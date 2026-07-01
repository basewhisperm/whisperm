import { type NextRequest, NextResponse } from "next/server";
import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import { createPrismaRepositories, type PrismaPersistenceClient } from "@whisperm/repositories";
import { createWhispeRMServices } from "@whisperm/services";
import { z } from "zod";

const paramsSchema = z.object({ campaignId: z.string().trim().min(1) });

const errorResponse = (message: string, status: number) => NextResponse.json({ ok: false, error: { message } }, { status });

const parseLimit = (value: string | null): number | undefined => {
  if (value === null || value.trim().length === 0) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(Math.max(parsed, 1), 100);
};

interface RouteContext {
  readonly params: { readonly campaignId: string };
}

export async function GET(request: NextRequest, context: RouteContext) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return errorResponse("Unauthorized", 401);

  const { tenant } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  const parsedParams = paramsSchema.safeParse(context.params);
  if (!parsedParams.success) return errorResponse("Invalid campaign id.", 400);

  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
  const page = {
    ...(limit === undefined ? {} : { limit }),
    ...(cursor === undefined ? {} : { cursor }),
  };

  const repositories = createPrismaRepositories(prisma as unknown as PrismaPersistenceClient);
  const services = createWhispeRMServices(repositories);
  const result = await services.sellerAcquisitionRecords.listByCampaignId(
    { tenantId: tenant.id },
    parsedParams.data.campaignId,
    page,
  );

  return NextResponse.json({ ok: true, data: { records: result.records, nextCursor: result.nextCursor } });
}
