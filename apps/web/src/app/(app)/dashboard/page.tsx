import Link from "next/link";
import {
  IconAlertCircle,
  IconArrowRight,
  IconCalendar,
  IconClock,
  IconCurrencyDollar,
  IconMail,
  IconNote,
  IconPhone,
  IconRocket,
  IconSend,
  IconTrophy,
  IconUsers,
} from "@tabler/icons-react";

type HealthStatus = "healthy" | "at-risk" | "idle";

interface DashboardContact {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  company?: string | null;
  lastTouchAt?: string | null;
}

interface DashboardActivity {
  id: string;
  type: string;
  note?: string | null;
  createdAt: string;
}

interface DashboardData {
  activeContacts: number;
  pipelineValue: number;
  healthContacts: DashboardContact[];
  followUpAlerts: DashboardContact[];
  activities: DashboardActivity[];
}

function getHealthStatus(lastTouchAt?: string | null): HealthStatus {
  if (!lastTouchAt) return "idle";

  const days = Math.floor((Date.now() - new Date(lastTouchAt).getTime()) / 86400000);

  if (days <= 7) return "healthy";
  if (days <= 14) return "at-risk";
  return "idle";
}

function getDaysSince(lastTouchAt?: string | null): number {
  if (!lastTouchAt) return 999;
  return Math.floor((Date.now() - new Date(lastTouchAt).getTime()) / 86400000);
}

function getHealthConfig(status: HealthStatus) {
  switch (status) {
    case "healthy":
      return { color: "var(--color-growth)", fill: 85, label: "Active" };
    case "at-risk":
      return { color: "var(--color-health-amber)", fill: 45, label: "Needs follow-up" };
    case "idle":
      return { color: "var(--color-health-red)", fill: 18, label: "Idle" };
  }
}

function getContactName(contact: DashboardContact): string {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  return name || contact.email || contact.company || "Unknown seller";
}

