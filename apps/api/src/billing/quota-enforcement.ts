/**
 * quota-enforcement.ts
 *
 * Pre-write quota enforcement for WhispeRM.
 * Wraps billing-runtime.evaluateQuota with plan limits and workspace context.
 *
 * Register resolvers once at app startup:
 *   setPlanResolver(async (tenantId) => { ... });
 *   setCurrentCountResolver(async (tenantId, resource) => { ... });
 *
 * Then call before any create operation:
 *   await enforceQuota({ tenantId, resource: "contacts" });
 *
 * IMPORTANT: tenantId must always come from the authenticated session context.
 */

import { evaluateQuota, type QuotaPolicy } from "@whisperm/billing-runtime";
import { ApiError } from "../errors.js";
import { planLimits, isUnlimited, type QuotaResource } from "./plan-limits.js";

export const PLAN_LIMIT_EXCEEDED = "PLAN_LIMIT_EXCEEDED" as const;

export type PlanResolver = (tenantId: string) => Promise<string>;
export type CurrentCountResolver = (tenantId: string, resource: QuotaResource) => Promise<number>;

let _planResolver: PlanResolver | null = null;
let _countResolver: CurrentCountResolver | null = null;

export const setPlanResolver = (resolver: PlanResolver): void => { _planResolver = resolver; };
export const setCurrentCountResolver = (resolver: CurrentCountResolver): void => { _countResolver = resolver; };

export interface EnforceQuotaInput {
  /** Must come from authenticated session context — never from request body */
  readonly tenantId: string;
  readonly resource: QuotaResource;
  readonly incrementBy?: number;
}

export const enforceQuota = async ({
  tenantId,
  resource,
  incrementBy = 1,
}: EnforceQuotaInput): Promise<void> => {
  if (_planResolver === null || _countResolver === null) {
    throw new ApiError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Quota enforcement is not configured. Call setPlanResolver and setCurrentCountResolver at startup.",
    });
  }

  const plan = await _planResolver(tenantId);

  // Fast path: unlimited resource — skip DB round-trip
  if (isUnlimited(plan, resource)) return;

  const limits = planLimits(plan);
  const limit = limits.quotas[resource] as number;
  const currentCount = await _countResolver(tenantId, resource);

  const policy: QuotaPolicy = {
    quotaId: `plan-${plan.toLowerCase()}-${resource}`,
    tenantId,
    metric: "WORKFLOW_RUNS",
    limit,
    period: "BILLING_CYCLE",
    enforcement: "HARD",
    failClosed: true,
    active: true,
    correlation: { correlationId: `quota-check:${tenantId}:${resource}` },
  };

  const decision = evaluateQuota({
    policy,
    currentQuantity: currentCount,
    requestedQuantity: incrementBy,
    evaluatedAt: new Date(),
  });

  if (!decision.allowed) {
    throw new ApiError({
      code: PLAN_LIMIT_EXCEEDED,
      message: `Plan limit exceeded: ${resource} limit is ${limit} on your current plan. Upgrade to continue.`,
      statusCode: 402,
    });
  }
};
