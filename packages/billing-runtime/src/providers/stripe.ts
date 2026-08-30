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
  provider: "STRIPE" | "PAYSTACK";
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
  provider: "STRIPE" | "PAYSTACK";
  providerSubscriptionId: string;
  status: StripeSubscriptionStatus;
  occurredAt: string;
  source: "stripe" | "paystack";
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

/** Stripe event types this module knows how to turn into a subscription snapshot. */
export const stripeHandledSubscriptionEventTypes = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
  "invoice.payment_succeeded",
]);

const stringOrUndefined = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

const invoiceMetadata = (invoice: Stripe.Invoice): Record<string, string> => {
  const invoiceWithSubscriptionDetails = invoice as unknown as { readonly subscription_details?: { readonly metadata?: Record<string, string> } };
  const parent = (invoice as unknown as { readonly parent?: { readonly subscription_details?: { readonly metadata?: Record<string, string> } } }).parent;
  return {
    ...(parent?.subscription_details?.metadata ?? {}),
    ...(invoiceWithSubscriptionDetails.subscription_details?.metadata ?? {}),
    ...(invoice.metadata ?? {}),
  };
};

const invoiceSubscriptionId = (invoice: Stripe.Invoice): string | undefined => {
  const subscription = (invoice as unknown as { readonly subscription?: unknown }).subscription;
  const parentSubscription = (invoice as unknown as { readonly parent?: { readonly subscription_details?: { readonly subscription?: unknown } } }).parent?.subscription_details?.subscription;
  const candidate = subscription ?? parentSubscription;
  if (typeof candidate === "string") return stringOrUndefined(candidate);
  if (typeof candidate === "object" && candidate !== null && "id" in candidate) return stringOrUndefined(candidate.id as unknown as string);
  return undefined;
};

const invoiceCustomerId = (invoice: Stripe.Invoice): string | undefined => {
  const customer = invoice.customer;
  if (typeof customer === "string") return stringOrUndefined(customer);
  if (typeof customer === "object" && customer !== null && "id" in customer) return stringOrUndefined(customer.id as unknown as string);
  return undefined;
};

const invoiceToSubscriptionSnapshot = (
  invoice: Stripe.Invoice,
  status: BillingSubscriptionSnapshot["status"],
): BillingSubscriptionSnapshot | undefined => {
  const metadata = invoiceMetadata(invoice);
  const tenantId = stringOrUndefined(metadata.tenantId);
  const providerSubscriptionId = invoiceSubscriptionId(invoice);
  const providerCustomerId = invoiceCustomerId(invoice);
  if (tenantId === undefined || providerSubscriptionId === undefined || providerCustomerId === undefined) {
    return undefined;
  }

  return {
    tenantId,
    provider: "STRIPE",
    providerCustomerId,
    providerSubscriptionId,
    status,
    cancelAtPeriodEnd: false,
    metadata,
  };
};

/**
 * Routes a Stripe webhook event to a subscription snapshot, or `undefined`
 * for an event type this module doesn't map (caller should treat that as
 * "received, nothing to do" rather than an error). Mirrors the mapping
 * previously duplicated inline in apps/api's webhook handler -- this is the
 * shared home for it so any consumer (apps/api, apps/web, ...) gets the
 * same subscription/invoice-event interpretation.
 */
export const stripeEventToSubscriptionSnapshot = (event: Stripe.Event): BillingSubscriptionSnapshot | undefined => {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return stripeSubscriptionToSnapshot(event.data.object as Stripe.Subscription);
    case "invoice.payment_failed":
      return invoiceToSubscriptionSnapshot(event.data.object as Stripe.Invoice, "PAST_DUE");
    case "invoice.payment_succeeded":
      return invoiceToSubscriptionSnapshot(event.data.object as Stripe.Invoice, "ACTIVE");
    default:
      return undefined;
  }
};