function getActivityIcon(type: string) {
  switch (type.toUpperCase()) {
    case "CALL":
      return IconPhone;
    case "EMAIL":
      return IconMail;
    case "MEETING":
      return IconCalendar;
    default:
      return IconNote;
  }
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

async function getDashboardData(): Promise<DashboardData> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/dashboard`, {
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) throw new Error("Failed to fetch");

    return res.json() as Promise<DashboardData>;
  } catch {
    return {
      activeContacts: 0,
      pipelineValue: 0,
      healthContacts: [],
      followUpAlerts: [],
      activities: [],
    };
  }
}

export default async function DashboardPage() {
  const data = await getDashboardData();

  const sellersNeedingFollowUp = data.followUpAlerts.length;
  const recentActivityCount = data.activities.length;
  const acquisitionHealth = data.activeContacts === 0
    ? 0
    : Math.max(0, Math.round(((data.activeContacts - sellersNeedingFollowUp) / data.activeContacts) * 100));

  const metrics = [
    {
      label: "Acquired Sellers",
      value: String(data.activeContacts),
      delta: "CRM contacts created from acquisition work",
      positive: true,
      icon: IconUsers,
    },
    {
      label: "Revenue Pipeline",
      value: formatCurrency(data.pipelineValue),
      delta: "Open opportunities tied to seller follow-up",
      positive: true,
      icon: IconCurrencyDollar,
    },
    {
      label: "Needs Action",
      value: String(sellersNeedingFollowUp),
      delta: "Sellers idle for 7+ days",
      positive: sellersNeedingFollowUp === 0,
      icon: IconAlertCircle,
    },
    {
      label: "Acquisition Health",
      value: `${acquisitionHealth}%`,
      delta: "Active sellers without stale follow-up",
      positive: acquisitionHealth >= 70,
      icon: IconTrophy,
    },
  ];

  const sortedHealth = [...data.healthContacts].sort(
    (a, b) => getDaysSince(b.lastTouchAt) - getDaysSince(a.lastTouchAt),
  );

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-3xl bg-midnight p-5 text-ivory shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-ivory/60">Seller Acquisition Command</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              Run campaigns, capture sellers, and convert marketplace activity into revenue.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-ivory/70">
              WhispeRM now starts from acquisition performance. Campaign infrastructure is next, but this dashboard already
              centers the daily operating question: which sellers need action and how much pipeline is being created?
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row lg:shrink-0">
            <Link
              className="inline-flex items-center justify-center gap-2 rounded-full bg-ivory px-4 py-2 text-sm font-medium text-midnight transition hover:bg-ivory/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pulse"
              href="/marketplace-acquisition/capture"
            >
              Capture seller
              <IconArrowRight aria-hidden="true" className="size-4" stroke={1.8} />
            </Link>
            <Link
              className="inline-flex items-center justify-center gap-2 rounded-full bg-ivory/10 px-4 py-2 text-sm font-medium text-ivory transition hover:bg-ivory/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pulse"
              href="/marketplace-acquisition"
            >
              Open workbench
              <IconRocket aria-hidden="true" className="size-4" stroke={1.8} />
            </Link>
          </div>
        </div>
      </section>

      {sellersNeedingFollowUp > 0 && (
        <div
          className="flex items-start gap-3 rounded-2xl p-4"
          style={{ background: "var(--color-muted)", border: "0.5px solid var(--color-health-amber)" }}
        >
          <IconAlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600" stroke={1.8} />
          <div>
            <p className="text-sm font-medium text-amber-900">
              {sellersNeedingFollowUp} seller{sellersNeedingFollowUp > 1 ? "s" : ""} need acquisition follow-up
            </p>
            <p className="mt-0.5 text-xs text-amber-700">
              {data.followUpAlerts.map(getContactName).join(", ")} {sellersNeedingFollowUp > 1 ? "have" : "has"} had no
              activity in 7+ days.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {metrics.map((card) => {
          const Icon = card.icon;

          return (
            <div key={card.label} className="rounded-2xl bg-secondary p-5" style={{ border: "0.5px solid var(--color-border)" }}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{card.label}</p>
                <div className="flex size-8 items-center justify-center rounded-xl" style={{ background: "var(--color-mist)" }}>
                  <Icon className="size-4" style={{ color: "var(--color-whisper)" }} stroke={1.8} />
                </div>
              </div>
              <p className="mt-3 text-[26px] font-semibold tracking-tight text-foreground">{card.value}</p>
              <p className={`mt-1 text-xs ${card.positive ? "text-[var(--color-growth)]" : "text-[var(--color-health-red)]"}`}>
                {card.delta}
              </p>
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }}>
          <div
            className="mb-1 flex items-center justify-between gap-3"
            style={{ paddingBottom: "12px", borderBottom: "0.5px solid var(--color-border)" }}
          >
            <div>
              <h2 className="text-sm font-semibold text-foreground">Seller Follow-up Queue</h2>
              <p className="mt-1 text-xs text-muted-foreground">Prioritize sellers before acquisition momentum goes cold.</p>
            </div>
            <span className="text-xs text-muted-foreground">{data.healthContacts.length} sellers</span>
          </div>

          {sortedHealth.length === 0 ? (
            <div className="py-8 text-center">
              <IconSend aria-hidden="true" className="mx-auto size-8 text-muted-foreground" stroke={1.6} />
              <p className="mt-3 text-sm font-medium text-foreground">No sellers in the acquisition queue yet.</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                Capture your first marketplace seller to begin building the campaign pipeline.
              </p>
            </div>
          ) : (
            sortedHealth.map((contact) => {
              const status = getHealthStatus(contact.lastTouchAt);
              const { color, fill, label } = getHealthConfig(status);
              const days = getDaysSince(contact.lastTouchAt);

              return (
                <div key={contact.id} className="flex items-center gap-4 py-3" style={{ borderBottom: "0.5px solid var(--color-border)" }}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium text-foreground">{getContactName(contact)}</p>
                      <span className="shrink-0 text-xs text-muted-foreground">{days === 999 ? "Never touched" : `${days}d ago`}</span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{contact.company ?? contact.email ?? "No company recorded"}</p>
                  </div>
                  <div className="flex w-32 shrink-0 flex-col gap-1">
                    <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color }}>
                      {label}
                    </span>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full" style={{ width: `${fill}%`, background: color }} />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }}>
          <div
            className="mb-1 flex items-center justify-between gap-3"
            style={{ paddingBottom: "12px", borderBottom: "0.5px solid var(--color-border)" }}
          >
            <div>
              <h2 className="text-sm font-semibold text-foreground">Acquisition Activity</h2>
              <p className="mt-1 text-xs text-muted-foreground">Latest movement across seller follow-up and CRM conversion.</p>
            </div>
            <span className="text-xs text-muted-foreground">Last {recentActivityCount}</span>
          </div>

          {data.activities.length === 0 ? (
            <div className="py-8 text-center">
              <IconClock aria-hidden="true" className="mx-auto size-8 text-muted-foreground" stroke={1.6} />
              <p className="mt-3 text-sm font-medium text-foreground">No acquisition activity yet.</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                Seller captures, invitations, claims, and follow-ups will appear here as the team works.
              </p>
            </div>
          ) : (
            data.activities.map((activity) => {
              const Icon = getActivityIcon(activity.type);

              return (
                <div key={activity.id} className="flex items-start gap-3 py-3" style={{ borderBottom: "0.5px solid var(--color-border)" }}>
                  <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg" style={{ background: "var(--color-mist)" }}>
                    <Icon className="size-3.5" style={{ color: "var(--color-whisper)" }} stroke={1.8} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{activity.note ?? activity.type}</p>
                    <p className="text-xs text-muted-foreground">{new Date(activity.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
