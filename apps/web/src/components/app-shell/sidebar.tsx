"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton, useUser } from "@clerk/nextjs";
import { t, type TranslationKey } from "@/lib/i18n";
import {
  IconBuildingCommunity,
  IconLayoutDashboard,
  IconSettings,
  IconUsers,
  IconBriefcase,
  IconChartBar,
} from "@tabler/icons-react";

const navigationItems = [
  { labelKey: "dashboard.title", icon: IconLayoutDashboard, href: "/dashboard" },
  { labelKey: "contacts.title", icon: IconUsers, href: "/contacts" },
  { labelKey: "deals.title", icon: IconBriefcase, href: "/deals" },
  { labelKey: "reports.title", icon: IconChartBar, href: "/reports" },
  { labelKey: "settings.title", icon: IconSettings, href: "/settings" },
] satisfies readonly { readonly labelKey: TranslationKey; readonly icon: typeof IconLayoutDashboard; readonly href: string }[];

export function Sidebar() {
  const pathname = usePathname();
  const { user } = useUser();

  return (
    <aside className="hidden h-dvh w-[196px] shrink-0 border-r-hairline bg-midnight text-ivory md:flex md:flex-col">
      <div className="border-b-hairline px-5 py-5">
        <p className="text-lg font-semibold tracking-tight">{t("app.name")}</p>
      </div>
      <div className="px-4 py-4">
        <div className="rounded-2xl border-hairline border-ivory/15 bg-ivory/10 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <IconBuildingCommunity aria-hidden="true" className="size-4" stroke={1.8} />
            {t("appShell.workspace.label")}
          </div>
          <p className="mt-1 text-xs text-ivory/70">{t("appShell.workspace.switcherSlot")}</p>
        </div>
      </div>
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
      <div className="border-t-hairline p-4">
        <div className="flex items-center gap-3 rounded-2xl bg-ivory/10 p-3">
          <UserButton
            appearance={{
              elements: {
                avatarBox: "size-8",
                userButtonPopoverCard: "shadow-lg",
              },
            }}
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
    </aside>
  );
}
