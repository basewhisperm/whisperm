import { AppShell } from "@/components/app-shell/app-shell";
import { t } from "@/lib/i18n";

export default function HomePage() {
  return (
    <AppShell>
      <section className="rounded-3xl border-hairline bg-muted p-5 shadow-sm">
        <p className="text-sm font-medium text-whisper">{t("home.shellReady")}</p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">
          {t("home.foundationInitialized")}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          {t("home.shellValidation")}
        </p>
      </section>
    </AppShell>
  );
}
