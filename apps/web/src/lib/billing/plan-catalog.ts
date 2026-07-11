import type { CheckoutPlan } from "@/lib/billing/checkout";

export interface PlanCatalogEntry {
  readonly plan: CheckoutPlan;
  readonly label: string;
  readonly tagline: string;
  readonly quotas: readonly string[];
  readonly features: readonly string[];
}

/** Display-only catalog for the pricing page. Enforcement isn't wired yet -- see plan-limits in apps/api for the quota/feature source this mirrors. */
export const PLAN_CATALOG: readonly PlanCatalogEntry[] = [
  {
    plan: "STARTER",
    label: "Starter",
    tagline: "For a single operator getting the acquisition pipeline running.",
    quotas: ["50 contacts", "1 pipeline", "1 team member"],
    features: [],
  },
  {
    plan: "GROWTH",
    label: "Growth",
    tagline: "For a small team running multiple acquisition pipelines.",
    quotas: ["Unlimited contacts", "5 pipelines", "5 team members"],
    features: ["Reports", "Health scores"],
  },
  {
    plan: "PRO",
    label: "Pro",
    tagline: "For a team that needs the full platform, unlocked.",
    quotas: ["Unlimited contacts", "Unlimited pipelines", "Unlimited team members"],
    features: ["Reports", "Health scores", "API access"],
  },
];
