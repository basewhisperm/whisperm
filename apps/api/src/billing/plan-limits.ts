/**
 * plan-limits.ts
 *
 * Centralised plan limit definitions for WhispeRM.
 * Single source of truth for quota-limited resources and feature gates.
 */

export type PlanName = "STARTER" | "GROWTH" | "PRO";

export type QuotaResource = "contacts" | "pipelines" | "teamMembers";

export type GatedFeature = "reports" | "healthScores" | "apiAccess";

/** null means "unlimited" — never expose as Infinity in API responses. */
export type QuotaLimit = number | null;

export interface PlanLimits {
  quotas: Record<QuotaResource, QuotaLimit>;
  features: Record<GatedFeature, boolean>;
}

const PLAN_LIMITS: Record<PlanName, PlanLimits> = {
  STARTER: {
    quotas: { contacts: 50, pipelines: 1, teamMembers: 1 },
    features: { reports: false, healthScores: false, apiAccess: false },
  },
  GROWTH: {
    quotas: { contacts: null, pipelines: 5, teamMembers: 5 },
    features: { reports: true, healthScores: true, apiAccess: false },
  },
  PRO: {
    quotas: { contacts: null, pipelines: null, teamMembers: null },
    features: { reports: true, healthScores: true, apiAccess: true },
  },
};

/**
 * Returns plan limits for the given plan name (case-insensitive).
 * Falls back to STARTER for unknown or missing plans — fail safe.
 */
export const planLimits = (plan: string | null | undefined): PlanLimits => {
  const key = (plan ?? "").toUpperCase() as PlanName;
  return PLAN_LIMITS[key] ?? PLAN_LIMITS.STARTER;
};

export const isUnlimited = (plan: string, resource: QuotaResource): boolean =>
  planLimits(plan).quotas[resource] === null;

export const hasFeature = (plan: string, feature: GatedFeature): boolean =>
  planLimits(plan).features[feature] === true;
