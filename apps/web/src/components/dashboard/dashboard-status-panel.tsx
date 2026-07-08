import Link from "next/link";
import { IconAlertTriangle } from "@tabler/icons-react";

interface DashboardStatusPanelProps {
  readonly title: string;
  readonly message: string;
  readonly code?: string;
  readonly actionLabel?: string;
  readonly actionHref?: string;
}

/** Shared status panel for the /dashboard truthfulness gate: renders explicit auth/tenant, feature-disabled, and runtime-failure states instead of masking them as empty or zeroed metrics. */
export function DashboardStatusPanel({ title, message, code, actionLabel, actionHref }: DashboardStatusPanelProps) {
  return (
    <section
      aria-label="Dashboard status"
      className="rounded-2xl border-hairline bg-background p-8 text-center"
      data-testid="dashboard-status-panel"
      role="alert"
    >
      <IconAlertTriangle aria-hidden="true" className="mx-auto size-8 text-[var(--color-health-red)]" stroke={1.6} />
      <h2 className="mt-3 text-sm font-semibold text-foreground">{title}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{message}</p>
      {code ? (
        <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground" data-testid="dashboard-status-panel-code">
          Diagnostic code: {code}
        </p>
      ) : null}
      {actionLabel && actionHref ? (
        <Link className="mt-4 inline-flex rounded-full bg-whisper px-4 py-2 text-sm font-semibold text-white" href={actionHref}>
          {actionLabel}
        </Link>
      ) : null}
    </section>
  );
}
