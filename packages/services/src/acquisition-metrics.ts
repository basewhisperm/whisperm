/**
 * ST1-013E -- the canonical acquisition metrics engine.
 *
 * Metrics are domain state, not a UI concern. This module is the only place
 * in WhispeRM that classifies a seller into a queue state or aggregates
 * acquisition counts. Every screen -- Dashboard, Workbench, Campaigns, Bulk
 * Invitation, Command Center -- must render numbers that came from here.
 *
 *   Database -> Repository -> Acquisition Domain -> Metrics Engine -> Web/API/Worker
 *
 * No page, card, or route should reimplement `records.filter(...)`,
 * `records.reduce(...)`, or `records.length` to answer "how many sellers
 * need review / are ready to invite / are waiting on claim." Call through
 * to `AcquisitionMetricsService` (or the pure `resolveQueueState` /
 * `calculateAcquisitionMetrics` helpers it is built from) instead.
 */

import type {
  AcquisitionMetrics,
  CampaignMetrics,
  DashboardMetrics,
  MetricsEnvelope,
  MetricsProvenance,
  QueueMetrics,
  QueueState,
  QueueStateSummary,
} from "@whisperm/types";
import type { TenantScoped } from "@whisperm/types";
import type { SellerAcquisitionRecord, SellerAcquisitionRecordService } from "./seller-acquisition-records.js";
import type { SellerAcquisitionCampaignService } from "./seller-acquisition-campaigns.js";

/**
 * The minimal seller shape `resolveQueueState` needs. Deliberately a
 * structural subset of `SellerAcquisitionRecord` (rather than that type
 * itself) so both the server (which has the full record) and client
 * components (which hold their own parallel `SellerAcquisitionRecord`
 * mirror type) can call the exact same classifier without a type-only
 * duplicate. Any object with this shape -- server or client -- is a valid
 * classification input.
 *
 * `healthStatus` / `nextAction` / `missingRequirements` are read directly
 * from `SellerAcquisitionRecordService.decide()` -- the one place that
 * already turns raw capture/draft/invitation/claim/conversion rows into a
 * decision. This classifier re-buckets that existing decision into the
 * canonical queue vocabulary; it does not recompute the decision itself.
 */
export interface QueueStateInput {
  readonly capture: {
    readonly metadata?: unknown;
  };
  readonly contact?: { readonly phone?: string | null | undefined } | null | undefined;
  readonly draftInventory?: unknown | null;
  readonly latestInvitation?: { readonly status?: string | undefined } | null | undefined;
  readonly ownershipAttestation?: unknown | null;
  readonly healthStatus: string;
  readonly nextAction: string;
  readonly missingRequirements: readonly string[];
}

export type { QueueState, QueueStateSummary, AcquisitionMetrics, CampaignMetrics, DashboardMetrics, QueueMetrics };

// ---------------------------------------------------------------------------
// Campaign-member funnel classification, shared between AcquisitionCommandCenterService
// and CampaignRuntimeService's growth-signal snapshot -- previously the same
// three Sets were typed out independently in both files.
// ---------------------------------------------------------------------------

export const CAMPAIGN_MEMBER_QUALIFIED_STATUSES: ReadonlySet<string> = new Set(["QUALIFIED", "INVITED", "CLAIMED", "CONVERTED", "COMPLETED"]);
export const CAMPAIGN_MEMBER_INVITED_STATUSES: ReadonlySet<string> = new Set(["INVITED", "CLAIMED", "CONVERTED", "COMPLETED"]);
export const CAMPAIGN_MEMBER_CLAIMED_STATUSES: ReadonlySet<string> = new Set(["CLAIMED", "CONVERTED", "COMPLETED"]);

// ---------------------------------------------------------------------------
// Seller-level queue resolver
// ---------------------------------------------------------------------------

const isPlainRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);

const nonEmptyText = (value: unknown): string | null => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

/**
 * Presence-based phone resolution, mirroring the fallback chain
 * `SellerAcquisitionRecordService` already uses to decide `PHONE_REQUIRED`.
 * This only reads the already-loaded record; it never touches a repository.
 */
const resolvePhoneValue = (record: QueueStateInput): string | null => {
  const metadata = isPlainRecord(record.capture.metadata) ? record.capture.metadata : {};
  return nonEmptyText(record.contact?.phone)
    ?? nonEmptyText(metadata.sellerPhone)
    ?? nonEmptyText(metadata.phone)
    ?? nonEmptyText(metadata.primaryPhoneNumber);
};

