import { NoopCampaignRuntimeWorker, type CampaignRuntimeWorker } from "@whisperm/campaign-runtime";
import type {
  CampaignRuntimeExecutionRecord,
  CampaignRuntimeExecutionRepository,
  CampaignRuntimeExecutionTrigger,
  PageRequest,
  SellerAcquisitionCampaignRepository,
} from "@whisperm/repositories";
import { PersistenceError } from "@whisperm/repositories";
import type { TenantScoped } from "@whisperm/types";

export interface StartCampaignExecutionInput {
  readonly campaignId: string;
  readonly trigger?: CampaignRuntimeExecutionTrigger | undefined;
}

export interface CampaignRuntimeServiceDependencies {
  readonly campaigns: SellerAcquisitionCampaignRepository;
  readonly executions: CampaignRuntimeExecutionRepository;
  readonly worker?: CampaignRuntimeWorker | undefined;
}

const activeStatuses = new Set(["QUEUED", "RUNNING"]);

const sanitizeErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "Campaign runtime worker failed";
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

  getCampaignExecution(context: TenantScoped, executionId: string): Promise<CampaignRuntimeExecutionRecord | null> {
    return this.deps.executions.findById(context, executionId);
  }

  listCampaignExecutions(context: TenantScoped, campaignId: string, page?: PageRequest) {
    return this.deps.executions.listByCampaignId(context, campaignId, page);
  }
}
