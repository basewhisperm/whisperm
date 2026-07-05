import { type NextRequest, NextResponse } from "next/server";
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

const errorResponse = (message: string, status: number) =>
  NextResponse.json({ ok: false, error: { message } }, { status });

interface RouteContext {
  readonly params: { readonly campaignId: string; readonly sellerId: string };
}

export async function POST(_request: NextRequest, context: RouteContext) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return errorResponse("Unauthorized", 401);

  const { tenant, tenantUserId } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  const campaignId = decodeURIComponent(context.params.campaignId);
  const sellerId = decodeURIComponent(context.params.sellerId);

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
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    if (error instanceof DiscoveryPromotionError) {
      return errorResponse(error.message, error.status);
    }
    if (error instanceof ServiceError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse("Failed to add seller to campaign.", 500);
  }
}