/**
 * A conservative format check -- WhispeRM has never validated phone format
 * anywhere before this engine, so this intentionally accepts any string
 * whose digit count is plausible for a real phone number rather than
 * enforcing a specific national format.
 */
const isValidPhoneFormat = (value: string): boolean => {
  const digits = value.replace(/\D/gu, "");
  return digits.length >= 8 && digits.length <= 15;
};

const hasValue = (value: unknown): boolean => value !== null && value !== undefined;

/**
 * Classifies a single seller into exactly one canonical queue state. This is
 * the only seller-classification logic in WhispeRM -- every page derives its
 * "Needs Review" / "Phone Ready" / "Waiting Claim" / etc. counts by calling
 * this once per record, never by inventing its own predicate.
 *
 * Built directly on top of `healthStatus` / `nextAction` -- the decision
 * `SellerAcquisitionRecordService.decide()` already made -- rather than a
 * second, competing stage model. A seller that cannot advance (an expired
 * capture, or a conversion recorded in an order that should be impossible)
 * is always reported as `"BLOCKED"` with a human-readable reason, taking
 * priority over whatever it would otherwise naturally classify as.
 */
export const resolveQueueState = (record: QueueStateInput): QueueStateSummary => {
  if (record.healthStatus === "EXPIRED") {
    return { state: "BLOCKED", blockedReason: "Marketplace capture expired before the seller completed the workflow" };
  }

  const phoneValue = resolvePhoneValue(record);
  const hasValidPhone = !record.missingRequirements.includes("PHONE_REQUIRED") && phoneValue !== null && isValidPhoneFormat(phoneValue);
  if (!hasValidPhone) {
    return { state: "REVIEW" };
  }

  if (!hasValue(record.draftInventory)) {
    return { state: "PHONE_READY" };
  }

  if (record.nextAction === "SEND_INVITATION" || record.nextAction === "RETRY_INVITATION") {
    return { state: "INVITATION_READY" };
  }

  // decide() only reaches here once phone + draft inventory both exist and
  // no invitation is currently FAILED. An invitation still sitting in
  // PENDING (queued, not yet delivered) has no dedicated nextAction of its
  // own -- report it directly rather than letting it fall through to the
  // BLOCKED catch-all below.
  if (record.latestInvitation?.status === "PENDING" && !hasValue(record.ownershipAttestation)) {
    return { state: "INVITATION_PENDING" };
  }

  if (record.nextAction === "WAIT_FOR_CLAIM") {
    return { state: "WAITING_CLAIM" };
  }

  if (record.nextAction === "CONVERT_SELLER") {
    return { state: "CLAIMED" };
  }

  if (record.nextAction === "CONVERT_INVENTORY") {
    return { state: "READY_CONVERSION" };
  }

  if (record.nextAction === "COMPLETE_ACQUISITION" || record.healthStatus === "COMPLETED") {
    return { state: "CONVERTED" };
  }

  return { state: "BLOCKED", blockedReason: "Seller state could not be classified from current signals and needs manual review" };
};

/** True when a seller is eligible for invitation right now. The single source bulk invite, per-record actions, and stat tiles all call through to. */
export const isEligibleForInvitation = (record: QueueStateInput): boolean => resolveQueueState(record).state === "INVITATION_READY";

const EMPTY_METRICS: AcquisitionMetrics = {
  totalCaptured: 0,
  needsReview: 0,
  phoneReady: 0,
  invitationReady: 0,
  invitationPending: 0,
  waitingClaim: 0,
  claimed: 0,
  readyConversion: 0,
  converted: 0,
  blocked: 0,
  totalCampaignMembers: 0,
};

const QUEUE_STATE_TO_METRIC_KEY: Readonly<Record<QueueState, keyof AcquisitionMetrics>> = {
  REVIEW: "needsReview",
  PHONE_READY: "phoneReady",
  INVITATION_READY: "invitationReady",
  INVITATION_PENDING: "invitationPending",
  WAITING_CLAIM: "waitingClaim",
  CLAIMED: "claimed",
  READY_CONVERSION: "readyConversion",
  CONVERTED: "converted",
  BLOCKED: "blocked",
};

/**
 * Aggregates a list of sellers into `AcquisitionMetrics` in a single pass:
 * classify each seller once with `resolveQueueState`, increment its bucket.
 * Pure and synchronous -- safe to call from a client component the same way
 * `resolveQueueState` itself is, with no risk of a second, competing
 * calculation appearing anywhere else.
 */
