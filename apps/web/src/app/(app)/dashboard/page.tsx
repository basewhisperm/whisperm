import {
  IconAlertCircle,
  IconCalendar,
  IconClock,
  IconCurrencyDollar,
  IconMail,
  IconNote,
  IconPhone,
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
      return { color: "var(--color-growth)", fill: 85, label: "Healthy" };
    case "at-risk":
      return { color: "var(--color-health-amber)", fill: 45, label: "At risk" };
    case "idle":
      return { color: "var(--color-health-red)", fill: 18, label: "Idle" };
  }
}

function getContactName(contact: DashboardContact): string {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  return name || contact.email || contact.company || "Unknown";
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

  const metrics = [
    {
      label: "Active Clients",
      value: String(data.activeContacts),
      delta: "+0 this month",
      positive: true,
      icon: IconUsers,
    },
    {
      label: "Pipeline Value",
      value: formatCurrency(data.pipelineValue),
      delta: "Open deals",
      positive: true,
      icon: IconCurrencyDollar,
    },
    {
      label: "Follow-up Alerts",
      value: String(data.followUpAlerts.length),
      delta: "Clients idle 7+ days",
      positive: data.followUpAlerts.length === 0,
      icon: IconTrophy,
    },
    {
      label: "Activities",
      value: String(data.activities.length),
      delta: "Recent logged",
      positive: true,
      icon: IconClock,
    },
  ];

  const sortedHealth = [...data.healthContacts].sort(
    (a, b) => getDaysSince(b.lastTouchAt) - getDaysSince(a.lastTouchAt),
  );

  return (
    <div className="space-y-6">
      {data.followUpAlerts.length > 0 && (
        <div
          className="flex items-start gap-3 rounded-2xl p-4"
          style={{ background: "var(--color-muted)", border: "0.5px solid var(--color-health-amber)" }}
        >
          <IconAlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600" stroke={1.8} />
          <div>
            <p className="text-sm font-medium text-amber-900">
              {data.followUpAlerts.length} client{data.followUpAlerts.length > 1 ? "s" : ""} need follow-up
            </p>
            <p className="mt-0.5 text-xs text-amber-700">
              {data.followUpAlerts.map(getContactName).join(", ")} {data.followUpAlerts.length > 1 ? "have" : "has"} had no
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
              <div className="flex items-center justify-between">
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

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }}>
          <div
            className="mb-1 flex items-center justify-between"
            style={{ paddingBottom: "12px", borderBottom: "0.5px solid var(--color-border)" }}
          >
            <h2 className="text-sm font-semibold text-foreground">Client Health</h2>
            <span className="text-xs text-muted-foreground">{data.healthContacts.length} clients</span>
          </div>

          {sortedHealth.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No contacts yet — add your first client to see health tracking.</p>
          ) : (
            sortedHealth.map((contact) => {
              const status = getHealthStatus(contact.lastTouchAt);
              const { color, fill, label } = getHealthConfig(status);
              const days = getDaysSince(contact.lastTouchAt);

              return (
                <div key={contact.id} className="flex items-center gap-4 py-3" style={{ borderBottom: "0.5px solid var(--color-border)" }}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <p className="truncate text-sm font-medium text-foreground">{getContactName(contact)}</p>
                      <span className="ml-2 shrink-0 text-xs text-muted-foreground">{days === 999 ? "Never" : `${days}d ago`}</span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{contact.company ?? contact.email ?? ""}</p>
                  </div>
                  <div className="flex w-28 shrink-0 flex-col gap-1">
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
            className="mb-1 flex items-center justify-between"
            style={{ paddingBottom: "12px", borderBottom: "0.5px solid var(--color-border)" }}
          >
            <h2 className="text-sm font-semibold text-foreground">Recent Activity</h2>
            <span className="text-xs text-muted-foreground">Last {data.activities.length} activities</span>
          </div>

          {data.activities.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No activities yet — log your first interaction to see the feed.</p>
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