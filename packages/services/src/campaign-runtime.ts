import type { CampaignRuntimeWorker } from "@whisperm/campaign-runtime";
import type {
  AuditLogRepository,
  BusinessGrowthOpportunityRecord,
  CampaignRuntimeExecutionRecord,
  CampaignRuntimeExecutionRepository,
  CampaignRuntimeExecutionTrigger,
  DealRecord,
  DealsRepository,
  PageRequest,
  SellerAcquisitionCampaignMemberRecord,
  SellerAcquisitionCampaignRecord,
  SellerAcquisitionCampaignRepository,
  SellerInvitationRepository,
  BusinessGrowthOpportunityRepository,
} from "@whisperm/repositories";
import { PersistenceError } from "@whisperm/repositories";
import type { CorrelationMetadata, TenantScoped } from "@whisperm/types";
import { recordUsageEventBestEffort, type AcquisitionUsageMeteringService } from "./acquisition-usage-metering.js";
import { DiscoveryOptimizationWorker } from "./marketplace-acquisition/discovery-optimization-worker.js";
import {
  GrowthLoopWorker,
  type GrowthLoopTrigger,
  type GrowthProviderPerformance,
  type GrowthRecommendation,
  type GrowthSignalSnapshot,
} from "./marketplace-acquisition/growth-loop-worker.js";
import { validateCampaignTargeting, targetingFromCampaignMetadata, mergeCampaignTargetingMetadata, campaignTargetingConfigSchema } from "./campaign-targeting.js";
import {
  CAMPAIGN_MEMBER_CLAIMED_STATUSES,
  CAMPAIGN_MEMBER_INVITED_STATUSES,
  CAMPAIGN_MEMBER_QUALIFIED_STATUSES,
} from "./acquisition-metrics.js";

export interface StartCampaignExecutionInput {
  readonly campaignId: string;
  readonly trigger?: CampaignRuntimeExecutionTrigger | undefined;
}

export interface ExecuteInvitationInput {
  readonly campaignId: string;
  readonly opportunityId: string;
  readonly invitationId?: string | undefined;
  readonly preferredChannel?: "WHATSAPP" | "SMS" | "EMAIL" | undefined;
  readonly initiatedBy?: string | undefined;
  readonly correlationId?: string | undefined;
}

export interface CampaignRuntimeDiscoveryQueue {
  enqueueDiscovery(input: {
    readonly tenantId: string;
    readonly campaignId: string;
    readonly executionId: string;
    readonly correlationId?: string | undefined;
    readonly replaySafe: true;
    readonly targeting: import("./campaign-targeting.js").CampaignTargetingConfig;
  }): Promise<void> | void;
}

export interface CampaignRuntimeQualificationQueue {
  enqueueQualification(input: {
    readonly tenantId: string;
    readonly campaignId: string;
    readonly executionId: string;
    readonly correlationId?: string | undefined;
    readonly replaySafe: true;
  }): Promise<void> | void;
}

export interface CampaignRuntimeOptimizationQueue {
  enqueueOptimization(input: {
    readonly tenantId: string;
    readonly campaignId: string;
    readonly executionId: string;
    readonly correlationId?: string | undefined;
    readonly replaySafe: true;
  }): Promise<void> | void;
}

export interface CampaignRuntimeGrowthLoopQueue {
  enqueueGrowthLoopEvaluation(input: {
    readonly tenantId: string;
    readonly campaignId: string;
    readonly trigger: GrowthLoopTrigger;
    readonly correlationId?: string | undefined;
    readonly replaySafe: true;
  }): Promise<void> | void;
}

export interface CampaignRuntimeInvitationQueue {
  enqueueInvitation(input: {
    readonly tenantId: string;
    readonly campaignId: string;
    readonly opportunityId: string;
    readonly executionId: string;
    readonly invitationId?: string | undefined;
    readonly preferredChannel?: "WHATSAPP" | "SMS" | "EMAIL" | undefined;
    readonly correlationId?: string | undefined;
    readonly delayMs?: number | undefined;
    /**
     * ST1-013M: distinguishes a scheduled retry from the original dispatch job so a canonical
     * queue producer can give each attempt its own idempotency key (e.g.
     * `{executionId}:retry:{attempt}`) instead of colliding with the still-ACTIVE original job's
     * key -- which would make the retry enqueue silently return the original row instead of
     * creating a new one. Omitted for the initial dispatch.
     */
    readonly attempt?: number | undefined;
    readonly replaySafe: true;
  }): Promise<void> | void;
}

/**
 * ST-003: golden-path invitation dispatch. When configured, `executeInvitation` calls this
 * synchronously instead of only enqueueing a job, so a customer-visible invite request completes
 * (or fails) within the same request rather than depending on a queue worker that may never run.
 */
export interface CampaignRuntimeInvitationExecutor {
  sendInvitation(
    context: { readonly tenantId: string; readonly correlation: CorrelationMetadata },
    input: { readonly tenantId: string; readonly captureId: string; readonly channel: "WHATSAPP" | "SMS" | "EMAIL" },
  ): Promise<{ readonly invitationId: string; readonly status: string; readonly provider?: string | undefined }>;
}


export interface RecordDiscoveryResultInput {
  readonly executionId: string;
  readonly status: "COMPLETED" | "FAILED";
  readonly discoveredCount?: number | undefined;
  readonly capturedCount?: number | undefined;
  readonly skippedDuplicateCount?: number | undefined;
  readonly errorCode?: string | undefined;
  readonly errorMessage?: string | undefined;
}

export interface RecordQualificationResultInput {
  readonly executionId: string;
  readonly status: "COMPLETED" | "FAILED";
  readonly qualifiedCount?: number | undefined;
  readonly disqualifiedCount?: number | undefined;
  readonly needsReviewCount?: number | undefined;
  readonly skippedDuplicateCount?: number | undefined;
  readonly failedCount?: number | undefined;
  readonly errorCode?: string | undefined;
  readonly errorMessage?: string | undefined;
}

export interface RecordInvitationResultInput {
  readonly executionId: string;
  readonly opportunityId?: string | undefined;
  readonly invitationId?: string | undefined;
  readonly status: string;
  readonly channel: "WHATSAPP" | "SMS" | "EMAIL";
  readonly provider?: string | undefined;
  readonly errorCode?: string | undefined;
  readonly errorMessage?: string | undefined;
  readonly retryable?: boolean | undefined;
  readonly maxRetries?: number | undefined;
}

const deliveredStatuses = new Set(["SENT", "DELIVERED", "COMPLETED"]);
const retryableStates = new Set(["FAILED", "DEAD_LETTERED", "RETRY_SCHEDULED"]);
const defaultInvitationMaxRetries = 3;
const invitationBackoffMs = [5 * 60_000, 30 * 60_000, 2 * 60 * 60_000] as const;
const invitationChannels = ["WHATSAPP", "SMS", "EMAIL"] as const;
type InvitationChannel = typeof invitationChannels[number];

interface InvitationOptimizationStrategy {
  readonly selectedChannel: InvitationChannel;
  readonly selectedProvider: string;
  readonly recommendedSendTime: string;
  readonly retryScheduleMs: readonly number[];
  readonly maxRetries: number;
  readonly shouldDelay: boolean;
  readonly shouldSkip: boolean;
  readonly shouldEscalate: boolean;
  readonly confidence: number;
  readonly reason: string;
  readonly suppressionReason?: string | undefined;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);
