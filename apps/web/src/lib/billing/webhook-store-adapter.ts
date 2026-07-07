import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { ApplySubscriptionChangeInput, BillingWebhookPort } from "@whisperm/billing-runtime";

const toPrismaStatus = (status: string): "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "UNPAID" => {
  switch (status) {
    case "ACTIVE": return "ACTIVE";
    case "TRIALING": return "TRIALING";
    case "CANCELED": return "CANCELED";
    case "UNPAID": return "UNPAID";
    // INCOMPLETE / INCOMPLETE_EXPIRED have no equivalent in the persisted enum -- treat them the
    // same as PAST_DUE (blocked until payment succeeds), which is the correct gating behavior.
    default: return "PAST_DUE";
  }
};

const planFromMetadata = (metadata: Record<string, unknown>): "STARTER" | "GROWTH" | "PRO" | undefined => {
  const plan = metadata.plan;
  return plan === "STARTER" || plan === "GROWTH" || plan === "PRO" ? plan : undefined;
};

const customerIdField = (provider: "STRIPE" | "PAYSTACK") =>
  provider === "STRIPE" ? "stripeCustomerId" : "paystackCustomerId";

const subscriptionIdField = (provider: "STRIPE" | "PAYSTACK") =>
  provider === "STRIPE" ? "stripeSubscriptionId" : "paystackSubscriptionId";

export const webhookStoreAdapter: BillingWebhookPort = {
  async applySubscriptionChange(input: ApplySubscriptionChangeInput) {
    const { tenantId, provider, providerEventId, eventType, snapshot } = input;
    const plan = planFromMetadata(snapshot.metadata);
    const status = toPrismaStatus(snapshot.status);
    const customerIdKey = customerIdField(provider);
    const subscriptionIdKey = subscriptionIdField(provider);

    try {
      await prisma.$transaction(async (tx) => {
        // Dedup marker created first, inside the same transaction as the subscription write --
        // if this insert conflicts, the whole transaction rolls back before the subscription is
        // ever touched, so "duplicate" and "not applied" can never disagree.
        await tx.billingWebhookEvent.create({
          data: { tenantId, provider, providerEventId, eventType },
        });

        const existing = await tx.subscription.findFirst({ where: { tenantId, [customerIdKey]: snapshot.providerCustomerId } });

        if (existing === null) {
          await tx.subscription.create({
            data: {
              tenantId,
              plan: plan ?? "STARTER",
              status,
              currency: "USD",
              [customerIdKey]: snapshot.providerCustomerId,
              [subscriptionIdKey]: snapshot.providerSubscriptionId,
              currentPeriodStart: snapshot.currentPeriodStart ? new Date(snapshot.currentPeriodStart) : null,
              currentPeriodEnd: snapshot.currentPeriodEnd ? new Date(snapshot.currentPeriodEnd) : null,
              canceledAt: snapshot.cancelAtPeriodEnd ? new Date() : null,
              metadata: snapshot.metadata as Prisma.InputJsonValue,
            },
          });
          return;
        }

        await tx.subscription.update({
          where: { tenantId_id: { tenantId, id: existing.id } },
          data: {
            ...(plan === undefined ? {} : { plan }),
            status,
            [subscriptionIdKey]: snapshot.providerSubscriptionId,
            currentPeriodStart: snapshot.currentPeriodStart ? new Date(snapshot.currentPeriodStart) : existing.currentPeriodStart,
            currentPeriodEnd: snapshot.currentPeriodEnd ? new Date(snapshot.currentPeriodEnd) : existing.currentPeriodEnd,
            canceledAt: snapshot.cancelAtPeriodEnd ? (existing.canceledAt ?? new Date()) : null,
            metadata: snapshot.metadata as Prisma.InputJsonValue,
          },
        });
      });
      return "applied";
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return "duplicate";
      }
      throw error;
    }
  },
};
