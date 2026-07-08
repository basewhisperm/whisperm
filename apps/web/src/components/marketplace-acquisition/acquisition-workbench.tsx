"use client";

// WhatsApp will be attempted first
// + Capture Seller
// Seller dossier
// Seller command center summary
// Marketplace Sellers
// marketplaceSource
// draftInventory?.title ?? record.capture.title
// catch { return `${currency} ${numericPrice}`;
// No Action
// Captured ${captured}
// try { return new Intl.NumberFormat
// Complete Acquisition
// Convert Inventory
// Convert Seller
// Ready To Complete
// Ready For Inventory Conversion
// Ready For Seller Conversion
// Waiting for Seller Claim
// record.draftInventory?.currency || record.capture.currency || "USD"
// Retry Invitation
// Waiting For Claim
// rawPrice.includes("[object")
// Send WhatsApp-first Invite
// Needs Phone Reveal

import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { IconArrowRight, IconBookmark } from "@tabler/icons-react";

import {
  type CaptureConfidence,
  type RevenueAttributionSnapshot,
  type SellerAcquisitionHealthStatus,
  type SellerAcquisitionNextAction,
  type SellerAcquisitionRecord,
} from "@/lib/marketplace-acquisition/records-store";
import {
  type QueueBucketId,
  type SellerRollup,
  acquisitionScore,
  badgeTone,
  capturedAge,
  confidence,
  errorMessageFromPayload,
  hasPhone,
  isActionEnabled,
  listingCount,
  nextActionLabels,
  nextActionReason,
  phone,
  price,
  qualityIssues,
  queueBuckets,
  readinessChecks,
  readinessScore,
  readinessStatus,
  rollupListingCount,
  rollupListingTitles,
  rollupPriceSummary,
  rollupRecords,
  searchText,
  sellerName,
  sellerRelationshipTimelineItems,
  claimIntelligenceItems,
  source,
  title,
  location,
} from "@/lib/marketplace-acquisition/workbench-domain";



interface OptimizationRecommendationState {
  readonly id?: string | undefined;
  readonly type: string;
  readonly reason: string;
  readonly severity: string;
  readonly confidence: string;
  readonly supportingMetrics?: Record<string, unknown> | undefined;
}

interface DiscoveryRuntimeState {
  readonly status: string;
  readonly discoveredCount: number;
  readonly capturedCount: number;
  readonly skippedDuplicateCount: number;
  readonly lastExecutionTime?: string | undefined;
  readonly qualificationStatus?: string | undefined;
  readonly qualifiedCount: number;
  readonly disqualifiedCount: number;
  readonly needsReviewCount: number;
  readonly qualificationFailedCount: number;
  readonly qualificationFailureMessage?: string | undefined;
  readonly failureMessage?: string | undefined;
  readonly optimizationStatus?: string | undefined;
  readonly lastOptimizedAt?: string | undefined;
  readonly optimizationFailureMessage?: string | undefined;
  readonly optimizationRecommendations: readonly OptimizationRecommendationState[];
  readonly targetingStatus?: string | undefined;
  readonly targetingSnapshot?: Record<string, unknown> | undefined;
  readonly targetingFailureReason?: string | undefined;
}

const asOptimizationRecommendations = (value: unknown): readonly OptimizationRecommendationState[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    if (typeof record.type !== "string" || typeof record.reason !== "string") return [];
    return [{
      id: typeof record.id === "string" ? record.id : undefined,
      type: record.type,
      reason: record.reason,
      severity: typeof record.severity === "string" ? record.severity : "INFO",
      confidence: typeof record.confidence === "string" ? record.confidence : "LOW",
      supportingMetrics: typeof record.supportingMetrics === "object" && record.supportingMetrics !== null ? record.supportingMetrics as Record<string, unknown> : undefined,
    }];
  });
};

const latestDiscoveryState = (executions: readonly { readonly status: string; readonly startedAt?: string | null; readonly completedAt?: string | null; readonly failedAt?: string | null; readonly errorMessage?: string | null; readonly metrics?: Record<string, unknown> | null }[]): DiscoveryRuntimeState | null => {
  const execution = executions.find((item) => typeof item.metrics?.discoveryStatus === "string");
  if (execution === undefined) return null;
  const metrics = execution.metrics ?? {};
  return {
    status: typeof metrics.discoveryStatus === "string" ? metrics.discoveryStatus : execution.status,
    discoveredCount: typeof metrics.discoveredCount === "number" ? metrics.discoveredCount : 0,
    capturedCount: typeof metrics.capturedCount === "number" ? metrics.capturedCount : 0,
    skippedDuplicateCount: typeof metrics.skippedDuplicateCount === "number" ? metrics.skippedDuplicateCount : 0,
    qualificationStatus: typeof metrics.qualificationStatus === "string" ? metrics.qualificationStatus : undefined,
    qualifiedCount: typeof metrics.qualifiedCount === "number" ? metrics.qualifiedCount : 0,
    disqualifiedCount: typeof metrics.disqualifiedCount === "number" ? metrics.disqualifiedCount : 0,
    needsReviewCount: typeof metrics.needsReviewCount === "number" ? metrics.needsReviewCount : 0,
    qualificationFailedCount: typeof metrics.qualificationFailedCount === "number" ? metrics.qualificationFailedCount : 0,
    qualificationFailureMessage: typeof metrics.qualificationFailureMessage === "string" ? metrics.qualificationFailureMessage : undefined,
    lastExecutionTime: execution.completedAt ?? execution.failedAt ?? execution.startedAt ?? undefined,
    failureMessage: typeof metrics.failureMessage === "string" ? metrics.failureMessage : execution.errorMessage ?? undefined,
    optimizationStatus: typeof metrics.optimizationStatus === "string" ? metrics.optimizationStatus : undefined,
    lastOptimizedAt: typeof metrics.lastOptimizedAt === "string" ? metrics.lastOptimizedAt : undefined,
    optimizationFailureMessage: typeof metrics.optimizationFailureMessage === "string" ? metrics.optimizationFailureMessage : undefined,
    optimizationRecommendations: asOptimizationRecommendations(metrics.optimizationRecommendations),
    targetingStatus: typeof metrics.targetingStatus === "string" ? metrics.targetingStatus : undefined,
    targetingSnapshot: typeof metrics.targetingSnapshot === "object" && metrics.targetingSnapshot !== null ? metrics.targetingSnapshot as Record<string, unknown> : undefined,
    targetingFailureReason: typeof metrics.targetingFailureReason === "string" ? metrics.targetingFailureReason : undefined,
  };
};

async function fetchDiscoveryRuntimeState(campaignId: string): Promise<DiscoveryRuntimeState | null> {
  const response = await fetch(`/api/marketplace-acquisition/campaigns/${encodeURIComponent(campaignId)}/runtime/executions?limit=5`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorMessageFromPayload(payload) ?? "Discovery runtime state could not be loaded.");
  const executions = (payload as { readonly data?: { readonly executions?: readonly { readonly status: string; readonly startedAt?: string | null; readonly completedAt?: string | null; readonly failedAt?: string | null; readonly errorMessage?: string | null; readonly metrics?: Record<string, unknown> | null }[] } }).data?.executions ?? [];
  return latestDiscoveryState(executions);
}

// ---------------------------------------------------------------------------
// Growth loop (CS-019) -- read-only view + governed apply/dismiss actions.
// This component never computes recommendations; it only renders what the
// CampaignRuntimeService already persisted and coordinates recompute/apply/
// dismiss requests through the growth API routes.
// ---------------------------------------------------------------------------

interface GrowthRecommendationState {
  readonly id: string;
  readonly type: string;
  readonly reason: string;
  readonly severity: string;
  readonly confidence: string;
  readonly status: string;
  readonly supportingMetrics?: Record<string, unknown> | undefined;
  readonly targetingCandidate?: Record<string, unknown> | undefined;
  readonly scheduleCandidate?: Record<string, unknown> | undefined;
  readonly appliedAt?: string | undefined;
  readonly dismissedAt?: string | undefined;
}

