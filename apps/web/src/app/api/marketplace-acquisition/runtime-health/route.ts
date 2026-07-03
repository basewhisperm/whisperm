import { NextResponse } from "next/server";

import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import {
  createPrismaRepositories,
  PrismaCampaignRuntimeExecutionRepository,
  type PrismaPersistenceClient,
} from "@whisperm/repositories";
import { AcquisitionRuntimeHealthService } from "@whisperm/services";

const errorResponse = (message: string, status: number) => NextResponse.json({ ok: false, error: { message } }, { status });

// CS-021: thin read-model route -- computation lives entirely in
// AcquisitionRuntimeHealthService, which aggregates the existing canonical
// campaign/execution/deal/capture/claim repositories. This route only
// authenticates, gates the feature flag, and delegates.
const runtimeHealthService = () => {
  const persistence = prisma as unknown as PrismaPersistenceClient;
  const repositories = createPrismaRepositories(persistence);
  return new AcquisitionRuntimeHealthService({
    campaigns: repositories.sellerAcquisitionCampaigns,
    executions: new PrismaCampaignRuntimeExecutionRepository(persistence),
    deals: repositories.deals,
    claimTokens: repositories.marketplaceClaimTokens,
    marketplaceCaptures: repositories.marketplaceCaptures,
  });
};

export async function GET() {
  const tenant = await getTenantForCurrentUser();
  if (!tenant) return errorResponse("Unauthorized", 401);
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  try {
    const snapshot = await runtimeHealthService().getRuntimeHealth({ tenantId: tenant.id });
    return NextResponse.json({ ok: true, data: snapshot });
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { readonly status: unknown }).status) : 500;
    const message = error instanceof Error ? error.message : "Failed to load acquisition runtime health.";
    return errorResponse(message, Number.isFinite(status) ? status : 500);
  }
}
