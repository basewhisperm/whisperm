import { type NextRequest, NextResponse } from "next/server";
import { readJsonBody, RequestBodyError } from "@/lib/api/request-body";
import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import { PrismaSellerAcquisitionCampaignRepository, type PrismaPersistenceClient } from "@whisperm/repositories";
import { SellerAcquisitionCampaignService } from "@whisperm/services";

const errorResponse = (message: string, status: number) =>
  NextResponse.json({ ok: false, error: { message } }, { status });

interface RouteContext {
  readonly params: { readonly campaignId: string };
}

const campaignService = () =>
  new SellerAcquisitionCampaignService(
    new PrismaSellerAcquisitionCampaignRepository(prisma as unknown as PrismaPersistenceClient),
  );

export async function GET(_request: NextRequest, context: RouteContext) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return errorResponse("Unauthorized", 401);

  const { tenant } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  const campaign = await campaignService().findById({ tenantId: tenant.id }, context.params.campaignId);
  if (campaign === null) return errorResponse("Seller acquisition campaign not found.", 404);

  return NextResponse.json({ ok: true, data: { campaign } });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
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

  const service = campaignService();
  const input = body as { readonly archive?: boolean };
  const campaign = input.archive === true
    ? await service.archive({ tenantId: tenant.id }, context.params.campaignId)
    : await service.update({ tenantId: tenant.id }, context.params.campaignId, body as never);

  return NextResponse.json({ ok: true, data: { campaign } });
}
