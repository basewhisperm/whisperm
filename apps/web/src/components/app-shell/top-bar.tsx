import { IconBell, IconSearch } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

export function TopBar() {
  return (
    <header className="border-b-hairline bg-background/92 px-4 py-4 backdrop-blur sm:px-5">
      <div className="mx-auto flex max-w-content flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {t("topBar.eyebrow")}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {t("topBar.title")}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-2 rounded-full border-hairline bg-muted px-3 py-2 text-sm text-muted-foreground sm:flex">
            <IconSearch aria-hidden className="size-4" stroke={1.8} />
            {t("common.searchSlot")}
          </div>
          <Button aria-label={t("common.notifications")} size="icon" variant="secondary">
            <IconBell aria-hidden className="size-4" stroke={1.8} />
          </Button>
          <Button>{t("common.newRecord")}</Button>
        </div>
      </div>
    </header>
  );
}
