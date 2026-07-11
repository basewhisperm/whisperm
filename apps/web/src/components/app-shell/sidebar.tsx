"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton, useUser } from "@clerk/nextjs";
import {
  IconBookmark,
  IconBriefcase,
  IconChartBar,
  IconCircleCheck,
  IconCreditCard,
  IconInbox,
  IconLayoutDashboard,
  IconReportAnalytics,
  IconRocket,
  IconSend,
  IconSettings,
  IconUsers,
} from "@tabler/icons-react";
import { WorkspaceSelector } from "@/components/ui/workspace-selector";
import { t, type TranslationKey } from "@/lib/i18n";
import { SELLER_ACQUISITION_FEATURE } from "@/lib/tenant-feature-keys";

type NavigationItem = {
  readonly labelKey: TranslationKey;
  readonly icon: typeof IconLayoutDashboard;
  readonly href?: string;
  readonly disabled?: boolean;
};

type NavigationSection = {
  readonly labelKey: TranslationKey;
  readonly items: readonly NavigationItem[];
};

const dashboardNavigationItems = [
  { labelKey: "dashboard.title", icon: IconLayoutDashboard, href: "/dashboard" },
] satisfies readonly NavigationItem[];

const sellerAcquisitionNavigationItems = [
  // marketplaceSellers.title
  { labelKey: "sellerAcquisition.nav.campaigns", icon: IconRocket, href: "/marketplace-acquisition/campaigns" },
  { labelKey: "sellerAcquisition.nav.workbench", icon: IconInbox, href: "/marketplace-acquisition" },
  { labelKey: "sellerAcquisition.nav.sellers", icon: IconBookmark, disabled: true },
  { labelKey: "sellerAcquisition.nav.invites", icon: IconSend, disabled: true },
  { labelKey: "sellerAcquisition.nav.claims", icon: IconCircleCheck, disabled: true },
  { labelKey: "sellerAcquisition.nav.conversions", icon: IconReportAnalytics, disabled: true },
  { labelKey: "sellerAcquisition.nav.analytics", icon: IconChartBar, disabled: true },
] satisfies readonly NavigationItem[];

const crmNavigationItems = [
  { labelKey: "contacts.title", icon: IconUsers, href: "/contacts" },
  { labelKey: "deals.title", icon: IconBriefcase, href: "/deals" },
] satisfies readonly NavigationItem[];

const reportsNavigationItems = [
  { labelKey: "reports.title", icon: IconChartBar, href: "/reports" },
] satisfies readonly NavigationItem[];

const settingsNavigationItems = [
  { labelKey: "billing.title", icon: IconCreditCard, href: "/billing" },
  { labelKey: "settings.title", icon: IconSettings, href: "/settings" },
] satisfies readonly NavigationItem[];

function isActiveRoute(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavigationItemLink({
  item,
  onNavigate,
}: {
  readonly item: NavigationItem;
  readonly onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const Icon = item.icon;
  const isActive = item.href ? isActiveRoute(pathname, item.href) : false;

  const className = `flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pulse ${
    isActive
      ? "bg-whisper text-ivory shadow-sm"
      : item.disabled
        ? "cursor-not-allowed text-ivory/35"
        : "text-ivory/70 hover:bg-ivory/10 hover:text-ivory"
  }`;

  const content = (
    <>
      <Icon aria-hidden="true" className="size-4 shrink-0" stroke={isActive ? 2 : 1.8} />
      <span className="min-w-0 flex-1 truncate text-left">{t(item.labelKey)}</span>
      {item.disabled ? (
        <span className="rounded-full bg-ivory/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-ivory/50">
          {t("navigation.status.soon")}
        </span>
      ) : null}
    </>
  );

  if (!item.href || item.disabled) {
    return (
      <button aria-disabled="true" className={className} type="button">
        {content}
      </button>
    );
  }

  return (
    <Link {...(onNavigate ? { onClick: onNavigate } : {})} className={className} href={item.href}>
      {content}
    </Link>
  );
}

function NavigationSectionList({
  enabledFeatures,
  onNavigate,
}: {
  readonly enabledFeatures: readonly string[];
  readonly onNavigate?: () => void;
}) {
  const sections: NavigationSection[] = [
    { labelKey: "navigation.section.dashboard", items: dashboardNavigationItems },
  ];

  if (enabledFeatures.includes(SELLER_ACQUISITION_FEATURE)) {
    sections.push({ labelKey: "navigation.section.sellerAcquisition", items: sellerAcquisitionNavigationItems });
  }

  sections.push(
    { labelKey: "navigation.section.crm", items: crmNavigationItems },
    { labelKey: "navigation.section.reports", items: reportsNavigationItems },
    { labelKey: "navigation.section.settings", items: settingsNavigationItems },
  );

  return (
    <nav aria-label={t("navigation.primary")} className="flex-1 overflow-y-auto px-3 py-2">
      <div className="space-y-5">
        {sections.map((section) => (
          <section key={section.labelKey}>
            <p className="px-2 text-xs font-medium uppercase tracking-[0.16em] text-ivory/50">
              {t(section.labelKey)}
            </p>
            <div className="mt-3 space-y-1">
              {section.items.map((item) => (
                <NavigationItemLink
                  item={item}
                  key={item.labelKey}
                  {...(onNavigate ? { onNavigate } : {})}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </nav>
  );
}

function SidebarProfile() {
  const { user } = useUser();

  return (
    <div className="border-t-hairline p-4">
      <div className="flex items-center gap-3 rounded-2xl bg-ivory/10 p-3">
        <UserButton appearance={{ elements: { avatarBox: "size-8" } }} afterSignOutUrl="/sign-in" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ivory">
            {user?.firstName ?? user?.emailAddresses[0]?.emailAddress ?? "User"}
          </p>
          <p className="truncate text-xs text-ivory/65">{user?.emailAddresses[0]?.emailAddress ?? ""}</p>
        </div>
      </div>
    </div>
  );
}

export function Sidebar({
  enabledFeatures,
  mobileOpen,
  onMobileOpenChange,
}: {
  readonly enabledFeatures: readonly string[];
  readonly mobileOpen: boolean;
  readonly onMobileOpenChange: (open: boolean) => void;
}) {
  return (
    <>
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            aria-label={t("navigation.mobile.overlayClose")}
            className="absolute inset-0 bg-midnight/60"
            onClick={() => onMobileOpenChange(false)}
            type="button"
          />
          <aside
            className="relative flex h-dvh w-[min(88vw,340px)] flex-col border-r-hairline bg-midnight text-ivory shadow-xl"
            id="mobile-primary-navigation"
          >
            <div className="border-b-hairline px-5 py-5">
              <p className="text-lg font-semibold tracking-tight">{t("app.name")}</p>
            </div>
            <div className="px-4 py-4">
              <WorkspaceSelector />
            </div>
            <NavigationSectionList enabledFeatures={enabledFeatures} onNavigate={() => onMobileOpenChange(false)} />
            <SidebarProfile />
          </aside>
        </div>
      ) : null}

      <aside className="hidden h-dvh w-[240px] shrink-0 border-r-hairline bg-midnight text-ivory md:flex md:flex-col">
        <div className="border-b-hairline px-5 py-5">
          <p className="text-lg font-semibold tracking-tight">{t("app.name")}</p>
        </div>
        <div className="px-4 py-4">
          <WorkspaceSelector />
        </div>
        <NavigationSectionList enabledFeatures={enabledFeatures} />
        <SidebarProfile />
      </aside>
    </>
  );
}
