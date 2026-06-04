import { t, type TranslationKey } from "@/lib/i18n";

import {
  IconBuildingCommunity,
  IconLayoutDashboard,
  IconSettings,
  IconUsers,
} from "@tabler/icons-react";

const navigationItems = [
  { labelKey: "dashboard.title", icon: IconLayoutDashboard },
  { labelKey: "contacts.title", icon: IconUsers },
  { labelKey: "deals.title", icon: IconBuildingCommunity },
  { labelKey: "reports.title", icon: IconBuildingCommunity },
  { labelKey: "settings.title", icon: IconSettings },
] satisfies readonly { readonly labelKey: TranslationKey; readonly icon: typeof IconLayoutDashboard }[];

export function Sidebar() {
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

            return (
              <a
                className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-ivory/78 transition hover:bg-ivory/10 hover:text-ivory focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pulse"
                href="#"
                key={item.labelKey}
              >
                <Icon aria-hidden="true" className="size-4" stroke={1.8} />
                {t(item.labelKey)}
              </a>
            );
          })}
        </div>
      </nav>

      <div className="border-t-hairline p-4">
        <div className="flex items-center gap-3 rounded-2xl bg-ivory/10 p-3">
          <div className="flex size-8 items-center justify-center rounded-full bg-whisper text-xs font-semibold text-primary-foreground">
            WM
          </div>
          <div>
            <p className="text-sm font-medium">{t("appShell.user.operator")}</p>
            <p className="text-xs text-ivory/65">{t("appShell.user.avatarSlot")}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
