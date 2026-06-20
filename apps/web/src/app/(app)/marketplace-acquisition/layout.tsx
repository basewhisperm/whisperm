import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { isProtectedTenantFeatureEnabled, SELLER_ACQUISITION_FEATURE } from "@/lib/tenant-features";

export default async function MarketplaceAcquisitionLayout({ children }: { readonly children: ReactNode }) {
  const tenant = await getTenantForCurrentUser();

  if (!tenant) notFound();

  const enabled = await isProtectedTenantFeatureEnabled(tenant.id, SELLER_ACQUISITION_FEATURE);
  if (!enabled) notFound();

  return children;
}
