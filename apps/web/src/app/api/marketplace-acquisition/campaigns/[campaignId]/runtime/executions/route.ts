import { type NextRequest, NextResponse } from "next/server";
import { readJsonBody, RequestBodyError } from "@/lib/api/request-body";
import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import { createPrismaRepositories, PersistenceError, PrismaCampaignRuntimeExecutionRepository, PrismaMarketplaceDiscoveryRepository, PrismaSellerAcquisitionCampaignRepository, type PrismaPersistenceClient } from "@whisperm/repositories";
import { CampaignRuntimeService, DiscoveryExecutionWorker, MarketplaceDiscoveryService } from "@whisperm/services";
import { JijiDiscoveryProvider } from "@whisperm/provider-adapters";
import { createAcquisitionUsageMetering } from "@/lib/marketplace-acquisition/acquisition-services";
import { z } from "zod";

const requestSchema = z.object({ trigger: z.enum(["MANUAL", "SCHEDULED", "SYSTEM"]).optional() }).strict().default({});

const errorResponse = (message: string, status: number) =>
  NextResponse.json({ ok: false, error: { message } }, { status });

interface RouteContext {
  readonly params: { readonly campaignId: string };
}

const MARKETPLACE_SOURCES: Readonly<Record<string, { readonly key: string; readonly name: string; readonly sourceUrl: string }>> = {
  jiji: { key: "jiji", name: "Jiji", sourceUrl: "https://jiji.com.gh" },
};

const runtimeService = () => {
  const persistence = prisma as unknown as PrismaPersistenceClient;
  const campaigns = new PrismaSellerAcquisitionCampaignRepository(persistence);
  const discoveryRepo = new PrismaMarketplaceDiscoveryRepository(persistence);
  const discoveryService = new MarketplaceDiscoveryService({
    discoveryRepo,
    usageMetering: createAcquisitionUsageMetering(createPrismaRepositories(persistence)),
  });
  const worker = new DiscoveryExecutionWorker({
    campaigns,
    discoveryService,
    providers: [new JijiDiscoveryProvider()],
    resolveMarketplaceSourceId: async ({ tenantId, marketplaceSourceKey }) => {
      const definition = MARKETPLACE_SOURCES[marketplaceSourceKey.trim().toLowerCase()];
      if (definition === undefined) throw new Error(`Unsupported marketplace source ${marketplaceSourceKey}`);
      const source = await prisma.marketplaceSource.upsert({
        where: { tenantId_key: { tenantId, key: definition.key } },
        create: { tenantId, key: definition.key, name: definition.name, sourceUrl: definition.sourceUrl, isActive: true },
        update: { name: definition.name, sourceUrl: definition.sourceUrl, isActive: true },
        select: { id: true },
      });
      return source.id;
    },
  });
  return new CampaignRuntimeService({
    campaigns,
    executions: new PrismaCampaignRuntimeExecutionRepository(persistence),
    worker,
  });
};

export async function GET(request: NextRequest, context: RouteContext) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return errorResponse("Unauthorized", 401);

  const { tenant } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  const limitParam = request.nextUrl.searchParams.get("limit");
  const parsedLimit = limitParam === null ? undefined : Number.parseInt(limitParam, 10);
  const limit = parsedLimit === undefined || !Number.isFinite(parsedLimit) ? undefined : Math.min(Math.max(parsedLimit, 1), 100);
  const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
  const page = await runtimeService().listCampaignExecutions(
    { tenantId: tenant.id },
    context.params.campaignId,
    { ...(limit === undefined ? {} : { limit }), ...(cursor === undefined ? {} : { cursor }) },
  );

  return NextResponse.json({ ok: true, data: { executions: page.items, nextCursor: page.nextCursor } });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return errorResponse("Unauthorized", 401);

  const { tenant } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  let body: unknown = {};
  try {
    body = await readJsonBody(request, { maxBytes: 4_000 });
  } catch (error) {
    if (error instanceof RequestBodyError) return errorResponse(error.message, error.status);
  }

  const parsed = requestSchema.safeParse(body ?? {});
  if (!parsed.success) return errorResponse("Invalid campaign runtime execution request.", 400);

  try {
    const execution = await runtimeService().startCampaignExecution(
      { tenantId: tenant.id },
      { campaignId: context.params.campaignId, trigger: parsed.data.trigger ?? "MANUAL" },
    );
    if (execution.status === "FAILED") {
      return NextResponse.json(
        { ok: false, error: { message: execution.errorMessage ?? "Campaign runtime execution is not supported.", code: execution.errorCode ?? "CAMPAIGN_RUNTIME_WORKER_FAILED" } },
        { status: 502 },
      );
    }
    return NextResponse.json({ data: { execution } }, { status: 201 });
  } catch (error) {
    if (error instanceof PersistenceError) return errorResponse(error.message, error.status);
    return errorResponse("Campaign runtime execution failed.", 500);
  }
}