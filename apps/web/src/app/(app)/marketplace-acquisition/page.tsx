"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { IconArrowRight, IconBookmark } from "@tabler/icons-react";

import { computeAcquisitionSummary, formatAcquisitionConversionRate } from "@/lib/acquisition-summary";

interface PipelineStage {
  readonly id: string;
  readonly name: string;
  readonly sortOrder?: number | null;
  readonly position?: number | null;
}

interface Pipeline {
  readonly id: string;
  readonly tenantId?: string;
  readonly name: string;
  readonly stages: readonly PipelineStage[];
}

interface Deal {
  readonly id: string;
  readonly title?: string | null;
  readonly value?: number | null;
  readonly currency?: string | null;
  readonly pipelineId: string;
  readonly pipelineStageId: string;
  readonly updatedAt: string;
}

const acquisitionStages = ["Captured", "Invited", "Converted"] as const;

function stageKey(name: string): string {
  return name.trim().toLowerCase();
}

function formatValue(value?: number | null, currency?: string | null): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency ?? "USD",
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}

function formatUpdatedAt(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function searchText(deal: Deal): string {
  return [deal.title, deal.currency, deal.id, marketplaceSource(deal)].filter(Boolean).join(" ").toLowerCase();
}

function marketplaceSource(deal: Deal): string {
  return deal.currency ?? "";
}

export default function MarketplaceAcquisitionPage() {
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("all");

  useEffect(() => {
    let cancelled = false;

    fetch("/api/deals?pipelineDefaultKey=marketplace_acquisition")
      .then((response) => response.json())
      .then((data: { readonly pipeline: Pipeline | null; readonly deals?: readonly Deal[] }) => {
        if (!cancelled) {
          setPipeline(data.pipeline);
          setDeals([...(data.deals ?? [])]);
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

  const filteredDeals = useMemo(() => {
    const normalizedSearchQuery = searchQuery.trim().toLowerCase();

    return deals.filter((deal) => {
      const matchesSearch =
        normalizedSearchQuery.length === 0 || searchText(deal).includes(normalizedSearchQuery);
      const dealStageName =
        pipeline?.stages.find((stage) => stage.id === deal.pipelineStageId)?.name ?? "";
      if (stageFilter !== "all" && stageKey(dealStageName) !== stageKey(stageFilter)) return false;

      return matchesSearch;
    });
  }, [deals, searchQuery, stageFilter, pipeline?.stages]);

  const summary = useMemo(() => computeAcquisitionSummary(pipeline, filteredDeals), [pipeline, filteredDeals]);
  const stageByName = useMemo(() => new Map((pipeline?.stages ?? []).map((stage) => [stageKey(stage.name), stage])), [pipeline]);

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 rounded-2xl bg-background p-5 sm:flex-row sm:items-center sm:justify-between" style={{ border: "0.5px solid var(--color-border)" }}>
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Marketplace Acquisition</p>
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

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Marketplace acquisition summary">
        <SummaryCard label="Captured" value={String(summary.captured)} description="Deals in the Captured stage" />
        <SummaryCard label="Invited" value={String(summary.invited)} description="Deals in the Invited stage" />
        <SummaryCard label="Converted" value={String(summary.converted)} description="Deals in the Converted stage" />
        <SummaryCard label="Conversion rate" value={formatAcquisitionConversionRate(summary.conversionRate)} description="Converted divided by captured" />
        <SummaryCard label="Recent opportunities" value={String(summary.recentCount)} description="Opportunities currently loaded from the board" />
      </section>

      <input
        aria-label="Search acquisitions"
        className="h-10 w-full rounded-xl bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-pulse"
        placeholder="Search by deal or contact"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        style={{ border: "0.5px solid var(--color-border)" }}
      />

      <select
        aria-label="Filter by acquisition stage"
        className="h-10 w-full rounded-xl bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-pulse"
        value={stageFilter}
        onChange={(event) => setStageFilter(event.target.value)}
        style={{ border: "0.5px solid var(--color-border)" }}
      >
        <option value="all">All stages</option>
        {acquisitionStages.map((stageName) => (
          <option key={stageName} value={stageName}>
            {stageName}
          </option>
        ))}
      </select>

      {!loading && pipeline !== null && filteredDeals.length === 0 && (
        <p className="rounded-xl bg-background px-4 py-6 text-center text-sm text-muted-foreground" style={{ border: "0.5px solid var(--color-border)" }}>
          No acquisition opportunities match these filters.
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading Marketplace Acquisition…</p>
      ) : pipeline === null ? (
        <section className="flex flex-col items-center justify-center rounded-2xl bg-background px-6 py-16 text-center" style={{ border: "0.5px solid var(--color-border)" }}>
          <IconBookmark aria-hidden="true" className="size-8 text-muted-foreground" stroke={1.5} />
          <h2 className="mt-4 text-sm font-semibold text-foreground">No marketplace acquisition deals yet</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">Start by configuring marketplace capture, then captured sellers will appear on this acquisition board.</p>
        </section>
      ) : (
        <div className="overflow-x-auto pb-2">
          <div className="grid min-w-[760px] grid-cols-3 gap-3">
            {acquisitionStages.map((stageName) => {
              const stage = stageByName.get(stageKey(stageName));
              const stageDeals = stage === undefined ? [] : filteredDeals.filter((deal) => deal.pipelineStageId === stage.id);

              return (
                <section key={stageName} className="rounded-2xl bg-secondary p-3" style={{ border: "0.5px solid var(--color-border)" }}>
                  <div className="flex items-center justify-between px-1 pb-3">
                    <h2 className="text-xs font-semibold text-foreground">{stageName}</h2>
                    <span className="flex size-5 items-center justify-center rounded-full bg-background text-[11px] font-semibold text-muted-foreground">{stageDeals.length}</span>
                  </div>

                  <div className="space-y-2">
                    {stageDeals.length === 0 ? (
                      <p className="rounded-xl bg-background px-3 py-6 text-center text-xs text-muted-foreground">No deals</p>
                    ) : (
                      stageDeals.map((deal) => (
                        <Link key={deal.id} href={`/marketplace-acquisition/${deal.id}`} className="block rounded-2xl bg-background p-4" style={{ border: "0.5px solid var(--color-border)" }}>
                          <h3 className="truncate text-sm font-semibold text-foreground">{deal.title ?? "Untitled acquisition deal"}</h3>
                          <p className="mt-2 text-xs text-muted-foreground">{formatValue(deal.value, deal.currency)}</p>
                          <p className="mt-2 text-xs text-muted-foreground">Updated {formatUpdatedAt(deal.updatedAt)}</p>
                        </Link>
                      ))
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

function SummaryCard({ label, value, description }: { readonly label: string; readonly value: string; readonly description: string }) {
  return (
    <div className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }}>
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