const stringValue = (value: unknown): string | undefined => typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const round4 = (value: number): number => Number(value.toFixed(4));
const numeric = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};
const numericOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const result = numeric(value);
  return Number.isFinite(result) ? result : null;
};
const numberMetric = (metrics: Readonly<Record<string, unknown>>, key: string): number => {
  const value = metrics[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};
const asGrowthRecommendations = (metadata: unknown): readonly GrowthRecommendation[] => {
  const value = isRecord(metadata) ? metadata.growthRecommendations : undefined;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.type !== "string" || typeof item.status !== "string") return [];
    return [item as unknown as GrowthRecommendation];
  });
};
const growthRecommendationSignature = (recommendation: GrowthRecommendation): string => JSON.stringify(recommendation.supportingMetrics ?? {});

const mergeGrowthRecommendations = (existing: readonly GrowthRecommendation[], computed: readonly GrowthRecommendation[]): readonly GrowthRecommendation[] => {
  const computedById = new Map(computed.map((item) => [item.id, item]));
  const merged: GrowthRecommendation[] = [];
  const consumed = new Set<string>();
  for (const item of existing) {
    if (item.status === "APPLIED") {
      merged.push(item);
      consumed.add(item.id);
      continue;
    }
    if (item.status === "DISMISSED") {
      const next = computedById.get(item.id);
      if (next === undefined || growthRecommendationSignature(next) === growthRecommendationSignature(item)) {
        merged.push(item);
      } else {
        merged.push(next);
      }
      consumed.add(item.id);
    }
  }
  for (const item of computed) {
    if (!consumed.has(item.id)) merged.push(item);
  }
  return merged;
};

const aggregateExecutionSignal = (executions: readonly CampaignRuntimeExecutionRecord[]): { readonly duplicateRate: number | null; readonly qualificationYield: number | null } => {
  let discovered = 0;
  let captured = 0;
  let duplicate = 0;
  let qualified = 0;
  let judged = 0;
  for (const execution of executions) {
    const metrics = execution.metrics ?? {};
    discovered += numberMetric(metrics, "discoveredCount");
    captured += numberMetric(metrics, "capturedCount");
    duplicate += numberMetric(metrics, "skippedDuplicateCount");
    qualified += numberMetric(metrics, "qualifiedCount");
    judged += numberMetric(metrics, "qualifiedCount") + numberMetric(metrics, "disqualifiedCount") + numberMetric(metrics, "needsReviewCount");
  }
  return {
    duplicateRate: discovered > 0 ? round4(duplicate / discovered) : captured + duplicate > 0 ? round4(duplicate / (captured + duplicate)) : null,
    qualificationYield: judged > 0 ? round4(qualified / judged) : null,
  };
};

const buildProviderPerformance = (
  opportunities: readonly BusinessGrowthOpportunityRecord[],
  dealById: ReadonlyMap<string, DealRecord>,
): readonly GrowthProviderPerformance[] => {
  const groups = new Map<string, { wonDealsCount: number; attributedRevenue: number; memberCount: number }>();
  for (const opportunity of opportunities) {
    const key = opportunity.sourceKey ?? opportunity.sourceType ?? "UNKNOWN";
    const current = groups.get(key) ?? { wonDealsCount: 0, attributedRevenue: 0, memberCount: 0 };
    current.memberCount += 1;
    const deal = opportunity.dealId == null ? undefined : dealById.get(opportunity.dealId);
    if (deal !== undefined && deal.closedAt != null) {
      current.wonDealsCount += 1;
      current.attributedRevenue += numeric(deal.value);
    }
    groups.set(key, current);
  }
  return [...groups.entries()].map(([key, value]) => ({ key, wonDealsCount: value.wonDealsCount, attributedRevenue: round4(value.attributedRevenue), memberCount: value.memberCount }));
};

const MAX_GROWTH_SIGNAL_ITEMS = 500;
const configuredChannels = (metadata: unknown): readonly InvitationChannel[] => {
  const raw = isRecord(metadata) ? metadata.invitationChannels ?? metadata.availableInvitationChannels : undefined;
  if (!Array.isArray(raw)) return invitationChannels;
  const channels = raw.filter((item): item is InvitationChannel => invitationChannels.includes(item as InvitationChannel));
  return channels.length > 0 ? channels : invitationChannels;
};

const providerHealthPenalty = (metadata: unknown, channel: InvitationChannel): number => {
  const health = isRecord(metadata) && isRecord(metadata.providerHealth) ? stringValue(metadata.providerHealth[channel])?.toUpperCase() : undefined;
  if (health === "UNHEALTHY" || health === "DOWN") return 60;
  if (health === "DEGRADED" || health === "RATE_LIMITED") return 25;
  return 0;
};

const scoreChannel = (channel: InvitationChannel, invitations: readonly { readonly channel: string; readonly status: string; readonly metadata?: unknown }[], campaignMetadata: unknown): number => {
  const base = channel === "WHATSAPP" ? 30 : channel === "SMS" ? 20 : 10;
  const healthPenalty = providerHealthPenalty(campaignMetadata, channel);
  const history = invitations.filter((invitation) => invitation.channel === channel);
  const successes = history.filter((invitation) => invitation.status === "SENT" || invitation.status === "OPENED" || (isRecord(invitation.metadata) && invitation.metadata.providerOutcome === "DELIVERED")).length;
  const failures = history.filter((invitation) => invitation.status === "FAILED" || (isRecord(invitation.metadata) && (invitation.metadata.providerOutcome === "PROVIDER_FAILED" || invitation.metadata.failureCode !== undefined))).length;
  return base + successes * 35 - failures * 30 - healthPenalty;
};

const buildInvitationOptimizationStrategy = (input: {
  readonly preferredChannel?: InvitationChannel | undefined;
  readonly campaignMetadata: unknown;
  readonly invitations: readonly { readonly channel: string; readonly status: string; readonly metadata?: unknown }[];
  readonly now: Date;
}): InvitationOptimizationStrategy => {
  const alreadyConverted = input.invitations.some((invitation) => isRecord(invitation.metadata) && (invitation.metadata.claimedAt !== undefined || invitation.metadata.conversionStatus === "CONVERTED"));
  const activeDuplicate = input.invitations.some((invitation) => invitation.status === "SENT" || invitation.status === "OPENED");
  const available = configuredChannels(input.campaignMetadata);
  const preferred = input.preferredChannel !== undefined && available.includes(input.preferredChannel) ? input.preferredChannel : undefined;
  const ranked = [...available].sort((a, b) => scoreChannel(b, input.invitations, input.campaignMetadata) - scoreChannel(a, input.invitations, input.campaignMetadata));
  const selectedChannel = preferred ?? ranked[0] ?? "WHATSAPP";
  const selectedProvider = stringValue(isRecord(input.campaignMetadata) && isRecord(input.campaignMetadata.invitationProviders) ? input.campaignMetadata.invitationProviders[selectedChannel] : undefined) ?? selectedChannel;
  const unhealthy = providerHealthPenalty(input.campaignMetadata, selectedChannel) >= 60;
  const retryScheduleMs = unhealthy ? [30 * 60_000, 2 * 60 * 60_000] : invitationBackoffMs;
  const maxRetries = unhealthy ? 2 : defaultInvitationMaxRetries;
  const shouldSkip = alreadyConverted || activeDuplicate;
  const reason = shouldSkip
    ? alreadyConverted ? "Relationship memory shows seller already converted; invitation suppressed." : "Relationship memory shows an active prior invitation; duplicate suppressed."
    : preferred !== undefined ? "Campaign/runtime preferred channel is available and governed by provider health."
    : "Selected from relationship delivery history, provider health, and campaign configuration.";
  return {
    selectedChannel,
    selectedProvider,
    recommendedSendTime: input.now.toISOString(),
    retryScheduleMs,
    maxRetries,
    shouldDelay: unhealthy && !shouldSkip,
    shouldSkip,
    shouldEscalate: ranked.length > 1 && providerHealthPenalty(input.campaignMetadata, ranked[0] ?? selectedChannel) >= 60,
    confidence: Math.max(0.25, Math.min(0.95, (scoreChannel(selectedChannel, input.invitations, input.campaignMetadata) + 70) / 140)),
    reason,
    ...(shouldSkip ? { suppressionReason: alreadyConverted ? "SELLER_ALREADY_CONVERTED" : "DUPLICATE_INVITATION_PREVENTED" } : {}),
  };
};

