import { NextResponse } from "next/server";

import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import { createPrismaRepositories, type PrismaPersistenceClient } from "@whisperm/repositories";
import { createWhispeRMServices } from "@whisperm/services";

const errorResponse = (message: string, status: number) => NextResponse.json({ ok: false, error: { message } }, { status });

interface RouteContext {
  readonly params: { readonly captureId: string };
}

export async function GET(_request: Request, context: RouteContext) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return errorResponse("Unauthorized", 401);
  const { tenant } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  const repositories = createPrismaRepositories(prisma as unknown as PrismaPersistenceClient);
  const services = createWhispeRMServices(repositories);
  const record = await services.sellerAcquisitionRecords.findByCaptureId({ tenantId: tenant.id }, context.params.captureId);
  if (record === null) return errorResponse("Marketplace capture not found.", 404);

  return NextResponse.json({ ok: true, data: { record } });
}
