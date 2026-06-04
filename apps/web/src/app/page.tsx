import { AppShell } from "@/components/app-shell/app-shell";

export default function HomePage() {
  return (
    <AppShell>
      <section className="rounded-3xl border-hairline bg-muted p-5 shadow-sm">
        <p className="text-sm font-medium text-whisper">App shell ready</p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">
          Frontend foundation initialized
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          This validates the CRM shell, brand tokens, Inter typography, shadcn/ui
          button styling, and Tabler outline icons without introducing CRM feature
          screens.
        </p>
      </section>
    </AppShell>
  );
}
