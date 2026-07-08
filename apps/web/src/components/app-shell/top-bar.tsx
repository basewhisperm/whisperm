"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { IconBell, IconMenu2, IconSearch, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { NewRecordModal } from "@/components/ui/new-record-modal";
import { t } from "@/lib/i18n";

const ROUTE_META: Record<string, { eyebrow: string; title: string }> = {
  "/dashboard": { eyebrow: "Seller Acquisition", title: "Campaign Performance" },
  "/marketplace-acquisition": { eyebrow: "Seller Acquisition", title: "Acquisition Workbench" },
  "/marketplace-acquisition/campaigns": { eyebrow: "Seller Acquisition", title: "Campaigns" },
  "/marketplace-acquisition/capture": { eyebrow: "Seller Acquisition", title: "Capture Seller" },
  "/contacts": { eyebrow: "CRM", title: "Contacts" },
  "/deals": { eyebrow: "CRM", title: "Pipeline" },
  "/reports": { eyebrow: "Analytics", title: "Reports" },
  "/settings": { eyebrow: "Workspace", title: "Settings" },
};

const DEFAULT_META = { eyebrow: t("topBar.eyebrow"), title: t("topBar.title") };

export function TopBar({
  mobileNavOpen,
  onToggleMobileNav,
}: {
  readonly mobileNavOpen: boolean;
  readonly onToggleMobileNav: () => void;
}) {
  const pathname = usePathname();
  const meta = ROUTE_META[pathname] ?? DEFAULT_META;
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <header className="border-b-hairline bg-background/92 px-4 py-4 backdrop-blur sm:px-5">
        <div className="mx-auto flex max-w-content flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <button
              aria-controls="mobile-primary-navigation"
              aria-expanded={mobileNavOpen}
              aria-label={mobileNavOpen ? t("navigation.mobile.close") : t("navigation.mobile.open")}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border-hairline bg-background text-foreground shadow-sm transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:hidden"
              onClick={onToggleMobileNav}
              type="button"
            >
              {mobileNavOpen ? <IconX aria-hidden="true" className="size-5" /> : <IconMenu2 aria-hidden="true" className="size-5" />}
            </button>
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{meta.eyebrow}</p>
              <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">{meta.title}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-full border-hairline bg-muted px-3 py-2 text-sm text-muted-foreground sm:flex">
              <IconSearch aria-hidden="true" className="size-4" stroke={1.8} />
              {t("common.searchSlot")}
            </div>
            <Button aria-label="Notifications" size="icon" variant="secondary">
              <IconBell aria-hidden="true" className="size-4" stroke={1.8} />
            </Button>
            <Button onClick={() => setModalOpen(true)}>{t("common.newRecord")}</Button>
          </div>
        </div>
      </header>
      <NewRecordModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
