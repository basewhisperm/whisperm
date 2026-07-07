import { planLimits, type PlanName } from "./plan-limits.js";

export type BillingQuotaPlan = PlanName;

export interface BillingQuotaContext {
  readonly tenantId: string;
  readonly correlation: {
    readonly correlationId: string;
    readonly requestId?: string | undefined;
  };
}

export interface BillingQuotaReader {
  countContacts(context: BillingQuotaContext): Promise<number>;
  findCurrentPlan(context: BillingQuotaContext): Promise<BillingQuotaPlan | null>;
}

export interface PipelineQuotaReader {
  countPipelines(context: BillingQuotaContext): Promise<number>;
  findCurrentPlan(context: BillingQuotaContext): Promise<BillingQuotaPlan | null>;
}

export interface BillingQuotaDecision {
  readonly allowed: boolean;
  readonly code?: "quota_exceeded" | undefined;
  readonly limit?: number | undefined;
}

const evaluateSimpleQuota = (limit: number | null, currentQuantity: number, requestedQuantity = 1): BillingQuotaDecision => {
  if (limit === null || currentQuantity + requestedQuantity <= limit) return { allowed: true };
  return { allowed: false, code: "quota_exceeded", limit };
};

export const evaluateContactCreateQuota = async (
  reader: BillingQuotaReader,
  context: BillingQuotaContext,
): Promise<BillingQuotaDecision> => {
  const plan = (await reader.findCurrentPlan(context)) ?? "STARTER";
  const limit = planLimits(plan).quotas.contacts;
  const currentQuantity = await reader.countContacts(context);
  return evaluateSimpleQuota(limit, currentQuantity);
};

export const evaluatePipelineCreateQuota = async (
  reader: PipelineQuotaReader,
  context: BillingQuotaContext,
): Promise<BillingQuotaDecision> => {
  const plan = (await reader.findCurrentPlan(context)) ?? "STARTER";
  const limit = planLimits(plan).quotas.pipelines;
  const currentQuantity = await reader.countPipelines(context);
  return evaluateSimpleQuota(limit, currentQuantity);
};

export const evaluateTeamMemberQuota = async (
  plan: BillingQuotaPlan,
  currentQuantity: number,
): Promise<BillingQuotaDecision> => {
  const limit = planLimits(plan).quotas.teamMembers;
  return evaluateSimpleQuota(limit, currentQuantity);
};
