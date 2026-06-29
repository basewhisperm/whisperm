import { type NextRequest, NextResponse } from "next/server";
import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import {
  PrismaMarketplaceDiscoveryRepository,
  type PrismaPersistenceClient,
} from "@whisperm/repositories";
import { MarketplaceDiscoveryService } from "@whisperm/services/src/marketplace-acquisition/discovery-service.js";

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

  const sellerId = decodeURIComponent(context.params.sellerId);
  const repo = new PrismaMarketplaceDiscoveryRepository(prisma as unknown as PrismaPersistenceClient);
  const service = new MarketplaceDiscoveryService({ discoveryRepo: repo });

  const updated = await service.rejectSeller(
    { tenantId: tenant.id, actorId: tenant.id },
    sellerId,
  );

  return NextResponse.json({ ok: true, data: { seller: updated } });
}
