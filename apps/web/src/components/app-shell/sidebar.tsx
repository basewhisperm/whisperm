"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton, useUser } from "@clerk/nextjs";
import { t, type TranslationKey } from "@/lib/i18n";
import { WorkspaceSelector } from "@/components/ui/workspace-selector";
import {
  IconLayoutDashboard,
  IconSettings,
  IconUsers,
  IconBriefcase,
  IconChartBar,
  IconBookmark,
  IconMenu2,
  IconX,
} from "@tabler/icons-react";

const navigationItems = [
  { labelKey: "dashboard.title", icon: IconLayoutDashboard, href: "/dashboard" },
  { labelKey: "contacts.title", icon: IconUsers, href: "/contacts" },
  { labelKey: "deals.title", icon: IconBriefcase, href: "/deals" },
  { labelKey: "marketplaceAcquisition.title", icon: IconBookmark, href: "/marketplace-acquisition" },
  { labelKey: "reports.title", icon: IconChartBar, href: "/reports" },
  { labelKey: "marketplaceCapture.title", icon: IconBookmark, href: "/marketplace-acquisition/capture" },
  { labelKey: "settings.title", icon: IconSettings, href: "/settings" },
] satisfies readonly { readonly labelKey: TranslationKey; readonly icon: typeof IconLayoutDashboard; readonly href: string }[];

function NavigationLinks({ onNavigate }: { readonly onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label={t("navigation.primary")} className="flex-1 px-3 py-2">
      <p className="px-2 text-xs font-medium uppercase tracking-[0.16em] text-ivory/50">
        {t("navigation.section.crm")}
      </p>
      <div className="mt-3 space-y-1">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          return (
            <Link
              {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pulse ${
                isActive
                  ? "bg-whisper text-ivory shadow-sm"
                  : "text-ivory/70 hover:bg-ivory/10 hover:text-ivory"
              }`}
              href={item.href}
              key={item.labelKey}
            >
              <Icon aria-hidden="true" className="size-4" stroke={isActive ? 2 : 1.8} />
              {t(item.labelKey)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function SidebarProfile() {
  const { user } = useUser();

  return (
    <div className="border-t-hairline p-4">
      <div className="flex items-center gap-3 rounded-2xl bg-ivory/10 p-3">
        <UserButton
          appearance={{ elements: { avatarBox: "size-8" } }}
          afterSignOutUrl="/sign-in"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ivory">
            {user?.firstName ?? user?.emailAddresses[0]?.emailAddress ?? "User"}
          </p>
          <p className="truncate text-xs text-ivory/65">
            {user?.emailAddresses[0]?.emailAddress ?? ""}
          </p>
        </div>
      </div>
    </div>
  );
}

export function Sidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <button
        aria-controls="mobile-primary-navigation"
        aria-expanded={mobileOpen}
        aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
        className="fixed left-4 top-4 z-50 inline-flex size-11 items-center justify-center rounded-full bg-midnight text-ivory shadow-lg transition hover:bg-midnight/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pulse focus-visible:ring-offset-2 focus-visible:ring-offset-background md:hidden"
        onClick={() => setMobileOpen((open) => !open)}
        type="button"
      >
        {mobileOpen ? (
          <IconX aria-hidden="true" className="size-5" />
        ) : (
          <IconMenu2 aria-hidden="true" className="size-5" />
        )}
      </button>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            aria-label="Close navigation menu overlay"
            className="absolute inset-0 bg-midnight/60"
            onClick={() => setMobileOpen(false)}
            type="button"
          />
          <aside
            className="relative flex h-dvh w-[min(82vw,280px)] flex-col border-r-hairline bg-midnight text-ivory shadow-xl"
            id="mobile-primary-navigation"
          >
            <div className="border-b-hairline px-5 py-5 pl-16">
              <p className="text-lg font-semibold tracking-tight">{t("app.name")}</p>
            </div>
            <div className="px-4 py-4">
              <WorkspaceSelector />
            </div>
            <NavigationLinks onNavigate={() => setMobileOpen(false)} />
            <SidebarProfile />
          </aside>
        </div>
      ) : null}

      <aside className="hidden h-dvh w-[196px] shrink-0 border-r-hairline bg-midnight text-ivory md:flex md:flex-col">
        <div className="border-b-hairline px-5 py-5">
          <p className="text-lg font-semibold tracking-tight">{t("app.name")}</p>
        </div>
        <div className="px-4 py-4">
          <WorkspaceSelector />
        </div>
        <NavigationLinks />
        <SidebarProfile />
      </aside>
    </>
  );
}
