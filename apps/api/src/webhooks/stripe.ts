import Stripe from "stripe";

import {
  createSubscriptionChangedEvent,
  stripeSubscriptionToSnapshot,
  type BillingSubscriptionSnapshot,
} from "@whisperm/billing-runtime";

import { firstHeaderValue, type FastifyReplyLike, type FastifyRequestLike } from "../http/fastify.js";
import type { StripeWebhookDependencies } from "../billing/contracts.js";

export interface StripeWebhookRequest extends FastifyRequestLike {
  rawBody?: string;
}


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

export const createStripeWebhookHandler = (
  dependencies: StripeWebhookDependencies,
  options: {
    stripeSecretKey: string;
    stripeWebhookSecret: string;
  },
) => {
  const stripe = new Stripe(options.stripeSecretKey, {
    apiVersion: "2026-05-27.dahlia",
  });

  return async (request: StripeWebhookRequest, reply: FastifyReplyLike): Promise<void> => {
    const signature = firstHeaderValue(request.headers, "stripe-signature");

    if (signature === undefined || signature.trim().length === 0) {
      reply.code(400).send({ ok: false, error: "STRIPE_SIGNATURE_MISSING" });
      return;
    }

    const rawBody = request.rawBody ?? (typeof request.body === "string" ? request.body : undefined);
    if (rawBody === undefined) {
      reply.code(400).send({ ok: false, error: "STRIPE_RAW_BODY_MISSING" });
      return;
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        options.stripeWebhookSecret,
      );
    } catch {
      reply.code(400).send({ ok: false, error: "STRIPE_SIGNATURE_INVALID" });
      return;
    }

    if (!handledEvents.has(event.type)) {
      reply.code(200).send({ ok: true, ignored: true });
      return;
    }

    const reservation = await dependencies.billingEventIngestion.reserve({
      provider: "STRIPE",
      providerEventId: event.id,
      eventType: event.type,
      correlationId: request.correlationId ?? request.id ?? event.id,
    });

    if (reservation === "duplicate") {
      reply.code(200).send({ ok: true, duplicate: true });
      return;
    }

    const snapshot = subscriptionSnapshotFromEvent(event);
    if (snapshot === undefined) {
      reply.code(202).send({ ok: true, received: true, unmapped: true });
      return;
    }

    await dependencies.subscriptions.upsertSubscription(snapshot);

    await dependencies.outbox.publishSubscriptionChanged(
      createSubscriptionChangedEvent(snapshot, dependencies.now?.() ?? new Date(), event.id),
    );

    reply.code(200).send({ ok: true, received: true });
  };
};
