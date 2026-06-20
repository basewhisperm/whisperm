import { AppShell } from "@/components/app-shell/app-shell";
import { WorkspaceProvider } from "@/lib/workspace-context";
import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { getTenantFeatures } from "@/lib/tenant-features";
import type { ReactNode } from "react";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const tenant = await getTenantForCurrentUser();
  const enabledFeatures = tenant ? await getTenantFeatures(tenant.id) : [];

  return (
    <WorkspaceProvider>
      <AppShell enabledFeatures={enabledFeatures}>{children}</AppShell>
    </WorkspaceProvider>
  );
}
