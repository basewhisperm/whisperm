"use client";

import { useState } from "react";
import { IconPlus, IconX, IconCurrencyDollar, IconUser, IconChevronDown } from "@tabler/icons-react";

type Stage = "Prospect" | "Qualified" | "Proposal" | "Engagement" | "Renewal";

interface Deal {
  id: string;
  contact: string;
  company: string;
  value: number;
  currency: string;
  owner: string;
  probability: number;
  stage: Stage;
}

const STAGES: Stage[] = ["Prospect", "Qualified", "Proposal", "Engagement", "Renewal"];

const STAGE_COLORS: Record<Stage, { accent: string; light: string }> = {
  Prospect:   { accent: "#4338CA", light: "#EEF2FF" },
  Qualified:  { accent: "#1D4ED8", light: "#EFF6FF" },
  Proposal:   { accent: "#B45309", light: "#FEF3C7" },
  Engagement: { accent: "var(--color-whisper)", light: "var(--color-mist)" },
  Renewal:    { accent: "#15803D", light: "#DCFCE7" },
};

const INITIAL_DEALS: Deal[] = [
  { id: "1", contact: "Kwame Asante", company: "Asante & Co", value: 12000, currency: "USD", owner: "Operator", probability: 80, stage: "Engagement" },
  { id: "2", contact: "Abena Mensah", company: "Mensah Partners", value: 8500, currency: "USD", owner: "Operator", probability: 60, stage: "Proposal" },
  { id: "3", contact: "Kofi Boateng", company: "Boateng Advisory", value: 5000, currency: "USD", owner: "Operator", probability: 40, stage: "Qualified" },
  { id: "4", contact: "Ama Owusu", company: "Owusu Consulting", value: 3200, currency: "USD", owner: "Operator", probability: 20, stage: "Prospect" },
  { id: "5", contact: "Yaw Darko", company: "Darko & Sons", value: 15000, currency: "USD", owner: "Operator", probability: 90, stage: "Renewal" },
  { id: "6", contact: "Efua Agyeman", company: "Agyeman Group", value: 9800, currency: "USD", owner: "Operator", probability: 75, stage: "Engagement" },
  { id: "7", contact: "Nana Amponsah", company: "Amponsah & Associates", value: 6500, currency: "USD", owner: "Operator", probability: 45, stage: "Qualified" },
  { id: "8", contact: "Akosua Frimpong", company: "Frimpong Tax", value: 4200, currency: "USD", owner: "Operator", probability: 55, stage: "Proposal" },
];

function initials(name: string) {
  return name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
}