export const nextInvitationRetryAt = (retryCount: number, now: Date = new Date()): string => {
  const index = Math.max(0, Math.min(retryCount - 1, invitationBackoffMs.length - 1));
  return new Date(now.getTime() + (invitationBackoffMs[index] ?? 7_200_000)).toISOString();
};

export interface RunDueScheduledCampaignsInput {
  readonly now?: Date | undefined;
  readonly limit?: number | undefined;
}

export interface RunDueScheduledCampaignsResult {
  readonly started: number;
  readonly skipped: number;
}

export interface CampaignRuntimeServiceDependencies {
  readonly campaigns: SellerAcquisitionCampaignRepository;
  readonly executions: CampaignRuntimeExecutionRepository;
  readonly worker?: CampaignRuntimeWorker | undefined;
  readonly invitationQueue?: CampaignRuntimeInvitationQueue | undefined;
  readonly invitationExecutor?: CampaignRuntimeInvitationExecutor | undefined;
  readonly discoveryQueue?: CampaignRuntimeDiscoveryQueue | undefined;
  readonly qualificationQueue?: CampaignRuntimeQualificationQueue | undefined;
  readonly optimizationQueue?: CampaignRuntimeOptimizationQueue | undefined;
  readonly optimizationWorker?: DiscoveryOptimizationWorker | undefined;
  readonly sellerInvitations?: SellerInvitationRepository | undefined;
  readonly opportunities?: BusinessGrowthOpportunityRepository | undefined;
  readonly deals?: Pick<DealsRepository, "findById"> | undefined;
  readonly auditLogs?: AuditLogRepository | undefined;
  readonly growthLoopWorker?: GrowthLoopWorker | undefined;
  readonly growthLoopQueue?: CampaignRuntimeGrowthLoopQueue | undefined;
  /** CS-023: best-effort billable-usage recording; never blocks runtime execution on failure. */
  readonly usageMetering?: Pick<AcquisitionUsageMeteringService, "recordUsageEvent"> | undefined;
}

const activeStatuses = new Set(["QUEUED", "RUNNING"]);

const nextRunAtForCadence = (from: Date, cadence: string | null | undefined): string | null => {
  const next = new Date(from.getTime());
  if (cadence === "HOURLY") next.setUTCHours(next.getUTCHours() + 1);
  else if (cadence === "DAILY") next.setUTCDate(next.getUTCDate() + 1);
  else if (cadence === "WEEKLY") next.setUTCDate(next.getUTCDate() + 7);
  else return null;
  return next.toISOString();
};

const sanitizeErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Campaign runtime worker failed";
  return message
  .replace(
    /(token|secret|password|authorization|api[_-]?key)=[^\s&]+/giu,
    (_match, key) => `${key}=[REDACTED]`,
  )
  .slice(0, 500);};

const errorCode = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String((error as { readonly code: unknown }).code).trim();
    if (code.length > 0) return code.slice(0, 100);
  }
  return "CAMPAIGN_RUNTIME_WORKER_FAILED";
};

export class CampaignRuntimeService {
  /**
   * ST1-012: no default. Every production call site enqueues discovery via `discoveryQueue`
   * instead; `worker` only exists for tests that want to exercise the inline execute()/catch
   * branch directly. Defaulting this to NoopCampaignRuntimeWorker used to make
   * startCampaignExecution silently report COMPLETED with `{ noop: true }` metrics whenever no
   * discoveryQueue was configured -- see the ST1-012 "no worker configured" branch below.
   */
  private readonly worker: CampaignRuntimeWorker | undefined;
  private readonly optimizationWorker: DiscoveryOptimizationWorker;
  private readonly growthLoopWorker: GrowthLoopWorker;

  constructor(private readonly deps: CampaignRuntimeServiceDependencies) {
    this.worker = deps.worker;
    this.optimizationWorker = deps.optimizationWorker ?? new DiscoveryOptimizationWorker();
    this.growthLoopWorker = deps.growthLoopWorker ?? new GrowthLoopWorker();
  }

  async executeInvitation(context: TenantScoped, input: ExecuteInvitationInput): Promise<CampaignRuntimeExecutionRecord> {
    const campaign = await this.deps.campaigns.findById(context, input.campaignId);
    if (campaign === null) {
      throw new PersistenceError({ code: "PERSISTENCE_NOT_FOUND", message: "Seller acquisition campaign not found", status: 404 });
    }

    const opportunity = await this.deps.opportunities?.findByMarketplaceCaptureId(context, input.opportunityId) ?? await this.deps.opportunities?.findByDiscoveredSellerId(context, input.opportunityId) ?? null;
    if (opportunity !== null && opportunity.qualificationStatus !== "QUALIFIED" && opportunity.status !== "QUALIFIED") {
      throw new PersistenceError({ code: "PERSISTENCE_VALIDATION_FAILED", message: "Seller acquisition record is not qualified for invitation", status: 422 });
    }

    const priorInvitations = await this.deps.sellerInvitations?.listSellerInvitationsByMarketplaceCaptureId(context, input.opportunityId) ?? [];
    const strategy = buildInvitationOptimizationStrategy({
      preferredChannel: input.preferredChannel,
      campaignMetadata: campaign.metadata,
      invitations: priorInvitations,
      now: new Date(),
    });

    const execution = await this.deps.executions.create(context, {
      tenantId: context.tenantId,
      campaignId: input.campaignId,
      trigger: "MANUAL",
      status: strategy.shouldSkip ? "COMPLETED" : "QUEUED",
      completedAt: strategy.shouldSkip ? strategy.recommendedSendTime : undefined,
      metrics: {
        invitationExecutionState: strategy.shouldSkip ? "SUPPRESSED" : "PENDING",
        opportunityId: input.opportunityId,
        invitationId: input.invitationId ?? null,
        initiatedBy: input.initiatedBy ?? null,
        retryCount: 0,
        maxRetries: strategy.maxRetries,
        selectedStrategy: "RELATIONSHIP_RUNTIME_OPTIMIZED",
        selectedChannel: strategy.selectedChannel,
        selectedProvider: strategy.selectedProvider,
        recommendedSendTime: strategy.recommendedSendTime,
        retryStrategy: { intervalsMs: strategy.retryScheduleMs, maxRetries: strategy.maxRetries, providerFailover: strategy.shouldEscalate },
        optimizationReason: strategy.reason,
        optimizationConfidence: strategy.confidence,
        shouldDelayInvitation: strategy.shouldDelay,
        shouldEscalateInvitation: strategy.shouldEscalate,
        suppressionReason: strategy.suppressionReason ?? null,
      },
    });

    if (strategy.shouldSkip) return execution;

    if (this.deps.invitationExecutor !== undefined) {
      await this.deps.executions.update(context, execution.id, {
        status: "RUNNING",
        metrics: { ...(execution.metrics ?? {}), invitationExecutionState: "DISPATCHED", dispatchedAt: new Date().toISOString() },
      });
      return this.dispatchInvitationInline(context, {
        executionId: execution.id,
        opportunityId: input.opportunityId,
        channel: strategy.selectedChannel,
        invitationId: input.invitationId,
        correlationId: input.correlationId,
      });
    }

    await this.deps.invitationQueue?.enqueueInvitation({
      tenantId: context.tenantId,
      campaignId: input.campaignId,
      opportunityId: input.opportunityId,
      executionId: execution.id,
      invitationId: input.invitationId,
      preferredChannel: strategy.selectedChannel,
      correlationId: input.correlationId,
      replaySafe: true,
    });

    return this.deps.executions.update(context, execution.id, {
      status: "RUNNING",
      metrics: {
        ...(execution.metrics ?? {}),
        invitationExecutionState: "DISPATCHED",
        dispatchedAt: new Date().toISOString(),
      },
    });
  }

