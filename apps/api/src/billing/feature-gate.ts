/**
 * feature-gate.ts
 *
 * Service-layer feature gate for plan-gated routes and background jobs.
 * Throws ApiError({ code: "PLAN_LIMIT_EXCEEDED", statusCode: 402 }) if gated.
 */

import { ApiError } from "../errors.js";
import { hasFeature, type GatedFeature } from "./plan-limits.js";
import { PLAN_LIMIT_EXCEEDED } from "./quota-enforcement.js";

type PlanResolver = (tenantId: string) => Promise<string>;
let _planResolver: PlanResolver | null = null;

export const setFeaturePlanResolver = (resolver: PlanResolver): void => { _planResolver = resolver; };

export interface AssertFeatureInput {
  readonly tenantId: string;
  readonly feature: GatedFeature;
}

export const assertFeature = async ({ tenantId, feature }: AssertFeatureInput): Promise<void> => {
  if (_planResolver === null) {
    throw new ApiError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Feature gate is not configured. Call setFeaturePlanResolver at startup.",
    });
  }

  const plan = await _planResolver(tenantId);

  if (!hasFeature(plan, feature)) {
    throw new ApiError({
      code: PLAN_LIMIT_EXCEEDED,
      message: `Feature "${feature}" is not available on your current plan. Upgrade to access it.`,
      statusCode: 402,
    });
  }
};
