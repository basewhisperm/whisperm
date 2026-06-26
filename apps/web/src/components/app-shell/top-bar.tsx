"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { IconBell, IconSearch } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { NewRecordModal } from "@/components/ui/new-record-modal";
import { t } from "@/lib/i18n";

const ROUTE_META: Record<string, { eyebrow: string; title: string }> = {
  "/dashboard": { eyebrow: "Seller Acquisition", title: "Campaign Performance" },
  "/marketplace-acquisition": { eyebrow: "Seller Acquisition", title: "Acquisition Workbench" },
  "/marketplace-acquisition/capture": { eyebrow: "Seller Acquisition", title: "Capture Seller" },
  "/contacts": { eyebrow: "CRM", title: "Contacts" },
  "/deals": { eyebrow: "CRM", title: "Pipeline" },
  "/reports": { eyebrow: "Analytics", title: "Reports" },
  "/settings": { eyebrow: "Workspace", title: "Settings" },
};

const DEFAULT_META = { eyebrow: t("topBar.eyebrow"), title: t("topBar.title") };

export function TopBar() {
  const pathname = usePathname();
  const meta = ROUTE_META[pathname] ?? DEFAULT_META;
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <header className="border-b-hairline bg-background/92 px-4 py-4 backdrop-blur sm:px-5">
        <div className="mx-auto flex max-w-content flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{meta.eyebrow}</p>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{meta.title}</h1>
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