  async startCampaignExecution(context: TenantScoped, input: StartCampaignExecutionInput): Promise<CampaignRuntimeExecutionRecord> {
    const campaign = await this.deps.campaigns.findById(context, input.campaignId);
    if (campaign === null) {
      throw new PersistenceError({ code: "PERSISTENCE_NOT_FOUND", message: "Seller acquisition campaign not found", status: 404 });
    }

    const active = await this.deps.executions.findActiveByCampaignId(context, input.campaignId);
    if (active !== null && activeStatuses.has(active.status)) {
      throw new PersistenceError({ code: "PERSISTENCE_CONFLICT", message: "Campaign runtime execution is already active", status: 409 });
    }

    const targetingValidation = validateCampaignTargeting(campaign.metadata);
    const targetingMetrics = {
      targetingStatus: targetingValidation.status,
      targetingSnapshot: targetingValidation.targeting ?? null,
      targetingFailureReason: targetingValidation.failureReason ?? null,
    };

    const execution = await this.deps.executions.create(context, {
      tenantId: context.tenantId,
      campaignId: input.campaignId,
      trigger: input.trigger ?? "MANUAL",
      status: targetingValidation.status === "VALID" ? "QUEUED" : "FAILED",
      failedAt: targetingValidation.status === "VALID" ? undefined : new Date().toISOString(),
      errorCode: targetingValidation.status === "VALID" ? undefined : "CAMPAIGN_TARGETING_INVALID",
      errorMessage: targetingValidation.failureReason,
      metrics: targetingMetrics,
    });

    if (targetingValidation.status !== "VALID" || targetingValidation.targeting === undefined) {
      return execution;
    }

    const running = await this.deps.executions.update(context, execution.id, { status: "RUNNING", startedAt: new Date().toISOString(), metrics: { ...targetingMetrics, discoveryStatus: "PENDING", discoveredCount: 0, capturedCount: 0, skippedDuplicateCount: 0 } });

    if (this.deps.discoveryQueue !== undefined) {
      await this.deps.discoveryQueue.enqueueDiscovery({
        tenantId: context.tenantId,
        campaignId: input.campaignId,
        executionId: running.id,
        replaySafe: true,
        targeting: targetingValidation.targeting,
      });
      return this.deps.executions.update(context, running.id, {
        status: "RUNNING",
        metrics: { ...(running.metrics ?? {}), discoveryStatus: "RUNNING", discoveryStartedAt: running.startedAt ?? new Date().toISOString(), targetingSnapshot: targetingValidation.targeting },
      });
    }

    if (this.worker === undefined) {
      // ST1-012: no discoveryQueue and no explicit worker configured. Autonomous discovery
      // execution is not a supported V1 production path (there is no real queue consumer wired
      // in apps/worker) -- fail honestly instead of silently reporting COMPLETED for work that
      // never ran.
      return this.deps.executions.update(context, running.id, {
        status: "FAILED",
        failedAt: new Date().toISOString(),
        errorCode: "CAMPAIGN_RUNTIME_DISCOVERY_NOT_CONFIGURED",
        errorMessage: "Autonomous discovery execution is not configured for this environment.",
        metrics: { ...(running.metrics ?? {}), discoveryStatus: "UNSUPPORTED" },
      });
    }

    try {
      const result = await this.worker.execute({
        tenantId: context.tenantId,
        campaignId: input.campaignId,
        executionId: running.id,
        trigger: running.trigger,
        targeting: targetingValidation.targeting,
      });
      if (result.status === "FAILED") {
        return this.deps.executions.update(context, running.id, {
          status: "FAILED",
          failedAt: new Date().toISOString(),
          errorCode: result.errorCode ?? "CAMPAIGN_RUNTIME_WORKER_FAILED",
          errorMessage: result.errorMessage?.slice(0, 500) ?? "Campaign runtime worker failed",
          metrics: result.metrics,
        });
      }
      return this.deps.executions.update(context, running.id, {
        status: "COMPLETED",
        completedAt: new Date().toISOString(),
        metrics: result.metrics,
      });
    } catch (error) {
      return this.deps.executions.update(context, running.id, {
        status: "FAILED",
        failedAt: new Date().toISOString(),
        errorCode: errorCode(error),
        errorMessage: sanitizeErrorMessage(error),
      });
    }
  }



  private async applyOptimization(context: TenantScoped, execution: CampaignRuntimeExecutionRecord, metrics: Readonly<Record<string, unknown>>): Promise<CampaignRuntimeExecutionRecord> {
    const now = new Date().toISOString();
    if (this.deps.optimizationQueue !== undefined) {
      await this.deps.optimizationQueue.enqueueOptimization({
        tenantId: context.tenantId,
        campaignId: execution.campaignId,
        executionId: execution.id,
        correlationId: typeof (context as { readonly correlation?: { readonly correlationId?: unknown } }).correlation?.correlationId === "string" ? (context as { readonly correlation?: { readonly correlationId?: string } }).correlation?.correlationId : execution.id,
        replaySafe: true,
      });
      return this.deps.executions.update(context, execution.id, {
        metrics: { ...metrics, optimizationStatus: "QUEUED", optimizationQueuedAt: now },
      });
    }

    try {
      const campaign = await this.deps.campaigns.findById(context, execution.campaignId);
      if (campaign === null) throw new PersistenceError({ code: "PERSISTENCE_NOT_FOUND", message: "Seller acquisition campaign not found", status: 404 });
      const optimizedExecution = { ...execution, metrics };
      const result = await this.optimizationWorker.analyze({ context, campaign, execution: optimizedExecution });
      return this.deps.executions.update(context, execution.id, {
        metrics: {
          ...metrics,
          optimizationStatus: result.optimizationStatus,
          lastOptimizedAt: result.lastOptimizedAt,
          optimizationRecommendations: result.recommendations,
        },
      });
    } catch (error) {
      return this.deps.executions.update(context, execution.id, {
        metrics: {
          ...metrics,
          optimizationStatus: "FAILED",
          optimizationFailedAt: now,
          optimizationFailureCode: errorCode(error),
          optimizationFailureMessage: sanitizeErrorMessage(error),
        },
      });
    }
  }

  async recordOptimizationResult(context: TenantScoped, executionId: string): Promise<CampaignRuntimeExecutionRecord> {
    const existing = await this.deps.executions.findById(context, executionId);
    if (existing === null) throw new PersistenceError({ code: "PERSISTENCE_NOT_FOUND", message: "Campaign runtime execution not found", status: 404 });
    return this.applyOptimization(context, existing, existing.metrics ?? {});
  }

  async runDueScheduledCampaigns(context: TenantScoped, input: RunDueScheduledCampaignsInput = {}): Promise<RunDueScheduledCampaignsResult> {
    const now = input.now ?? new Date();
    const due = await this.deps.campaigns.listDueScheduled(context, now.toISOString(), { limit: input.limit ?? 50 });
    let started = 0;
    let skipped = 0;

    for (const campaign of due.items) {
      try {
        await this.startCampaignExecution(context, { campaignId: campaign.id, trigger: "SCHEDULED" });
        started += 1;
        await this.deps.campaigns.update(context, campaign.id, {
          lastRunAt: now.toISOString(),
          nextRunAt: nextRunAtForCadence(now, campaign.scheduleCadence),
        });
      } catch (error) {
        if (error instanceof PersistenceError && error.status === 409) {
          skipped += 1;
          continue;
        }
        throw error;
      }
    }

    return { started, skipped };
  }

