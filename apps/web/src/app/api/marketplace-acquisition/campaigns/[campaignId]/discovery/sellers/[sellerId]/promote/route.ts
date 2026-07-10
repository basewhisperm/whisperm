import { type NextRequest } from "next/server";
import { apiFailure, apiSuccess } from "@/app/api/_lib/api-response";
import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import {
  PrismaMarketplaceDiscoveryRepository,
  PrismaSellerAcquisitionCampaignRepository,
  type PrismaPersistenceClient,
} from "@whisperm/repositories";
import { MarketplaceDiscoveryService, DiscoveryPromotionError, ServiceError } from "@whisperm/services";
import { createAcquisitionServiceBundle } from "@/lib/marketplace-acquisition/acquisition-services";

interface RouteContext {
  readonly params: { readonly campaignId: string; readonly sellerId: string };
}

export async function POST(_request: NextRequest, context: RouteContext) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return apiFailure(401, "UNAUTHORIZED", "Unauthorized");

  const { tenant, tenantUserId } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  const campaignId = decodeURIComponent(context.params.campaignId).trim();
  const sellerId = decodeURIComponent(context.params.sellerId).trim();
  if (campaignId.length === 0) return apiFailure(400, "VALIDATION_ERROR", "campaignId is required.");
  if (sellerId.length === 0) return apiFailure(400, "VALIDATION_ERROR", "sellerId is required.");

  const client = prisma as unknown as PrismaPersistenceClient;
  // ST1-006: discovery promotion routes through the same canonical capture pipeline
  // (MarketplaceAcquisitionCaptureService.capture) used by manual and URL capture.
  const { services, usageMetering } = createAcquisitionServiceBundle();
  const service = new MarketplaceDiscoveryService({
    discoveryRepo: new PrismaMarketplaceDiscoveryRepository(client),
    canonicalCapture: services.marketplaceAcquisition,
    campaigns: new PrismaSellerAcquisitionCampaignRepository(client),
    usageMetering,
  });

  try {
    const result = await service.promoteSellerToCapture(
      { tenantId: tenant.id, actorId: tenantUserId },
      campaignId,
      sellerId,
    );
    return apiSuccess(result);
  } catch (error) {
    if (error instanceof DiscoveryPromotionError) {
      const code = error.code === "CAMPAIGN_MISMATCH" ? "SELLER_NOT_IN_CAMPAIGN" : error.code === "SELLER_NOT_FOUND" || error.code === "CAMPAIGN_NOT_FOUND" ? "NOT_FOUND" : error.code === "INSUFFICIENT_CAPTURE_DATA" ? "VALIDATION_ERROR" : error.code === "CAPTURE_ASSIGNMENT_FAILED" ? "CAPTURE_ASSIGNMENT_FAILED" : "INTERNAL_ERROR";
      return apiFailure(error.status, code, error.message);
    }
    if (error instanceof ServiceError) {
      return apiFailure(error.status, "INTERNAL_ERROR", error.message);
    }
    return apiFailure(500, "INTERNAL_ERROR", "Failed to add seller to campaign.");
  }
}
