import { NoopCampaignRuntimeWorker, type CampaignRuntimeWorker } from "@whisperm/campaign-runtime";
import type {
  CampaignRuntimeExecutionRecord,
  CampaignRuntimeExecutionRepository,
  CampaignRuntimeExecutionTrigger,
  PageRequest,
  SellerAcquisitionCampaignRepository,
  SellerInvitationRepository,
} from "@whisperm/repositories";
import { PersistenceError } from "@whisperm/repositories";
import type { TenantScoped } from "@whisperm/types";

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

export interface CampaignRuntimeServiceDependencies {
  readonly campaigns: SellerAcquisitionCampaignRepository;
  readonly executions: CampaignRuntimeExecutionRepository;
  readonly worker?: CampaignRuntimeWorker | undefined;
  readonly invitationQueue?: CampaignRuntimeInvitationQueue | undefined;
  readonly sellerInvitations?: SellerInvitationRepository | undefined;
}

const activeStatuses = new Set(["QUEUED", "RUNNING"]);

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

  constructor(private readonly deps: CampaignRuntimeServiceDependencies) {
    this.worker = deps.worker ?? new NoopCampaignRuntimeWorker();
  }

  async executeInvitation(context: TenantScoped, input: ExecuteInvitationInput): Promise<CampaignRuntimeExecutionRecord> {
    const campaign = await this.deps.campaigns.findById(context, input.campaignId);
    if (campaign === null) {
      throw new PersistenceError({ code: "PERSISTENCE_NOT_FOUND", message: "Seller acquisition campaign not found", status: 404 });
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

    const running = await this.deps.executions.update(context, execution.id, { status: "RUNNING", startedAt: new Date().toISOString() });

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
