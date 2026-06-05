"use client";

import { useState } from "react";
import { IconTrendingUp, IconTrendingDown } from "@tabler/icons-react";

type DateRange = "this_month" | "last_month" | "quarter" | "year";

const DATE_RANGES: { label: string; value: DateRange }[] = [
  { label: "This month", value: "this_month" },
  { label: "Last month", value: "last_month" },
  { label: "Quarter", value: "quarter" },
  { label: "Year", value: "year" },
];

// ── Mock data per range ────────────────────────────────────────────────────
const PIPELINE_DATA: Record<DateRange, { stage: string; value: number; color: string }[]> = {
  this_month: [
    { stage: "Prospect", value: 3200, color: "#4338CA" },
    { stage: "Qualified", value: 11500, color: "#1D4ED8" },
    { stage: "Proposal", value: 12700, color: "#B45309" },
    { stage: "Engagement", value: 21800, color: "#534AB7" },
    { stage: "Renewal", value: 15000, color: "#15803D" },
  ],
  last_month: [
    { stage: "Prospect", value: 5100, color: "#4338CA" },
    { stage: "Qualified", value: 9200, color: "#1D4ED8" },
    { stage: "Proposal", value: 18400, color: "#B45309" },
    { stage: "Engagement", value: 16000, color: "#534AB7" },
    { stage: "Renewal", value: 12000, color: "#15803D" },
  ],
  quarter: [
    { stage: "Prospect", value: 12000, color: "#4338CA" },
    { stage: "Qualified", value: 34000, color: "#1D4ED8" },
    { stage: "Proposal", value: 41000, color: "#B45309" },
    { stage: "Engagement", value: 58000, color: "#534AB7" },
    { stage: "Renewal", value: 39000, color: "#15803D" },
  ],
  year: [
    { stage: "Prospect", value: 48000, color: "#4338CA" },
    { stage: "Qualified", value: 112000, color: "#1D4ED8" },
    { stage: "Proposal", value: 138000, color: "#B45309" },
    { stage: "Engagement", value: 201000, color: "#534AB7" },
    { stage: "Renewal", value: 145000, color: "#15803D" },
  ],
};

const ACQUISITION_DATA: Record<DateRange, { source: string; count: number; pct: number; color: string }[]> = {
  this_month: [
    { source: "Referral", count: 14, pct: 58, color: "#534AB7" },
    { source: "Inbound", count: 6, pct: 25, color: "#1D9E75" },
    { source: "Outbound", count: 4, pct: 17, color: "#F59E0B" },
  ],
  last_month: [
    { source: "Referral", count: 11, pct: 50, color: "#534AB7" },
    { source: "Inbound", count: 7, pct: 32, color: "#1D9E75" },
    { source: "Outbound", count: 4, pct: 18, color: "#F59E0B" },
  ],
  quarter: [
    { source: "Referral", count: 38, pct: 54, color: "#534AB7" },
    { source: "Inbound", count: 19, pct: 27, color: "#1D9E75" },
    { source: "Outbound", count: 13, pct: 19, color: "#F59E0B" },
  ],
  year: [
    { source: "Referral", count: 142, pct: 56, color: "#534AB7" },
    { source: "Inbound", count: 71, pct: 28, color: "#1D9E75" },
    { source: "Outbound", count: 41, pct: 16, color: "#F59E0B" },
  ],
};

const SUMMARY_STATS: Record<DateRange, { avgDaysToClose: number; renewalRate: number; avgDelta: number; renewalDelta: number }> = {
  this_month:  { avgDaysToClose: 34, renewalRate: 82, avgDelta: -3, renewalDelta: 4 },
  last_month:  { avgDaysToClose: 37, renewalRate: 78, avgDelta: 2, renewalDelta: -1 },
  quarter:     { avgDaysToClose: 31, renewalRate: 84, avgDelta: -6, renewalDelta: 6 },
  year:        { avgDaysToClose: 38, renewalRate: 79, avgDelta: 1, renewalDelta: 2 },
};

