import { type NextRequest, NextResponse } from "next/server";
import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import {
  PrismaMarketplaceDiscoveryRepository,
  PrismaMarketplaceAcquisitionRepository,
  PrismaSellerAcquisitionCampaignRepository,
  type PrismaPersistenceClient,
} from "@whisperm/repositories";
import { MarketplaceDiscoveryService, DiscoveryPromotionError } from "@whisperm/services";

const errorResponse = (message: string, status: number) =>
  NextResponse.json({ ok: false, error: { message } }, { status });

interface RouteContext {
  readonly params: { readonly campaignId: string; readonly sellerId: string };
}

export async function POST(_request: NextRequest, context: RouteContext) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return errorResponse("Unauthorized", 401);

  const { tenant } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  const campaignId = decodeURIComponent(context.params.campaignId);
  const sellerId = decodeURIComponent(context.params.sellerId);

  const client = prisma as unknown as PrismaPersistenceClient;
  const service = new MarketplaceDiscoveryService({
    discoveryRepo: new PrismaMarketplaceDiscoveryRepository(client),
    marketplaceCaptures: new PrismaMarketplaceAcquisitionRepository(client),
    campaigns: new PrismaSellerAcquisitionCampaignRepository(client),
  });

  try {
    const result = await service.promoteSellerToCapture(
      { tenantId: tenant.id, actorId: tenant.id },
      campaignId,
      sellerId,
    );
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    if (error instanceof DiscoveryPromotionError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse("Failed to add seller to campaign.", 500);
  }
}
