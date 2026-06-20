import { NextRequest, NextResponse } from "next/server";

import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { featureNotEnabledResponse, isTenantFeatureEnabled, SELLER_ACQUISITION_FEATURE } from "@/lib/tenant-features";
import { PrismaMarketplaceAcquisitionRepository } from "@whisperm/repositories";
import { SellerAcquisitionAnalyticsService } from "@whisperm/services";

export async function GET(request: NextRequest) {
  const tenant = await getTenantForCurrentUser();
  if (!tenant) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const featureEnabled = await isTenantFeatureEnabled(tenant.id, SELLER_ACQUISITION_FEATURE);
  if (!featureEnabled) return featureNotEnabledResponse();

  const repository = new PrismaMarketplaceAcquisitionRepository(prisma as any);
  const service = new SellerAcquisitionAnalyticsService({ repository });
  const filters = Object.fromEntries(request.nextUrl.searchParams.entries());
  const analytics = await service.get({ tenantId: tenant.id }, filters);
  return NextResponse.json({ ok: true, data: analytics });
}
