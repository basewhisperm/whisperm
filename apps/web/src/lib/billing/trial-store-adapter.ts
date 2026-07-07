import { prisma } from "@/lib/prisma";
import type { WorkspaceTrialStore } from "@whisperm/billing-runtime";

export const trialStoreAdapter: WorkspaceTrialStore = {
  async createTrialSubscription(input) {
    await prisma.subscription.create({
      data: {
        tenantId: input.tenantId,
        plan: "STARTER",
        status: "TRIALING",
        currency: "USD",
        trialEndsAt: new Date(input.trialEndsAt),
      },
    });
    return input;
  },
};
