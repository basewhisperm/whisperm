import { type NextRequest, NextResponse } from "next/server";
import { authorizeAcquisitionActionForApi } from "@/lib/acquisition-governance";
import { readJsonBody, RequestBodyError } from "@/lib/api/request-body";
import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import {
  createPrismaRepositories,
  PrismaMarketplaceDiscoveryRepository,
  type PrismaPersistenceClient,
} from "@whisperm/repositories";
import { MarketplaceDiscoveryService } from "@whisperm/services";
import { createAcquisitionUsageMetering } from "@/lib/marketplace-acquisition/acquisition-services";

const errorResponse = (message: string, status: number) =>
  NextResponse.json({ ok: false, error: { message } }, { status });

const MARKETPLACE_SOURCES = {
  jiji: { name: "Jiji", sourceUrl: "https://jiji.com.gh" },
  tonaton: { name: "Tonaton", sourceUrl: "https://tonaton.com" },
  facebook: { name: "Facebook Marketplace", sourceUrl: "https://www.facebook.com/marketplace" },
} as const;

type MarketplaceSourceKey = keyof typeof MARKETPLACE_SOURCES;

const marketplaceSourceKey = (value: unknown): MarketplaceSourceKey | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized in MARKETPLACE_SOURCES ? normalized as MarketplaceSourceKey : null;
};

const remainingDiscoveryAllowance = (
  limits: readonly { readonly key: string; readonly used: number; readonly limit: number | null }[],
): number => {
  const remaining = limits
    .filter((limit) => limit.key === "discovery.daily" || limit.key === "discovery.monthly")
    .map((limit) => limit.limit === null ? Number.POSITIVE_INFINITY : Math.max(0, limit.limit - limit.used));
  return remaining.length === 0 ? 0 : Math.min(...remaining);
};

interface RouteContext {
  readonly params: { readonly campaignId: string };
}

const makeDiscoveryService = () => {
  const persistence = prisma as unknown as PrismaPersistenceClient;
  const repo = new PrismaMarketplaceDiscoveryRepository(persistence);
  const usageMetering = createAcquisitionUsageMetering(createPrismaRepositories(persistence));
  return new MarketplaceDiscoveryService({ discoveryRepo: repo, usageMetering });
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return errorResponse("Unauthorized", 401);

  const { tenant } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  const campaignId = decodeURIComponent(context.params.campaignId);
  const repo = new PrismaMarketplaceDiscoveryRepository(prisma as unknown as PrismaPersistenceClient);
  const runs = await repo.listDiscoveryRunsByCampaign({ tenantId: tenant.id }, campaignId);
  const summary = await makeDiscoveryService().getRunSummary({ tenantId: tenant.id }, campaignId);

  return NextResponse.json({ ok: true, data: { runs, summary } });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return errorResponse("Unauthorized", 401);

  const { tenant } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  let body: unknown;
  try {
    body = await readJsonBody(request, { maxBytes: 500_000 });
  } catch (error) {
    if (error instanceof RequestBodyError) return errorResponse(error.message, error.status);
    body = {};
  }

  const { marketplaceSourceKey: rawMarketplaceSourceKey, mode, entries } = body as {
    marketplaceSourceKey?: string;
    mode?: string;
    entries?: unknown[];
  };

  const sourceKey = marketplaceSourceKey(rawMarketplaceSourceKey);
  if (sourceKey === null) return errorResponse("Choose a supported marketplace source.", 400);
  if (!Array.isArray(entries) || entries.length === 0) {
    return errorResponse("entries must be a non-empty array.", 400);
  }
  if (entries.length > 500) {
    return errorResponse("Maximum 500 entries per discovery run.", 400);
  }

  const campaignId = decodeURIComponent(context.params.campaignId);
  const campaign = await prisma.sellerAcquisitionCampaign.findFirst({
    where: { tenantId: tenant.id, id: campaignId },
    select: { status: true },
  });
  if (campaign === null) return errorResponse("Campaign not found.", 404);
  if (campaign.status !== "ACTIVE") return errorResponse("Activate this campaign before running discovery.", 409);

  const sourceDefinition = MARKETPLACE_SOURCES[sourceKey];
  const source = await prisma.marketplaceSource.upsert({
    where: { tenantId_key: { tenantId: tenant.id, key: sourceKey } },
    create: { tenantId: tenant.id, key: sourceKey, name: sourceDefinition.name, sourceUrl: sourceDefinition.sourceUrl, isActive: true },
    update: { name: sourceDefinition.name, sourceUrl: sourceDefinition.sourceUrl, isActive: true },
    select: { id: true },
  });

  const { decision, denied } = await authorizeAcquisitionActionForApi(tenant.id, {
    capability: "DISCOVERY",
    campaignId,
    requestedUnits: entries.length,
    provider: "DISCOVERY",
    source: "API",
  });
  if (denied) return denied;

  const allowance = remainingDiscoveryAllowance(decision.limits);
  if (allowance <= 0) return errorResponse("Discovery quota has been reached for this workspace.", 429);
  const clampedEntries = entries.slice(0, allowance);

  const service = makeDiscoveryService();
  let result;
  try {
    result = await service.runDiscovery(
    { tenantId: tenant.id, actorId: tenant.id },
    {
      campaignId,
      marketplaceSourceId: source.id,
      marketplaceSourceKey: sourceKey,
      mode: (mode as "MANUAL_SEED" | "CSV_IMPORT") ?? "MANUAL_SEED",
      entries: clampedEntries as never,
      // The discovery service uses this as a hard per-run ceiling. The
      // canonical governance decision above derives it from plan usage.
      discoveryCreditsRemaining: allowance,
    },
  );
  } catch (err) {
    console.error("[discovery/runs] runDiscovery failed:", err);
    return errorResponse(err instanceof Error ? err.message : "Discovery run failed internally.", 500);
  }

  return NextResponse.json({ ok: true, data: result }, { status: 201 });
}
