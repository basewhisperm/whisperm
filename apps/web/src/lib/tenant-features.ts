import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { SELLER_ACQUISITION_FEATURE } from "@/lib/tenant-feature-keys";

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

export type TenantFeatureResult =
  | { readonly ok: true; readonly enabled: boolean }
  | { readonly ok: false; readonly code: "TENANT_REQUIRED" | "LOOKUP_FAILED"; readonly message: string };

/**
 * Richer feature-flag check that lets callers distinguish "explicitly
 * disabled" from "we couldn't tell" (missing tenant vs. a failed lookup),
 * instead of collapsing every non-enabled outcome into the same boolean.
 * Still fails closed: `getTenantFeatureState(...).enabled` is only ever
 * `true` when the flag was actually read as enabled.
 */
export async function getTenantFeatureState(
  tenantId: string | null | undefined,
  featureKey: string,
): Promise<TenantFeatureResult> {
  if (!tenantId) {
    return { ok: false, code: "TENANT_REQUIRED", message: "No workspace was provided for this feature check." };
  }

  try {
    const feature = await prisma.tenantFeature.findUnique({
      where: { tenantId_featureKey: { tenantId, featureKey } },
      select: { enabled: true },
    });

    return { ok: true, enabled: feature?.enabled === true };
  } catch (error) {
    console.error("tenant_feature_state_lookup_failed", {
      tenantId,
      featureKey,
      error: error instanceof Error ? error.message : "Unknown tenant feature lookup error",
    });

    return { ok: false, code: "LOOKUP_FAILED", message: "Feature flag lookup failed." };
  }
}

/** Legacy boolean wrapper. Fails closed on any non-`true` outcome, including a failed lookup. */
export async function isTenantFeatureEnabled(
  tenantId: string,
  featureKey: string,
): Promise<boolean> {
  const result = await getTenantFeatureState(tenantId, featureKey);
  return result.ok && result.enabled;
}

export async function requireTenantFeature(
  tenantId: string,
  featureKey: string,
): Promise<boolean> {
  return isTenantFeatureEnabled(tenantId, featureKey);
}

export async function isProtectedTenantFeatureEnabled(
  tenantId: string,
  featureKey: string,
): Promise<boolean> {
  try {
    return await isTenantFeatureEnabled(tenantId, featureKey);
  } catch (error) {
    console.error("protected_tenant_feature_lookup_failed", {
      tenantId,
      featureKey,
      error: error instanceof Error ? error.message : "Unknown protected tenant feature lookup error",
    });

    return false;
  }
}

export async function requireSellerAcquisitionFeatureForApi(tenantId: string): Promise<NextResponse | null> {
  const enabled = await isProtectedTenantFeatureEnabled(tenantId, SELLER_ACQUISITION_FEATURE);
  return enabled ? null : featureNotEnabledResponse();
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
