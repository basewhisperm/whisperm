import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export { SELLER_ACQUISITION_FEATURE } from "@/lib/tenant-feature-keys";

export async function getTenantFeatures(tenantId: string): Promise<readonly string[]> {
  try {
    const features = await prisma.tenantFeature.findMany({
      where: { tenantId, enabled: true },
      orderBy: { featureKey: "asc" },
      select: { featureKey: true },
    });

    return features.map((feature) => feature.featureKey);
  } catch (error) {
    console.error("tenant_features_lookup_failed", {
      tenantId,
      error: error instanceof Error ? error.message : "Unknown tenant feature lookup error",
    });

    return [];
  }
}

export async function isTenantFeatureEnabled(
  tenantId: string,
  featureKey: string,
): Promise<boolean> {
  const feature = await prisma.tenantFeature.findUnique({
    where: { tenantId_featureKey: { tenantId, featureKey } },
    select: { enabled: true },
  });

  return feature?.enabled === true;
}

export async function requireTenantFeature(
  tenantId: string,
  featureKey: string,
): Promise<boolean> {
  return isTenantFeatureEnabled(tenantId, featureKey);
}

export function featureNotEnabledResponse(): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: {
        message: "Seller Acquisition add-on is not enabled for this workspace.",
        code: "FEATURE_NOT_ENABLED",
      },
    },
    { status: 403 },
  );
}