function formatValue(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

function DealCard({ deal, onClick }: { deal: Deal; onClick: () => void }) {
  const { accent } = STAGE_COLORS[deal.stage];
  return (
    <div
      onClick={onClick}
      className="cursor-pointer rounded-2xl bg-background p-4 transition hover:shadow-md"
      style={{ border: "0.5px solid hsl(var(--border))" }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white" style={{ background: accent }}>
            {initials(deal.contact)}
          </div>
          <div>
            <p className="text-sm font-medium text-foreground leading-tight">{deal.contact}</p>
            <p className="text-xs text-muted-foreground">{deal.company}</p>
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">{formatValue(deal.value, deal.currency)}</span>
        <span className="text-xs text-muted-foreground">{deal.owner}</span>
      </div>
      <div className="mt-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-muted-foreground">Probability</span>
          <span className="text-[11px] font-medium" style={{ color: accent }}>{deal.probability}%</span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full transition-all" style={{ width: `${deal.probability}%`, background: accent }} />
        </div>
      </div>
    </div>
  );
}

function DealDetail({ deal, onClose, onStageChange }: { deal: Deal; onClose: () => void; onStageChange: (id: string, stage: Stage) => void }) {
  const { accent } = STAGE_COLORS[deal.stage];
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between p-5" style={{ borderBottom: "0.5px solid hsl(var(--border))" }}>
        <div>
          <p className="font-semibold text-foreground">{deal.contact}</p>
          <p className="text-xs text-muted-foreground">{deal.company}</p>
        </div>
        <button onClick={onClose} className="rounded-lg p-1 hover:bg-muted">
          <IconX className="size-4 text-muted-foreground" stroke={1.8} />
        </button>
      </div>
      <div className="space-y-4 p-5">
        <div className="flex items-center gap-2 text-sm">
          <IconCurrencyDollar className="size-3.5 text-muted-foreground" stroke={1.8} />
          <span className="font-semibold text-foreground">{formatValue(deal.value, deal.currency)}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <IconUser className="size-3.5 text-muted-foreground" stroke={1.8} />
          <span className="text-foreground">{deal.owner}</span>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Move to stage</p>
          <div className="flex flex-wrap gap-2">
            {STAGES.map(s => (
              <button
                key={s}
                onClick={() => onStageChange(deal.id, s)}
                className="rounded-full px-3 py-1 text-xs font-medium transition"
                style={deal.stage === s
                  ? { background: STAGE_COLORS[s].accent, color: "#fff" }
                  : { background: STAGE_COLORS[s].light, color: STAGE_COLORS[s].accent }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">Probability</span>
            <span className="text-xs font-medium" style={{ color: accent }}>{deal.probability}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full" style={{ width: `${deal.probability}%`, background: accent }} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DealsPage() {
  const [deals, setDeals] = useState<Deal[]>(INITIAL_DEALS);
  const [selected, setSelected] = useState<Deal | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<Stage | null>(null);

  function stageDeals(stage: Stage) {
    return deals.filter(d => d.stage === stage);
  }

  function stageTotal(stage: Stage) {
    return stageDeals(stage).reduce((sum, d) => sum + d.value, 0);
  }

  function handleDragStart(id: string) {
    setDragging(id);
  }

  function handleDrop(stage: Stage) {
    if (!dragging) return;
    setDeals(prev => prev.map(d => d.id === dragging ? { ...d, stage } : d));
    if (selected?.id === dragging) setSelected(prev => prev ? { ...prev, stage } : null);
    setDragging(null);
    setDragOver(null);
  }

  function handleStageChange(id: string, stage: Stage) {
    setDeals(prev => prev.map(d => d.id === id ? { ...d, stage } : d));
    setSelected(prev => prev?.id === id ? { ...prev, stage } : prev);
  }

  return (
    <div className="flex gap-4">
      {/* Kanban board */}
      <div className="min-w-0 flex-1 overflow-x-auto">
        <div className="flex gap-3 pb-4" style={{ minWidth: "fit-content" }}>
          {STAGES.map(stage => {
            const { accent, light } = STAGE_COLORS[stage];
            const stageList = stageDeals(stage);
            const isDragTarget = dragOver === stage;
            return (
              <div
                key={stage}
                className="flex w-60 shrink-0 flex-col rounded-2xl transition-colors"
                style={{ background: isDragTarget ? light : "hsl(var(--secondary))", border: isDragTarget ? `2px solid ${accent}` : "0.5px solid hsl(var(--border))" }}
                onDragOver={e => { e.preventDefault(); setDragOver(stage); }}
                onDragLeave={() => setDragOver(null)}
                onDrop={() => handleDrop(stage)}
              >
                {/* Column header */}
                <div className="flex items-center justify-between px-3 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold" style={{ color: accent }}>{stage}</span>
                    <span className="flex size-4 items-center justify-center rounded-full text-[11px] font-semibold text-white" style={{ background: accent }}>{stageList.length}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{formatValue(stageTotal(stage), "USD")}</span>
                </div>

                {/* Cards */}
                <div className="flex flex-1 flex-col gap-2 px-2 pb-2">
                  {stageList.map(deal => (
                    <div
                      key={deal.id}
                      draggable
                      onDragStart={() => handleDragStart(deal.id)}
                      onDragEnd={() => { setDragging(null); setDragOver(null); }}
                      style={{ opacity: dragging === deal.id ? 0.4 : 1 }}
                    >
                      <DealCard deal={deal} onClick={() => setSelected(deal)} />
                    </div>
                  ))}

                  {/* Quick add */}
                  <button
                    className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs text-muted-foreground transition hover:bg-background"
                    style={{ border: "0.5px dashed hsl(var(--border))" }}
                  >
                    <IconPlus className="size-3" stroke={1.8} /> Add deal
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail drawer */}
      {selected && (
        <div className="h-fit w-72 shrink-0 overflow-hidden rounded-2xl bg-background" style={{ border: "2px solid var(--color-whisper)" }}>
          <DealDetail deal={selected} onClose={() => setSelected(null)} onStageChange={handleStageChange} />
        </div>
      )}
    </div>
  );
}
