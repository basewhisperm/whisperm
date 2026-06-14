"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { IconArrowRight, IconBookmark } from "@tabler/icons-react";

interface PipelineStage {
  readonly id: string;
  readonly name: string;
  readonly sortOrder?: number | null;
  readonly position?: number | null;
}

interface Pipeline {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly stages: readonly PipelineStage[];
}

interface Deal {
  readonly id: string;
  readonly title?: string | null;
  readonly pipelineStageId: string;
  readonly updatedAt: string;
  readonly metadata?: Readonly<Record<string, unknown>> | null;
  readonly contact?: {
    readonly firstName?: string | null;
    readonly lastName?: string | null;
    readonly email?: string | null;
    readonly company?: string | null;
  } | null;
}

const acquisitionStages = ["Captured", "Invited", "Converted"] as const;

type AcquisitionStageName = (typeof acquisitionStages)[number];

function stageKey(name: string): string {
  return name.trim().toLowerCase();
}

function contactName(deal: Deal): string | null {
  const contact = deal.contact;
  if (contact === null || contact === undefined) return null;

  const fullName = [contact.firstName, contact.lastName]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");

  return fullName || contact.company || contact.email || null;
}

function metadataString(metadata: Readonly<Record<string, unknown>> | null | undefined, keys: readonly string[]): string | null {
  if (metadata === null || metadata === undefined) return null;

  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }

  return null;
}

function formatUpdatedAt(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function DealSummaryCard({ deal, stageName }: { readonly deal: Deal; readonly stageName: AcquisitionStageName }) {
  const marketplace = metadataString(deal.metadata, ["marketplace", "source", "sourceHost", "marketplaceSource"]);
  const listingTitle = metadataString(deal.metadata, ["listingTitle", "listing_title", "capturedTitle", "title"]);
  const name = contactName(deal);

  return (
    <article className="rounded-2xl bg-background p-4" style={{ border: "0.5px solid var(--color-border)" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-foreground">{deal.title ?? "Untitled acquisition deal"}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{name ?? "No contact linked"}</p>
        </div>
        <span className="shrink-0 rounded-full bg-secondary px-2 py-1 text-[11px] font-medium text-muted-foreground">
          {stageName}
        </span>
      </div>

      <dl className="mt-4 space-y-2 text-xs">
        {marketplace !== null && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Marketplace</dt>
            <dd className="truncate font-medium text-foreground">{marketplace}</dd>
          </div>
        )}
        {listingTitle !== null && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Listing</dt>
            <dd className="truncate font-medium text-foreground">{listingTitle}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Updated</dt>
          <dd className="font-medium text-foreground">{formatUpdatedAt(deal.updatedAt)}</dd>
        </div>
      </dl>
    </article>
  );
}

export default function MarketplaceAcquisitionPage() {
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [deals, setDeals] = useState<readonly Deal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/deals?pipelineDefaultKey=marketplace_acquisition")
      .then((response) => response.json())
      .then((data: { readonly pipeline: Pipeline | null; readonly deals?: readonly Deal[] }) => {
        if (!cancelled) {
          setPipeline(data.pipeline);
          setDeals(data.deals ?? []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const stageByName = useMemo(() => new Map((pipeline?.stages ?? []).map((stage) => [stageKey(stage.name), stage])), [pipeline]);
  const hasDeals = deals.length > 0;

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 rounded-2xl bg-background p-5 sm:flex-row sm:items-center sm:justify-between" style={{ border: "0.5px solid var(--color-border)" }}>
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Marketplace acquisition</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Marketplace Acquisition</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Capture, invite, and convert marketplace sellers into Render sellers
          </p>
        </div>
        <Link className="inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pulse" href="/marketplace-acquisition/capture" style={{ background: "var(--color-whisper)" }}>
          Capture setup
          <IconArrowRight aria-hidden="true" className="size-4" stroke={1.8} />
        </Link>
      </section>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading marketplace acquisition pipeline…</p>
      ) : !hasDeals ? (
        <section className="flex flex-col items-center justify-center rounded-2xl bg-background px-6 py-16 text-center" style={{ border: "0.5px solid var(--color-border)" }}>
          <IconBookmark aria-hidden="true" className="size-8 text-muted-foreground" stroke={1.5} />
          <h2 className="mt-4 text-sm font-semibold text-foreground">No marketplace acquisition deals yet</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            Start by configuring marketplace capture, then captured sellers will appear on this acquisition board.
          </p>
          <Link className="mt-5 inline-flex h-10 items-center justify-center rounded-xl px-4 text-sm font-semibold text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pulse" href="/marketplace-acquisition/capture" style={{ background: "var(--color-whisper)" }}>
            Open capture setup
          </Link>
        </section>
      ) : (
        <div className="overflow-x-auto pb-2">
          <div className="grid min-w-[760px] grid-cols-3 gap-3">
            {acquisitionStages.map((stageName) => {
              const stage = stageByName.get(stageKey(stageName));
              const stageDeals = stage === undefined ? [] : deals.filter((deal) => deal.pipelineStageId === stage.id);

              return (
                <section key={stageName} className="rounded-2xl bg-secondary p-3" style={{ border: "0.5px solid var(--color-border)" }}>
                  <div className="flex items-center justify-between px-1 pb-3">
                    <h2 className="text-xs font-semibold text-foreground">{stageName}</h2>
                    <span className="flex size-5 items-center justify-center rounded-full bg-background text-[11px] font-semibold text-muted-foreground">
                      {stageDeals.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {stageDeals.length === 0 ? (
                      <p className="rounded-xl bg-background px-3 py-6 text-center text-xs text-muted-foreground">No deals</p>
                    ) : (
                      stageDeals.map((deal) => <DealSummaryCard deal={deal} key={deal.id} stageName={stageName} />)
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