  async recordDiscoveryResult(context: TenantScoped, input: RecordDiscoveryResultInput): Promise<CampaignRuntimeExecutionRecord> {
    const existing = await this.deps.executions.findById(context, input.executionId);
    if (existing === null) {
      throw new PersistenceError({ code: "PERSISTENCE_NOT_FOUND", message: "Campaign runtime execution not found", status: 404 });
    }
    const now = new Date().toISOString();
    const baseMetrics = existing.metrics ?? {};
    if (input.status === "COMPLETED") {
      const updated = await this.deps.executions.update(context, input.executionId, {
        status: this.deps.qualificationQueue === undefined ? "COMPLETED" : "RUNNING",
        completedAt: this.deps.qualificationQueue === undefined ? now : null,
        metrics: {
          ...baseMetrics,
          discoveryStatus: "COMPLETED",
          discoveryCompletedAt: now,
          discoveredCount: input.discoveredCount ?? 0,
          capturedCount: input.capturedCount ?? 0,
          skippedDuplicateCount: input.skippedDuplicateCount ?? 0,
          qualificationStatus: this.deps.qualificationQueue === undefined ? "SKIPPED" : "RUNNING",
          qualificationStartedAt: this.deps.qualificationQueue === undefined ? undefined : now,
        },
      });
      if (this.deps.qualificationQueue !== undefined) {
        await this.deps.qualificationQueue.enqueueQualification({ tenantId: context.tenantId, campaignId: existing.campaignId, executionId: input.executionId, correlationId: typeof (context as { readonly correlation?: { readonly correlationId?: unknown } }).correlation?.correlationId === "string" ? (context as { readonly correlation?: { readonly correlationId?: string } }).correlation?.correlationId : input.executionId, replaySafe: true });
      }
      return updated;
    }
    const safeMessage = input.errorMessage === undefined ? "Discovery execution failed" : sanitizeErrorMessage(input.errorMessage);
    const failed = await this.deps.executions.update(context, input.executionId, {
      status: "FAILED",
      failedAt: now,
      errorCode: input.errorCode ?? "DISCOVERY_EXECUTION_FAILED",
      errorMessage: safeMessage,
      metrics: {
        ...baseMetrics,
        discoveryStatus: "FAILED",
        discoveryFailedAt: now,
        discoveredCount: input.discoveredCount ?? 0,
        capturedCount: input.capturedCount ?? 0,
        skippedDuplicateCount: input.skippedDuplicateCount ?? 0,
        failureCategory: input.errorCode,
        failureCode: input.errorCode,
        failureMessage: safeMessage,
      },
    });
    return this.applyOptimization(context, failed, failed.metrics ?? {});
  }

  async recordQualificationResult(context: TenantScoped, input: RecordQualificationResultInput): Promise<CampaignRuntimeExecutionRecord> {
    const existing = await this.deps.executions.findById(context, input.executionId);
    if (existing === null) throw new PersistenceError({ code: "PERSISTENCE_NOT_FOUND", message: "Campaign runtime execution not found", status: 404 });
    const now = new Date().toISOString();
    const safeMessage = input.errorMessage === undefined ? undefined : sanitizeErrorMessage(input.errorMessage);
    const updated = await this.deps.executions.update(context, input.executionId, {
      status: input.status === "COMPLETED" ? "COMPLETED" : "FAILED",
      completedAt: input.status === "COMPLETED" ? now : null,
      failedAt: input.status === "FAILED" ? now : null,
      errorCode: input.status === "FAILED" ? input.errorCode ?? "QUALIFICATION_EXECUTION_FAILED" : null,
      errorMessage: input.status === "FAILED" ? safeMessage ?? "Qualification execution failed" : null,
      metrics: {
        ...(existing.metrics ?? {}),
        qualificationStatus: input.status,
        qualificationCompletedAt: input.status === "COMPLETED" ? now : undefined,
        qualificationFailedAt: input.status === "FAILED" ? now : undefined,
        qualifiedCount: input.qualifiedCount ?? 0,
        disqualifiedCount: input.disqualifiedCount ?? 0,
        needsReviewCount: input.needsReviewCount ?? 0,
        skippedDuplicateCount: input.skippedDuplicateCount ?? existing.metrics?.skippedDuplicateCount ?? 0,
        qualificationFailedCount: input.failedCount ?? 0,
        qualificationFailureCode: input.status === "FAILED" ? input.errorCode ?? "QUALIFICATION_EXECUTION_FAILED" : undefined,
        qualificationFailureMessage: input.status === "FAILED" ? safeMessage ?? "Qualification execution failed" : undefined,
      },
    });

    const qualifiedCount = input.qualifiedCount ?? 0;
    if (input.status === "COMPLETED" && qualifiedCount > 0 && this.deps.usageMetering !== undefined) {
      await recordUsageEventBestEffort(this.deps.usageMetering, context, {
        eventType: "SELLER_QUALIFIED",
        quantity: qualifiedCount,
        campaignId: updated.campaignId,
        runtimeExecutionId: input.executionId,
        occurredAt: new Date(now),
        idempotencyKey: `usage:SELLER_QUALIFIED:${context.tenantId}:${input.executionId}`,
      });
    }

    return this.applyOptimization(context, updated, updated.metrics ?? {});
  }

