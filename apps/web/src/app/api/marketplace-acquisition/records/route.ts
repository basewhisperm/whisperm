import { NextResponse } from "next/server";

import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { featureNotEnabledResponse, isTenantFeatureEnabled, SELLER_ACQUISITION_FEATURE } from "@/lib/tenant-features";
import { createPrismaRepositories, type PrismaPersistenceClient } from "@whisperm/repositories";
import { createWhispeRMServices } from "@whisperm/services";

const errorResponse = (message: string, status: number) => NextResponse.json({ ok: false, error: { message } }, { status });

export async function GET() {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return errorResponse("Unauthorized", 401);
  const { tenant } = tenantContext;
  const featureEnabled = await isTenantFeatureEnabled(tenant.id, SELLER_ACQUISITION_FEATURE);
  if (!featureEnabled) return featureNotEnabledResponse();

  const repositories = createPrismaRepositories(prisma as unknown as PrismaPersistenceClient);
  const services = createWhispeRMServices(repositories);
  const records = await services.sellerAcquisitionRecords.list({ tenantId: tenant.id });

  return NextResponse.json({ ok: true, data: { records } });
}
