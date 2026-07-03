import { NextRequest, NextResponse } from "next/server";

import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import {
  createPrismaRepositories,
  PrismaCampaignRuntimeExecutionRepository,
  type PrismaPersistenceClient,
} from "@whisperm/repositories";
import { AcquisitionCommandCenterService } from "@whisperm/services";

const errorResponse = (message: string, status: number) => NextResponse.json({ ok: false, error: { message } }, { status });

// CS-020: thin read-model route -- computation lives entirely in
// AcquisitionCommandCenterService, which aggregates the existing canonical
// campaign/member/deal repositories. This route only authenticates,
// gates the feature flag, and delegates.
const commandCenterService = () => {
  const persistence = prisma as unknown as PrismaPersistenceClient;
  const repositories = createPrismaRepositories(persistence);
  return new AcquisitionCommandCenterService({
    campaigns: repositories.sellerAcquisitionCampaigns,
    executions: new PrismaCampaignRuntimeExecutionRepository(persistence),
    deals: repositories.deals,
    claimTokens: repositories.marketplaceClaimTokens,
    opportunities: repositories.businessGrowthOpportunities,
  });
};

export async function GET(request: NextRequest) {
  const tenant = await getTenantForCurrentUser();
  if (!tenant) return errorResponse("Unauthorized", 401);
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  const campaignIdParam = request.nextUrl.searchParams.get("campaignId");
  const campaignId = campaignIdParam !== null && campaignIdParam.trim().length > 0 ? campaignIdParam : undefined;

  try {
    const snapshot = await commandCenterService().getSnapshot({ tenantId: tenant.id }, { campaignId });
    return NextResponse.json({ ok: true, data: snapshot });
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { readonly status: unknown }).status) : 500;
    const message = error instanceof Error ? error.message : "Failed to load acquisition command center.";
    return errorResponse(message, Number.isFinite(status) ? status : 500);
  }
}
