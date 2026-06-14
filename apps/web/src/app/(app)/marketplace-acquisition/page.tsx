"use client";

import { useEffect, useMemo, useState } from "react";

import { computeAcquisitionSummary, formatAcquisitionConversionRate } from "@/lib/acquisition-summary";

interface PipelineStage {
  id: string;
  name: string;
  sortOrder?: number | null;
}

interface Pipeline {
  id: string;
  tenantId: string;
  name: string;
  stages: PipelineStage[];
}

interface Deal {
  id: string;
  tenantId: string;
  title?: string | null;
  value?: number | null;
  currency?: string | null;
  probability?: number | null;
  pipelineId: string;
  pipelineStageId: string;
  contactId?: string | null;
  ownerId?: string | null;
  closedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

function stageDeals(deals: readonly Deal[], stageId: string): readonly Deal[] {
  return deals.filter((deal) => deal.pipelineStageId === stageId);
}

function SummaryCard({ label, value, description }: { label: string; value: string; description: string }) {
  return (
    <div className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }}>
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

export default function MarketplaceAcquisitionPage() {
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/deals")
      .then((response) => response.json())
      .then((data: { pipeline: Pipeline | null; deals?: Deal[] }) => {
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

  const summary = useMemo(() => computeAcquisitionSummary(pipeline, deals), [pipeline, deals]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading acquisition summary…</p>;
  }

  if (!pipeline) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-sm font-medium text-foreground">No acquisition pipeline found</p>
        <p className="mt-1 text-xs text-muted-foreground">A pipeline will be created automatically for your workspace.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Marketplace acquisition</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Acquisition dashboard</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Lightweight summary metrics derived from the existing deal pipeline stages.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Marketplace acquisition summary">
        <SummaryCard label="Captured" value={String(summary.captured)} description="Deals in the Captured stage" />
        <SummaryCard label="Invited" value={String(summary.invited)} description="Deals in the Invited stage" />
        <SummaryCard label="Converted" value={String(summary.converted)} description="Deals in the Converted stage" />
        <SummaryCard label="Conversion rate" value={formatAcquisitionConversionRate(summary.conversionRate)} description="Converted divided by captured" />
        <SummaryCard label="Recent opportunities" value={String(summary.recentCount)} description="Opportunities currently loaded from the board" />
      </section>

      <section className="min-w-0 overflow-x-auto" aria-label="Marketplace acquisition board">
        <div className="flex gap-3 pb-4" style={{ minWidth: "fit-content" }}>
          {pipeline.stages.map((stage) => {
            const stageList = stageDeals(deals, stage.id);

            return (
              <div
                key={stage.id}
                className="flex w-60 shrink-0 flex-col rounded-2xl bg-secondary"
                style={{ border: "0.5px solid var(--color-border)" }}
              >
                <div className="flex items-center justify-between px-3 py-3">
                  <span className="text-xs font-semibold text-foreground">{stage.name}</span>
                  <span className="flex size-4 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                    {stageList.length}
                  </span>
                </div>

                <div className="flex flex-1 flex-col gap-2 px-2 pb-2">
                  {stageList.length === 0 && <p className="px-2 py-4 text-center text-xs text-muted-foreground">No opportunities</p>}
                  {stageList.map((deal) => (
                    <article
                      key={deal.id}
                      className="rounded-2xl bg-background p-4"
                      style={{ border: "0.5px solid var(--color-border)" }}
                    >
                      <p className="truncate text-sm font-medium leading-tight text-foreground">{deal.title ?? "Untitled opportunity"}</p>
                      <p className="mt-2 text-xs text-muted-foreground">Updated {new Date(deal.updatedAt).toLocaleDateString()}</p>
                    </article>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