function formatK(value: number) {
  if (value >= 1000) return `$${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
  return `$${value}`;
}

function BarChart({ data }: { data: { stage: string; value: number; color: string }[] }) {
  const max = Math.max(...data.map(d => d.value));
  return (
    <div className="flex h-48 items-end gap-3">
      {data.map(d => (
        <div key={d.stage} className="flex flex-1 flex-col items-center gap-2">
          <span className="text-xs font-medium" style={{ color: d.color }}>{formatK(d.value)}</span>
          <div className="w-full overflow-hidden rounded-t-lg transition-all" style={{ height: `${Math.max((d.value / max) * 160, 8)}px`, background: d.color, opacity: 0.85 }} />
          <span className="text-[10px] text-muted-foreground text-center leading-tight">{d.stage}</span>
        </div>
      ))}
    </div>
  );
}

function AcquisitionChart({ data }: { data: { source: string; count: number; pct: number; color: string }[] }) {
  return (
    <div className="space-y-4">
      {data.map(d => (
        <div key={d.source}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm font-medium text-foreground">{d.source}</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{d.count} clients</span>
              <span className="text-xs font-semibold" style={{ color: d.color }}>{d.pct}%</span>
            </div>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full transition-all" style={{ width: `${d.pct}%`, background: d.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value, delta, unit }: { label: string; value: number; delta: number; unit: string }) {
  const positive = delta <= 0 && unit === "days" ? true : delta >= 0;
  const Icon = positive ? IconTrendingUp : IconTrendingDown;
  return (
    <div className="rounded-2xl bg-secondary p-5" style={{ border: "0.5px solid hsl(var(--border))" }}>
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-3 text-[28px] font-semibold tracking-tight text-foreground">
        {value}<span className="text-base font-normal text-muted-foreground ml-1">{unit}</span>
      </p>
      <div className="mt-1 flex items-center gap-1">
        <Icon className="size-3" style={{ color: positive ? "var(--color-growth)" : "#EF4444" }} stroke={1.8} />
        <span className="text-xs" style={{ color: positive ? "var(--color-growth)" : "#EF4444" }}>
          {delta > 0 ? "+" : ""}{delta} {unit} vs prior period
        </span>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const [range, setRange] = useState<DateRange>("this_month");

  const pipeline = PIPELINE_DATA[range];
  const acquisition = ACQUISITION_DATA[range];
  const stats = SUMMARY_STATS[range];

  return (
    <div className="space-y-5">
      {/* Date range selector */}
      <div className="flex items-center gap-2">
        {DATE_RANGES.map(r => (
          <button
            key={r.value}
            onClick={() => setRange(r.value)}
            className="rounded-full px-4 py-1.5 text-xs font-medium transition"
            style={range === r.value
              ? { background: "var(--color-whisper)", color: "#fff" }
              : { background: "hsl(var(--secondary))", color: "hsl(var(--muted-foreground))", border: "0.5px solid hsl(var(--border))" }
            }
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4">
        <StatCard label="Avg Days to Close" value={stats.avgDaysToClose} delta={stats.avgDelta} unit="days" />
        <StatCard label="Renewal Rate" value={stats.renewalRate} delta={stats.renewalDelta} unit="%" />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid hsl(var(--border))" }}>
          <div className="mb-4 flex items-center justify-between" style={{ paddingBottom: "12px", borderBottom: "0.5px solid hsl(var(--border))" }}>
            <h2 className="text-sm font-semibold text-foreground">Revenue by Pipeline Stage</h2>
            <span className="text-xs text-muted-foreground">
              Total: {formatK(pipeline.reduce((s, d) => s + d.value, 0))}
            </span>
          </div>
          <BarChart data={pipeline} />
        </div>

        <div className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid hsl(var(--border))" }}>
          <div className="mb-4 flex items-center justify-between" style={{ paddingBottom: "12px", borderBottom: "0.5px solid hsl(var(--border))" }}>
            <h2 className="text-sm font-semibold text-foreground">Client Acquisition Sources</h2>
            <span className="text-xs text-muted-foreground">
              {acquisition.reduce((s, d) => s + d.count, 0)} total
            </span>
          </div>
          <AcquisitionChart data={acquisition} />
        </div>
      </div>
    </div>
  );
}
