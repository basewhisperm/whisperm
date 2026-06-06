import { AppShell } from "@/components/app-shell/app-shell";
import { WorkspaceProvider } from "@/lib/workspace-context";
import type { ReactNode } from "react";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <WorkspaceProvider>
      <AppShell>{children}</AppShell>
    </WorkspaceProvider>
  );
}
