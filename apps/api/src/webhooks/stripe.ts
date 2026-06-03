import Stripe from "stripe";

import {
  createSubscriptionChangedEvent,
  stripeSubscriptionToSnapshot,
} from "@whisperm/billing-runtime";

import { firstHeaderValue, type FastifyReplyLike, type FastifyRequestLike } from "../http/fastify.js";
import type { StripeWebhookDependencies } from "../billing/contracts.js";

export interface StripeWebhookRequest extends FastifyRequestLike {
  rawBody?: string;
}

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

    const rawBody =
      request.rawBody ??
      (typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {}));

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

    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const snapshot = stripeSubscriptionToSnapshot(
        event.data.object as Stripe.Subscription,
      );

      await dependencies.subscriptions.upsertSubscription(snapshot);

      await dependencies.outbox.publishSubscriptionChanged(
        createSubscriptionChangedEvent(snapshot, dependencies.now?.() ?? new Date()),
      );
    }

    if (
      event.type === "invoice.payment_failed" ||
      event.type === "invoice.payment_succeeded"
    ) {
      reply.code(200).send({ ok: true, received: true, deferred: true });
      return;
    }

    reply.code(200).send({ ok: true, received: true });
  };
};