  async recordInvitationResult(context: TenantScoped, input: RecordInvitationResultInput): Promise<CampaignRuntimeExecutionRecord> {
    const existing = await this.deps.executions.findById(context, input.executionId);
    if (existing === null) {
      throw new PersistenceError({ code: "PERSISTENCE_NOT_FOUND", message: "Campaign runtime execution not found", status: 404 });
    }
    const delivered = deliveredStatuses.has(input.status);
    const now = new Date().toISOString();
    const safeFailureMessage = input.errorMessage === undefined ? undefined : sanitizeErrorMessage(input.errorMessage);
    const metrics = {
      ...(existing.metrics ?? {}),
      invitationExecutionState: delivered ? "DELIVERED" : "FAILED",
      opportunityId: input.opportunityId ?? existing.metrics?.opportunityId ?? null,
      invitationId: input.invitationId ?? existing.metrics?.invitationId ?? null,
      channel: input.channel,
      provider: input.provider ?? input.channel,
      lastAttemptAt: now,
      lastAttemptedAt: now,
      ...(delivered
        ? { deliveredAt: now }
        : {
            failedAt: now,
            failureCode: input.errorCode ?? "INVITATION_DELIVERY_FAILED",
            failureMessage: safeFailureMessage ?? "Seller invitation worker failed",
            retryable: input.retryable ?? false,
          }),
    };

    const previousRetryCount = typeof existing.metrics?.retryCount === "number" ? existing.metrics.retryCount : 0;
    const maxRetries = input.maxRetries ?? (typeof existing.metrics?.maxRetries === "number" ? existing.metrics.maxRetries : defaultInvitationMaxRetries);
    const retryCount = delivered ? previousRetryCount : previousRetryCount + 1;
    const shouldScheduleRetry = !delivered && (input.retryable ?? false) && retryCount < maxRetries;
    const terminalFailure = !delivered && !shouldScheduleRetry;
    const retryStrategy = isRecord(existing.metrics?.retryStrategy) && Array.isArray(existing.metrics.retryStrategy.intervalsMs) ? existing.metrics.retryStrategy.intervalsMs : undefined;
    const optimizedDelay = retryStrategy?.[Math.max(0, retryCount - 1)];
    const nextRetryAt = shouldScheduleRetry ? (typeof optimizedDelay === "number" ? new Date(new Date(now).getTime() + optimizedDelay).toISOString() : nextInvitationRetryAt(retryCount, new Date(now))) : undefined;

    const finalMetrics = {
      ...metrics,
      retryCount,
      maxRetries,
      ...(shouldScheduleRetry ? { invitationExecutionState: "RETRY_SCHEDULED", nextRetryAt } : {}),
      ...(terminalFailure ? { invitationExecutionState: "DEAD_LETTERED", deadLetteredAt: now, nextRetryAt: null } : {}),
      ...(delivered ? { nextRetryAt: null, retryable: false } : {}),
    };

    if (shouldScheduleRetry && this.deps.invitationQueue !== undefined) {
      await this.deps.invitationQueue.enqueueInvitation({
        tenantId: context.tenantId,
        campaignId: existing.campaignId,
        opportunityId: String(finalMetrics.opportunityId),
        executionId: input.executionId,
        invitationId: input.invitationId ?? (typeof finalMetrics.invitationId === "string" ? finalMetrics.invitationId : undefined),
        preferredChannel: input.channel,
        correlationId: typeof (context as { readonly correlation?: { readonly correlationId?: unknown } }).correlation?.correlationId === "string" ? (context as { readonly correlation?: { readonly correlationId?: string } }).correlation?.correlationId : input.executionId,
        delayMs: Date.parse(nextRetryAt ?? now) - Date.parse(now),
        // ST1-013M: this execution's QueueJob row is still ACTIVE (the worker is mid-handler,
        // inside the catch branch that led here) when this fires for a worker-driven attempt --
        // an idempotency key shared with that row would make the retry enqueue return the
        // in-flight row instead of creating a new one, silently dropping the retry.
        attempt: retryCount,
        replaySafe: true,
      });
    }

    if (input.invitationId !== undefined && this.deps.sellerInvitations !== undefined) {
      await this.deps.sellerInvitations.update(context, input.invitationId, {
        status: delivered ? "SENT" : "FAILED",
        metadata: {
          ...finalMetrics,
          campaignRuntimeExecutionId: input.executionId,
          correlationId: typeof (context as { readonly correlation?: { readonly correlationId?: unknown } }).correlation?.correlationId === "string" ? (context as { readonly correlation?: { readonly correlationId?: string } }).correlation?.correlationId : null,
          channel: input.channel,
          provider: input.provider ?? input.channel,
          ...(delivered ? { deliveredAt: now } : { failedAt: now, failureCode: input.errorCode ?? "INVITATION_DELIVERY_FAILED", failureMessage: safeFailureMessage ?? "Seller invitation worker failed", retryable: input.retryable ?? false }),
        },
      });
    }

    const updatedExecution = await this.deps.executions.update(context, input.executionId, {
      status: delivered ? "COMPLETED" : shouldScheduleRetry ? "RUNNING" : "FAILED",
      completedAt: delivered ? now : null,
      failedAt: delivered || shouldScheduleRetry ? null : now,
      errorCode: delivered || shouldScheduleRetry ? null : input.errorCode ?? "INVITATION_DELIVERY_FAILED",
      errorMessage: delivered || shouldScheduleRetry ? null : safeFailureMessage ?? "Seller invitation worker failed",
      metrics: finalMetrics,
    });

    if (delivered && this.deps.usageMetering !== undefined) {
      await recordUsageEventBestEffort(this.deps.usageMetering, context, {
        eventType: "INVITATION_SENT",
        campaignId: existing.campaignId,
        captureId: typeof finalMetrics.opportunityId === "string" ? finalMetrics.opportunityId : undefined,
        runtimeExecutionId: input.executionId,
        occurredAt: new Date(now),
        idempotencyKey: `usage:INVITATION_SENT:${context.tenantId}:${input.executionId}`,
      });
    }

    return updatedExecution;
  }

  async retryInvitationExecution(context: TenantScoped, executionId: string): Promise<CampaignRuntimeExecutionRecord> {
    const existing = await this.deps.executions.findById(context, executionId);
    if (existing === null) throw new PersistenceError({ code: "PERSISTENCE_NOT_FOUND", message: "Campaign runtime execution not found", status: 404 });
    const state = typeof existing.metrics?.invitationExecutionState === "string" ? existing.metrics.invitationExecutionState : existing.status;
    if (!retryableStates.has(state)) throw new PersistenceError({ code: "PERSISTENCE_CONFLICT", message: "Invitation execution is not retryable", status: 409 });
    const opportunityId = typeof existing.metrics?.opportunityId === "string" ? existing.metrics.opportunityId : undefined;
    if (opportunityId === undefined) throw new PersistenceError({ code: "PERSISTENCE_VALIDATION_FAILED", message: "Invitation execution is missing opportunity context", status: 422 });
    // ST1-013M: retry must preserve the originally selected channel. `metrics.channel` is only
    // populated once a send attempt has actually completed (see recordInvitationResult above); an
    // execution that never reached that point (e.g. it was left RUNNING/DISPATCHED because the
    // async worker path was never drained -- see docs/runtime/runtime-surface.md) still has the
    // channel the optimization strategy picked at dispatch time in `metrics.selectedChannel`.
    // Falling through to that field (matching invitation-execution-response.ts and
    // acquisition-runtime-health.ts) prevents retry from silently defaulting to WhatsApp.
    const channelCandidate = existing.metrics?.channel ?? existing.metrics?.selectedChannel;
    const channel = invitationChannels.includes(String(channelCandidate) as InvitationChannel) ? channelCandidate as "WHATSAPP" | "SMS" | "EMAIL" : undefined;
    const invitationId = typeof existing.metrics?.invitationId === "string" ? existing.metrics.invitationId : undefined;

    if (this.deps.invitationExecutor !== undefined) {
      await this.deps.executions.update(context, executionId, { status: "RUNNING", failedAt: null, errorCode: null, errorMessage: null, metrics: { ...(existing.metrics ?? {}), invitationExecutionState: "DISPATCHED", retryable: true, nextRetryAt: null, manualRetryAt: new Date().toISOString() } });
      return this.dispatchInvitationInline(context, { executionId, opportunityId, channel: channel ?? "WHATSAPP", invitationId, correlationId: executionId });
    }

    if (this.deps.invitationQueue === undefined) throw new PersistenceError({ code: "PERSISTENCE_TRANSIENT", message: "Invitation queue is not configured", status: 503 });
    await this.deps.invitationQueue.enqueueInvitation({ tenantId: context.tenantId, campaignId: existing.campaignId, opportunityId, executionId, invitationId, preferredChannel: channel, correlationId: executionId, replaySafe: true });
    return this.deps.executions.update(context, executionId, { status: "RUNNING", failedAt: null, errorCode: null, errorMessage: null, metrics: { ...(existing.metrics ?? {}), invitationExecutionState: "DISPATCHED", retryable: true, nextRetryAt: null, manualRetryAt: new Date().toISOString() } });
  }

