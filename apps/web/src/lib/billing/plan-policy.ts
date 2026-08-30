import type { SubscriptionPlan } from "@prisma/client";

export type BillingInterval = "MONTHLY" | "ANNUAL";

export interface PlanPolicy {
  readonly plan: SubscriptionPlan;
  readonly label: string;
  readonly tagline: string;
  readonly recommended: boolean;
  readonly priceUsd: Readonly<Record<BillingInterval, number>>;
  readonly includedBillableActions: number;
  readonly quotas: readonly string[];
  readonly features: readonly string[];
}

/**
 * Canonical commercial policy used by both the customer-facing pricing UI
 * and server-side usage enforcement. Values in this module must never be
 * duplicated in a display-only catalog.
 */
export const PLAN_POLICIES = {
  STARTER: {
    plan: "STARTER",
    label: "Starter",
    tagline: "For a single operator building a repeatable acquisition motion.",
    recommended: false,
    priceUsd: { MONTHLY: 29, ANNUAL: 290 },
    includedBillableActions: 250,
    quotas: ["250 acquisition actions / month", "1 pipeline", "2 team members"],
    features: ["Seller capture", "Up to 200 seller discoveries / month", "Individual and bulk invitations"],
  },
  GROWTH: {
    plan: "GROWTH",
    label: "Growth",
    tagline: "For teams automating seller acquisition across multiple campaigns.",
    recommended: true,
    priceUsd: { MONTHLY: 99, ANNUAL: 990 },
    includedBillableActions: 1_500,
    quotas: ["1,500 acquisition actions / month", "5 pipelines", "5 team members"],
    features: ["Up to 2,000 seller discoveries / month", "Reports", "Health scores", "Campaign automation"],
  },
  PRO: {
    plan: "PRO",
    label: "Pro",
    tagline: "For high-volume teams operating a complete acquisition engine.",
    recommended: false,
    priceUsd: { MONTHLY: 299, ANNUAL: 2_990 },
    includedBillableActions: 6_000,
    quotas: ["6,000 acquisition actions / month", "Unlimited pipelines", "15 team members"],
    features: ["Unlimited seller discovery", "Advanced reporting", "Growth recommendations", "API access", "Priority support"],
  },
} as const satisfies Readonly<Record<SubscriptionPlan, PlanPolicy>>;

export const PLAN_POLICY_LIST: readonly PlanPolicy[] = [
  PLAN_POLICIES.STARTER,
  PLAN_POLICIES.GROWTH,
  PLAN_POLICIES.PRO,
];

export function getPlanPolicy(plan: SubscriptionPlan): PlanPolicy {
  return PLAN_POLICIES[plan];
}

export function annualSavingsUsd(policy: PlanPolicy): number {
  return policy.priceUsd.MONTHLY * 12 - policy.priceUsd.ANNUAL;
}
