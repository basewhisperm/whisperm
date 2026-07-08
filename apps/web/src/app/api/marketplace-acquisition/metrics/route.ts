import { NextRequest, NextResponse } from "next/server";

import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import { createPrismaRepositories, type PrismaPersistenceClient } from "@whisperm/repositories";
import { createWhispeRMServices, AcquisitionMetricsService, SellerAcquisitionCampaignService } from "@whisperm/services";

const errorResponse = (message: string, status: number) => NextResponse.json({ ok: false, error: { message } }, { status });

// ST1-013E: thin read-model route -- every acquisition metric on every
// screen (Dashboard, Workbench, Campaigns, Bulk Invitation, Command Center)
// is computed exactly once, here, by AcquisitionMetricsService. This route
// only authenticates, gates the feature flag, and delegates.
const metricsService = () => {
  const repositories = createPrismaRepositories(prisma as unknown as PrismaPersistenceClient);
  const services = createWhispeRMServices(repositories);
  return new AcquisitionMetricsService({
    sellerAcquisitionRecords: services.sellerAcquisitionRecords,
    sellerAcquisitionCampaigns: new SellerAcquisitionCampaignService(repositories.sellerAcquisitionCampaigns),
  });
};

export async function GET(request: NextRequest) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return errorResponse("Unauthorized", 401);

  const { tenant } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  const campaignId = request.nextUrl.searchParams.get("campaignId")?.trim() || undefined;

  try {
    const service = metricsService();
    const metrics = campaignId === undefined
      ? await service.getGlobalMetrics({ tenantId: tenant.id })
      : await service.getCampaignMetrics({ tenantId: tenant.id }, campaignId);
    return NextResponse.json({ ok: true, data: { metrics } });
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { readonly status: unknown }).status) : 500;
    const message = error instanceof Error ? error.message : "Failed to load acquisition metrics.";
    return errorResponse(message, Number.isFinite(status) ? status : 500);
  }
}