export const calculateAcquisitionMetrics = (
  records: readonly QueueStateInput[],
  totalCampaignMembers = 0,
): AcquisitionMetrics => {
  const metrics: { -readonly [K in keyof AcquisitionMetrics]: number } = { ...EMPTY_METRICS };
  metrics.totalCaptured = records.length;
  metrics.totalCampaignMembers = totalCampaignMembers;

  for (const record of records) {
    const { state } = resolveQueueState(record);
    metrics[QUEUE_STATE_TO_METRIC_KEY[state]] += 1;
  }

  return metrics;
};

const provenance = (): MetricsProvenance => ({
  generatedAt: new Date().toISOString(),
  source: "AcquisitionMetricsService",
  version: 1,
});

const debugLogMetrics = (metrics: AcquisitionMetrics): void => {
  if (process.env.NODE_ENV === "production") return;
  // eslint-disable-next-line no-console -- intentional dev-only diagnostic, see module docs
  console.debug("[Metrics]", metrics);
};

export interface AcquisitionMetricsDependencies {
  readonly sellerAcquisitionRecords: SellerAcquisitionRecordService;
  readonly sellerAcquisitionCampaigns?: SellerAcquisitionCampaignService | undefined;
}

const PAGE_SIZE = 100;

/**
 * The single authoritative source of acquisition statistics. No other
 * service, route, or component computes acquisition metrics -- they call
 * one of the public methods below.
 */
export class AcquisitionMetricsService {
  constructor(private readonly deps: AcquisitionMetricsDependencies) {}

  /** Global acquisition metrics across every captured seller. Backs the Dashboard and the global Workbench. */
  async getGlobalMetrics(context: TenantScoped): Promise<DashboardMetrics> {
    const records = await this.listAllRecords(context);
    const metrics = calculateAcquisitionMetrics(records);
    debugLogMetrics(metrics);
    return metrics;
  }

  /** Metrics scoped to one campaign's membership. Backs the Campaign summary card and the campaign Workbench. */
  async getCampaignMetrics(context: TenantScoped, campaignId: string): Promise<CampaignMetrics> {
    const [records, totalCampaignMembers, campaignName] = await Promise.all([
      this.listAllRecords(context, campaignId),
      this.deps.sellerAcquisitionCampaigns?.countMembers(context, campaignId) ?? Promise.resolve(0),
      this.resolveCampaignName(context, campaignId),
    ]);
    const metrics = calculateAcquisitionMetrics(records, totalCampaignMembers);
    debugLogMetrics(metrics);
    return { ...metrics, campaignId, campaignName };
  }

  /** The count of sellers eligible for invitation right now -- the single source for Bulk Invite eligibility. */
  async getEligibleInvitationCount(context: TenantScoped, campaignId?: string): Promise<number> {
    const records = campaignId === undefined ? await this.listAllRecords(context) : await this.listAllRecords(context, campaignId);
    return records.filter(isEligibleForInvitation).length;
  }

  /** Same shape as `getGlobalMetrics` / `getCampaignMetrics`, named for queue-focused consumers (Workbench queue tiles). */
  async getQueueSummary(context: TenantScoped, campaignId?: string): Promise<QueueMetrics> {
    return campaignId === undefined ? this.getGlobalMetrics(context) : this.getCampaignMetrics(context, campaignId);
  }

  private async resolveCampaignName(context: TenantScoped, campaignId: string): Promise<string> {
    const campaign = await this.deps.sellerAcquisitionCampaigns?.findById(context, campaignId);
    return campaign?.name ?? "Unknown campaign";
  }

  private async listAllRecords(context: TenantScoped, campaignId?: string): Promise<readonly SellerAcquisitionRecord[]> {
    const records: SellerAcquisitionRecord[] = [];
    let cursor: string | undefined;
    do {
      const page = campaignId === undefined
        ? await this.deps.sellerAcquisitionRecords.list(context, cursor === undefined ? { limit: PAGE_SIZE } : { limit: PAGE_SIZE, cursor })
        : await this.deps.sellerAcquisitionRecords.listByCampaignId(context, campaignId, cursor === undefined ? { limit: PAGE_SIZE } : { limit: PAGE_SIZE, cursor });
      records.push(...page.records);
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    return records;
  }
}

export const withMetricsProvenance = <T>(metrics: T): MetricsEnvelope<T> => ({ metrics, provenance: provenance() });
