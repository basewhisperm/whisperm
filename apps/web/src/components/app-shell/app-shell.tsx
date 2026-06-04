import type { ReactNode } from "react";

import { Sidebar } from "@/components/app-shell/sidebar";
import { TopBar } from "@/components/app-shell/top-bar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh bg-background text-foreground">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-content px-4 py-5 sm:px-5">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
