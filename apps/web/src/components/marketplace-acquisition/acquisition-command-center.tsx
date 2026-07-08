"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";

import { errorMessageFromPayload } from "@/lib/marketplace-acquisition/workbench-domain";

interface CommandCenterFunnel {
  readonly discovered: number;
  readonly qualified: number;
  readonly invited: number;
  readonly claimed: number;
  readonly crmConverted: number;
  readonly dealsCreated: number;
  readonly revenueAttributed: number;
}

interface CommandCenterRevenue {
  readonly pipelineValue: number;
  readonly attributedRevenue: number;
  readonly currency: string;
}

interface CommandCenterRates {
  readonly qualificationRate: number;
  readonly inviteRate: number;
  readonly claimRate: number;
  readonly crmConversionRate: number;
  readonly revenueConversionRate: number;
}

interface CommandCenterSourcePerformance {
  readonly key: string;
  readonly attributedRevenue: number;
  readonly wonDealsCount: number;
}

interface CommandCenterAction {
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly description: string;
  readonly severity: "INFO" | "WARNING" | "ACTIONABLE";
  readonly count?: number;
  readonly workbenchHref: string;
}

interface CommandCenterWarning {
  readonly code: string;
  readonly severity: "INFO" | "WARNING" | "CRITICAL";
  readonly message: string;
}

interface CommandCenterAcquisitionMetrics {
  readonly needsReview: number;
  readonly phoneReady: number;
  readonly invitationReady: number;
  readonly waitingClaim: number;
  readonly converted: number;
}

interface CommandCenterSnapshot {
  readonly campaignId: string;
  readonly campaignName: string;
  readonly status: string;
  readonly funnel: CommandCenterFunnel;
  readonly revenue: CommandCenterRevenue;
  readonly rates: CommandCenterRates;
  readonly bestSource: CommandCenterSourcePerformance | null;
  readonly worstSource: CommandCenterSourcePerformance | null;
  readonly topActions: readonly CommandCenterAction[];
  readonly readinessWarnings: readonly CommandCenterWarning[];
  readonly growthRecommendations: readonly unknown[];
  readonly generatedAt: string;
  /** ST1-013E: read from AcquisitionMetricsService, identical to Dashboard/Workbench/Campaigns. */
  readonly acquisitionMetrics?: CommandCenterAcquisitionMetrics | undefined;
}

