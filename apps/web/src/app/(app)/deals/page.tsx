"use client";

import { useEffect, useState } from "react";
import { IconCurrencyDollar, IconPlus, IconX } from "@tabler/icons-react";

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

function formatValue(value?: number | null, currency?: string | null) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency ?? "USD",
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}

function getStageColor(_stage: PipelineStage, index: number): { accent: string; light: string } {
  const colors = [
    { accent: "var(--color-whisper)", light: "var(--color-mist)" },
    { accent: "var(--color-pulse)", light: "var(--color-secondary)" },
    { accent: "var(--color-health-amber)", light: "var(--color-muted)" },
    { accent: "var(--color-growth)", light: "var(--color-secondary)" },
    { accent: "var(--color-midnight)", light: "var(--color-mist)" },
  ];

  return colors[index % colors.length] ?? { accent: "var(--color-whisper)", light: "var(--color-mist)" };
}

function initials(title?: string | null): string {
  if (!title) return "?";

  return title
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function DealCard({ deal, accent, onClick }: { deal: Deal; accent: string; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="cursor-pointer rounded-2xl bg-background p-4 transition hover:shadow-md"
      style={{ border: "0.5px solid var(--color-border)" }}
    >
      <div className="flex items-center gap-2">
        <div
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-primary-foreground"
          style={{ background: accent }}
        >
          {initials(deal.title)}
        </div>
        <p className="truncate text-sm font-medium leading-tight text-foreground">{deal.title ?? "Untitled deal"}</p>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">{formatValue(deal.value, deal.currency)}</span>
      </div>

      {deal.probability != null && (
        <div className="mt-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Probability</span>
            <span className="text-[11px] font-medium" style={{ color: accent }}>
              {deal.probability}%
            </span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full" style={{ width: `${deal.probability}%`, background: accent }} />
          </div>
        </div>
      )}
    </div>
  );
}

function DealDetail({
  deal,
  stages,
  onClose,
  onStageChange,
}: {
  deal: Deal;
  stages: PipelineStage[];
  onClose: () => void;
  onStageChange: (dealId: string, stageId: string) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between p-5" style={{ borderBottom: "0.5px solid var(--color-border)" }}>
        <div>
          <p className="font-semibold text-foreground">{deal.title ?? "Untitled deal"}</p>
          <p className="text-xs text-muted-foreground">{formatValue(deal.value, deal.currency)}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-muted">
          <IconX className="size-4 text-muted-foreground" stroke={1.8} />
        </button>
      </div>

      <div className="space-y-4 p-5">
        <div className="flex items-center gap-2 text-sm">
          <IconCurrencyDollar className="size-3.5 text-muted-foreground" stroke={1.8} />
          <span className="font-semibold text-foreground">{formatValue(deal.value, deal.currency)}</span>
        </div>

        {deal.probability != null && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Probability</span>
              <span className="text-xs font-medium" style={{ color: "var(--color-whisper)" }}>
                {deal.probability}%
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{ width: `${deal.probability}%`, background: "var(--color-whisper)" }}
              />
            </div>
          </div>
        )}

        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Move to stage</p>
          <div className="flex flex-wrap gap-2">
            {stages.map((stage, index) => {
              const { accent, light } = getStageColor(stage, index);

              return (
                <button
                  key={stage.id}
                  type="button"
                  onClick={() => onStageChange(deal.id, stage.id)}
                  className="rounded-full px-3 py-1 text-xs font-medium transition"
                  style={
                    deal.pipelineStageId === stage.id
                      ? { background: accent, color: "var(--color-primary-foreground)" }
                      : { background: light, color: accent }
                  }
                >
                  {stage.name}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DealsPage() {
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Deal | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [stageMoveError, setStageMoveError] = useState<string | null>(null);

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
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function stageDeals(stageId: string) {
    return deals.filter((deal) => deal.pipelineStageId === stageId);
  }

  function stageTotal(stageId: string) {
    return stageDeals(stageId).reduce((sum, deal) => sum + (deal.value ?? 0), 0);
  }

  function moveDealStage(dealId: string, stageId: string, previousStageId: string) {
    setStageMoveError(null);

    setDeals((currentDeals) =>
      currentDeals.map((deal) => (deal.id === dealId ? { ...deal, pipelineStageId: stageId } : deal)),
    );

    setSelected((currentDeal) =>
      currentDeal !== null && currentDeal.id === dealId ? { ...currentDeal, pipelineStageId: stageId } : currentDeal,
    );

    fetch(`/api/deals/${dealId}/stage`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stageId }),
    })
      .then(async (response) => {
        if (response.ok) return;

        setDeals((currentDeals) =>
          currentDeals.map((deal) => (deal.id === dealId ? { ...deal, pipelineStageId: previousStageId } : deal)),
        );
        setSelected((currentDeal) =>
          currentDeal !== null && currentDeal.id === dealId ? { ...currentDeal, pipelineStageId: previousStageId } : currentDeal,
        );

        const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        setStageMoveError(payload?.error?.message ?? "Could not move the deal. Please try again.");
      })
      .catch(() => {
        setDeals((currentDeals) =>
          currentDeals.map((deal) => (deal.id === dealId ? { ...deal, pipelineStageId: previousStageId } : deal)),
        );
        setSelected((currentDeal) =>
          currentDeal !== null && currentDeal.id === dealId ? { ...currentDeal, pipelineStageId: previousStageId } : currentDeal,
        );
        setStageMoveError("Could not move the deal. Please try again.");
      });
  }

  function handleDrop(stageId: string) {
    if (dragging === null) return;

    const previousStageId = deals.find((deal) => deal.id === dragging)?.pipelineStageId;
    const dealId = dragging;

    setDragging(null);
    setDragOver(null);

    if (previousStageId === undefined || previousStageId === stageId) return;
    moveDealStage(dealId, stageId, previousStageId);
  }

  function handleStageChange(dealId: string, stageId: string) {
    const previousStageId = deals.find((deal) => deal.id === dealId)?.pipelineStageId;
    if (previousStageId === undefined || previousStageId === stageId) return;

    moveDealStage(dealId, stageId, previousStageId);
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading pipeline…</p>;
  }

  if (!pipeline) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-sm font-medium text-foreground">No pipeline found</p>
        <p className="mt-1 text-xs text-muted-foreground">A pipeline will be created automatically for your workspace.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {stageMoveError && (
        <div
          className="flex items-center justify-between rounded-xl px-4 py-2 text-xs font-medium"
          style={{ background: "var(--color-muted)", color: "var(--color-health-amber)" }}
        >
          <span>{stageMoveError}</span>
          <button type="button" onClick={() => setStageMoveError(null)} className="rounded p-0.5 hover:opacity-70">
            <IconX className="size-3.5" stroke={1.8} />
          </button>
        </div>
      )}
      <div className="flex gap-4">
      <div className="min-w-0 flex-1 overflow-x-auto">
        <div className="flex gap-3 pb-4" style={{ minWidth: "fit-content" }}>
          {pipeline.stages.map((stage, index) => {
            const { accent, light } = getStageColor(stage, index);
            const stageList = stageDeals(stage.id);
            const isDragTarget = dragOver === stage.id;

            return (
              <div
                key={stage.id}
                className="flex w-60 shrink-0 flex-col rounded-2xl transition-colors"
                style={{
                  background: isDragTarget ? light : "var(--color-secondary)",
                  border: isDragTarget ? `2px solid ${accent}` : "0.5px solid var(--color-border)",
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOver(stage.id);
                }}
                onDragLeave={() => setDragOver(null)}
                onDrop={() => handleDrop(stage.id)}
              >
                <div className="flex items-center justify-between px-3 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold" style={{ color: accent }}>
                      {stage.name}
                    </span>
                    <span
                      className="flex size-4 items-center justify-center rounded-full text-[11px] font-semibold text-primary-foreground"
                      style={{ background: accent }}
                    >
                      {stageList.length}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">{formatValue(stageTotal(stage.id), "USD")}</span>
                </div>

                <div className="flex flex-1 flex-col gap-2 px-2 pb-2">
                  {stageList.length === 0 && (
                    <p className="px-2 py-4 text-center text-xs text-muted-foreground">No deals</p>
                  )}

                  {stageList.map((deal) => (
                    <div
                      key={deal.id}
                      draggable
                      onDragStart={() => setDragging(deal.id)}
                      onDragEnd={() => {
                        setDragging(null);
                        setDragOver(null);
                      }}
                      style={{ opacity: dragging === deal.id ? 0.4 : 1 }}
                    >
                      <DealCard deal={deal} accent={accent} onClick={() => setSelected(deal)} />
                    </div>
                  ))}

                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs text-muted-foreground transition hover:bg-background"
                    style={{ border: "0.5px dashed var(--color-border)" }}
                  >
                    <IconPlus className="size-3" stroke={1.8} />
                    Add deal
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selected && (
        <div className="h-fit w-72 shrink-0 overflow-hidden rounded-2xl bg-background" style={{ border: "2px solid var(--color-whisper)" }}>
          <DealDetail
            deal={selected}
            stages={pipeline.stages}
            onClose={() => setSelected(null)}
            onStageChange={handleStageChange}
          />
        </div>
      )}
      </div>
    </div>
  );
}