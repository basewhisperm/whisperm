"use client";

import { useState, useEffect } from "react";
import { IconTrendingUp, IconTrendingDown } from "@tabler/icons-react";

type DateRange = "this_month" | "last_month" | "quarter" | "year";

interface RevenueByStage { stageId: string; stageName: string; revenue: number; }
interface AcquisitionSource { source: string; count: number; }

interface ReportsData {
  revenueByStage: RevenueByStage[];
  acquisitionSources: AcquisitionSource[];
  avgDaysToClose: number | null;
  renewalRate: number | null;
}

const DATE_RANGES: { label: string; value: DateRange }[] = [
  { label: "This month", value: "this_month" },
  { label: "Last month", value: "last_month" },
  { label: "Quarter", value: "quarter" },
  { label: "Year", value: "year" },
];

const STAGE_COLORS = ["#534AB7", "#1D4ED8", "#B45309", "#15803D", "#4338CA"];
const STAGE_COLORS = ["var(--color-whisper)", "var(--color-pulse)", "var(--color-health-amber)", "var(--color-growth)", "var(--color-midnight)"];

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function BarChart({ data }: { data: RevenueByStage[] }) {
  if (data.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">No revenue data for this period.</p>;
  const max = Math.max(...data.map(d => d.revenue), 1);
  return (
    <div className="flex h-48 items-end gap-3">
      {data.map((d, i) => {
        const color = STAGE_COLORS[i % STAGE_COLORS.length] ?? "#534AB7";
        const color = STAGE_COLORS[i % STAGE_COLORS.length] ?? "var(--color-whisper)";
        return (
          <div key={d.stageId} className="flex flex-1 flex-col items-center gap-2">
            <span className="text-xs font-medium" style={{ color }}>{formatCurrency(d.revenue)}</span>
            <div className="w-full overflow-hidden rounded-t-lg" style={{ height: `${Math.max((d.revenue / max) * 160, 8)}px`, background: color, opacity: 0.85 }} />
            <span className="text-[11px] text-muted-foreground text-center leading-tight">{d.stageName}</span>
          </div>
        );
      })}
    </div>
  );
}

function AcquisitionChart({ data }: { data: AcquisitionSource[] }) {
  if (data.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">No acquisition data for this period.</p>;
  const total = data.reduce((s, d) => s + d.count, 0);
  return (
    <div className="space-y-4">
      {data.map((d, i) => {
        const color = STAGE_COLORS[i % STAGE_COLORS.length] ?? "#534AB7";
        const color = STAGE_COLORS[i % STAGE_COLORS.length] ?? "var(--color-whisper)";
        const pct = total > 0 ? Math.round((d.count / total) * 100) : 0;
        return (
          <div key={d.source}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-medium text-foreground">{d.source}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{d.count} clients</span>
                <span className="text-xs font-semibold" style={{ color }}>{pct}%</span>
              </div>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function ReportsPage() {
  const [range, setRange] = useState<DateRange>("this_month");
  const [data, setData] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/reports?range=${range}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [range]);

  const avgDays = data?.avgDaysToClose;
  const renewalRate = data?.renewalRate;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        {DATE_RANGES.map(r => (
          <button key={r.value} onClick={() => setRange(r.value)} className="rounded-full px-4 py-1.5 text-xs font-medium transition"
            style={range === r.value ? { background: "var(--color-whisper)", color: "#fff" } : { background: "hsl(var(--secondary))", color: "hsl(var(--muted-foreground))", border: "0.5px solid hsl(var(--border))" }}>
            style={range === r.value ? { background: "var(--color-whisper)", color: "var(--color-primary-foreground)" } : { background: "var(--color-secondary)", color: "var(--color-muted-foreground)", border: "0.5px solid var(--color-border)" }}>
            {r.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {[
          { label: "Avg Days to Close", value: avgDays != null ? `${Math.round(avgDays)}` : "—", unit: avgDays != null ? "days" : "", positive: true },
          { label: "Renewal Rate", value: renewalRate != null ? `${Math.round(renewalRate * 100)}` : "—", unit: renewalRate != null ? "%" : "", positive: true },
        ].map(stat => (
          <div key={stat.label} className="rounded-2xl bg-secondary p-5" style={{ border: "0.5px solid hsl(var(--border))" }}>
          <div key={stat.label} className="rounded-2xl bg-secondary p-5" style={{ border: "0.5px solid var(--color-border)" }}>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{stat.label}</p>
            <p className="mt-3 text-[28px] font-semibold tracking-tight text-foreground">
              {loading ? "…" : stat.value}<span className="text-base font-normal text-muted-foreground ml-1">{stat.unit}</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{stat.value === "—" ? "No data yet" : "Current period"}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid hsl(var(--border))" }}>
          <div className="mb-4 flex items-center justify-between" style={{ paddingBottom: "12px", borderBottom: "0.5px solid hsl(var(--border))" }}>
        <div className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }}>
          <div className="mb-4 flex items-center justify-between" style={{ paddingBottom: "12px", borderBottom: "0.5px solid var(--color-border)" }}>
            <h2 className="text-sm font-semibold text-foreground">Revenue by Pipeline Stage</h2>
            <span className="text-xs text-muted-foreground">
              {data ? formatCurrency(data.revenueByStage.reduce((s, d) => s + d.revenue, 0)) : "—"}
            </span>
          </div>
          {loading ? <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p> : <BarChart data={data?.revenueByStage ?? []} />}
        </div>

        <div className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid hsl(var(--border))" }}>
          <div className="mb-4 flex items-center justify-between" style={{ paddingBottom: "12px", borderBottom: "0.5px solid hsl(var(--border))" }}>
        <div className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }}>
          <div className="mb-4 flex items-center justify-between" style={{ paddingBottom: "12px", borderBottom: "0.5px solid var(--color-border)" }}>
            <h2 className="text-sm font-semibold text-foreground">Client Acquisition Sources</h2>
            <span className="text-xs text-muted-foreground">
              {data ? `${data.acquisitionSources.reduce((s, d) => s + d.count, 0)} total` : "—"}
            </span>
          </div>
          {loading ? <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p> : <AcquisitionChart data={data?.acquisitionSources ?? []} />}
        </div>
      </div>
    </div>
  );
}