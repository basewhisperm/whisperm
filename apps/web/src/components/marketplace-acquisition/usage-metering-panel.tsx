"use client";

import { useEffect, useState } from "react";

import { errorMessageFromPayload } from "@/lib/marketplace-acquisition/workbench-domain";

interface UsageEventTotal {
  readonly eventType: string;
  readonly quantity: number;
  readonly billableQuantity: number;
}

interface UsageSummary {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly totals: readonly UsageEventTotal[];
  readonly billableTotalQuantity: number;
  readonly plan: "STARTER" | "GROWTH" | "PRO";
  readonly includedBillableActions: number;
  readonly remainingBillableActions: number;
  readonly generatedAt: string;
}

const asSummary = (payload: unknown): UsageSummary | null => {
  const data = (payload as { readonly data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  return data as UsageSummary;
};

async function fetchUsageSummary(): Promise<UsageSummary | null> {
  const response = await fetch("/api/marketplace-acquisition/usage");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorMessageFromPayload(payload) ?? "Usage could not be loaded.");
  return asSummary(payload);
}

const eventTypeLabels: Readonly<Record<string, string>> = {
  SELLER_DISCOVERED: "Sellers discovered",
  SELLER_QUALIFIED: "Sellers qualified",
  INVITATION_SENT: "Invitations sent",
  SELLER_CLAIMED: "Sellers claimed",
  CRM_CONVERSION_CREATED: "CRM conversions",
  REVENUE_ATTRIBUTED: "Revenue attributions",
  GROWTH_LOOP_EVALUATED: "Growth loop evaluations",
  GROWTH_RECOMMENDATION_APPLIED: "Growth recommendations applied",
};

const formatTimestamp = (value: string | null): string => {
  if (value === null) return "Never";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

const formatMonthLabel = (periodStart: string): string => {
  try {
    return new Date(periodStart).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  } catch {
    return periodStart;
  }
};

export function UsageMeteringPanel() {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchUsageSummary()
      .then((next) => {
        if (!cancelled) {
          setSummary(next);
          setLoading(false);
        }
      })
      .catch((fetchError: unknown) => {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : "Usage could not be loaded.");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <section className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }} aria-label="Usage & Metering">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Usage &amp; Metering</p>
        <p className="mt-2 text-sm text-muted-foreground">Loading usage…</p>
      </section>
    );
  }

  if (error !== null) {
    return (
      <section className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }} aria-label="Usage & Metering">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Usage &amp; Metering</p>
        <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{error}</p>
      </section>
    );
  }

  if (summary === null) return null;

  const billableRows = summary.totals.filter((total) => total.billableQuantity > 0);
  const nonBillableRows = summary.totals.filter((total) => total.billableQuantity === 0);
  const isEmpty = summary.totals.length === 0;
  const usagePercent = Math.min(100, Math.round((summary.billableTotalQuantity / summary.includedBillableActions) * 100));

  return (
    <section className="space-y-4 rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }} aria-label="Usage & Metering">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Usage &amp; Metering</p>
          <p className="mt-1 text-xs text-muted-foreground">{formatMonthLabel(summary.periodStart)} · updated {formatTimestamp(summary.generatedAt)}</p>
        </div>
        <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
          {summary.plan} · {summary.billableTotalQuantity.toLocaleString()} / {summary.includedBillableActions.toLocaleString()}
        </span>
      </div>

      <p className="rounded-xl bg-secondary px-3 py-2 text-xs text-muted-foreground">
        {summary.remainingBillableActions.toLocaleString()} acquisition actions remain in this month&apos;s included allowance.
        This meter is not an invoice; it reflects recorded platform activity.
      </p>
      <div aria-label={`${usagePercent}% of monthly acquisition-action allowance used`} className="h-2 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-whisper transition-all" style={{ width: `${usagePercent}%` }} />
      </div>

      {isEmpty ? (
        <p className="text-xs text-muted-foreground">
          No acquisition activity has been metered yet this period. Usage will appear here once discovery, invitations, claims, or conversions run.
        </p>
      ) : (
        <>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Billable usage</p>
            {billableRows.length > 0 ? (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[420px] text-left text-xs" aria-label="Billable usage by event type">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="py-1 pr-2 font-medium">Event type</th>
                      <th className="py-1 pr-2 font-medium">Quantity</th>
                      <th className="py-1 pr-2 font-medium">Billable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billableRows.map((total) => (
                      <tr key={total.eventType} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                        <td className="py-2 pr-2 font-medium text-foreground">{eventTypeLabels[total.eventType] ?? total.eventType}</td>
                        <td className="py-2 pr-2 text-muted-foreground">{total.quantity}</td>
                        <td className="py-2 pr-2 text-foreground">{total.billableQuantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">No billable usage recorded this period.</p>
            )}
          </div>

          {nonBillableRows.length > 0 ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Non-billable activity</p>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[300px] text-left text-xs text-muted-foreground" aria-label="Non-billable usage by event type">
                  <thead>
                    <tr>
                      <th className="py-1 pr-2 font-medium">Event type</th>
                      <th className="py-1 pr-2 font-medium">Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nonBillableRows.map((total) => (
                      <tr key={total.eventType} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                        <td className="py-2 pr-2">{eventTypeLabels[total.eventType] ?? total.eventType}</td>
                        <td className="py-2 pr-2">{total.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
