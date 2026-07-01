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
  const rawStatus = request.nextUrl.searchParams.get("status");
  const allowedStatuses: readonly DiscoveredSellerRecord["status"][] = ["NEW", "QUALIFYING", "PENDING", "QUALIFIED", "NEEDS_REVIEW", "REJECTED", "DUPLICATE", "PROMOTED"];
  const statusParam = rawStatus !== null && allowedStatuses.includes(rawStatus as DiscoveredSellerRecord["status"])
    ? rawStatus as DiscoveredSellerRecord["status"]
    : undefined;

  const repo = new PrismaMarketplaceDiscoveryRepository(prisma as unknown as PrismaPersistenceClient);
  const sellers = await repo.listDiscoveredSellersByCampaign(
    { tenantId: tenant.id },
    campaignId,
    statusParam,
  );

  return NextResponse.json({ ok: true, data: { sellers, total: sellers.length } });
}
