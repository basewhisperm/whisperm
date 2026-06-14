import { notFound } from "next/navigation";
import { IconClock, IconNote } from "@tabler/icons-react";
import { PrismaDealsRepository, type ActivityRecord, type PrismaPersistenceClient } from "@whisperm/repositories";

import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";

interface MarketplaceAcquisitionDealPageProps {
  readonly params: {
    readonly dealId: string;
  };
}

const formatTimestamp = (value?: string | null): string => {
  if (value === undefined || value === null) return "Unknown time";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
};

const activityTimestamp = (activity: ActivityRecord): string => activity.occurredAt ?? activity.createdAt;

function ActivityTimeline({ activities }: { readonly activities: readonly ActivityRecord[] }) {
  return (
    <section className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Activity Timeline</h2>
          <p className="mt-1 text-xs text-muted-foreground">Deal-scoped activity for this acquisition opportunity.</p>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
          {activities.length} {activities.length === 1 ? "activity" : "activities"}
        </span>
      </div>

      {activities.length === 0 ? (
        <p className="mt-6 rounded-xl bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
          No activity yet for this acquisition opportunity.
        </p>
      ) : (
        <ol className="mt-5 space-y-4">
          {activities.map((activity) => (
            <li key={activity.id} className="flex gap-3">
              <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-mist text-whisper">
                <IconNote className="size-4" stroke={1.8} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1 rounded-xl bg-secondary p-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="text-sm font-semibold text-foreground">{activity.type}</p>
                  <span className="text-xs text-muted-foreground">by {activity.createdById}</span>
                </div>
                {activity.note !== undefined && activity.note !== null && activity.note.trim() !== "" ? (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{activity.note}</p>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">No note provided.</p>
                )}
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <IconClock className="size-3.5" stroke={1.8} aria-hidden="true" />
                  {formatTimestamp(activityTimestamp(activity))}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default async function MarketplaceAcquisitionDealPage({ params }: MarketplaceAcquisitionDealPageProps) {
  const tenant = await getTenantForCurrentUser();
  if (tenant === null) notFound();

  const deals = new PrismaDealsRepository(prisma as unknown as PrismaPersistenceClient);
  const detail = await deals.findDetailById(tenant.id, params.dealId);
  if (detail === null) notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }}>
        <p className="text-xs font-semibold uppercase tracking-wide text-whisper">Marketplace Acquisition</p>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">{detail.deal.title ?? "Untitled acquisition opportunity"}</h1>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          {detail.contact?.email !== undefined && detail.contact.email !== null && <span>Contact: {detail.contact.email}</span>}
          {detail.owner?.email !== undefined && detail.owner.email !== null && <span>Owner: {detail.owner.email}</span>}
          <span>Deal ID: {detail.deal.id}</span>
        </div>
      </div>

      <ActivityTimeline activities={detail.activity} />
    </div>
  );
}
