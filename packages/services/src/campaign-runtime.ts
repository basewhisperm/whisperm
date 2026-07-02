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
}

const deliveredStatuses = new Set(["SENT", "DELIVERED", "COMPLETED"]);

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
  readonly sellerInvitations?: SellerInvitationRepository | undefined;
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

    if (input.invitationId !== undefined && this.deps.sellerInvitations !== undefined) {
      await this.deps.sellerInvitations.update(context, input.invitationId, {
        status: delivered ? "SENT" : "FAILED",
        metadata: {
          invitationExecutionState: delivered ? "DELIVERED" : "FAILED",
          campaignRuntimeExecutionId: input.executionId,
          correlationId: typeof (context as { readonly correlation?: { readonly correlationId?: unknown } }).correlation?.correlationId === "string" ? (context as { readonly correlation?: { readonly correlationId?: string } }).correlation?.correlationId : null,
          channel: input.channel,
          provider: input.provider ?? input.channel,
          ...(delivered ? { deliveredAt: now } : { failedAt: now, failureCode: input.errorCode ?? "INVITATION_DELIVERY_FAILED", failureMessage: safeFailureMessage ?? "Seller invitation worker failed", retryable: input.retryable ?? false }),
        },
      });
    }

    return this.deps.executions.update(context, input.executionId, {
      status: delivered ? "COMPLETED" : "FAILED",
      completedAt: delivered ? now : null,
      failedAt: delivered ? null : now,
      errorCode: delivered ? null : input.errorCode ?? "INVITATION_DELIVERY_FAILED",
      errorMessage: delivered ? null : safeFailureMessage ?? "Seller invitation worker failed",
      metrics,
    });
  }

  getCampaignExecution(context: TenantScoped, executionId: string): Promise<CampaignRuntimeExecutionRecord | null> {
    return this.deps.executions.findById(context, executionId);
  }

  listCampaignExecutions(context: TenantScoped, campaignId: string, page?: PageRequest) {
    return this.deps.executions.listByCampaignId(context, campaignId, page);
  }
}
