import { type NextRequest, NextResponse } from "next/server";
import { readJsonBody, RequestBodyError } from "@/lib/api/request-body";
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

export async function POST(request: NextRequest, context: RouteContext) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return errorResponse("Unauthorized", 401);

  const { tenant } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  let body: unknown;
  try {
    body = await readJsonBody(request, { maxBytes: 32_000 });
  } catch (error) {
    if (error instanceof RequestBodyError) return errorResponse(error.message, error.status);
    body = {};
  }

  const { captureId } = body as { captureId?: string };
  if (!captureId) return errorResponse("captureId is required.", 400);

  const sellerId = decodeURIComponent(context.params.sellerId);
  const repo = new PrismaMarketplaceDiscoveryRepository(prisma as unknown as PrismaPersistenceClient);
  const service = new MarketplaceDiscoveryService({ discoveryRepo: repo });

  const updated = await service.promoteSellerToCapture(
    { tenantId: tenant.id, actorId: tenant.id },
    sellerId,
    captureId,
  );

  return NextResponse.json({ ok: true, data: { seller: updated } });
}