interface GrowthLoopState {
  readonly growthLoopStatus: string;
  readonly growthLoopTrigger: string | null;
  readonly lastGrowthEvaluatedAt: string | null;
  readonly growthCompleteness: number | null;
  readonly growthFailureMessage: string | null;
  readonly growthSignalSnapshot: Record<string, unknown> | null;
  readonly growthRecommendations: readonly GrowthRecommendationState[];
}

const asGrowthLoopState = (payload: unknown): GrowthLoopState | null => {
  const data = (payload as { readonly data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  return {
    growthLoopStatus: typeof record.growthLoopStatus === "string" ? record.growthLoopStatus : "NOT_EVALUATED",
    growthLoopTrigger: typeof record.growthLoopTrigger === "string" ? record.growthLoopTrigger : null,
    lastGrowthEvaluatedAt: typeof record.lastGrowthEvaluatedAt === "string" ? record.lastGrowthEvaluatedAt : null,
    growthCompleteness: typeof record.growthCompleteness === "number" ? record.growthCompleteness : null,
    growthFailureMessage: typeof record.growthFailureMessage === "string" ? record.growthFailureMessage : null,
    growthSignalSnapshot: typeof record.growthSignalSnapshot === "object" && record.growthSignalSnapshot !== null ? record.growthSignalSnapshot as Record<string, unknown> : null,
    growthRecommendations: Array.isArray(record.growthRecommendations) ? record.growthRecommendations.filter((item): item is GrowthRecommendationState => typeof item === "object" && item !== null && typeof (item as { readonly id?: unknown }).id === "string") : [],
  };
};

async function fetchGrowthLoopState(campaignId: string): Promise<GrowthLoopState | null> {
  const response = await fetch(`/api/marketplace-acquisition/campaigns/${encodeURIComponent(campaignId)}/growth`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorMessageFromPayload(payload) ?? "Growth loop state could not be loaded.");
  return asGrowthLoopState(payload);
}

async function recomputeGrowthLoop(campaignId: string): Promise<GrowthLoopState | null> {
  const response = await fetch(`/api/marketplace-acquisition/campaigns/${encodeURIComponent(campaignId)}/growth`, { method: "POST" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorMessageFromPayload(payload) ?? "Growth loop recompute failed.");
  return asGrowthLoopState(payload);
}

async function actOnGrowthRecommendation(campaignId: string, recommendationId: string, action: "APPLY" | "DISMISS"): Promise<void> {
  const response = await fetch(`/api/marketplace-acquisition/campaigns/${encodeURIComponent(campaignId)}/growth/recommendations/${encodeURIComponent(recommendationId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorMessageFromPayload(payload) ?? "Growth recommendation update failed.");
}

function GrowthLoopSection({ campaignId, growthLoop, onRefresh }: {
  readonly campaignId: string;
  readonly growthLoop: GrowthLoopState;
  readonly onRefresh: (next: GrowthLoopState | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const snapshot = growthLoop.growthSignalSnapshot;

  const recompute = async () => {
    setBusy(true);
    setActionError(null);
    try {
      onRefresh(await recomputeGrowthLoop(campaignId));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Growth loop recompute failed.");
    } finally {
      setBusy(false);
    }
  };

  const act = async (recommendationId: string, action: "APPLY" | "DISMISS") => {
    setBusy(true);
    setActionError(null);
    try {
      await actOnGrowthRecommendation(campaignId, recommendationId, action);
      onRefresh(await fetchGrowthLoopState(campaignId));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Growth recommendation update failed.");
    } finally {
      setBusy(false);
    }
  };

  const pending = growthLoop.growthRecommendations.filter((item) => item.status === "PENDING");
  const decided = growthLoop.growthRecommendations.filter((item) => item.status !== "PENDING");

  return (
    <section className="mt-4 rounded-xl bg-secondary p-3" aria-label="Revenue-informed growth loop">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Growth loop</p>
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground">{growthLoop.growthLoopStatus}{growthLoop.lastGrowthEvaluatedAt ? ` · ${growthLoop.lastGrowthEvaluatedAt}` : ""}</p>
          <button className="h-8 rounded-lg bg-background px-3 text-xs font-semibold text-foreground disabled:opacity-50" style={{ border: "0.5px solid var(--color-border)" }} disabled={busy} onClick={() => void recompute()} type="button">
            {busy ? "Working…" : "Recompute"}
          </button>
        </div>
      </div>
      {growthLoop.growthFailureMessage ? <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{growthLoop.growthFailureMessage}</p> : null}
      {actionError ? <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{actionError}</p> : null}
      {snapshot ? (
        <div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4">
          <div className="rounded-xl bg-background p-3"><p className="font-semibold text-foreground">{String(snapshot.attributedRevenue ?? 0)} {String(snapshot.currency ?? "")}</p><p className="text-muted-foreground">attributed revenue</p></div>
          <div className="rounded-xl bg-background p-3"><p className="font-semibold text-foreground">{String(snapshot.wonDealsCount ?? 0)}</p><p className="text-muted-foreground">won deals</p></div>
          <div className="rounded-xl bg-background p-3"><p className="font-semibold text-foreground">{snapshot.conversionRate === null || snapshot.conversionRate === undefined ? "—" : `${Math.round(Number(snapshot.conversionRate) * 100)}%`}</p><p className="text-muted-foreground">conversion rate</p></div>
          <div className="rounded-xl bg-background p-3"><p className="font-semibold text-foreground">{String(snapshot.totalMembers ?? 0)}</p><p className="text-muted-foreground">sellers in scope</p></div>
        </div>
      ) : null}
      {pending.length > 0 ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {pending.map((recommendation) => (
            <div key={recommendation.id} className="rounded-xl bg-background p-3" style={{ border: "0.5px solid var(--color-border)" }}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-foreground">{recommendation.type.replaceAll("_", " ")}</p>
                <Badge tone={recommendation.severity === "ACTIONABLE" ? "bg-amber-50 text-amber-700" : recommendation.severity === "WARNING" ? "bg-red-50 text-red-700" : undefined}>{recommendation.severity}</Badge>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{recommendation.reason}</p>
              <p className="mt-2 text-[11px] text-muted-foreground">Confidence: {recommendation.confidence}</p>
              <div className="mt-3 flex gap-2">
                <button className="h-8 flex-1 rounded-lg bg-whisper px-3 text-xs font-semibold text-white disabled:opacity-50" disabled={busy} onClick={() => void act(recommendation.id, "APPLY")} type="button">Apply</button>
                <button className="h-8 flex-1 rounded-lg bg-secondary px-3 text-xs font-semibold text-foreground disabled:opacity-50" disabled={busy} onClick={() => void act(recommendation.id, "DISMISS")} type="button">Dismiss</button>
              </div>
            </div>
          ))}
        </div>
      ) : <p className="mt-3 text-xs text-muted-foreground">No pending growth recommendations.</p>}
      {decided.length > 0 ? (
        <div className="mt-3 space-y-1">
          {decided.map((recommendation) => (
            <p key={recommendation.id} className="text-[11px] text-muted-foreground">
              {recommendation.type.replaceAll("_", " ")} — {recommendation.status}{recommendation.appliedAt ? ` at ${recommendation.appliedAt}` : recommendation.dismissedAt ? ` at ${recommendation.dismissedAt}` : ""}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

const invitationRuntimeStatus = (invitation: { readonly status: string; readonly channel: string; readonly metadata?: unknown; readonly updatedAt?: string } | null): string => {
  if (invitation === null) return "No invitation sent";
  const metadata = typeof invitation.metadata === "object" && invitation.metadata !== null ? invitation.metadata as Record<string, unknown> : {};
  const state = typeof metadata.invitationExecutionState === "string" ? metadata.invitationExecutionState : invitation.status;
  const lastAttempted = typeof metadata.lastAttemptAt === "string" ? metadata.lastAttemptAt : typeof metadata.lastAttemptedAt === "string" ? metadata.lastAttemptedAt : invitation.updatedAt;
  const retryCount = typeof metadata.retryCount === "number" ? ` · retries ${metadata.retryCount}/${typeof metadata.maxRetries === "number" ? metadata.maxRetries : "?"}` : "";
  const nextRetry = typeof metadata.nextRetryAt === "string" ? ` · next retry ${metadata.nextRetryAt}` : "";
  const optimization = typeof metadata.optimizationReason === "string" ? ` · optimized: ${metadata.optimizationReason}` : "";
  const selected = typeof metadata.selectedChannel === "string" ? ` · recommended ${metadata.selectedChannel}${typeof metadata.selectedProvider === "string" ? ` via ${metadata.selectedProvider}` : ""}` : "";
  const retryStrategy = typeof metadata.retryStrategy === "object" && metadata.retryStrategy !== null && "maxRetries" in metadata.retryStrategy ? ` · retry strategy max ${String((metadata.retryStrategy as { readonly maxRetries?: unknown }).maxRetries ?? "?")}` : "";
  const suppression = typeof metadata.suppressionReason === "string" ? ` · suppressed: ${metadata.suppressionReason}` : "";
  const failure = typeof metadata.failureMessage === "string" ? ` — ${metadata.failureMessage}` : "";
  return `${invitation.channel} ${state}${lastAttempted ? ` (last attempted ${lastAttempted})` : ""}${selected}${optimization}${retryCount}${nextRetry}${retryStrategy}${suppression}${failure}`;
};

async function fetchSellerAcquisitionRecords(recordsPath: string): Promise<readonly SellerAcquisitionRecord[]> {
  const response = await fetch(recordsPath);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorMessageFromPayload(payload) ?? "Acquisition Workbench records could not be loaded.");
  return (payload as { readonly data?: { readonly records?: readonly SellerAcquisitionRecord[] } }).data?.records ?? [];
}

async function runPrimaryAction(record: SellerAcquisitionRecord): Promise<void> {
  const paths: Partial<Record<SellerAcquisitionNextAction, string>> = {
    SEND_INVITATION:      `/api/marketplace-acquisition/captures/${record.capture.id}/invite`,
    RETRY_INVITATION:     `/api/marketplace-acquisition/captures/${record.capture.id}/invite`,
    CONVERT_SELLER:       `/api/marketplace-acquisition/captures/${record.capture.id}/convert/render-seller`,
    CONVERT_INVENTORY:    `/api/marketplace-acquisition/captures/${record.capture.id}/convert/render-inventory`,
    COMPLETE_ACQUISITION: `/api/marketplace-acquisition/captures/${record.capture.id}/complete`,
  };
  const path = paths[record.nextAction];
  if (!path) throw new Error("This Acquisition Workbench action is not available.");
  const needsBody = ["SEND_INVITATION", "RETRY_INVITATION"].includes(record.nextAction);
  const response = await fetch(path, {
    method: "POST",
    ...(needsBody ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preferredChannel: "WHATSAPP" }) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorMessageFromPayload(payload) ?? "Workbench action failed.");
}

// ---------------------------------------------------------------------------
// Edit extract helpers
// ---------------------------------------------------------------------------

interface EditFields {
  title:       string;
  sellerName:  string;
  sellerPhone: string;
  priceText:   string;
  currency:    string;
  description: string;
  location:    string;
  category:    string;
}

function editFieldsFromRecord(record: SellerAcquisitionRecord): EditFields {
  return {
    title:       title(record),
    sellerName:  record.capture.sellerName ?? sellerName(record),
    sellerPhone: phone(record) ?? "",
    priceText:   String(record.draftInventory?.price ?? record.capture.price ?? ""),
    currency:    record.draftInventory?.currency ?? record.capture.currency ?? "",
    description: record.draftInventory?.description ?? record.capture.description ?? "",
    location:    location(record) ?? "",
    category:    record.draftInventory?.category ?? "",
  };
}

const EDIT_FIELD_CONFIG: readonly { key: keyof EditFields; label: string; placeholder: string }[] = [
  { key: "title",       label: "Title",       placeholder: "Listing title" },
  { key: "sellerName",  label: "Seller name", placeholder: "Seller name" },
  { key: "sellerPhone", label: "Phone",       placeholder: "+233..." },
  { key: "priceText",   label: "Price",       placeholder: "GH₵ 250,000" },
  { key: "currency",    label: "Currency",    placeholder: "GHS" },
  { key: "description", label: "Description", placeholder: "Optional description" },
  { key: "location",    label: "Location",    placeholder: "Spintex, Accra" },
  { key: "category",    label: "Category",    placeholder: "Vehicles" },
];

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export function AcquisitionWorkbench({
  mode,
  recordsPath,
  campaignId,
  title: pageTitle,
  description,
  contextNote,
  campaignName,
}: {
  readonly mode: "global" | "campaign";
  readonly recordsPath: string;
  readonly campaignId?: string | undefined;
  readonly title: string;
  readonly description: string;
  readonly contextNote: string;
  readonly campaignName?: string;
}) {
  const [records, setRecords] = useState<readonly SellerAcquisitionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null);
  const [selectedBulkIds, setSelectedBulkIds] = useState<readonly string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [queueFilter, setQueueFilter] = useState<QueueBucketId>("all");
  const [healthFilter, setHealthFilter] = useState("all");
  const [nextActionFilter, setNextActionFilter] = useState("all");
  const [confidenceFilter, setConfidenceFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [discoveryRuntime, setDiscoveryRuntime] = useState<DiscoveryRuntimeState | null>(null);
  const [growthLoop, setGrowthLoop] = useState<GrowthLoopState | null>(null);

  const scopedRecordsPath = useMemo(() => {
    if (campaignId === undefined || campaignId.trim().length === 0) return recordsPath;
    const separator = recordsPath.includes("?") ? "&" : "?";
    return `${recordsPath}${separator}campaignId=${encodeURIComponent(campaignId)}`;
  }, [recordsPath, campaignId]);

  const refreshRecords = useCallback(async () => {
    const nextRecords = await fetchSellerAcquisitionRecords(scopedRecordsPath);
    setRecords(nextRecords);
    setSelectedCaptureId((current) => current ?? nextRecords[0]?.capture.id ?? null);
  }, [scopedRecordsPath]);

  useEffect(() => {
    let cancelled = false;
    fetchSellerAcquisitionRecords(scopedRecordsPath)
      .then((nextRecords) => {
        if (!cancelled) {
          setRecords(nextRecords);
          setSelectedCaptureId(nextRecords[0]?.capture.id ?? null);
          setLoading(false);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setActionError(error instanceof Error ? error.message : "Acquisition Workbench records could not be loaded.");
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [scopedRecordsPath]);

  useEffect(() => {
    if (mode !== "campaign" || campaignId === undefined) return;
    let cancelled = false;
    fetchDiscoveryRuntimeState(campaignId)
      .then((state) => { if (!cancelled) setDiscoveryRuntime(state); })
      .catch(() => { if (!cancelled) setDiscoveryRuntime(null); });
    return () => { cancelled = true; };
  }, [campaignId, mode]);

  useEffect(() => {
    if (mode !== "campaign" || campaignId === undefined) return;
    let cancelled = false;
    fetchGrowthLoopState(campaignId)
      .then((state) => { if (!cancelled) setGrowthLoop(state); })
      .catch(() => { if (!cancelled) setGrowthLoop(null); });
    return () => { cancelled = true; };
  }, [campaignId, mode]);

  const filteredRecords = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const bucket = queueBuckets.find((item) => item.id === queueFilter);
    return records.filter((record) => {
      if (bucket && !bucket.matches(record)) return false;
      if (healthFilter !== "all" && record.healthStatus !== healthFilter) return false;
      if (nextActionFilter !== "all" && record.nextAction !== nextActionFilter) return false;
      if (confidenceFilter !== "all" && confidence(record) !== confidenceFilter) return false;
      if (stageFilter !== "all" && record.currentStage !== stageFilter) return false;
      return query.length === 0 || searchText(record).includes(query);
    });
  }, [records, queueFilter, healthFilter, nextActionFilter, confidenceFilter, stageFilter, searchQuery]);

  const selectedRecord = filteredRecords.find((r) => r.capture.id === selectedCaptureId) ?? filteredRecords[0] ?? null;
  const filteredRollups = rollupRecords(filteredRecords);
  const selectedRollup = selectedRecord === null
    ? null
    : filteredRollups.find((rollup) => rollup.records.some((record) => record.capture.id === selectedRecord.capture.id)) ?? null;
  const visibleQueueGroups = queueBuckets
    .map((bucket) => ({ bucket, rollups: filteredRollups.filter((rollup) => rollup.records.some(bucket.matches)) }))
    .filter((group) => queueFilter === "all" ? group.rollups.length > 0 : group.bucket.id === queueFilter);
  const ungroupedVisibleRollups = queueFilter === "all"
    ? filteredRollups.filter((rollup) => !queueBuckets.some((bucket) => rollup.records.some(bucket.matches)))
    : [];
  const bulkEligibleRecords = filteredRecords.filter((record) =>
    ["SEND_INVITATION", "RETRY_INVITATION"].includes(record.nextAction) && hasPhone(record)
  );
  const selectedBulkRecords = bulkEligibleRecords.filter((record) => selectedBulkIds.includes(record.capture.id));
  const allEligibleSelected = bulkEligibleRecords.length > 0 && selectedBulkRecords.length === bulkEligibleRecords.length;
  const stages = [...new Set(records.map((r) => r.currentStage).filter(Boolean))];

  const attributedSnapshots = filteredRecords
    .map((record) => revenueAttribution(record))
    .filter((snapshot): snapshot is RevenueAttributionSnapshot => snapshot !== null);
  const wonDealsCount = attributedSnapshots.length;
  const attributedRevenueTotal = attributedSnapshots.reduce((sum, snapshot) => {
    const numeric = Number(snapshot.revenueAmount ?? 0);
    return sum + (Number.isFinite(numeric) ? numeric : 0);
  }, 0);
  const attributedRevenueCurrency = attributedSnapshots.find((snapshot) => snapshot.revenueCurrency !== undefined)?.revenueCurrency ?? "USD";

  const commandCenterStats = [
    { label: "Total sellers", value: filteredRollups.length },
    { label: "Needs Review", value: filteredRecords.filter((record) => confidence(record) === "LOW" || qualityIssues(record).length >= 2).length },
    { label: "Needs Invitation", value: filteredRecords.filter((record) => record.nextAction === "SEND_INVITATION" && hasPhone(record)).length },
    { label: "Waiting Claim", value: filteredRecords.filter((record) => record.nextAction === "WAIT_FOR_CLAIM").length },
    { label: "Ready Conversion", value: filteredRecords.filter((record) => ["CONVERT_SELLER", "CONVERT_INVENTORY", "COMPLETE_ACQUISITION"].includes(record.nextAction)).length },
    { label: "Completed", value: filteredRecords.filter((record) => record.healthStatus === "COMPLETED").length },
    { label: "Won Deals", value: wonDealsCount },
    { label: "Attributed Revenue", value: formatCurrencyAmount(attributedRevenueTotal, attributedRevenueCurrency) },
  ] as const;

  const toggleBulkRecord = useCallback((captureId: string) => {
    setSelectedBulkIds((current) =>
      current.includes(captureId) ? current.filter((id) => id !== captureId) : [...current, captureId],
    );
  }, []);

  const toggleBulkRollup = useCallback((recordsToToggle: readonly SellerAcquisitionRecord[]) => {
    const eligibleIds = recordsToToggle
      .filter((record) => ["SEND_INVITATION", "RETRY_INVITATION"].includes(record.nextAction) && hasPhone(record))
      .map((record) => record.capture.id);

    if (eligibleIds.length === 0) return;

    setSelectedBulkIds((current) => {
      const allSelected = eligibleIds.every((id) => current.includes(id));
      return allSelected
        ? current.filter((id) => !eligibleIds.includes(id))
        : [...new Set([...current, ...eligibleIds])];
    });
  }, []);

  const toggleAllEligible = useCallback(() => {
    setSelectedBulkIds(allEligibleSelected ? [] : bulkEligibleRecords.map((record) => record.capture.id));
  }, [allEligibleSelected, bulkEligibleRecords]);

  const runBulkInvites = useCallback(async () => {
    if (selectedBulkRecords.length === 0) return;
    setBulkBusy(true);
    setActionError(null);
    try {
      const response = await fetch("/api/marketplace-acquisition/captures/bulk-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captureIds: selectedBulkRecords.map((r) => r.capture.id), channel: "WHATSAPP" }),
      });
      const payload = await response.json().catch(() => ({}));
      const data = (payload as { data?: { completed?: number; pending?: number; failed?: number; invalid?: string[] } })?.data;
      const completed = data?.completed ?? 0;
      const pending = data?.pending ?? 0;
      const failed = data?.failed ?? 0;
      const invalidCount = data?.invalid?.length ?? 0;
      setSelectedBulkIds([]);
      await refreshRecords();
      setActionError(null);
      const parts: string[] = [];
      if (completed > 0) parts.push(`${completed} invitation${completed === 1 ? "" : "s"} sent.`);
      if (pending > 0) parts.push(`${pending} invitation${pending === 1 ? "" : "s"} pending.`);
      if (failed > 0) parts.push(`${failed} invitation${failed === 1 ? "" : "s"} failed.`);
      if (invalidCount > 0) parts.push(`${invalidCount} skipped — no valid phone.`);
      if (parts.length > 0) {
        setActionError(parts.join(" "));
        setTimeout(() => setActionError(null), 5_000);
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Bulk invitation failed.");
    } finally {
      setBulkBusy(false);
    }
  }, [refreshRecords, selectedBulkRecords]);

  // Patch a single updated record into the local list without a full reload
  const patchRecord = useCallback((updated: SellerAcquisitionRecord) => {
    setRecords((prev) => prev.map((r) => r.capture.id === updated.capture.id ? updated : r));
  }, []);

  return (
    <div className="w-full max-w-full min-w-0 space-y-6 overflow-x-hidden" data-testid="acquisition-workbench">
      <section className="flex flex-col gap-4 rounded-2xl bg-background p-5 sm:flex-row sm:items-center sm:justify-between" style={{ border: "0.5px solid var(--color-border)" }}>
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{mode === "campaign" ? `Seller Acquisition · ${campaignName ?? "Campaign"}` : "Seller Acquisition"}</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{pageTitle}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
          <p className="mt-3 max-w-3xl text-xs leading-5 text-muted-foreground">{contextNote}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {mode === "campaign" ? (
            <Link className="inline-flex h-10 items-center justify-center rounded-xl bg-secondary px-4 text-sm font-semibold text-foreground transition hover:opacity-90" href="/marketplace-acquisition">
              Back to command center
            </Link>
          ) : null}
          <Link className="inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pulse" href={mode === "campaign" && campaignId ? `/marketplace-acquisition/capture?campaignId=${campaignId}` : "/marketplace-acquisition/capture"} style={{ background: "var(--color-whisper)" }}>
            Capture seller
            <IconArrowRight aria-hidden="true" className="size-4" stroke={1.8} />
          </Link>
        </div>
      </section>

      {mode === "campaign" && discoveryRuntime !== null ? (
        <section className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }} aria-label="Discovery execution state">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Autonomous discovery execution</p>
              <h2 className="mt-1 text-sm font-semibold text-foreground">{discoveryRuntime.status}</h2>
              <p className="mt-1 text-xs text-muted-foreground">Last execution {discoveryRuntime.lastExecutionTime ?? "not recorded"}</p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs sm:min-w-[360px]">
              <div className="rounded-xl bg-secondary p-3"><p className="font-semibold text-foreground">{discoveryRuntime.discoveredCount}</p><p className="text-muted-foreground">discovered</p></div>
              <div className="rounded-xl bg-secondary p-3"><p className="font-semibold text-foreground">{discoveryRuntime.capturedCount}</p><p className="text-muted-foreground">captured</p></div>
              <div className="rounded-xl bg-secondary p-3"><p className="font-semibold text-foreground">{discoveryRuntime.skippedDuplicateCount}</p><p className="text-muted-foreground">duplicates</p></div>
            </div>
          </div>
          <div className="mt-3 rounded-xl bg-secondary p-3 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground">Targeting {discoveryRuntime.targetingStatus ?? "not recorded"}</p>
            <p>{discoveryRuntime.targetingSnapshot ? [discoveryRuntime.targetingSnapshot.marketplaceSourceKey ?? discoveryRuntime.targetingSnapshot.marketplaceSourceId, discoveryRuntime.targetingSnapshot.keyword, discoveryRuntime.targetingSnapshot.category, discoveryRuntime.targetingSnapshot.location].filter(Boolean).join(" · ") : "No targeting snapshot recorded."}</p>
            <p>Execution limit: {typeof discoveryRuntime.targetingSnapshot?.executionLimit === "number" || typeof discoveryRuntime.targetingSnapshot?.executionLimit === "string" ? discoveryRuntime.targetingSnapshot.executionLimit : "—"}</p>
          </div>
          {discoveryRuntime.targetingFailureReason ? <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">{discoveryRuntime.targetingFailureReason}</p> : null}
          {discoveryRuntime.failureMessage ? <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{discoveryRuntime.failureMessage}</p> : null}
          {discoveryRuntime.qualificationFailureMessage ? <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{discoveryRuntime.qualificationFailureMessage}</p> : null}
          <div className="mt-4 rounded-xl bg-secondary p-3" aria-label="Adaptive discovery optimization">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Adaptive optimization</p>
              <p className="text-xs text-muted-foreground">{discoveryRuntime.optimizationStatus ?? "Not evaluated"}{discoveryRuntime.lastOptimizedAt ? ` · ${discoveryRuntime.lastOptimizedAt}` : ""}</p>
            </div>
            {discoveryRuntime.optimizationFailureMessage ? <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{discoveryRuntime.optimizationFailureMessage}</p> : null}
            {discoveryRuntime.optimizationRecommendations.length > 0 ? (
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {discoveryRuntime.optimizationRecommendations.map((recommendation) => (
                  <div key={recommendation.id ?? `${recommendation.type}:${recommendation.reason}`} className="rounded-xl bg-background p-3" style={{ border: "0.5px solid var(--color-border)" }}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-foreground">{recommendation.type.replaceAll("_", " ")}</p>
                      <Badge tone={recommendation.severity === "ACTIONABLE" ? "bg-amber-50 text-amber-700" : recommendation.severity === "WARNING" ? "bg-red-50 text-red-700" : undefined}>{recommendation.severity}</Badge>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">{recommendation.reason}</p>
                    <p className="mt-2 text-[11px] text-muted-foreground">Confidence: {recommendation.confidence}</p>
                  </div>
                ))}
              </div>
            ) : <p className="mt-2 text-xs text-muted-foreground">No recommendations yet.</p>}
          </div>
        </section>
      ) : null}

      {mode === "campaign" && campaignId !== undefined && growthLoop !== null ? (
        <section className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }} aria-label="Revenue-informed growth loop">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Revenue attribution → growth recommendations</p>
          <p className="mt-1 text-xs text-muted-foreground">Deterministic, revenue-informed recommendations for scaling, pausing, or retargeting this campaign. Applying a recommendation is the only path that changes campaign targeting or scheduling.</p>
          <GrowthLoopSection campaignId={campaignId} growthLoop={growthLoop} onRefresh={setGrowthLoop} />
        </section>
      ) : null}

      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6" aria-label="Acquisition workbench summary">
        {commandCenterStats.map((stat) => (
          <div key={stat.label} className="rounded-2xl bg-background p-4" style={{ border: "0.5px solid var(--color-border)" }}>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{stat.label}</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">{stat.value}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Mobile-first qualification system</h2>
            <p className="mt-1 text-sm text-muted-foreground">Designed for Africa-heavy WhatsApp markets. Email is optional for non-cellphone-first markets.</p>
          </div>
          <Badge tone="bg-emerald-50 text-emerald-700">WhatsApp-first</Badge>
        </div>
        <div className="mt-4 grid gap-3 text-sm md:grid-cols-4">
          <div className="rounded-xl bg-secondary p-3"><p className="font-semibold text-foreground">1. Mobile required</p><p className="mt-1 text-xs text-muted-foreground">No phone means no automated invitation.</p></div>
          <div className="rounded-xl bg-secondary p-3"><p className="font-semibold text-foreground">2. WhatsApp first</p><p className="mt-1 text-xs text-muted-foreground">Primary invitation path for qualified sellers.</p></div>
          <div className="rounded-xl bg-secondary p-3"><p className="font-semibold text-foreground">3. SMS is fallback</p><p className="mt-1 text-xs text-muted-foreground">Keeps outreach alive when WhatsApp fails.</p></div>
          <div className="rounded-xl bg-secondary p-3"><p className="font-semibold text-foreground">4. Email optional</p><p className="mt-1 text-xs text-muted-foreground">Useful for non-cellphone-first markets.</p></div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-10" aria-label="Action queue">
        <button className={`rounded-2xl bg-background p-4 text-left transition hover:opacity-90 ${queueFilter === "all" ? "ring-2 ring-pulse" : ""}`} onClick={() => setQueueFilter("all")} style={{ border: "0.5px solid var(--color-border)" }} type="button">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">All sellers</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{records.length}</p>
          <p className="mt-1 text-xs text-muted-foreground">Reset queue view</p>
        </button>
        {queueBuckets.map((bucket) => {
          const count = records.filter(bucket.matches).length;
          return (
            <button key={bucket.id} className={`rounded-2xl bg-background p-4 text-left transition hover:opacity-90 ${queueFilter === bucket.id ? "ring-2 ring-pulse" : ""}`} onClick={() => setQueueFilter(bucket.id)} style={{ border: "0.5px solid var(--color-border)" }} type="button">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{bucket.label}</p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{count}</p>
              <p className="mt-1 text-xs text-muted-foreground">Oldest pending when available</p>
            </button>
          );
        })}
      </section>

      <section className="grid w-full min-w-0 max-w-full gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="min-w-0 space-y-4">
          <div className="w-full min-w-0 max-w-full rounded-2xl bg-background p-4" data-testid="workbench-filter-panel" style={{ border: "0.5px solid var(--color-border)" }}>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
              <input aria-label="Search marketplace sellers" className="h-10 w-full min-w-0 rounded-xl bg-secondary px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-pulse" placeholder="Search sellers, phone, title, or marketplace" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
              <button className="h-10 w-full rounded-xl bg-secondary px-4 text-sm font-semibold text-foreground disabled:opacity-50 md:w-auto" disabled={loading} onClick={() => void refreshRecords()} type="button">Refresh</button>
              <Link className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-whisper px-4 text-sm font-semibold text-white md:w-auto" href={mode === "campaign" && campaignId ? `/marketplace-acquisition/capture?campaignId=${campaignId}` : "/marketplace-acquisition/capture"}>Capture seller</Link>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Filter label="Queue"       value={queueFilter}       onChange={(value) => setQueueFilter(value as QueueBucketId)} options={["all", ...queueBuckets.map((b) => b.id)]} />
              <Filter label="Health"      value={healthFilter}      onChange={setHealthFilter}      options={["all", "READY", "ACTION_REQUIRED", "BLOCKED", "COMPLETED", "EXPIRED"]} />
              <Filter label="Next Action" value={nextActionFilter}  onChange={setNextActionFilter}  options={["all", ...Object.keys(nextActionLabels)]} />
              <Filter label="Confidence"  value={confidenceFilter}  onChange={setConfidenceFilter}  options={["all", "HIGH", "MEDIUM", "LOW"]} />
              <Filter label="Stage"       value={stageFilter}       onChange={setStageFilter}       options={["all", ...stages]} />
            </div>
          </div>

          <div className="w-full min-w-0 max-w-full rounded-2xl bg-background p-4 sm:p-6" data-testid="bulk-invitation-queue" style={{ border: "0.5px solid var(--color-border)" }}>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">Bulk invitation queue</h2>
              <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:flex sm:flex-wrap sm:items-center sm:gap-x-2">
                <span>{selectedBulkRecords.length} selected</span>
                <span className="hidden sm:inline">·</span>
                <span>{bulkEligibleRecords.length} eligible in current view</span>
                <span className="hidden sm:inline">·</span>
                <span>WhatsApp first, SMS fallback</span>
              </div>
            </div>
            <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap">
              <button
                className="h-10 w-full rounded-xl bg-secondary px-4 text-sm font-semibold text-foreground disabled:opacity-50 sm:w-auto"
                disabled={bulkEligibleRecords.length === 0 || bulkBusy}
                onClick={toggleAllEligible}
                type="button"
              >
                {allEligibleSelected ? "Clear eligible" : "Select eligible"}
              </button>
              <button
                className="h-10 w-full rounded-xl bg-whisper px-4 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto"
                disabled={selectedBulkRecords.length === 0 || bulkBusy}
                onClick={runBulkInvites}
                type="button"
              >
                {bulkBusy ? "Sending…" : `Send Invites (${selectedBulkRecords.length})`}
              </button>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading Acquisition Workbench…</p>
          ) : filteredRecords.length === 0 ? (
            <section className="flex flex-col items-center justify-center rounded-2xl bg-background px-6 py-16 text-center" style={{ border: "0.5px solid var(--color-border)" }}>
              <IconBookmark aria-hidden="true" className="size-8 text-muted-foreground" stroke={1.5} />
              <h2 className="mt-4 text-sm font-semibold text-foreground">No sellers match this workbench view</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">Clear filters or capture a new seller to keep the acquisition queue moving.</p>
            </section>
          ) : (
            <div className="min-w-0 space-y-4">
              {visibleQueueGroups.map(({ bucket, rollups }) => (
                <section key={bucket.id} className="w-full min-w-0 max-w-full rounded-2xl bg-background p-4" style={{ border: "0.5px solid var(--color-border)" }}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{bucket.label}</p>
                      <h2 className="mt-1 text-sm font-semibold text-foreground">{rollups.length} seller{rollups.length === 1 ? "" : "s"}</h2>
                    </div>
                    <Badge>{rollups.filter((rollup) => rollup.records.some(hasPhone)).length} phone-ready</Badge>
                  </div>
                  <div className="grid min-w-0 gap-3 xl:grid-cols-2">
                    {rollups.map((rollup) => (
                      <SellerRollupCard
                        key={rollup.key}
                        rollup={rollup}
                        selectedCaptureId={selectedRecord?.capture.id ?? null}
                        selectedBulkIds={selectedBulkIds}
                        bulkEligibleRecords={bulkEligibleRecords}
                        onBulkToggle={() => toggleBulkRollup(rollup.records)}
                        onSelect={() => setSelectedCaptureId(rollup.primary.capture.id)}
                      />
                    ))}
                  </div>
                </section>
              ))}

              {ungroupedVisibleRollups.length > 0 ? (
                <section className="w-full min-w-0 max-w-full rounded-2xl bg-background p-4" style={{ border: "0.5px solid var(--color-border)" }}>
                  <div className="mb-3">
                    <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Other sellers</p>
                    <h2 className="mt-1 text-sm font-semibold text-foreground">{ungroupedVisibleRollups.length} seller{ungroupedVisibleRollups.length === 1 ? "" : "s"}</h2>
                  </div>
                  <div className="grid min-w-0 gap-3 xl:grid-cols-2">
                    {ungroupedVisibleRollups.map((rollup) => (
                      <SellerRollupCard
                        key={rollup.key}
                        rollup={rollup}
                        selectedCaptureId={selectedRecord?.capture.id ?? null}
                        selectedBulkIds={selectedBulkIds}
                        bulkEligibleRecords={bulkEligibleRecords}
                        onBulkToggle={() => toggleBulkRollup(rollup.records)}
                        onSelect={() => setSelectedCaptureId(rollup.primary.capture.id)}
                      />
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </div>
        <Workbench
          record={selectedRecord}
          rollupRecords={selectedRollup?.records ?? []}
          actionError={actionError}
          onActionError={setActionError}
          onRefresh={refreshRecords}
          onRecordPatched={patchRecord}
        />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Filter({ label, value, options, onChange }: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly string[];
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="text-xs font-medium text-muted-foreground">
      {label}
      <select
        className="mt-1 h-10 w-full rounded-xl bg-secondary px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-pulse"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option === "all" ? `All ${label.toLowerCase()}` : option}
          </option>
        ))}
      </select>
    </label>
  );
}

function Badge({ children, tone }: { readonly children: ReactNode; readonly tone?: string | undefined }) {
  return (
    <span className={`max-w-full break-words rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone ?? "bg-secondary text-muted-foreground"}`}>
      {children}
    </span>
  );
}


// ST-005: CRM conversion is capture-time canonical -- a qualified seller already has its
// Contact/Deal pair, so status reads directly off that linkage instead of dead post-claim
// runtime metadata (which is never written now that runtime is retired from production).
function crmConversionStatus(record: SellerAcquisitionRecord): string {
  if (record.contact !== null && record.deal !== null) return "CONVERTED";
  return record.isQualifiedSellerLead ? "PENDING" : "NOT_ELIGIBLE";
}

function crmLinkedId(id: string | null | undefined): string {
  return id ?? "Not linked";
}

// Reads the attribution snapshot Runtime/Worker already computed and persisted onto
// the deal; this component never derives or recomputes attribution itself.
function revenueAttribution(record: SellerAcquisitionRecord): RevenueAttributionSnapshot | null {
  const snapshot = record.deal?.deal.metadata?.revenueAttribution;
  if (typeof snapshot !== "object" || snapshot === null) return null;
  const value = snapshot as Partial<RevenueAttributionSnapshot>;
  if (typeof value.attributionStatus !== "string" || typeof value.attributionCompleteness !== "string") return null;
  return value as RevenueAttributionSnapshot;
}

function formatCurrencyAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount} ${currency}`.trim();
  }
}

function formatRevenueAmount(snapshot: RevenueAttributionSnapshot): string {
  if (snapshot.revenueAmount === undefined) return "—";
  const numeric = Number(snapshot.revenueAmount);
  if (!Number.isFinite(numeric)) return `${snapshot.revenueAmount} ${snapshot.revenueCurrency ?? ""}`.trim();
  return formatCurrencyAmount(numeric, snapshot.revenueCurrency ?? "USD");
}

function attributionCompletenessTone(completeness: RevenueAttributionSnapshot["attributionCompleteness"]): string {
  if (completeness === "FAILED") return "text-red-700 bg-red-50";
  if (completeness === "PARTIAL") return "text-amber-700 bg-amber-50";
  return "text-emerald-700 bg-emerald-50";
}

function RevenueAttributionDetail({ snapshot }: { readonly snapshot: RevenueAttributionSnapshot | null }) {
  if (snapshot === null) {
    return <p className="text-sm text-muted-foreground">No revenue attributed yet.</p>;
  }
  return (
    <div className="space-y-2 text-sm text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={attributionCompletenessTone(snapshot.attributionCompleteness)}>{snapshot.attributionCompleteness}</Badge>
        <Badge>{formatRevenueAmount(snapshot)}</Badge>
      </div>
      <p><strong className="text-foreground">Campaign:</strong> {snapshot.campaignId ?? "Not linked"}</p>
      <p><strong className="text-foreground">Marketplace/source:</strong> {snapshot.marketplaceSource ?? snapshot.providerKey ?? "Unknown"}</p>
      <p><strong className="text-foreground">Qualification:</strong> {snapshot.qualificationStatus ?? "—"} {snapshot.qualificationScore ? `(${snapshot.qualificationScore})` : ""}</p>
      {snapshot.missingLinks.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {snapshot.missingLinks.map((link) => (
            <Badge key={link} tone="bg-amber-50 text-amber-700">Missing: {link}</Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function WorkbenchSection({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-secondary p-4" style={{ border: "0.5px solid var(--color-border)" }}>
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{title}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function CheckLine({ label, passed, detail }: { readonly label: string; readonly passed: boolean; readonly detail?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="min-w-0 text-muted-foreground">
        {label}
        {detail ? <span className="ml-2 text-xs">· {detail}</span> : null}
      </span>
      <span className={passed ? "font-semibold text-emerald-700" : "font-semibold text-amber-700"}>{passed ? "✓" : "⚠"}</span>
    </div>
  );
}

function SellerRollupCard({ rollup, selectedCaptureId, selectedBulkIds, bulkEligibleRecords, onBulkToggle, onSelect }: {
  readonly rollup: SellerRollup;
  readonly selectedCaptureId: string | null;
  readonly selectedBulkIds: readonly string[];
  readonly bulkEligibleRecords: readonly SellerAcquisitionRecord[];
  readonly onBulkToggle: () => void;
  readonly onSelect: () => void;
}) {
  const eligibleIds = rollup.records
    .filter((record) => bulkEligibleRecords.some((item) => item.capture.id === record.capture.id))
    .map((record) => record.capture.id);
  const primary = rollup.primary;
  const selected = rollup.records.some((record) => record.capture.id === selectedCaptureId);
  const bulkEligible = eligibleIds.length > 0;
  const bulkSelected = bulkEligible && eligibleIds.every((id) => selectedBulkIds.includes(id));
  const childTitles = rollupListingTitles(rollup);

  return (
    <div className="w-full min-w-0 max-w-full space-y-2">
      <RecordCard
        record={primary}
        selected={selected}
        bulkSelected={bulkSelected}
        bulkEligible={bulkEligible}
        onBulkToggle={onBulkToggle}
        onSelect={onSelect}
      />
      {rollup.records.length > 1 || childTitles.length > 1 ? (
        <div className="min-w-0 max-w-full rounded-2xl bg-secondary px-4 py-3 text-xs text-muted-foreground" style={{ border: "0.5px solid var(--color-border)" }}>
          <p className="break-words font-semibold text-foreground">{rollupListingCount(rollup)} listings · {rollupPriceSummary(rollup)}</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {childTitles.map((item) => (
              <li key={item} className="truncate">{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function InventoryThumbnail({ src, alt }: { readonly src?: string | null | undefined; readonly alt: string }) {
  const [failed, setFailed] = useState(false);
  const normalizedSrc = typeof src === "string" ? src.trim() : "";
  const isUsableSrc = !failed && /^https?:\/\//i.test(normalizedSrc);

  if (!isUsableSrc) {
    return (
      <div className="flex aspect-[4/3] w-full shrink-0 items-center justify-center rounded-xl bg-secondary px-2 text-center text-[11px] font-medium text-muted-foreground sm:w-24">
        Captured inventory
      </div>
    );
  }

  return (
    <img
      alt={alt}
      className="aspect-[4/3] w-full shrink-0 rounded-xl object-cover sm:w-24"
      loading="lazy"
      onError={() => setFailed(true)}
      src={normalizedSrc}
    />
  );
}

function RecordCard({ record, selected, bulkSelected, bulkEligible, onBulkToggle, onSelect }: {
  readonly record: SellerAcquisitionRecord;
  readonly selected: boolean;
  readonly bulkSelected: boolean;
  readonly bulkEligible: boolean;
  readonly onBulkToggle: () => void;
  readonly onSelect: () => void;
}) {
  const blocked = record.missingRequirements.includes("PHONE_REQUIRED");
  return (
    <article
      className={`w-full min-w-0 max-w-full rounded-2xl bg-background p-4 text-left transition hover:opacity-90 sm:p-5 ${selected ? "ring-2 ring-pulse" : ""}`}
      data-testid="seller-card"
      style={{ border: "0.5px solid var(--color-border)" }}
    >
      <div className="flex min-w-0 items-start gap-3">
        <input
          aria-label={`Select ${sellerName(record)} for bulk invite`}
          checked={bulkSelected}
          className="mt-1 size-4 shrink-0"
          disabled={!bulkEligible}
          onChange={onBulkToggle}
          type="checkbox"
        />
        <button className="min-w-0 flex-1 text-left" onClick={onSelect} type="button">
          <h3 className="break-words text-base font-semibold leading-snug text-foreground sm:text-lg">{sellerName(record)}</h3>
          <p className="mt-1 min-w-0 break-words text-xs text-muted-foreground">
            {hasPhone(record) ? phone(record) : "Mobile required"} · {source(record)}{location(record) ? ` · ${location(record)}` : ""}
          </p>
        </button>
      </div>

      <button className="mt-3 grid w-full min-w-0 gap-3 text-left sm:grid-cols-[6rem_minmax(0,1fr)]" onClick={onSelect} type="button">
        <InventoryThumbnail alt={`${sellerName(record)} captured inventory`} src={record.images[0]} />
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{listingCount(record)} listing{listingCount(record) === 1 ? "" : "s"}</p>
          <p className="line-clamp-2 break-words text-xs text-foreground">{title(record)}</p>
          <p className="mt-1 text-xs font-medium text-foreground">{price(record)}</p>
        </div>
      </button>

      <div className="mt-3 flex min-w-0 flex-wrap gap-2">
        <Badge tone={blocked ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}>
          {blocked ? "BLOCKED" : "PHONE READY"}
        </Badge>
        <Badge>{queueBuckets.find((bucket) => bucket.matches(record))?.label ?? "All Sellers"}</Badge>
        <Badge>{capturedAge(record)}</Badge>
      </div>
      {record.deal?.deal.id ? (
        <Link
          className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-2xl px-4 text-sm font-semibold text-whisper sm:w-auto"
          data-testid="seller-card-open-detail"
          href={`/marketplace-acquisition/${record.deal.deal.id}`}
          style={{ border: "0.5px solid var(--color-border)" }}
        >
          Open detail
        </Link>
      ) : null}
    </article>
  );
}

function Workbench({ record, rollupRecords, actionError, onActionError, onRefresh, onRecordPatched }: {
  readonly record: SellerAcquisitionRecord | null;
  readonly rollupRecords: readonly SellerAcquisitionRecord[];
  readonly actionError: string | null;
  readonly onActionError: (message: string | null) => void;
  readonly onRefresh: () => Promise<void>;
  readonly onRecordPatched: (updated: SellerAcquisitionRecord) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editFields, setEditFields] = useState<EditFields>({
    title: "", sellerName: "", sellerPhone: "", priceText: "",
    currency: "", description: "", location: "", category: "",
  });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Reset edit mode whenever the selected record changes so the form does not
  // carry stale values from a previously-selected card.
  useEffect(() => {
    setEditMode(false);
    setEditError(null);
  }, [record?.capture.id]);

  if (record === null) {
    return (
      <aside className="rounded-2xl bg-background p-5 text-sm text-muted-foreground" style={{ border: "0.5px solid var(--color-border)" }}>
        Select a seller from the queue to review readiness, edit extracted data, send invitations, and advance the acquisition workflow.
      </aside>
    );
  }

  const blocked = record.missingRequirements.includes("PHONE_REQUIRED");
  const enabled = isActionEnabled(record);
  const sellerRecords = rollupRecords.length > 0 ? rollupRecords : [record];
  const sellerListingTitles = [...new Set(sellerRecords.map(title))].slice(0, 8);
  const sellerListingCount = sellerRecords.reduce((count, item) => count + listingCount(item), 0);
  const sellerImageCount = sellerRecords.reduce((count, item) => count + item.images.length, 0);
  const sellerPhoneReadyCount = sellerRecords.filter(hasPhone).length;
  const sellerLatestInvitation = sellerRecords.find((item) => item.latestInvitation !== null)?.latestInvitation ?? null;

  const openEdit = () => {
    setEditFields(editFieldsFromRecord(record));
    setEditError(null);
    setEditMode(true);
  };

  const saveEdit = async () => {
    setEditSaving(true);
    setEditError(null);
    try {
      // Only send fields that have a non-empty value after trimming.
      const body: Record<string, string> = {};
      for (const { key } of EDIT_FIELD_CONFIG) {
        const val = editFields[key].trim();
        if (val.length > 0) body[key] = val;
      }
      if (Object.keys(body).length === 0) {
        setEditError("No changes to save.");
        return;
      }

      const response = await fetch(
        `/api/marketplace-acquisition/records/${encodeURIComponent(record.capture.id)}`,
        { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      );
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        setEditError(errorMessageFromPayload(result) ?? "Save failed. Please try again.");
        return;
      }

      const updated = (result as { readonly data?: { readonly record?: SellerAcquisitionRecord } }).data?.record;
      if (updated !== undefined) {
        onRecordPatched(updated);
      }
      setEditMode(false);
    } catch {
      setEditError("Save failed. Please try again.");
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <aside className="space-y-4 rounded-2xl bg-background p-5 sticky top-6 max-h-[calc(100vh-5rem)] overflow-y-auto" style={{ border: "0.5px solid var(--color-border)" }}>
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Workbench dossier</p>
        <h2 className="mt-1 text-lg font-semibold text-foreground">{sellerName(record)}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {hasPhone(record) ? phone(record) : "Mobile required"} · {source(record)} · {sellerRecords.length} capture{sellerRecords.length === 1 ? "" : "s"}
        </p>
      </div>

      <WorkbenchSection title="Seller portfolio">
        <div className="grid gap-2 text-sm text-muted-foreground">
          <p><strong className="text-foreground">Listings:</strong> {sellerListingCount}</p>
          <p><strong className="text-foreground">Phone-ready captures:</strong> {sellerPhoneReadyCount}/{sellerRecords.length}</p>
          <p><strong className="text-foreground">Images captured:</strong> {sellerImageCount}</p>
          <p><strong className="text-foreground">Activity events:</strong> {sellerRecords.reduce((count, item) => count + item.activityTimeline.length, 0)}</p>
          <p><strong className="text-foreground">Latest invitation:</strong> {invitationRuntimeStatus(sellerLatestInvitation)}</p>
        </div>
        {sellerListingTitles.length > 0 ? (
          <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            {sellerListingTitles.map((item) => (
              <li key={item} className="truncate">{item}</li>
            ))}
          </ul>
        ) : null}
      </WorkbenchSection>
        <WorkbenchSection title="Acquisition readiness">
          <div className="space-y-2">
            {readinessChecks(record).map((item) => (
              <CheckLine key={item.label} label={item.label} passed={item.passed} />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Badge tone={badgeTone(readinessStatus(record))}>{readinessStatus(record)}</Badge>
            <Badge>{readinessScore(record)}/100</Badge>
          </div>
        </WorkbenchSection>

        <WorkbenchSection title="Next action">
          <p className="text-base font-semibold text-foreground">{nextActionLabels[record.nextAction]}</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{nextActionReason(record)}</p>
          {blocked ? <p className="mt-2 text-sm font-semibold text-red-700">PHONE_REQUIRED blocks invitation.</p> : null}
        </WorkbenchSection>

        <WorkbenchSection title="Invitation status">
          <p className="text-sm text-muted-foreground">
            {invitationRuntimeStatus(sellerLatestInvitation)}
          </p>
        </WorkbenchSection>

        <WorkbenchSection title="Claim intelligence">
          <div className="space-y-2">
            {claimIntelligenceItems(record).map((item) => (
              <CheckLine key={item.label} label={item.label} detail={item.detail} passed={item.done} />
            ))}
          </div>
        </WorkbenchSection>


        <WorkbenchSection title="CRM conversion">
          <div className="space-y-2 text-sm text-muted-foreground">
            <p><strong className="text-foreground">Status:</strong> {crmConversionStatus(record)}</p>
            <p><strong className="text-foreground">Contact:</strong> {crmLinkedId(record.contact?.id)}</p>
            <p><strong className="text-foreground">Deal:</strong> {crmLinkedId(record.deal?.deal.id)}</p>
          </div>
        </WorkbenchSection>

        <WorkbenchSection title="Seller relationship memory">
          <div className="space-y-2">
            {sellerRelationshipTimelineItems(sellerRecords).map((item) => (
              <CheckLine key={item.label} label={item.label} detail={item.detail} passed={item.done} />
            ))}
          </div>
        </WorkbenchSection>

        <WorkbenchSection title="Revenue attribution">
          <RevenueAttributionDetail snapshot={revenueAttribution(record)} />
        </WorkbenchSection>

        <WorkbenchSection title="Extract quality issues">
          {qualityIssues(record).length === 0 ? (
            <p className="text-sm font-medium text-emerald-700">No major extract issues detected.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {qualityIssues(record).map((issue) => (
                <Badge key={issue} tone="bg-amber-50 text-amber-700">⚠ {issue}</Badge>
              ))}
            </div>
          )}
          <button
            className="mt-3 h-10 w-full rounded-xl bg-background px-4 text-sm font-semibold text-foreground"
            onClick={openEdit}
            style={{ border: "0.5px solid var(--color-border)" }}
            type="button"
          >
            Edit extract
          </button>
        </WorkbenchSection>

      <button
        className="h-10 w-full rounded-xl bg-whisper px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!enabled || busy}
        onClick={async () => {
          setBusy(true);
          onActionError(null);
          try {
            await runPrimaryAction(record);
            await onRefresh();
            onActionError(null);
          } catch (error) {
            onActionError(error instanceof Error ? error.message : "Workbench action failed.");
          } finally {
            setBusy(false);
          }
        }}
        type="button"
      >
        {busy ? "Working…" : nextActionLabels[record.nextAction]}
      </button>

      {actionError ? <p className="text-xs font-semibold text-red-700" role="alert">{actionError}</p> : null}
      {!enabled ? <p className="text-xs text-muted-foreground">This action is disabled because the seller is waiting on another step, blocked by missing mobile data, or not safe to automate yet.</p> : null}

      {/* Edit extract -------------------------------------------------------- */}
      {editMode ? (
        <div
          className="space-y-3 rounded-2xl bg-secondary p-4"
          style={{ border: "0.5px solid var(--color-border)" }}
        >
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Edit extract</p>

          {EDIT_FIELD_CONFIG.map(({ key, label, placeholder }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-muted-foreground">{label}</label>
              <input
                className="mt-1 h-9 w-full rounded-xl bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pulse"
                style={{ border: "0.5px solid var(--color-border)" }}
                placeholder={placeholder}
                value={editFields[key]}
                onChange={(e) => setEditFields((prev) => ({ ...prev, [key]: e.target.value }))}
                disabled={editSaving}
              />
            </div>
          ))}

          {editError ? <p className="text-xs text-red-600" role="alert">{editError}</p> : null}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              disabled={editSaving}
              onClick={saveEdit}
              className="flex-1 rounded-xl bg-whisper py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {editSaving ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              disabled={editSaving}
              onClick={() => { setEditMode(false); setEditError(null); }}
              className="rounded-xl px-4 py-2 text-sm text-muted-foreground hover:bg-mist disabled:opacity-60"
              style={{ border: "0.5px solid var(--color-border)" }}
            >
              Cancel
            </button>
          </div>
        </div>
        ) : null}
    </aside>
  );
}
