"use client";

import { useEffect, useState } from "react";

import { errorMessageFromPayload } from "@/lib/marketplace-acquisition/workbench-domain";

type GovernanceOverallStatus = "ACTIVE" | "DEGRADED" | "ACTION_REQUIRED" | "DISABLED";
type GovernanceCapabilityStatus = "AVAILABLE" | "DEGRADED" | "BLOCKED";
type GovernanceLimitPeriod = "DAY" | "MONTH" | "PLAN" | "NONE";
type GovernanceLimitStatus = "OK" | "NEAR_LIMIT" | "EXCEEDED" | "UNLIMITED";
type GovernanceWarningSeverity = "LOW" | "MEDIUM" | "HIGH";

interface GovernanceCapabilitySnapshot {
  readonly enabled: boolean;
  readonly status: GovernanceCapabilityStatus;
  readonly message: string | null;
}

interface GovernanceLimit {
  readonly key: string;
  readonly used: number;
  readonly limit: number | null;
  readonly period: GovernanceLimitPeriod;
  readonly status: GovernanceLimitStatus;
}

interface GovernanceWarning {
  readonly code: string;
  readonly message: string;
  readonly severity: GovernanceWarningSeverity;
}

interface GovernanceSnapshot {
  readonly generatedAt: string;
  readonly overallStatus: GovernanceOverallStatus;
  readonly featureEnabled: boolean;
  readonly planName: string | null;
  readonly capabilities: Record<string, GovernanceCapabilitySnapshot>;
  readonly limits: readonly GovernanceLimit[];
  readonly warnings: readonly GovernanceWarning[];
}