  /**
   * ST-003: shared golden-path dispatch for `executeInvitation`/`retryInvitationExecution`
   * when an `invitationExecutor` is configured -- sends synchronously and records the real
   * outcome via `recordInvitationResult` instead of only enqueueing a job for a worker that
   * may never run.
   */
  private async dispatchInvitationInline(context: TenantScoped, input: { readonly executionId: string; readonly opportunityId: string; readonly channel: "WHATSAPP" | "SMS" | "EMAIL"; readonly invitationId?: string | undefined; readonly correlationId?: string | undefined }): Promise<CampaignRuntimeExecutionRecord> {
    const correlation: CorrelationMetadata = { correlationId: input.correlationId ?? input.executionId };
    try {
      const result = await this.deps.invitationExecutor!.sendInvitation(
        { tenantId: context.tenantId, correlation },
        { tenantId: context.tenantId, captureId: input.opportunityId, channel: input.channel },
      );
      return this.recordInvitationResult(context, {
        executionId: input.executionId,
        opportunityId: input.opportunityId,
        invitationId: result.invitationId,
        status: result.status,
        channel: input.channel,
        provider: result.provider ?? input.channel,
      });
    } catch (error) {
      return this.recordInvitationResult(context, {
        executionId: input.executionId,
        opportunityId: input.opportunityId,
        invitationId: input.invitationId,
        status: "FAILED",
        channel: input.channel,
        provider: input.channel,
        errorCode: typeof error === "object" && error !== null && "code" in error ? String((error as { readonly code: unknown }).code) : "INVITATION_DELIVERY_FAILED",
        errorMessage: error instanceof Error ? error.message : "Seller invitation execution failed",
        retryable: typeof error === "object" && error !== null && "retryable" in error ? Boolean((error as { readonly retryable: unknown }).retryable) : false,
      });
    }
  }

  getCampaignExecution(context: TenantScoped, executionId: string): Promise<CampaignRuntimeExecutionRecord | null> {
    return this.deps.executions.findById(context, executionId);
  }

  listCampaignExecutions(context: TenantScoped, campaignId: string, page?: PageRequest) {
    return this.deps.executions.listByCampaignId(context, campaignId, page);
  }

  /**
   * Governance entrypoint for the growth loop (CS-019): enqueues evaluation when a
   * queue is configured, otherwise computes inline -- mirroring `applyOptimization`.
   */
  async evaluateGrowthLoop(context: TenantScoped, input: { readonly campaignId: string; readonly trigger?: GrowthLoopTrigger | undefined }): Promise<SellerAcquisitionCampaignRecord> {
    const campaign = await this.deps.campaigns.findById(context, input.campaignId);
    if (campaign === null) throw new PersistenceError({ code: "PERSISTENCE_NOT_FOUND", message: "Seller acquisition campaign not found", status: 404 });
    const trigger = input.trigger ?? "MANUAL";
    if (this.deps.growthLoopQueue !== undefined) {
      await this.deps.growthLoopQueue.enqueueGrowthLoopEvaluation({
        tenantId: context.tenantId,
        campaignId: campaign.id,
        trigger,
        correlationId: typeof (context as { readonly correlation?: { readonly correlationId?: unknown } }).correlation?.correlationId === "string" ? (context as { readonly correlation?: { readonly correlationId?: string } }).correlation?.correlationId : campaign.id,
        replaySafe: true,
      });
      return this.deps.campaigns.update(context, campaign.id, {
        metadata: { ...(campaign.metadata ?? {}), growthLoopStatus: "QUEUED", growthLoopTrigger: trigger, growthLoopQueuedAt: new Date().toISOString() },
      });
    }
    return this.computeGrowthLoop(context, campaign, trigger);
  }

  /** Worker-side execution port: always computes, regardless of queue configuration. */
  async executeGrowthLoopEvaluation(context: TenantScoped, input: { readonly campaignId: string; readonly trigger?: GrowthLoopTrigger | undefined }): Promise<SellerAcquisitionCampaignRecord> {
    const campaign = await this.deps.campaigns.findById(context, input.campaignId);
    if (campaign === null) throw new PersistenceError({ code: "PERSISTENCE_NOT_FOUND", message: "Seller acquisition campaign not found", status: 404 });
    return this.computeGrowthLoop(context, campaign, input.trigger ?? "MANUAL");
  }

  async applyGrowthRecommendation(context: TenantScoped, input: { readonly campaignId: string; readonly recommendationId: string; readonly actorId: string }): Promise<SellerAcquisitionCampaignRecord> {
    const { campaign, recommendation, index, recommendations } = await this.requireGrowthRecommendation(context, input.campaignId, input.recommendationId);
    const now = new Date().toISOString();
    const targetingUpdate = recommendation.targetingCandidate === undefined
      ? undefined
      : mergeCampaignTargetingMetadata(campaign.metadata, campaignTargetingConfigSchema.parse({ ...targetingFromCampaignMetadata(campaign.metadata) as Record<string, unknown>, ...recommendation.targetingCandidate }));
    const scheduleCandidateValue = recommendation.scheduleCandidate?.scheduleCadence;
    const scheduleCadence = typeof scheduleCandidateValue === "string" && ["HOURLY", "DAILY", "WEEKLY"].includes(scheduleCandidateValue) ? scheduleCandidateValue as "HOURLY" | "DAILY" | "WEEKLY" : undefined;
    const applied: GrowthRecommendation = { ...recommendation, status: "APPLIED", appliedAt: now, appliedBy: input.actorId };
    const nextRecommendations = recommendations.map((item, itemIndex) => (itemIndex === index ? applied : item));
    const baseMetadata = targetingUpdate ?? campaign.metadata ?? {};
    const updated = await this.deps.campaigns.update(context, campaign.id, {
      metadata: { ...baseMetadata, growthRecommendations: nextRecommendations },
      ...(scheduleCadence === undefined ? {} : { scheduleCadence }),
    });
    if (this.deps.usageMetering !== undefined) {
      await recordUsageEventBestEffort(this.deps.usageMetering, context, {
        eventType: "GROWTH_RECOMMENDATION_APPLIED",
        campaignId: campaign.id,
        occurredAt: new Date(now),
        idempotencyKey: `usage:GROWTH_RECOMMENDATION_APPLIED:${context.tenantId}:${campaign.id}:${input.recommendationId}`,
      });
    }
    await this.auditGrowthRecommendation(context, campaign.id, "GROWTH_RECOMMENDATION_APPLIED", recommendation, { actorId: input.actorId });
    return updated;
  }

  async dismissGrowthRecommendation(context: TenantScoped, input: { readonly campaignId: string; readonly recommendationId: string; readonly actorId: string; readonly reason?: string | undefined }): Promise<SellerAcquisitionCampaignRecord> {
    const { campaign, recommendation, index, recommendations } = await this.requireGrowthRecommendation(context, input.campaignId, input.recommendationId);
    const now = new Date().toISOString();
    const dismissed: GrowthRecommendation = { ...recommendation, status: "DISMISSED", dismissedAt: now, dismissedBy: input.actorId, ...(input.reason === undefined ? {} : { dismissedReason: input.reason }) };
    const nextRecommendations = recommendations.map((item, itemIndex) => (itemIndex === index ? dismissed : item));
    const updated = await this.deps.campaigns.update(context, campaign.id, {
      metadata: { ...(campaign.metadata ?? {}), growthRecommendations: nextRecommendations },
    });
    await this.auditGrowthRecommendation(context, campaign.id, "GROWTH_RECOMMENDATION_DISMISSED", recommendation, { actorId: input.actorId, reason: input.reason });
    return updated;
  }

  private async requireGrowthRecommendation(context: TenantScoped, campaignId: string, recommendationId: string): Promise<{ readonly campaign: SellerAcquisitionCampaignRecord; readonly recommendation: GrowthRecommendation; readonly index: number; readonly recommendations: readonly GrowthRecommendation[] }> {
    const campaign = await this.deps.campaigns.findById(context, campaignId);
    if (campaign === null) throw new PersistenceError({ code: "PERSISTENCE_NOT_FOUND", message: "Seller acquisition campaign not found", status: 404 });
    const recommendations = asGrowthRecommendations(campaign.metadata);
    const index = recommendations.findIndex((item) => item.id === recommendationId);
    const recommendation = index === -1 ? undefined : recommendations[index];
    if (recommendation === undefined || index === -1) throw new PersistenceError({ code: "PERSISTENCE_NOT_FOUND", message: "Growth recommendation not found", status: 404 });
    if (recommendation.status !== "PENDING") throw new PersistenceError({ code: "PERSISTENCE_CONFLICT", message: "Growth recommendation is not pending", status: 409 });
    return { campaign, recommendation, index, recommendations };
  }

