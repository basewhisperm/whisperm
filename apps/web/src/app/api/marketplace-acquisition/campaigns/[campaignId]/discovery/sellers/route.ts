import { type NextRequest, NextResponse } from "next/server";
import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import {
  PrismaMarketplaceDiscoveryRepository,
  type PrismaPersistenceClient,
  type DiscoveredSellerRecord,
} from "@whisperm/repositories";

const errorResponse = (message: string, status: number) =>
  NextResponse.json({ ok: false, error: { message } }, { status });

interface RouteContext {
  readonly params: { readonly campaignId: string };
}

export async function GET(request: NextRequest, context: RouteContext) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return errorResponse("Unauthorized", 401);

  const { tenant } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  const campaignId = decodeURIComponent(context.params.campaignId);
  const statusParam = request.nextUrl.searchParams.get("status") as DiscoveredSellerRecord["status"] | null;

  const repo = new PrismaMarketplaceDiscoveryRepository(prisma as unknown as PrismaPersistenceClient);
  const sellers = await repo.listDiscoveredSellersByCampaign(
    { tenantId: tenant.id },
    campaignId,
    statusParam ?? undefined,
  );

  return NextResponse.json({ ok: true, data: { sellers, total: sellers.length } });
}
