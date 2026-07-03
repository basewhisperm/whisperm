"use client";

import { useEffect, useState } from "react";

import { errorMessageFromPayload } from "@/lib/marketplace-acquisition/workbench-domain";

type RuntimeHealthStatus = "HEALTHY" | "DEGRADED" | "ACTION_REQUIRED" | "UNKNOWN";

interface RuntimeUnitHealth {
  readonly unit: string;
  readonly status: RuntimeHealthStatus;
  readonly lastSuccessfulRunAt: string | null;
  readonly lastFailedRunAt: string | null;
  readonly failureCount: number;
  readonly retryBacklog: number;
  readonly deadLetterCount: number;
  readonly message: string | null;
}

interface ProviderHealth {
  readonly provider: string;
  readonly status: RuntimeHealthStatus;
  readonly configured: boolean;
  readonly lastSuccessfulUseAt: string | null;
  readonly lastFailedUseAt: string | null;
  readonly message: string | null;
}

interface OperationsAction {
  readonly id: string;
  readonly priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  readonly title: string;
  readonly description: string;
  readonly actionType: string;
}

interface RuntimeHealthSnapshot {
  readonly overallStatus: RuntimeHealthStatus;
  readonly generatedAt: string;
  readonly units: readonly RuntimeUnitHealth[];
  readonly providers: readonly ProviderHealth[];
  readonly retryBacklog: number;
  readonly deadLetterCount: number;
  readonly lastSuccessfulRunAt: string | null;
  readonly recommendedOperationsActions: readonly OperationsAction[];
}

