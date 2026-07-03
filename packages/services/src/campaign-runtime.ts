import { NoopCampaignRuntimeWorker, type CampaignRuntimeWorker } from "@whisperm/campaign-runtime";
import type {
  CampaignRuntimeExecutionRecord,
  CampaignRuntimeExecutionRepository,
  CampaignRuntimeExecutionTrigger,
  PageRequest,
  SellerAcquisitionCampaignRepository,
  SellerInvitationRepository,
  BusinessGrowthOpportunityRepository,
} from "@whisperm/repositories";
import { PersistenceError } from "@whisperm/repositories";
import type { TenantScoped } from "@whisperm/types";
import { DiscoveryOptimizationWorker } from "./marketplace-acquisition/discovery-optimization-worker.js";

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
    readonly replaySafe: true;
  }): Promise<void> | void;
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
  readonly discoveryQueue?: CampaignRuntimeDiscoveryQueue | undefined;
  readonly qualificationQueue?: CampaignRuntimeQualificationQueue | undefined;
  readonly optimizationQueue?: CampaignRuntimeOptimizationQueue | undefined;
  readonly optimizationWorker?: DiscoveryOptimizationWorker | undefined;
  readonly sellerInvitations?: SellerInvitationRepository | undefined;
  readonly opportunities?: BusinessGrowthOpportunityRepository | undefined;
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
  private readonly worker: CampaignRuntimeWorker;
  private readonly optimizationWorker: DiscoveryOptimizationWorker;

  constructor(private readonly deps: CampaignRuntimeServiceDependencies) {
    this.worker = deps.worker ?? new NoopCampaignRuntimeWorker();
    this.optimizationWorker = deps.optimizationWorker ?? new DiscoveryOptimizationWorker();
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

    const execution = await this.deps.executions.create(context, {
      tenantId: context.tenantId,
      campaignId: input.campaignId,
      trigger: "MANUAL",
      status: "QUEUED",
      metrics: {
        invitationExecutionState: "PENDING",
        opportunityId: input.opportunityId,
        invitationId: input.invitationId ?? null,
        initiatedBy: input.initiatedBy ?? null,
        retryCount: 0,
        maxRetries: defaultInvitationMaxRetries,
      },
    });

    await this.deps.invitationQueue?.enqueueInvitation({
      tenantId: context.tenantId,
      campaignId: input.campaignId,
      opportunityId: input.opportunityId,
      executionId: execution.id,
      invitationId: input.invitationId,
      preferredChannel: input.preferredChannel,
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

    const execution = await this.deps.executions.create(context, {
      tenantId: context.tenantId,
      campaignId: input.campaignId,
      trigger: input.trigger ?? "MANUAL",
      status: "QUEUED",
      metrics: {},
    });

    const running = await this.deps.executions.update(context, execution.id, { status: "RUNNING", startedAt: new Date().toISOString(), metrics: { discoveryStatus: "PENDING", discoveredCount: 0, capturedCount: 0, skippedDuplicateCount: 0 } });

    if (this.deps.discoveryQueue !== undefined) {
      await this.deps.discoveryQueue.enqueueDiscovery({
        tenantId: context.tenantId,
        campaignId: input.campaignId,
        executionId: running.id,
        replaySafe: true,
      });
      return this.deps.executions.update(context, running.id, {
        status: "RUNNING",
        metrics: { ...(running.metrics ?? {}), discoveryStatus: "RUNNING", discoveryStartedAt: running.startedAt ?? new Date().toISOString() },
      });
    }

    try {
      const result = await this.worker.execute({
        tenantId: context.tenantId,
        campaignId: input.campaignId,
        executionId: running.id,
        trigger: running.trigger,
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
    const nextRetryAt = shouldScheduleRetry ? nextInvitationRetryAt(retryCount, new Date(now)) : undefined;

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

    return this.deps.executions.update(context, input.executionId, {
      status: delivered ? "COMPLETED" : shouldScheduleRetry ? "RUNNING" : "FAILED",
      completedAt: delivered ? now : null,
      failedAt: delivered || shouldScheduleRetry ? null : now,
      errorCode: delivered || shouldScheduleRetry ? null : input.errorCode ?? "INVITATION_DELIVERY_FAILED",
      errorMessage: delivered || shouldScheduleRetry ? null : safeFailureMessage ?? "Seller invitation worker failed",
      metrics: finalMetrics,
    });
  }

  async retryInvitationExecution(context: TenantScoped, executionId: string): Promise<CampaignRuntimeExecutionRecord> {
    const existing = await this.deps.executions.findById(context, executionId);
    if (existing === null) throw new PersistenceError({ code: "PERSISTENCE_NOT_FOUND", message: "Campaign runtime execution not found", status: 404 });
    const state = typeof existing.metrics?.invitationExecutionState === "string" ? existing.metrics.invitationExecutionState : existing.status;
    if (!retryableStates.has(state)) throw new PersistenceError({ code: "PERSISTENCE_CONFLICT", message: "Invitation execution is not retryable", status: 409 });
    if (this.deps.invitationQueue === undefined) throw new PersistenceError({ code: "PERSISTENCE_TRANSIENT", message: "Invitation queue is not configured", status: 503 });
    const opportunityId = typeof existing.metrics?.opportunityId === "string" ? existing.metrics.opportunityId : undefined;
    if (opportunityId === undefined) throw new PersistenceError({ code: "PERSISTENCE_VALIDATION_FAILED", message: "Invitation execution is missing opportunity context", status: 422 });
    const channel = ["WHATSAPP", "SMS", "EMAIL"].includes(String(existing.metrics?.channel)) ? existing.metrics?.channel as "WHATSAPP" | "SMS" | "EMAIL" : undefined;
    await this.deps.invitationQueue.enqueueInvitation({ tenantId: context.tenantId, campaignId: existing.campaignId, opportunityId, executionId, invitationId: typeof existing.metrics?.invitationId === "string" ? existing.metrics.invitationId : undefined, preferredChannel: channel, correlationId: executionId, replaySafe: true });
    return this.deps.executions.update(context, executionId, { status: "RUNNING", failedAt: null, errorCode: null, errorMessage: null, metrics: { ...(existing.metrics ?? {}), invitationExecutionState: "DISPATCHED", retryable: true, nextRetryAt: null, manualRetryAt: new Date().toISOString() } });
  }

  getCampaignExecution(context: TenantScoped, executionId: string): Promise<CampaignRuntimeExecutionRecord | null> {
    return this.deps.executions.findById(context, executionId);
  }

  listCampaignExecutions(context: TenantScoped, campaignId: string, page?: PageRequest) {
    return this.deps.executions.listByCampaignId(context, campaignId, page);
  }
}
