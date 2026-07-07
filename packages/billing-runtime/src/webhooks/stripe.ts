import Stripe from "stripe";

import { stripeSubscriptionToSnapshot, type BillingSubscriptionSnapshot } from "../providers/stripe.js";
import type { BillingWebhookPort, WebhookResult } from "./contracts.js";

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
  if (typeof candidate === "object" && candidate !== null && "id" in candidate) return stringOrUndefined(candidate.id);
  return undefined;
};

const invoiceCustomerId = (invoice: Stripe.Invoice): string | undefined => {
  const customer = invoice.customer;
  if (typeof customer === "string") return stringOrUndefined(customer);
  if (typeof customer === "object" && customer !== null && "id" in customer) return stringOrUndefined(customer.id);
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

const subscriptionSnapshotFromEvent = (event: Stripe.Event): BillingSubscriptionSnapshot | undefined => {
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

const handledEvents = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
  "invoice.payment_succeeded",
]);

export interface StripeWebhookInput {
  readonly rawBody: string;
  readonly signature: string | null | undefined;
}

export interface StripeWebhookOptions {
  readonly stripeSecretKey: string;
  readonly stripeWebhookSecret: string;
}

export const processStripeWebhook = async (
  input: StripeWebhookInput,
  dependencies: BillingWebhookPort,
  options: StripeWebhookOptions,
): Promise<WebhookResult> => {
  if (input.signature === null || input.signature === undefined || input.signature.trim().length === 0) {
    return { status: 400, body: { ok: false, error: "STRIPE_SIGNATURE_MISSING" } };
  }

  const stripe = new Stripe(options.stripeSecretKey, { apiVersion: "2026-05-27.dahlia" });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(input.rawBody, input.signature, options.stripeWebhookSecret);
  } catch {
    return { status: 400, body: { ok: false, error: "STRIPE_SIGNATURE_INVALID" } };
  }

  if (!handledEvents.has(event.type)) {
    return { status: 200, body: { ok: true, ignored: true } };
  }

  const snapshot = subscriptionSnapshotFromEvent(event);
  if (snapshot === undefined) {
    return { status: 202, body: { ok: true, received: true, unmapped: true } };
  }

  const outcome = await dependencies.applySubscriptionChange({
    tenantId: snapshot.tenantId,
    provider: "STRIPE",
    providerEventId: event.id,
    eventType: event.type,
    snapshot,
  });

  if (outcome === "duplicate") {
    return { status: 200, body: { ok: true, duplicate: true } };
  }

  return { status: 200, body: { ok: true, received: true } };
};