const asSnapshot = (payload: unknown): CommandCenterSnapshot | null => {
  const data = (payload as { readonly data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  return data as CommandCenterSnapshot;
};

async function fetchCommandCenterSnapshot(campaignId?: string): Promise<CommandCenterSnapshot | null> {
  const query = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : "";
  const response = await fetch(`/api/marketplace-acquisition/command-center${query}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorMessageFromPayload(payload) ?? "Acquisition command center could not be loaded.");
  return asSnapshot(payload);
}

function Badge({ children, tone }: { readonly children: ReactNode; readonly tone?: string | undefined }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone ?? "bg-secondary text-foreground"}`}>{children}</span>;
}

const severityTone = (severity: "INFO" | "WARNING" | "ACTIONABLE" | "CRITICAL"): string => {
  if (severity === "CRITICAL") return "bg-red-100 text-red-700";
  if (severity === "ACTIONABLE") return "bg-amber-50 text-amber-700";
  if (severity === "WARNING") return "bg-red-50 text-red-700";
  return "bg-secondary text-muted-foreground";
};

const formatCurrency = (amount: number, currency: string): string => {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
};

const formatRate = (rate: number): string => `${Math.round(rate * 100)}%`;

const funnelStages: readonly { readonly key: keyof CommandCenterFunnel; readonly label: string }[] = [
  { key: "discovered", label: "Discovered" },
  { key: "qualified", label: "Qualified" },
  { key: "invited", label: "Invited" },
  { key: "claimed", label: "Claimed" },
  { key: "crmConverted", label: "Converted to CRM" },
  { key: "dealsCreated", label: "Deal created" },
  { key: "revenueAttributed", label: "Revenue attributed" },
];

export function AcquisitionCommandCenter({ campaignId }: { readonly campaignId?: string | undefined }) {
  const [snapshot, setSnapshot] = useState<CommandCenterSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchCommandCenterSnapshot(campaignId)
      .then((next) => {
        if (!cancelled) {
          setSnapshot(next);
          setLoading(false);
        }
      })
      .catch((fetchError: unknown) => {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : "Acquisition command center could not be loaded.");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  if (loading) {
    return (
      <section className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }} aria-label="Acquisition command center">
        <p className="text-sm text-muted-foreground">Loading acquisition command center…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }} aria-label="Acquisition command center">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Revenue engine status</p>
        <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{error}</p>
      </section>
    );
  }

  if (snapshot === null) return null;

  const hasCampaign = snapshot.campaignId.length > 0;

  return (
    <section data-testid="command-center" className="space-y-4 rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }} aria-label="Acquisition command center">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Revenue engine status</p>
          <h2 className="mt-1 text-lg font-semibold text-foreground">{hasCampaign ? snapshot.campaignName : "No campaign yet"}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{hasCampaign ? `Status ${snapshot.status}` : "Create a campaign to start the acquisition engine."}</p>
        </div>
        {hasCampaign ? (
          <Link className="inline-flex h-10 items-center justify-center rounded-xl bg-whisper px-4 text-sm font-semibold text-white" href={`/marketplace-acquisition/campaigns/${encodeURIComponent(snapshot.campaignId)}/workbench`}>
            Open Workbench
          </Link>
        ) : (
          <Link className="inline-flex h-10 items-center justify-center rounded-xl bg-whisper px-4 text-sm font-semibold text-white" href="/marketplace-acquisition/campaigns">
            Create Campaign
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4">
        <div data-testid="revenue-pipeline-value" className="rounded-xl bg-secondary p-3"><p className="font-semibold text-foreground">{formatCurrency(snapshot.revenue.pipelineValue, snapshot.revenue.currency)}</p><p className="text-muted-foreground">pipeline value</p></div>
        <div data-testid="revenue-attributed-value" className="rounded-xl bg-secondary p-3"><p className="font-semibold text-foreground">{formatCurrency(snapshot.revenue.attributedRevenue, snapshot.revenue.currency)}</p><p className="text-muted-foreground">attributed revenue</p></div>
        <div className="rounded-xl bg-secondary p-3"><p className="font-semibold text-foreground">{formatRate(snapshot.rates.claimRate)}</p><p className="text-muted-foreground">claim rate</p></div>
        <div className="rounded-xl bg-secondary p-3"><p className="font-semibold text-foreground">{formatRate(snapshot.rates.crmConversionRate)}</p><p className="text-muted-foreground">CRM conversion rate</p></div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4">
        <div className="rounded-xl bg-secondary p-3">
          <p className="font-semibold text-foreground">{snapshot.bestSource ? snapshot.bestSource.key : "—"}</p>
          <p className="text-muted-foreground">best source{snapshot.bestSource ? ` · ${formatCurrency(snapshot.bestSource.attributedRevenue, snapshot.revenue.currency)}` : ""}</p>
        </div>
        <div className="rounded-xl bg-secondary p-3">
          <p className="font-semibold text-foreground">{snapshot.worstSource ? snapshot.worstSource.key : "—"}</p>
          <p className="text-muted-foreground">worst source{snapshot.worstSource ? ` · ${formatCurrency(snapshot.worstSource.attributedRevenue, snapshot.revenue.currency)}` : ""}</p>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Revenue funnel</p>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs sm:grid-cols-7" aria-label="Revenue funnel">
          {funnelStages.map((stage) => (
            <div key={stage.key} data-testid={`funnel-${stage.key}`} className="rounded-xl bg-secondary p-3">
              <p className="text-lg font-semibold text-foreground">{snapshot.funnel[stage.key]}</p>
              <p className="text-muted-foreground">{stage.label}</p>
            </div>
          ))}
        </div>
      </div>

      {snapshot.acquisitionMetrics !== undefined ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Acquisition metrics</p>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs sm:grid-cols-5" aria-label="Acquisition metrics">
            <div data-testid="metric-needs-review" className="rounded-xl bg-secondary p-3"><p className="text-lg font-semibold text-foreground">{snapshot.acquisitionMetrics.needsReview}</p><p className="text-muted-foreground">Needs Review</p></div>
            <div data-testid="metric-phone-ready" className="rounded-xl bg-secondary p-3"><p className="text-lg font-semibold text-foreground">{snapshot.acquisitionMetrics.phoneReady}</p><p className="text-muted-foreground">Phone Ready</p></div>
            <div data-testid="metric-invitation-ready" className="rounded-xl bg-secondary p-3"><p className="text-lg font-semibold text-foreground">{snapshot.acquisitionMetrics.invitationReady}</p><p className="text-muted-foreground">Invitation Ready</p></div>
            <div data-testid="metric-waiting-claim" className="rounded-xl bg-secondary p-3"><p className="text-lg font-semibold text-foreground">{snapshot.acquisitionMetrics.waitingClaim}</p><p className="text-muted-foreground">Waiting Claim</p></div>
            <div data-testid="metric-converted" className="rounded-xl bg-secondary p-3"><p className="text-lg font-semibold text-foreground">{snapshot.acquisitionMetrics.converted}</p><p className="text-muted-foreground">Converted</p></div>
          </div>
        </div>
      ) : null}

      {snapshot.readinessWarnings.length > 0 ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Production readiness</p>
          <div className="mt-2 space-y-2" aria-label="Readiness warnings">
            {snapshot.readinessWarnings.map((warning) => (
              <div key={warning.code} className="flex items-start justify-between gap-3 rounded-xl bg-secondary p-3">
                <p className="text-xs leading-5 text-muted-foreground">{warning.message}</p>
                <Badge tone={severityTone(warning.severity)}>{warning.severity}</Badge>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Next best actions</p>
        {snapshot.topActions.length > 0 ? (
          <div className="mt-2 grid gap-2 md:grid-cols-2" aria-label="Next best actions">
            {snapshot.topActions.map((action) => (
              <Link key={action.id} href={action.workbenchHref} className="block rounded-xl bg-secondary p-3 transition hover:opacity-90">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-foreground">{action.label}</p>
                  <Badge tone={severityTone(action.severity)}>{action.severity}</Badge>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{action.description}</p>
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">No actions need attention right now.</p>
        )}
      </div>
    </section>
  );
}
