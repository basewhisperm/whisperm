"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

interface PipelineStage {
  id: string;
  name: string;
  position?: number | null;
  color?: string | null;
}

interface Pipeline {
  id: string;
  name: string;
  stages: PipelineStage[];
}

interface Deal {
  id: string;
  title?: string | null;
  value?: number | null;
  currency?: string | null;
  pipelineId: string;
  pipelineStageId: string;
  updatedAt: string;
}

const ACQUISITION_STAGE_NAMES = ["Captured", "Invited", "Converted"] as const;
type AcquisitionStageName = (typeof ACQUISITION_STAGE_NAMES)[number];

function formatValue(value?: number | null, currency?: string | null) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency ?? "USD",
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}

function stageColor(stage: PipelineStage, index: number): string {
  const colors = ["#64748B", "#2563EB", "#16A34A"];
  return stage.color ?? colors[index % colors.length] ?? "#64748B";
}

function acquisitionStageNames(pipeline: Pipeline | null): Set<string> {
  return new Set((pipeline?.stages ?? []).map((stage) => stage.name));
}

function nextActions(currentStageName: string | undefined): readonly AcquisitionStageName[] {
  if (currentStageName === "Captured") return ["Invited", "Converted"];
  if (currentStageName === "Invited") return ["Captured", "Converted"];
  if (currentStageName === "Converted") return ["Captured", "Invited"];
  return [];
}

export default function MarketplaceAcquisitionPage() {
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [movingDealId, setMovingDealId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/marketplace-acquisition/deals?pipelineDefaultKey=marketplace_acquisition")
      .then(async (response) => {
        const data = (await response.json()) as { pipeline: Pipeline | null; deals?: Deal[]; error?: string };
        if (!response.ok) throw new Error(data.error ?? "Unable to load marketplace acquisition deals");
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        setPipeline(data.pipeline);
        setDeals(data.deals ?? []);
        setError(data.error ?? null);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "Unable to load marketplace acquisition deals");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const configuredStageNames = useMemo(() => acquisitionStageNames(pipeline), [pipeline]);
  const missingStages = ACQUISITION_STAGE_NAMES.filter((stageName) => !configuredStageNames.has(stageName));

  function stageDeals(stageId: string) {
    return deals.filter((deal) => deal.pipelineStageId === stageId);
  }

  function stageNameFor(deal: Deal): string | undefined {
    return pipeline?.stages.find((stage) => stage.id === deal.pipelineStageId)?.name;
  }

  async function moveDeal(deal: Deal, stageName: AcquisitionStageName) {
    setMovingDealId(deal.id);
    setError(null);

    try {
      const response = await fetch(`/api/marketplace-acquisition/deals/${deal.id}/stage`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stageName }),
      });
      const data = (await response.json()) as { deal?: Deal; error?: string };
      if (!response.ok || data.deal === undefined) throw new Error(data.error ?? "Unable to move acquisition deal");
      setDeals((currentDeals) => currentDeals.map((currentDeal) => (currentDeal.id === deal.id ? data.deal! : currentDeal)));
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Unable to move acquisition deal");
    } finally {
      setMovingDealId(null);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading Marketplace Acquisition…</p>;

  if (!pipeline) {
    return (
      <div className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }}>
        <h1 className="text-xl font-semibold text-foreground">Marketplace Acquisition</h1>
        <p className="mt-2 text-sm text-muted-foreground">Marketplace Acquisition pipeline is missing. Run the pipeline seed before moving captured listings.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Marketplace acquisition</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Acquisition stage actions</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Capture, invite, and convert marketplace sellers into Render sellers. Move captured marketplace opportunities through the acquisition pipeline without triggering seller invitations, verification, or conversion side effects.
        </p>
      </div>

      <Link href="/marketplace-acquisition/capture" className="text-sm font-medium text-foreground">Capture setup</Link>

      {(error !== null || missingStages.length > 0) && (
        <div className="rounded-2xl bg-background p-4 text-sm text-destructive" style={{ border: "0.5px solid var(--color-border)" }}>
          {error ?? `Marketplace Acquisition pipeline is missing expected stage(s): ${missingStages.join(", ")}.`}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        {pipeline.stages.map((stage, index) => {
          const color = stageColor(stage, index);
          const items = stageDeals(stage.id);

          return (
            <section key={stage.id} className="rounded-2xl bg-secondary p-3" style={{ border: "0.5px solid var(--color-border)" }}>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold" style={{ color }}>{stage.name}</span>
                  <span className="flex size-4 items-center justify-center rounded-full text-[11px] font-semibold text-primary-foreground" style={{ background: color }}>{items.length}</span>
                </div>
              </div>

              <div className="space-y-2">
                {items.length === 0 && <p className="rounded-xl bg-background p-4 text-center text-xs text-muted-foreground">No acquisition deals</p>}
                {items.map((deal) => {
                  const currentStageName = stageNameFor(deal);
                  const actions = nextActions(currentStageName).filter((stageName) => configuredStageNames.has(stageName));

                  return (
                    <article key={deal.id} className="rounded-2xl bg-background p-4" style={{ border: "0.5px solid var(--color-border)" }}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="truncate text-sm font-semibold text-foreground">{deal.title ?? "Untitled acquisition deal"}</h2>
                          <p className="mt-1 text-xs text-muted-foreground">{formatValue(deal.value, deal.currency)}</p>
                          <Link href={`/marketplace-acquisition/${deal.id}`} className="mt-2 inline-flex text-xs font-medium text-whisper hover:underline">View detail</Link>
                        </div>
                        <span className="rounded-full px-2 py-1 text-[11px] font-medium" style={{ background: `${color}1A`, color }}>{currentStageName ?? "Unknown"}</span>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {actions.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No configured acquisition stage actions are available.</p>
                        ) : actions.map((stageName) => (
                          <button
                            key={stageName}
                            type="button"
                            disabled={movingDealId === deal.id || missingStages.length > 0}
                            onClick={() => void moveDeal(deal, stageName)}
                            className="rounded-full px-3 py-1 text-xs font-medium text-primary-foreground transition disabled:cursor-not-allowed disabled:opacity-50"
                            style={{ background: "var(--color-whisper)" }}
                          >
                            Move to {stageName}
                          </button>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
