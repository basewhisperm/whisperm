import {
  IconBuildingCommunity,
  IconLayoutDashboard,
  IconSettings,
  IconUsers,
} from "@tabler/icons-react";

const navigationItems = [
  { label: "Dashboard", icon: IconLayoutDashboard },
  { label: "Contacts", icon: IconUsers },
  { label: "Settings", icon: IconSettings },
] as const;

export function Sidebar() {
  return (
    <aside className="hidden h-dvh w-[196px] shrink-0 border-r-hairline bg-midnight text-ivory md:flex md:flex-col">
      <div className="border-b-hairline px-5 py-5">
        <p className="text-lg font-semibold tracking-tight">WhispeRM</p>
      </div>

      <div className="px-4 py-4">
        <div className="rounded-2xl border-hairline border-ivory/15 bg-ivory/10 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <IconBuildingCommunity aria-hidden className="size-4" stroke={1.8} />
            Workspace
          </div>
          <p className="mt-1 text-xs text-ivory/70">Switcher slot</p>
        </div>
      </div>

      <nav aria-label="Primary" className="flex-1 px-3 py-2">
        <p className="px-2 text-xs font-medium uppercase tracking-[0.16em] text-ivory/50">
          CRM
        </p>
        <div className="mt-3 space-y-1">
          {navigationItems.map((item) => {
            const Icon = item.icon;

            return (
              <a
                className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-ivory/78 transition hover:bg-ivory/10 hover:text-ivory"
                href="#"
                key={item.label}
              >
                <Icon aria-hidden className="size-4" stroke={1.8} />
                {item.label}
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
            <p className="text-sm font-medium">Operator</p>
            <p className="text-xs text-ivory/65">Avatar slot</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
