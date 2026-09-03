import { NextRequest } from "next/server";
import { apiFailure, apiSuccess } from "@/app/api/_lib/api-response";
import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import { createPrismaRepositories, type PrismaPersistenceClient } from "@whisperm/repositories";
import { createWhispeRMServices } from "@whisperm/services";

const parseLimit = (value: string | null): number | undefined => {
  if (value === null || value.trim().length === 0) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(Math.max(parsed, 1), 100);
};

export async function GET(request: NextRequest) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return apiFailure(401, "UNAUTHORIZED", "Unauthorized");

  const { tenant } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  const rawLimit = request.nextUrl.searchParams.get("limit");
  if (rawLimit !== null && rawLimit.trim().length > 0 && !/^\d+$/u.test(rawLimit.trim())) {
    return apiFailure(400, "VALIDATION_ERROR", "limit must be a positive integer.");
  }
  const limit = parseLimit(rawLimit);
  const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
  const campaignId = request.nextUrl.searchParams.get("campaignId")?.trim() || undefined;

  const repositories = createPrismaRepositories(prisma as unknown as PrismaPersistenceClient);
  const services = createWhispeRMServices(repositories);
  const page = {
    ...(limit === undefined ? {} : { limit }),
    ...(cursor === undefined ? {} : { cursor }),
  };
  const result = campaignId === undefined
    ? await services.sellerAcquisitionRecords.list({ tenantId: tenant.id }, page)
    : await services.sellerAcquisitionRecords.listByCampaignId({ tenantId: tenant.id }, campaignId, page);

  return apiSuccess({ records: result.records, nextCursor: result.nextCursor });
}
