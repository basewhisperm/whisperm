import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IconClock, IconNote } from "@tabler/icons-react";
import { PrismaDealsRepository, type ActivityRecord, type PrismaPersistenceClient } from "@whisperm/repositories";

import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";

const marketplacePipelineKey = "marketplace_acquisition";

type PageProps = {
  params: { dealId: string };
};

function formatValue(value?: { toString(): string } | number | string | null, currency?: string | null) {
  if (value === undefined || value === null) return "Not provided";

  const stringValue = typeof value === "object" && value !== null ? value.toString() : value;
  const numericValue = typeof stringValue === "string" ? Number(stringValue) : stringValue;

  if (!Number.isFinite(numericValue)) return `${currency ?? ""} ${String(value)}`.trim();

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency ?? "USD",
    maximumFractionDigits: 0,
  }).format(numericValue);
}

function formatDate(value: Date | string | null | undefined) {
  if (value === null || value === undefined) return "Unknown time";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function contactName(
  contact:
    | { firstName?: string | null; lastName?: string | null; email?: string | null; company?: string | null }
    | null
    | undefined,
) {
  if (!contact) return "Not linked";

  return [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.email || contact.company || "Not linked";
}

function ownerName(owner: { displayName?: string | null; email?: string | null } | null | undefined) {
  if (!owner) return "Unassigned";

  return owner.displayName || owner.email || "Unassigned";
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-background p-4" style={{ border: "0.5px solid var(--color-border)" }}>
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <div className="mt-2 text-sm font-medium text-foreground">{children}</div>
    </div>
  );
}

const activityTimestamp = (activity: ActivityRecord): string | Date | null | undefined => activity.occurredAt ?? activity.createdAt;

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
                  {formatDate(activityTimestamp(activity))}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default async function MarketplaceAcquisitionDealDetailPage({ params }: PageProps) {
  const tenant = await getTenantForCurrentUser();
  if (!tenant) notFound();

  const deals = new PrismaDealsRepository(prisma as unknown as PrismaPersistenceClient);

  const [pipeline, detail] = await Promise.all([
    prisma.pipeline.findFirst({
      where: { tenantId: tenant.id, defaultKey: marketplacePipelineKey },
      include: { stages: { orderBy: { position: "asc" } } },
    }),
    deals.findDetailById(tenant.id, params.dealId),
  ]);

  if (detail === null) notFound();

  const deal = detail.deal;

  if (pipeline === null || deal.pipelineId !== pipeline.id) {
    return (
      <div className="rounded-2xl bg-background p-6" style={{ border: "0.5px solid var(--color-border)" }}>
        <p className="text-sm font-medium text-foreground">This deal is not a Marketplace Acquisition opportunity.</p>
        <p className="mt-1 text-xs text-muted-foreground">Open this record from the standard Deals workspace instead.</p>
        <Link className="mt-4 inline-flex text-sm font-medium text-whisper hover:underline" href="/marketplace-acquisition">
          Back to Marketplace Acquisition
        </Link>
      </div>
    );
  }

  const stage = pipeline.stages.find((pipelineStage) => pipelineStage.id === deal.pipelineStageId);

  const capture = await prisma.marketplaceCapture.findFirst({
    where: { tenantId: tenant.id, dealId: deal.id },
    include: { marketplaceSource: { select: { key: true, name: true } } },
    orderBy: { capturedAt: "desc" },
  });

  return (
    <div className="space-y-5">
      <div>
        <Link className="text-sm font-medium text-whisper hover:underline" href="/marketplace-acquisition">
          ← Back to Marketplace Acquisition
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Acquisition Deal</p>
            <h1 className="mt-2 text-2xl font-semibold text-foreground">{deal.title ?? "Untitled acquisition opportunity"}</h1>
          </div>
          <span className="rounded-full bg-muted px-3 py-1 text-sm font-medium text-muted-foreground">
            {stage?.name ?? "Unknown stage"}
          </span>
        </div>
      </div>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Deal summary">
        <DetailRow label="Stage">{stage?.name ?? "Unknown stage"}</DetailRow>
        <DetailRow label="Contact">{contactName(detail.contact)}</DetailRow>
        <DetailRow label="Owner">{ownerName(detail.owner)}</DetailRow>
        <DetailRow label="Created">{formatDate(deal.createdAt)}</DetailRow>
        <DetailRow label="Updated">{formatDate(deal.updatedAt)}</DetailRow>
        <DetailRow label="Deal value">{formatValue(deal.value, deal.currency)}</DetailRow>
      </section>

      <section className="space-y-3" aria-label="Marketplace capture context">
        <h2 className="text-lg font-semibold text-foreground">Marketplace capture context</h2>
        {capture === null ? (
          <div className="rounded-2xl bg-background p-4 text-sm text-muted-foreground" style={{ border: "0.5px solid var(--color-border)" }}>
            No marketplace capture is linked to this deal yet. Deal summary is still available above.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <DetailRow label="Listing URL">
              <a className="break-all text-whisper hover:underline" href={capture.listingUrl} target="_blank" rel="noreferrer">
                {capture.listingUrl}
              </a>
            </DetailRow>
            <DetailRow label="Marketplace/source">
              {capture.marketplaceSource?.name ?? capture.marketplaceSource?.key ?? "Not provided"}
            </DetailRow>
            <DetailRow label="Seller name">{capture.sellerName ?? "Not provided"}</DetailRow>
            <DetailRow label="Capture status">{capture.status}</DetailRow>
            <DetailRow label="Price/currency">{formatValue(capture.price?.toString() ?? null, capture.currency)}</DetailRow>
            <DetailRow label="Captured">{formatDate(capture.capturedAt)}</DetailRow>
          </div>
        )}
      </section>

      <ActivityTimeline activities={detail.activity} />
    </div>
  );
}
