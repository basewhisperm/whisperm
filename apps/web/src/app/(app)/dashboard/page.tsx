import { IconUsers, IconCurrencyDollar, IconTrophy, IconClock, IconAlertCircle, IconPhone, IconMail, IconCalendar, IconNote } from "@tabler/icons-react";

type HealthStatus = "healthy" | "at-risk" | "idle";
interface MetricCard { label: string; value: string; delta: string; positive: boolean; icon: typeof IconUsers; }
interface Contact { id: string; name: string; company: string; lastTouchDays: number; status: HealthStatus; }
interface Activity { id: string; type: "call" | "email" | "meeting" | "note"; contact: string; description: string; time: string; }

const metrics: MetricCard[] = [
  { label: "Active Clients", value: "48", delta: "+3 this month", positive: true, icon: IconUsers },
  { label: "Pipeline Value", value: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(284500), delta: "+12% vs last month", positive: true, icon: IconCurrencyDollar },
  { label: "Engagements Won", value: "7", delta: "+2 vs last month", positive: true, icon: IconTrophy },
  { label: "Avg Response Time", value: "4.2h", delta: "+0.8h vs last month", positive: false, icon: IconClock },
];

const healthContacts: Contact[] = [
  { id: "1", name: "Kwame Asante", company: "Asante & Co", lastTouchDays: 18, status: "idle" },
  { id: "2", name: "Abena Mensah", company: "Mensah Partners", lastTouchDays: 12, status: "at-risk" },
  { id: "3", name: "Kofi Boateng", company: "Boateng Advisory", lastTouchDays: 21, status: "idle" },
  { id: "4", name: "Ama Owusu", company: "Owusu Consulting", lastTouchDays: 9, status: "at-risk" },
  { id: "5", name: "Yaw Darko", company: "Darko & Sons", lastTouchDays: 3, status: "healthy" },
  { id: "6", name: "Efua Agyeman", company: "Agyeman Group", lastTouchDays: 1, status: "healthy" },
];

const activities: Activity[] = [
  { id: "1", type: "call", contact: "Kwame Asante", description: "Discussed Q2 audit scope", time: "2h ago" },
  { id: "2", type: "email", contact: "Abena Mensah", description: "Sent proposal for tax advisory", time: "4h ago" },
  { id: "3", type: "meeting", contact: "Ama Owusu", description: "Onboarding kickoff call", time: "Yesterday" },
  { id: "4", type: "note", contact: "Yaw Darko", description: "Client requested monthly reporting", time: "Yesterday" },
  { id: "5", type: "email", contact: "Efua Agyeman", description: "Follow-up on engagement letter", time: "2 days ago" },
];

const followUpAlerts = healthContacts.filter(c => c.lastTouchDays >= 7).sort((a, b) => b.lastTouchDays - a.lastTouchDays);

function getHealthConfig(status: HealthStatus) {
  switch (status) {
    case "healthy": return { color: "var(--color-growth)", fill: 85, label: "Healthy" };
    case "at-risk": return { color: "#F59E0B", fill: 45, label: "At risk" };
    case "idle":    return { color: "#EF4444", fill: 18, label: "Idle" };
  }
}

function getActivityIcon(type: Activity["type"]) {
  switch (type) {
    case "call":    return IconPhone;
    case "email":   return IconMail;
    case "meeting": return IconCalendar;
    case "note":    return IconNote;
  }
}

function MetricCardUI({ card }: { card: MetricCard }) {
  const Icon = card.icon;
  return (
    <div className="rounded-2xl bg-secondary p-5" style={{ border: "0.5px solid hsl(var(--border))" }}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{card.label}</p>
        <div className="flex size-8 items-center justify-center rounded-xl" style={{ background: "var(--color-mist)" }}>
          <Icon className="size-4" style={{ color: "var(--color-whisper)" }} stroke={1.8} />
        </div>
      </div>
      <p className="mt-3 text-[26px] font-semibold tracking-tight text-foreground">{card.value}</p>
      <p className={`mt-1 text-xs ${card.positive ? "text-[var(--color-growth)]" : "text-red-500"}`}>{card.delta}</p>
    </div>
  );
}

function HealthBar({ contact }: { contact: Contact }) {
  const { color, fill, label } = getHealthConfig(contact.status);
  return (
    <div className="flex items-center gap-4 py-3" style={{ borderBottom: "0.5px solid hsl(var(--border))" }}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <p className="truncate text-sm font-medium text-foreground">{contact.name}</p>
          <span className="ml-2 shrink-0 text-xs text-muted-foreground">{contact.lastTouchDays}d ago</span>
        </div>
        <p className="truncate text-xs text-muted-foreground">{contact.company}</p>
      </div>
      <div className="flex w-28 shrink-0 flex-col gap-1">
        <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color }}>{label}</span>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full" style={{ width: `${fill}%`, background: color }} />
        </div>
      </div>
    </div>
  );
}

function ActivityItem({ activity }: { activity: Activity }) {
  const Icon = getActivityIcon(activity.type);
  return (
    <div className="flex items-start gap-3 py-3" style={{ borderBottom: "0.5px solid hsl(var(--border))" }}>
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg" style={{ background: "var(--color-mist)" }}>
        <Icon className="size-3.5" style={{ color: "var(--color-whisper)" }} stroke={1.8} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{activity.contact}</p>
        <p className="text-xs text-muted-foreground">{activity.description}</p>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">{activity.time}</span>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {followUpAlerts.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl p-4" style={{ background: "#FEF3C7", border: "0.5px solid #FCD34D" }}>
          <IconAlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600" stroke={1.8} />
          <div>
            <p className="text-sm font-medium text-amber-900">{followUpAlerts.length} client{followUpAlerts.length > 1 ? "s" : ""} need follow-up</p>
            <p className="mt-0.5 text-xs text-amber-700">{followUpAlerts.map(c => c.name).join(", ")} {followUpAlerts.length > 1 ? "have" : "has"} had no activity in 7+ days.</p>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {metrics.map((card) => <MetricCardUI card={card} key={card.label} />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid hsl(var(--border))" }}>
          <div className="mb-1 flex items-center justify-between" style={{ paddingBottom: "12px", borderBottom: "0.5px solid hsl(var(--border))" }}>
            <h2 className="text-sm font-semibold text-foreground">Client Health</h2>
            <span className="text-xs text-muted-foreground">{healthContacts.length} clients</span>
          </div>
          {healthContacts.map((contact) => <HealthBar contact={contact} key={contact.id} />)}
        </div>
        <div className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid hsl(var(--border))" }}>
          <div className="mb-1 flex items-center justify-between" style={{ paddingBottom: "12px", borderBottom: "0.5px solid hsl(var(--border))" }}>
            <h2 className="text-sm font-semibold text-foreground">Recent Activity</h2>
            <span className="text-xs text-muted-foreground">Last 5 activities</span>
          </div>
          {activities.map((activity) => <ActivityItem activity={activity} key={activity.id} />)}
        </div>
      </div>
    </div>
  );
}
