"use client";

import { useState, useEffect } from "react";
import { IconPlus, IconX, IconCurrencyDollar, IconUser } from "@tabler/icons-react";

interface PipelineStage {
  id: string;
  name: string;
  position: number;
  color?: string | null;
}

interface Pipeline {
  id: string;
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
  if (!value) return new Intl.NumberFormat("en-US", { style: "currency", currency: currency ?? "USD", maximumFractionDigits: 0 }).format(0);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency ?? "USD", maximumFractionDigits: 0 }).format(value);
}

function getStageColor(stage: PipelineStage, index: number): { accent: string; light: string } {
  const COLORS = [
    { accent: "#4338CA", light: "#EEF2FF" },
    { accent: "#1D4ED8", light: "#EFF6FF" },
    { accent: "#B45309", light: "#FEF3C7" },
    { accent: "#534AB7", light: "var(--color-mist)" },
    { accent: "#15803D", light: "#DCFCE7" },
  ];
  return COLORS[index % COLORS.length] ?? COLORS[0];
}

function initials(title?: string | null): string {
  if (!title) return "?";
  return title.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
}

function DealCard({ deal, accent, onClick }: { deal: Deal; accent: string; onClick: () => void }) {
  return (
    <div onClick={onClick} className="cursor-pointer rounded-2xl bg-background p-4 transition hover:shadow-md" style={{ border: "0.5px solid hsl(var(--border))" }}>
      <div className="flex items-center gap-2">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white" style={{ background: accent }}>
          {initials(deal.title)}
        </div>
        <p className="text-sm font-medium text-foreground leading-tight truncate">{deal.title ?? "Untitled deal"}</p>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">{formatValue(deal.value, deal.currency)}</span>
      </div>
      {deal.probability != null && (
        <div className="mt-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-muted-foreground">Probability</span>
            <span className="text-[11px] font-medium" style={{ color: accent }}>{deal.probability}%</span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full" style={{ width: `${deal.probability}%`, background: accent }} />
          </div>
        </div>
      )}
    </div>
  );
}

function DealDetail({ deal, stages, onClose, onStageChange }: { deal: Deal; stages: PipelineStage[]; onClose: () => void; onStageChange: (dealId: string, stageId: string) => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between p-5" style={{ borderBottom: "0.5px solid hsl(var(--border))" }}>
        <div>
          <p className="font-semibold text-foreground">{deal.title ?? "Untitled deal"}</p>
          <p className="text-xs text-muted-foreground">{formatValue(deal.value, deal.currency)}</p>
        </div>
        <button onClick={onClose} className="rounded-lg p-1 hover:bg-muted"><IconX className="size-4 text-muted-foreground" stroke={1.8} /></button>
      </div>
      <div className="space-y-4 p-5">
        <div className="flex items-center gap-2 text-sm">
          <IconCurrencyDollar className="size-3.5 text-muted-foreground" stroke={1.8} />
          <span className="font-semibold text-foreground">{formatValue(deal.value, deal.currency)}</span>
        </div>
        {deal.probability != null && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">Probability</span>
              <span className="text-xs font-medium" style={{ color: "var(--color-whisper)" }}>{deal.probability}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${deal.probability}%`, background: "var(--color-whisper)" }} />
            </div>
          </div>
        )}
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Move to stage</p>
          <div className="flex flex-wrap gap-2">
            {stages.map((s, i) => {
              const { accent, light } = getStageColor(s, i);
              return (
                <button key={s.id} onClick={() => onStageChange(deal.id, s.id)}
                  className="rounded-full px-3 py-1 text-xs font-medium transition"
                  style={deal.pipelineStageId === s.id ? { background: accent, color: "#fff" } : { background: light, color: accent }}>
                  {s.name}
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

  useEffect(() => {
    fetch("/api/deals")
      .then(r => r.json())
      .then(data => { setPipeline(data.pipeline); setDeals(data.deals ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  function handleDrop(stageId: string) {
    if (!dragging) return;
    setDeals(prev => prev.map(d => d.id === dragging ? { ...d, pipelineStageId: stageId } : d));
    if (selected?.id === dragging) setSelected(prev => prev ? { ...prev, pipelineStageId: stageId } : null);
    setDragging(null);
    setDragOver(null);
  }

  function handleStageChange(dealId: string, stageId: string) {
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, pipelineStageId: stageId } : d));
    setSelected(prev => prev?.id === dealId ? { ...prev, pipelineStageId: stageId } : prev);
  }

  function stageDeals(stageId: string) {
    return deals.filter(d => d.pipelineStageId === stageId);
  }

  function stageTotal(stageId: string) {
    return stageDeals(stageId).reduce((sum, d) => sum + (d.value ?? 0), 0);
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading pipeline…</p>;

  if (!pipeline) return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <p className="text-sm font-medium text-foreground">No pipeline found</p>
      <p className="mt-1 text-xs text-muted-foreground">A pipeline will be created automatically for your workspace.</p>
    </div>
  );

  return (
    <div className="flex gap-4">
      <div className="min-w-0 flex-1 overflow-x-auto">
        <div className="flex gap-3 pb-4" style={{ minWidth: "fit-content" }}>
          {pipeline.stages.map((stage, index) => {
            const { accent, light } = getStageColor(stage, index);
            const stageList = stageDeals(stage.id);
            const isDragTarget = dragOver === stage.id;
            return (
              <div key={stage.id} className="flex w-60 shrink-0 flex-col rounded-2xl transition-colors"
                style={{ background: isDragTarget ? light : "hsl(var(--secondary))", border: isDragTarget ? `2px solid ${accent}` : "0.5px solid hsl(var(--border))" }}
                onDragOver={e => { e.preventDefault(); setDragOver(stage.id); }}
                onDragLeave={() => setDragOver(null)}
                onDrop={() => handleDrop(stage.id)}>
                <div className="flex items-center justify-between px-3 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold" style={{ color: accent }}>{stage.name}</span>
                    <span className="flex size-4 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ background: accent }}>{stageList.length}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{formatValue(stageTotal(stage.id), "USD")}</span>
                </div>
                <div className="flex flex-1 flex-col gap-2 px-2 pb-2">
                  {stageList.length === 0 && (
                    <p className="px-2 py-4 text-center text-xs text-muted-foreground">No deals</p>
                  )}
                  {stageList.map(deal => (
                    <div key={deal.id} draggable onDragStart={() => setDragging(deal.id)} onDragEnd={() => { setDragging(null); setDragOver(null); }} style={{ opacity: dragging === deal.id ? 0.4 : 1 }}>
                      <DealCard deal={deal} accent={accent} onClick={() => setSelected(deal)} />
                    </div>
                  ))}
                  <button className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs text-muted-foreground transition hover:bg-background" style={{ border: "0.5px dashed hsl(var(--border))" }}>
                    <IconPlus className="size-3" stroke={1.8} /> Add deal
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {selected && (
        <div className="h-fit w-72 shrink-0 overflow-hidden rounded-2xl bg-background" style={{ border: "2px solid var(--color-whisper)" }}>
          <DealDetail deal={selected} stages={pipeline.stages} onClose={() => setSelected(null)} onStageChange={handleStageChange} />
        </div>
      )}
    </div>
  );
}
