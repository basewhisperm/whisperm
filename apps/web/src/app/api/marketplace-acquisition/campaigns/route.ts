import { type NextRequest, NextResponse } from "next/server";
import { readJsonBody, RequestBodyError } from "@/lib/api/request-body";
import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import { PrismaSellerAcquisitionCampaignRepository, type PrismaPersistenceClient } from "@whisperm/repositories";
import { SellerAcquisitionCampaignService } from "@whisperm/services";

const errorResponse = (message: string, status: number) =>
  NextResponse.json({ ok: false, error: { message } }, { status });

const parseLimit = (value: string | null): number | undefined => {
  if (value === null || value.trim().length === 0) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(Math.max(parsed, 1), 100);
};

const campaignService = () =>
  new SellerAcquisitionCampaignService(
    new PrismaSellerAcquisitionCampaignRepository(prisma as unknown as PrismaPersistenceClient),
  );

export async function GET(request: NextRequest) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return errorResponse("Unauthorized", 401);

  const { tenant } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
  const page = await campaignService().list(
    { tenantId: tenant.id },
    { ...(limit === undefined ? {} : { limit }), ...(cursor === undefined ? {} : { cursor }) },
  );

  return NextResponse.json({ ok: true, data: { campaigns: page.items, nextCursor: page.nextCursor } });
}

export async function POST(request: NextRequest) {
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

  const campaign = await campaignService().create({ tenantId: tenant.id }, body as never);
  return NextResponse.json({ ok: true, data: { campaign } }, { status: 201 });
}
