import { evaluateQuota, quotaPolicySchema } from "@whisperm/billing-runtime";

export type BillingQuotaPlan = "STARTER" | "GROWTH" | "PRO";

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

const starterContactLimit = 50;
const starterPipelineLimit = 1;
const growthPipelineLimit = 5;
const starterTeamMemberLimit = 1;
const growthTeamMemberLimit = 5;

export interface PlanLimits {
  readonly quotas: {
    readonly contacts: number | null;
    readonly pipelines: number | null;
    readonly teamMembers: number | null;
  };
  readonly features: {
    readonly reports: boolean;
    readonly healthScores: boolean;
    readonly apiAccess: boolean;
  };
}

export const planLimits = (plan: string): PlanLimits => {
  switch (plan) {
    case "GROWTH":
      return {
        quotas: { contacts: null, pipelines: 5, teamMembers: 5 },
        features: { reports: true, healthScores: true, apiAccess: false },
      };
    case "PRO":
      return {
        quotas: { contacts: null, pipelines: null, teamMembers: null },
        features: { reports: true, healthScores: true, apiAccess: true },
      };
    case "STARTER":
    default:
      return {
        quotas: { contacts: 50, pipelines: 1, teamMembers: 1 },
        features: { reports: false, healthScores: false, apiAccess: false },
      };
  }
};

export const evaluateContactCreateQuota = async (
  reader: BillingQuotaReader,
  context: BillingQuotaContext,
  now: Date,
): Promise<BillingQuotaDecision> => {
  const plan = await reader.findCurrentPlan(context) ?? "STARTER";
  if (plan !== "STARTER") {
    return { allowed: true };
  }
  const currentQuantity = await reader.countContacts(context);
  const decision = evaluateQuota({
    policy: quotaPolicySchema.parse({
      quotaId: "starter.contacts",
      tenantId: context.tenantId,
      metric: "CONTACTS",
      limit: starterContactLimit,
      period: "BILLING_CYCLE",
      enforcement: "HARD",
      failClosed: true,
      active: true,
      correlation: context.correlation,
    }),
    currentQuantity,
    requestedQuantity: 1,
    evaluatedAt: now,
  });
  return decision.allowed
    ? { allowed: true }
    : { allowed: false, code: "quota_exceeded", limit: starterContactLimit };
};

export const evaluatePipelineCreateQuota = async (
  reader: PipelineQuotaReader,
  context: BillingQuotaContext,
  now: Date,
): Promise<BillingQuotaDecision> => {
  const plan = await reader.findCurrentPlan(context) ?? "STARTER";
  if (plan === "PRO") {
    return { allowed: true };
  }
  const limit = plan === "GROWTH" ? growthPipelineLimit : starterPipelineLimit;
  const currentQuantity = await reader.countPipelines(context);
  const decision = evaluateQuota({
    policy: quotaPolicySchema.parse({
      quotaId: `${plan.toLowerCase()}.pipelines`,
      tenantId: context.tenantId,
      metric: "WORKFLOW_RUNS",
      limit,
      period: "BILLING_CYCLE",
      enforcement: "HARD",
      failClosed: true,
      active: true,
      correlation: context.correlation,
    }),
    currentQuantity,
    requestedQuantity: 1,
    evaluatedAt: now,
  });
  return decision.allowed
    ? { allowed: true }
    : { allowed: false, code: "quota_exceeded", limit };
};


export const evaluateTeamMemberQuota = async (
  plan: BillingQuotaPlan,
  context: BillingQuotaContext,
  currentQuantity: number,
  now: Date,
): Promise<BillingQuotaDecision> => {
  if (plan === "PRO") {
    return { allowed: true };
  }
  const limit = plan === "GROWTH" ? growthTeamMemberLimit : starterTeamMemberLimit;
  const decision = evaluateQuota({
    policy: quotaPolicySchema.parse({
      quotaId: `${plan.toLowerCase()}.teamMembers`,
      tenantId: context.tenantId,
      metric: "CONTACTS",
      limit,
      period: "BILLING_CYCLE",
      enforcement: "HARD",
      failClosed: true,
      active: true,
      correlation: context.correlation,
    }),
    currentQuantity,
    requestedQuantity: 1,
    evaluatedAt: now,
  });
  return decision.allowed
    ? { allowed: true }
    : { allowed: false, code: "quota_exceeded", limit };
};
