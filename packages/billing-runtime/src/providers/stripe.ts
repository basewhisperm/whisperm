import type Stripe from "stripe";
import { z } from "zod";

export const stripeSubscriptionStatusSchema = z.enum([
  "ACTIVE",
  "TRIALING",
  "PAST_DUE",
  "CANCELED",
  "UNPAID",
  "INCOMPLETE",
  "INCOMPLETE_EXPIRED",
]);

export type StripeSubscriptionStatus = z.output<typeof stripeSubscriptionStatusSchema>;

export interface BillingSubscriptionSnapshot {
  tenantId: string;
  provider: "STRIPE";
  providerCustomerId: string;
  providerSubscriptionId: string;
  status: StripeSubscriptionStatus;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  trialEndsAt?: string;
  cancelAtPeriodEnd: boolean;
  metadata: Record<string, unknown>;
}

export interface SubscriptionChangedEvent {
  type: "subscription.changed";
  tenantId: string;
  provider: "STRIPE";
  providerSubscriptionId: string;
  status: StripeSubscriptionStatus;
  occurredAt: string;
  source: "stripe";
  stripeEventId?: string;
  subscription: BillingSubscriptionSnapshot;
}

const epochToIso = (epoch?: number | null): string | undefined =>
  epoch === undefined || epoch === null ? undefined : new Date(epoch * 1000).toISOString();

const optionalNumberField = (value: unknown): number | undefined =>
  typeof value === "number" ? value : undefined;

export const mapStripeStatus = (status: Stripe.Subscription.Status): StripeSubscriptionStatus => {
  switch (status) {
    case "active":
      return "ACTIVE";
    case "trialing":
      return "TRIALING";
    case "past_due":
      return "PAST_DUE";
    case "canceled":
      return "CANCELED";
    case "unpaid":
      return "UNPAID";
    case "incomplete":
      return "INCOMPLETE";
    case "incomplete_expired":
      return "INCOMPLETE_EXPIRED";
    default:
      return "PAST_DUE";
  }
};

export const stripeSubscriptionToSnapshot = (
  subscription: Stripe.Subscription,
): BillingSubscriptionSnapshot => {
  const tenantId = subscription.metadata?.tenantId;
  if (tenantId === undefined || tenantId.trim().length === 0) {
    throw new Error("Stripe subscription missing metadata.tenantId");
  }

  const providerCustomerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  const snapshot: BillingSubscriptionSnapshot = {
    tenantId,
    provider: "STRIPE",
    providerCustomerId,
    providerSubscriptionId: subscription.id,
    status: mapStripeStatus(subscription.status),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    metadata: subscription.metadata,
  };

  const currentPeriodStart = epochToIso(
    optionalNumberField((subscription as unknown as Record<string, unknown>).current_period_start),
  );
  const currentPeriodEnd = epochToIso(
    optionalNumberField((subscription as unknown as Record<string, unknown>).current_period_end),
  );
  const trialEndsAt = epochToIso(subscription.trial_end);

  if (currentPeriodStart !== undefined) snapshot.currentPeriodStart = currentPeriodStart;
  if (currentPeriodEnd !== undefined) snapshot.currentPeriodEnd = currentPeriodEnd;
  if (trialEndsAt !== undefined) snapshot.trialEndsAt = trialEndsAt;

  return snapshot;
};

export const createSubscriptionChangedEvent = (
  subscription: BillingSubscriptionSnapshot,
  occurredAt = new Date(),
  stripeEventId?: string,
): SubscriptionChangedEvent => ({
  type: "subscription.changed",
  tenantId: subscription.tenantId,
  provider: "STRIPE",
  providerSubscriptionId: subscription.providerSubscriptionId,
  status: subscription.status,
  occurredAt: occurredAt.toISOString(),
  source: "stripe",
  ...(stripeEventId === undefined ? {} : { stripeEventId }),
  subscription,
});