const asSnapshot = (payload: unknown): GovernanceSnapshot | null => {
  const data = (payload as { readonly data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  return data as GovernanceSnapshot;
};

async function fetchGovernance(): Promise<GovernanceSnapshot | null> {
  const response = await fetch("/api/marketplace-acquisition/governance");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorMessageFromPayload(payload) ?? "Governance could not be loaded.");
  return asSnapshot(payload);
}

const capabilityLabels: Readonly<Record<string, string>> = {
  DISCOVERY: "Discovery",
  QUALIFICATION: "Qualification",
  INVITATION: "Invitation",
  CLAIM: "Claim",
  CRM_CONVERSION: "CRM conversion",
  REVENUE_ATTRIBUTION: "Revenue attribution",
  GROWTH_LOOP: "Growth loop",
  COMMAND_CENTER: "Command center",
  RUNTIME_HEALTH: "Runtime health",
};

const overallTone = (status: GovernanceOverallStatus): string => {
  if (status === "DISABLED") return "bg-secondary text-muted-foreground";
  if (status === "ACTION_REQUIRED") return "bg-red-100 text-red-700";
  if (status === "DEGRADED") return "bg-amber-50 text-amber-700";
  return "bg-green-50 text-green-700";
};

const capabilityTone = (status: GovernanceCapabilityStatus): string => {
  if (status === "BLOCKED") return "bg-red-100 text-red-700";
  if (status === "DEGRADED") return "bg-amber-50 text-amber-700";
  return "bg-green-50 text-green-700";
};

const limitTone = (status: GovernanceLimitStatus): string => {
  if (status === "EXCEEDED") return "bg-red-100 text-red-700";
  if (status === "NEAR_LIMIT") return "bg-amber-50 text-amber-700";
  if (status === "UNLIMITED") return "bg-secondary text-muted-foreground";
  return "bg-green-50 text-green-700";
};

const severityTone = (severity: GovernanceWarningSeverity): string => {
  if (severity === "HIGH") return "bg-red-100 text-red-700";
  if (severity === "MEDIUM") return "bg-amber-50 text-amber-700";
  return "bg-secondary text-muted-foreground";
};

function Badge({ children, tone }: { readonly children: React.ReactNode; readonly tone: string }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{children}</span>;
}

export function GovernancePanel() {
  const [snapshot, setSnapshot] = useState<GovernanceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchGovernance()
      .then((next) => {
        if (!cancelled) {
          setSnapshot(next);
          setLoading(false);
        }
      })
      .catch((fetchError: unknown) => {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : "Governance could not be loaded.");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <section className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }} aria-label="Governance & Limits">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Governance & Limits</p>
        <p className="mt-2 text-sm text-muted-foreground">Loading governance status…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }} aria-label="Governance & Limits">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Governance & Limits</p>
        <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{error}</p>
      </section>
    );
  }

  if (snapshot === null) return null;

  const isDisabled = snapshot.overallStatus === "DISABLED";
  const capabilityEntries = Object.entries(snapshot.capabilities);

  return (
    <section className="space-y-4 rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }} aria-label="Governance & Limits">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Governance & Limits</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {isDisabled ? "Seller acquisition is not enabled for this workspace." : `Plan: ${snapshot.planName ?? "Unknown"}`}
          </p>
        </div>
        <Badge tone={overallTone(snapshot.overallStatus)}>{snapshot.overallStatus.replaceAll("_", " ")}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-3" aria-label="Governance summary">
        <div className="rounded-xl bg-secondary p-3">
          <p className="font-semibold text-foreground">{snapshot.overallStatus.replaceAll("_", " ")}</p>
          <p className="text-muted-foreground">overall status</p>
        </div>
        <div className="rounded-xl bg-secondary p-3">
          <p className="font-semibold text-foreground">{snapshot.featureEnabled ? "Enabled" : "Disabled"}</p>
          <p className="text-muted-foreground">feature state</p>
        </div>
        <div className="rounded-xl bg-secondary p-3">
          <p className="font-semibold text-foreground">{snapshot.planName ?? "Unknown"}</p>
          <p className="text-muted-foreground">plan</p>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Capabilities</p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-xs" aria-label="Capability availability">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 pr-2 font-medium">Capability</th>
                <th className="py-1 pr-2 font-medium">Status</th>
                <th className="py-1 pr-2 font-medium">Message</th>
              </tr>
            </thead>
            <tbody>
              {capabilityEntries.map(([capability, snapshotEntry]) => (
                <tr key={capability} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                  <td className="py-2 pr-2 font-medium text-foreground">{capabilityLabels[capability] ?? capability}</td>
                  <td className="py-2 pr-2"><Badge tone={capabilityTone(snapshotEntry.status)}>{snapshotEntry.status}</Badge></td>
                  <td className="py-2 pr-2 text-muted-foreground">{snapshotEntry.message ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Usage limits</p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-xs" aria-label="Usage limits">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 pr-2 font-medium">Usage</th>
                <th className="py-1 pr-2 font-medium">Used</th>
                <th className="py-1 pr-2 font-medium">Limit</th>
                <th className="py-1 pr-2 font-medium">Period</th>
                <th className="py-1 pr-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.limits.map((limit) => (
                <tr key={limit.key} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                  <td className="py-2 pr-2 font-medium text-foreground">{limit.key}</td>
                  <td className="py-2 pr-2 text-muted-foreground">{limit.used}</td>
                  <td className="py-2 pr-2 text-muted-foreground">{limit.limit ?? "Unlimited"}</td>
                  <td className="py-2 pr-2 text-muted-foreground">{limit.period}</td>
                  <td className="py-2 pr-2"><Badge tone={limitTone(limit.status)}>{limit.status.replaceAll("_", " ")}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Warnings</p>
        {snapshot.warnings.length > 0 ? (
          <div className="mt-2 space-y-2" aria-label="Governance warnings">
            {snapshot.warnings.map((warning) => (
              <div key={warning.code} className="flex items-center justify-between gap-2 rounded-xl bg-secondary p-3">
                <p className="text-xs leading-5 text-muted-foreground">{warning.message}</p>
                <Badge tone={severityTone(warning.severity)}>{warning.severity}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">No governance warnings right now.</p>
        )}
      </div>
    </section>
  );
}
