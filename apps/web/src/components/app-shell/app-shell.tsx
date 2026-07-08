"use client";

import { useState, type ReactNode } from "react";

import { Sidebar } from "@/components/app-shell/sidebar";
import { TopBar } from "@/components/app-shell/top-bar";

export function AppShell({ children, enabledFeatures }: { readonly children: ReactNode; readonly enabledFeatures?: readonly string[] }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex h-dvh overflow-x-hidden bg-background text-foreground">
      <a
        className="sr-only z-50 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
        href="#main-content"
      >
        Skip to main content
      </a>
      <Sidebar
        enabledFeatures={enabledFeatures ?? []}
        mobileOpen={mobileNavOpen}
        onMobileOpenChange={setMobileNavOpen}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar mobileNavOpen={mobileNavOpen} onToggleMobileNav={() => setMobileNavOpen((open) => !open)} />
        <div className="min-h-0 flex-1 overflow-y-auto" id="main-content" tabIndex={-1}>
          <div className="mx-auto w-full max-w-content px-4 py-5 sm:px-5">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
