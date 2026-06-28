import { type NextRequest, NextResponse } from "next/server";
import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import { PrismaSellerAcquisitionCampaignRepository, type PrismaPersistenceClient } from "@whisperm/repositories";
import { SellerAcquisitionCampaignService } from "@whisperm/services";

const errorResponse = (message: string, status: number) =>
  NextResponse.json({ ok: false, error: { message } }, { status });

interface RouteContext {
  readonly params: { readonly campaignId: string; readonly memberId: string };
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return errorResponse("Unauthorized", 401);

  const { tenant } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  const service = new SellerAcquisitionCampaignService(
    new PrismaSellerAcquisitionCampaignRepository(prisma as unknown as PrismaPersistenceClient),
  );
  const member = await service.removeSeller({ tenantId: tenant.id }, context.params.campaignId, context.params.memberId);

  return NextResponse.json({ ok: true, data: { member } });
}
