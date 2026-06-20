import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { isTenantFeatureEnabled, SELLER_ACQUISITION_FEATURE } from "@/lib/tenant-features";

export default async function MarketplaceAcquisitionLayout({ children }: { readonly children: ReactNode }) {
  const tenant = await getTenantForCurrentUser();

  if (!tenant) notFound();

  const enabled = await isTenantFeatureEnabled(tenant.id, SELLER_ACQUISITION_FEATURE);
  if (!enabled) notFound();

  return children;
}