  private async auditGrowthRecommendation(context: TenantScoped, campaignId: string, action: string, recommendation: GrowthRecommendation, metadata: Readonly<Record<string, unknown>>): Promise<void> {
    if (this.deps.auditLogs === undefined) return;
    const correlationId = typeof (context as { readonly correlation?: { readonly correlationId?: unknown } }).correlation?.correlationId === "string" ? (context as { readonly correlation?: { readonly correlationId?: string } }).correlation?.correlationId as string : campaignId;
    await this.deps.auditLogs.append(context, {
      tenantId: context.tenantId,
      action,
      targetType: "SELLER_ACQUISITION_CAMPAIGN",
      targetId: campaignId,
      correlationId,
      metadata: { recommendationId: recommendation.id, type: recommendation.type, ...metadata },
    });
  }

  private async computeGrowthLoop(context: TenantScoped, campaign: SellerAcquisitionCampaignRecord, trigger: GrowthLoopTrigger): Promise<SellerAcquisitionCampaignRecord> {
    const now = new Date();
    try {
      const snapshot = await this.buildGrowthSignalSnapshot(context, campaign);
      const result = this.growthLoopWorker.analyze({ campaign, snapshot, now });
      const existing = asGrowthRecommendations(campaign.metadata);
      const merged = result.growthLoopStatus === "INSUFFICIENT_DATA" ? existing : mergeGrowthRecommendations(existing, result.recommendations);
      const previousRecomputeCount = numericOrNull(isRecord(campaign.metadata) ? campaign.metadata.growthRecomputeCount : undefined) ?? 0;
      const updatedCampaign = await this.deps.campaigns.update(context, campaign.id, {
        metadata: {
          ...(campaign.metadata ?? {}),
          growthLoopStatus: result.growthLoopStatus,
          growthLoopTrigger: trigger,
          lastGrowthEvaluatedAt: result.lastGrowthEvaluatedAt,
          growthRecommendations: merged,
          growthSignalSnapshot: snapshot,
          growthCompleteness: result.completeness,
          growthFailureCode: null,
          growthFailureMessage: null,
          growthRecomputeCount: previousRecomputeCount + 1,
        },
      });
      if (this.deps.usageMetering !== undefined) {
        const dayBucket = now.toISOString().slice(0, 10);
        await recordUsageEventBestEffort(this.deps.usageMetering, context, {
          eventType: "GROWTH_LOOP_EVALUATED",
          campaignId: campaign.id,
          occurredAt: now,
          idempotencyKey: `usage:GROWTH_LOOP_EVALUATED:${context.tenantId}:${campaign.id}:${trigger}:${dayBucket}`,
        });
      }
      return updatedCampaign;
    } catch (error) {
      const code = error instanceof PersistenceError ? error.code : errorCode(error);
      const message = error instanceof PersistenceError ? error.message : sanitizeErrorMessage(error);
      await this.deps.campaigns.update(context, campaign.id, {
        metadata: { ...(campaign.metadata ?? {}), growthLoopStatus: "FAILED", growthLoopTrigger: trigger, growthFailureCode: code, growthFailureMessage: message, growthLoopFailedAt: now.toISOString() },
      }).catch(() => undefined);
      throw error;
    }
  }

  private async buildGrowthSignalSnapshot(context: TenantScoped, campaign: SellerAcquisitionCampaignRecord): Promise<GrowthSignalSnapshot> {
    const members = await this.listAllCampaignMembers(context, campaign.id);
    const dealIds = [...new Set(members.map((member) => member.dealId).filter((id): id is string => typeof id === "string"))];
    const dealsRepo = this.deps.deals;
    const deals = dealsRepo === undefined ? [] : (await Promise.all(dealIds.map((id) => dealsRepo.findById(context.tenantId, id)))).filter((deal): deal is DealRecord => deal !== null);
    const dealById = new Map(deals.map((deal) => [deal.id, deal] as const));

    const wonDeals = deals.filter((deal) => deal.closedAt != null);
    const attributedRevenue = round4(wonDeals.reduce((sum, deal) => sum + numeric(deal.value), 0));
    const currency = campaign.currency ?? wonDeals[0]?.currency ?? deals[0]?.currency ?? "USD";

    const totalMembers = members.length;
    const convertedStatuses = new Set(["CONVERTED", "COMPLETED"]);
    const qualifiedCount = members.filter((member) => CAMPAIGN_MEMBER_QUALIFIED_STATUSES.has(member.status)).length;
    const invitedCount = members.filter((member) => CAMPAIGN_MEMBER_INVITED_STATUSES.has(member.status)).length;
    const claimedCount = members.filter((member) => CAMPAIGN_MEMBER_CLAIMED_STATUSES.has(member.status)).length;
    const convertedCount = members.filter((member) => convertedStatuses.has(member.status)).length;

    const conversionRate = totalMembers > 0 ? round4(convertedCount / totalMembers) : null;
    const qualifiedToClaimRate = qualifiedCount > 0 ? round4(claimedCount / qualifiedCount) : null;
    const claimToConversionRate = claimedCount > 0 ? round4(convertedCount / claimedCount) : null;

    const executions = this.deps.executions === undefined ? [] : (await this.deps.executions.listByCampaignId(context, campaign.id, { limit: 20 })).items;
    const { duplicateRate, qualificationYield } = aggregateExecutionSignal(executions);

    const opportunities = await this.listAllCampaignOpportunities(context, campaign.id);
    const providerPerformance = buildProviderPerformance(opportunities, dealById);

    return {
      campaignId: campaign.id,
      generatedAt: new Date().toISOString(),
      currency,
      attributedRevenue,
      wonDealsCount: wonDeals.length,
      openDealsCount: Math.max(0, dealById.size - wonDeals.length),
      totalDeals: dealById.size,
      totalMembers,
      qualifiedCount,
      invitedCount,
      claimedCount,
      convertedCount,
      conversionRate,
      qualifiedToClaimRate,
      claimToConversionRate,
      duplicateRate,
      qualificationYield,
      goalRevenue: numericOrNull(campaign.goalRevenue),
      goalSellerCount: campaign.goalSellerCount ?? null,
      targetingSnapshot: (targetingFromCampaignMetadata(campaign.metadata) as Readonly<Record<string, unknown>> | undefined) ?? {},
      scheduleSnapshot: { scheduleEnabled: campaign.scheduleEnabled, scheduleCadence: campaign.scheduleCadence ?? null },
      providerPerformance,
    };
  }

  private async listAllCampaignMembers(context: TenantScoped, campaignId: string): Promise<readonly SellerAcquisitionCampaignMemberRecord[]> {
    const members: SellerAcquisitionCampaignMemberRecord[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.deps.campaigns.listMembers(context, campaignId, { limit: 100, ...(cursor === undefined ? {} : { cursor }) });
      members.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== undefined && members.length < MAX_GROWTH_SIGNAL_ITEMS);
    return members;
  }

  private async listAllCampaignOpportunities(context: TenantScoped, campaignId: string): Promise<readonly BusinessGrowthOpportunityRecord[]> {
    if (this.deps.opportunities === undefined) return [];
    const items: BusinessGrowthOpportunityRecord[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.deps.opportunities.findByCampaignId(context, campaignId, { limit: 100, ...(cursor === undefined ? {} : { cursor }) });
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== undefined && items.length < MAX_GROWTH_SIGNAL_ITEMS);
    return items;
  }
}
