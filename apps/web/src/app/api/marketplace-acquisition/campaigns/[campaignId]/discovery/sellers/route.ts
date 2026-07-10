import { type NextRequest } from "next/server";
import { apiFailure, apiSuccess } from "@/app/api/_lib/api-response";
import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import {
  PrismaMarketplaceDiscoveryRepository,
  type PrismaPersistenceClient,
  type DiscoveredSellerRecord,
} from "@whisperm/repositories";

interface RouteContext {
  readonly params: { readonly campaignId: string };
}

export async function GET(request: NextRequest, context: RouteContext) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return apiFailure(401, "UNAUTHORIZED", "Unauthorized");

  const { tenant } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  const campaignId = decodeURIComponent(context.params.campaignId);
  if (campaignId.trim().length === 0) {
    return apiFailure(400, "VALIDATION_ERROR", "campaignId is required.");
  }

  const rawStatus = request.nextUrl.searchParams.get("status");
  const allowedStatuses: readonly DiscoveredSellerRecord["status"][] = ["NEW", "QUALIFYING", "PENDING", "QUALIFIED", "NEEDS_REVIEW", "REJECTED", "DUPLICATE", "PROMOTED"];
  if (rawStatus !== null && !allowedStatuses.includes(rawStatus as DiscoveredSellerRecord["status"])) {
    return apiFailure(400, "VALIDATION_ERROR", `status must be one of ${allowedStatuses.join(", ")}.`);
  }
  const statusParam = rawStatus !== null ? (rawStatus as DiscoveredSellerRecord["status"]) : undefined;

  const repo = new PrismaMarketplaceDiscoveryRepository(prisma as unknown as PrismaPersistenceClient);
  const sellers = await repo.listDiscoveredSellersByCampaign(
    { tenantId: tenant.id },
    campaignId,
    statusParam,
  );

  return apiSuccess({ sellers, total: sellers.length });
}