const asSnapshot = (payload: unknown): RuntimeHealthSnapshot | null => {
  const data = (payload as { readonly data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  return data as RuntimeHealthSnapshot;
};

async function fetchRuntimeHealth(): Promise<RuntimeHealthSnapshot | null> {
  const response = await fetch("/api/marketplace-acquisition/runtime-health");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorMessageFromPayload(payload) ?? "Runtime health could not be loaded.");
  return asSnapshot(payload);
}

const unitLabels: Readonly<Record<string, string>> = {
  DISCOVERY: "Discovery",
  QUALIFICATION: "Qualification",
  INVITATION: "Invitation",
  CLAIM: "Claim",
  CRM_CONVERSION: "CRM conversion",
  REVENUE_ATTRIBUTION: "Revenue attribution",
  GROWTH_LOOP: "Growth loop",
};

const statusTone = (status: RuntimeHealthStatus): string => {
  if (status === "ACTION_REQUIRED") return "bg-red-100 text-red-700";
  if (status === "DEGRADED") return "bg-amber-50 text-amber-700";
  if (status === "UNKNOWN") return "bg-secondary text-muted-foreground";
  return "bg-green-50 text-green-700";
};

const priorityTone = (priority: OperationsAction["priority"]): string => {
  if (priority === "CRITICAL") return "bg-red-100 text-red-700";
  if (priority === "HIGH") return "bg-red-50 text-red-700";
  if (priority === "MEDIUM") return "bg-amber-50 text-amber-700";
  return "bg-secondary text-muted-foreground";
};

function Badge({ children, tone }: { readonly children: React.ReactNode; readonly tone: string }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{children}</span>;
}

const formatTimestamp = (value: string | null): string => {
  if (value === null) return "Never";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

export function RuntimeHealthPanel() {
  const [snapshot, setSnapshot] = useState<RuntimeHealthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchRuntimeHealth()
      .then((next) => {
        if (!cancelled) {
          setSnapshot(next);
          setLoading(false);
        }
      })
      .catch((fetchError: unknown) => {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : "Runtime health could not be loaded.");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <section className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }} aria-label="Autonomous Runtime Health">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Autonomous Runtime Health</p>
        <p className="mt-2 text-sm text-muted-foreground">Loading runtime health…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }} aria-label="Autonomous Runtime Health">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Autonomous Runtime Health</p>
        <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{error}</p>
      </section>
    );
  }

  if (snapshot === null) return null;

  const isUnknown = snapshot.overallStatus === "UNKNOWN";

  return (
    <section className="space-y-4 rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }} aria-label="Autonomous Runtime Health">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Autonomous Runtime Health</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {isUnknown ? "No acquisition runtime data yet." : `Last checked ${formatTimestamp(snapshot.generatedAt)}`}
          </p>
        </div>
        <Badge tone={statusTone(snapshot.overallStatus)}>{snapshot.overallStatus.replaceAll("_", " ")}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4" aria-label="Runtime summary">
        <div className="rounded-xl bg-secondary p-3">
          <p className="font-semibold text-foreground">{formatTimestamp(snapshot.lastSuccessfulRunAt)}</p>
          <p className="text-muted-foreground">last successful run</p>
        </div>
        <div className="rounded-xl bg-secondary p-3">
          <p className="font-semibold text-foreground">{snapshot.retryBacklog}</p>
          <p className="text-muted-foreground">retry backlog</p>
        </div>
        <div className="rounded-xl bg-secondary p-3">
          <p className="font-semibold text-foreground">{snapshot.deadLetterCount}</p>
          <p className="text-muted-foreground">dead letters</p>
        </div>
        <div className="rounded-xl bg-secondary p-3">
          <p className="font-semibold text-foreground">{snapshot.units.length}</p>
          <p className="text-muted-foreground">runtime units</p>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Runtime units</p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-xs" aria-label="Runtime unit health">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 pr-2 font-medium">Unit</th>
                <th className="py-1 pr-2 font-medium">Status</th>
                <th className="py-1 pr-2 font-medium">Last success</th>
                <th className="py-1 pr-2 font-medium">Failures</th>
                <th className="py-1 pr-2 font-medium">Retrying</th>
                <th className="py-1 pr-2 font-medium">Dead letters</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.units.map((unit) => (
                <tr key={unit.unit} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                  <td className="py-2 pr-2 font-medium text-foreground">{unitLabels[unit.unit] ?? unit.unit}</td>
                  <td className="py-2 pr-2"><Badge tone={statusTone(unit.status)}>{unit.status.replaceAll("_", " ")}</Badge></td>
                  <td className="py-2 pr-2 text-muted-foreground">{formatTimestamp(unit.lastSuccessfulRunAt)}</td>
                  <td className="py-2 pr-2 text-muted-foreground">{unit.failureCount}</td>
                  <td className="py-2 pr-2 text-muted-foreground">{unit.retryBacklog}</td>
                  <td className="py-2 pr-2 text-muted-foreground">{unit.deadLetterCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Provider health</p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-xs" aria-label="Provider health">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 pr-2 font-medium">Provider</th>
                <th className="py-1 pr-2 font-medium">Configured</th>
                <th className="py-1 pr-2 font-medium">Status</th>
                <th className="py-1 pr-2 font-medium">Message</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.providers.map((provider) => (
                <tr key={provider.provider} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                  <td className="py-2 pr-2 font-medium text-foreground">{provider.provider}</td>
                  <td className="py-2 pr-2 text-muted-foreground">{provider.configured ? "Yes" : "No"}</td>
                  <td className="py-2 pr-2"><Badge tone={statusTone(provider.status)}>{provider.status.replaceAll("_", " ")}</Badge></td>
                  <td className="py-2 pr-2 text-muted-foreground">{provider.message ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Recommended operations actions</p>
        {snapshot.recommendedOperationsActions.length > 0 ? (
          <div className="mt-2 space-y-2" aria-label="Recommended operations actions">
            {snapshot.recommendedOperationsActions.map((action) => (
              <div key={action.id} className="rounded-xl bg-secondary p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-foreground">{action.title}</p>
                  <Badge tone={priorityTone(action.priority)}>{action.priority}</Badge>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{action.description}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">No operator action needed right now.</p>
        )}
      </div>
    </section>
  );
}
