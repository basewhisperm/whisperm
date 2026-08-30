import type { SubscriptionPlan } from "@prisma/client";

import { getPlanPolicy } from "@/lib/billing/plan-policy";
import { prisma } from "@/lib/prisma";

export interface PlanUsageState {
  readonly plan: SubscriptionPlan;
  readonly includedBillableActions: number;
  readonly usedBillableActions: number;
  readonly remainingBillableActions: number;
  readonly periodStart: Date;
  readonly periodEnd: Date;
}

export const currentUtcMonth = (now: Date): { readonly start: Date; readonly end: Date } => ({
  start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
  end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
});

/** Reads the same AcquisitionUsageEvent ledger shown in the usage UI. */
export async function getCurrentPlanUsage(tenantId: string, now: Date = new Date()): Promise<PlanUsageState> {
  const subscription = await prisma.subscription.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
    select: { plan: true },
  });
  const plan = subscription?.plan ?? "STARTER";
  const policy = getPlanPolicy(plan);
  const period = currentUtcMonth(now);
  const aggregate = await prisma.acquisitionUsageEvent.aggregate({
    where: {
      tenantId,
      billable: true,
      occurredAt: { gte: period.start, lt: period.end },
    },
    _sum: { quantity: true },
  });
  const usedBillableActions = aggregate._sum.quantity ?? 0;

  return {
    plan,
    includedBillableActions: policy.includedBillableActions,
    usedBillableActions,
    remainingBillableActions: Math.max(0, policy.includedBillableActions - usedBillableActions),
    periodStart: period.start,
    periodEnd: period.end,
  };
}
