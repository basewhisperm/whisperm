import { type NextRequest, NextResponse } from "next/server";
import { readJsonBody, RequestBodyError } from "@/lib/api/request-body";
import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import { DISCOVERY_FEATURE, DISCOVERY_CREDITS_DEFAULT } from "@/lib/tenant-feature-keys";
import {
  PrismaMarketplaceDiscoveryRepository,
  type PrismaPersistenceClient,
} from "@whisperm/repositories";
import { MarketplaceDiscoveryService } from "@whisperm/services/src/marketplace-acquisition/discovery-service.js";

const errorResponse = (message: string, status: number) =>
  NextResponse.json({ ok: false, error: { message } }, { status });

interface RouteContext {
  readonly params: { readonly campaignId: string };
}

const makeDiscoveryService = () => {
  const repo = new PrismaMarketplaceDiscoveryRepository(prisma as unknown as PrismaPersistenceClient);
  return new MarketplaceDiscoveryService({ discoveryRepo: repo });
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

  // Check discovery feature and credits
  const discoveryFeature = await prisma.tenantFeature.findFirst({
    where: { tenantId: tenant.id, featureKey: DISCOVERY_FEATURE },
  });

  if (!discoveryFeature?.enabled) {
    return errorResponse("Discovery is a Pro feature. Upgrade to access automated seller discovery.", 403);
  }

  const creditsRemaining = (discoveryFeature.discoveryCredits ?? DISCOVERY_CREDITS_DEFAULT) -
    (discoveryFeature.discoveryCreditsUsed ?? 0);

  if (creditsRemaining <= 0) {
    return errorResponse("Discovery credits exhausted. Purchase more credits to continue.", 402);
  }

  let body: unknown;
  try {
    body = await readJsonBody(request, { maxBytes: 500_000 });
  } catch (error) {
    if (error instanceof RequestBodyError) return errorResponse(error.message, error.status);
    body = {};
  }

  const { marketplaceSourceId, marketplaceSourceKey, mode, entries } = body as {
    marketplaceSourceId?: string;
    marketplaceSourceKey?: string;
    mode?: string;
    entries?: unknown[];
  };

  if (!marketplaceSourceId || !marketplaceSourceKey) {
    return errorResponse("marketplaceSourceId and marketplaceSourceKey are required.", 400);
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    return errorResponse("entries must be a non-empty array.", 400);
  }
  if (entries.length > 500) {
    return errorResponse("Maximum 500 entries per discovery run.", 400);
  }

  const campaignId = decodeURIComponent(context.params.campaignId);
  const clampedEntries = entries.slice(0, creditsRemaining);

  const service = makeDiscoveryService();
  const result = await service.runDiscovery(
    { tenantId: tenant.id, actorId: tenant.id },
    {
      campaignId,
      marketplaceSourceId,
      marketplaceSourceKey,
      mode: (mode as "MANUAL_SEED" | "CSV_IMPORT") ?? "MANUAL_SEED",
      entries: clampedEntries as never,
      discoveryCreditsRemaining: creditsRemaining,
    },
  );

  // Deduct credits used
  await prisma.tenantFeature.update({
    where: { tenantId_featureKey: { tenantId: tenant.id, featureKey: DISCOVERY_FEATURE } },
    data: { discoveryCreditsUsed: { increment: result.creditsConsumed } },
  });

  return NextResponse.json({ ok: true, data: result }, { status: 201 });
}
