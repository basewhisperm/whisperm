import Link from "next/link";
import {
  IconAlertCircle,
  IconArrowRight,
  IconChartBar,
  IconCircleCheck,
  IconClock,
  IconCurrencyDollar,
  IconInbox,
  IconRocket,
  IconSend,
  IconUsers,
} from "@tabler/icons-react";

interface DashboardData {
  activeContacts: number;
  pipelineValue: number;
  activities: { id: string; type: string; note?: string | null; createdAt: string }[];
}

interface AcquisitionRecord {
  capture: { id: string; title?: string | null; createdAt: string; capturedAt?: string | null };
  healthStatus: string;
  nextAction: string;
  missingRequirements: readonly string[];
  latestInvitation: { status: string; createdAt: string } | null;
  claimTokenStatus: { status: string; expiresAt?: string | null } | null;
  sellerConversion: unknown | null;
  inventoryConversion: unknown | null;
}

async function getDashboardData(): Promise<DashboardData> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/dashboard`, {
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error("Failed to fetch dashboard");
    return res.json() as Promise<DashboardData>;
  } catch {
    return { activeContacts: 0, pipelineValue: 0, activities: [] };
  }
}

async function getAcquisitionRecords(): Promise<readonly AcquisitionRecord[]> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/marketplace-acquisition/records`, {
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error("Failed to fetch acquisition records");
    const payload = await res.json() as { data?: { records?: AcquisitionRecord[] } };
    return payload.data?.records ?? [];
  } catch {
    return [];
  }
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export default async function DashboardPage() {
  const [dashboard, records] = await Promise.all([getDashboardData(), getAcquisitionRecords()]);

  const sellersCaptured = records.length || dashboard.activeContacts;
  const readyToInvite = records.filter((record) => record.nextAction === "SEND_INVITATION").length;
  const claimsPending = records.filter((record) => record.nextAction === "WAIT_FOR_CLAIM").length;
  const conversionsReady = records.filter((record) =>
    ["CONVERT_SELLER", "CONVERT_INVENTORY", "COMPLETE_ACQUISITION"].includes(record.nextAction),
  ).length;
  const blocked = records.filter((record) => record.missingRequirements.includes("PHONE_REQUIRED")).length;
  const completed = records.filter((record) => record.healthStatus === "COMPLETED").length;

  const metrics = [
    { label: "Active Campaigns", value: "0", detail: "Campaign model lands in Slice 4", icon: IconRocket },
    { label: "Sellers Captured", value: String(sellersCaptured), detail: "Captured marketplace seller records", icon: IconUsers },
    { label: "Ready to Invite", value: String(readyToInvite), detail: "WhatsApp-first outreach queue", icon: IconSend },
    { label: "Claims Pending", value: String(claimsPending), detail: "Waiting for seller claim", icon: IconClock },
    { label: "Conversions", value: String(completed || conversionsReady), detail: "Ready or completed conversion flow", icon: IconCircleCheck },
    { label: "Revenue Pipeline", value: formatCurrency(dashboard.pipelineValue), detail: "CRM pipeline tied to acquisition", icon: IconCurrencyDollar },
  ];

  const priorityRecords = records
    .filter((record) => record.nextAction !== "NONE" || record.healthStatus !== "COMPLETED")
    .slice(0, 6);

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-3xl bg-midnight p-5 text-ivory shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-ivory/60">Campaign Performance Dashboard</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              How are seller acquisition campaigns performing today?
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-ivory/70">
              Campaign records arrive in the next infrastructure slices. Until then, this dashboard uses existing seller records,
              invitations, claims, conversions, and CRM pipeline data to show acquisition performance.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row lg:shrink-0">
            <Link className="inline-flex items-center justify-center gap-2 rounded-full bg-ivory px-4 py-2 text-sm font-medium text-midnight" href="/marketplace-acquisition/capture">
              Capture seller <IconArrowRight aria-hidden="true" className="size-4" stroke={1.8} />
            </Link>
            <Link className="inline-flex items-center justify-center gap-2 rounded-full bg-ivory/10 px-4 py-2 text-sm font-medium text-ivory" href="/marketplace-acquisition">
              Open workbench <IconInbox aria-hidden="true" className="size-4" stroke={1.8} />
            </Link>
          </div>
        </div>
      </section>

      {blocked > 0 ? (
        <div className="flex items-start gap-3 rounded-2xl border-hairline bg-muted p-4">
          <IconAlertCircle className="mt-0.5 size-4 shrink-0 text-[var(--color-health-red)]" stroke={1.8} />
          <div>
            <p className="text-sm font-medium text-foreground">{blocked} seller{blocked === 1 ? "" : "s"} need phone review</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Use the Acquisition Workbench to reveal phone numbers, clean bad captures, and retry outreach.</p>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-6">
        {metrics.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="rounded-2xl border-hairline bg-secondary p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{card.label}</p>
                <Icon className="size-4 text-muted-foreground" stroke={1.8} />
              </div>
              <p className="mt-3 text-[26px] font-semibold tracking-tight text-foreground">{card.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{card.detail}</p>
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-2xl border-hairline bg-background p-5">
          <div className="mb-3 flex items-center justify-between gap-3 border-b-hairline pb-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Acquisition Priority Queue</h2>
              <p className="mt-1 text-xs text-muted-foreground">Highest-priority seller records across invite, claim, and conversion work.</p>
            </div>
            <Link className="text-xs font-medium text-[var(--color-whisper)]" href="/marketplace-acquisition">View all</Link>
          </div>

          {priorityRecords.length === 0 ? (
            <div className="py-8 text-center">
              <IconChartBar aria-hidden="true" className="mx-auto size-8 text-muted-foreground" stroke={1.6} />
              <p className="mt-3 text-sm font-medium text-foreground">No seller acquisition records yet.</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Capture sellers to populate campaign performance and workbench queues.</p>
            </div>
          ) : (
            priorityRecords.map((record) => (
              <div key={record.capture.id} className="flex items-center justify-between gap-4 border-b-hairline py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{record.capture.title || "Marketplace seller"}</p>
                  <p className="text-xs text-muted-foreground">{record.healthStatus} · {record.nextAction.replaceAll("_", " ")}</p>
                </div>
                <Link className="shrink-0 text-xs font-medium text-[var(--color-whisper)]" href="/marketplace-acquisition">Open</Link>
              </div>
            ))
          )}
        </section>

        <section className="rounded-2xl border-hairline bg-background p-5">
          <div className="mb-3 border-b-hairline pb-3">
            <h2 className="text-sm font-semibold text-foreground">Acquisition Activity</h2>
            <p className="mt-1 text-xs text-muted-foreground">Latest CRM activity while campaign events are being formalized.</p>
          </div>

          {dashboard.activities.length === 0 ? (
            <div className="py-8 text-center">
              <IconClock aria-hidden="true" className="mx-auto size-8 text-muted-foreground" stroke={1.6} />
              <p className="mt-3 text-sm font-medium text-foreground">No acquisition activity yet.</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Captures, invitations, claims, and conversions will appear as your team works.</p>
            </div>
          ) : (
            dashboard.activities.map((activity) => (
              <div key={activity.id} className="border-b-hairline py-3">
                <p className="text-sm font-medium text-foreground">{activity.note ?? activity.type}</p>
                <p className="text-xs text-muted-foreground">{new Date(activity.createdAt).toLocaleDateString()}</p>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
