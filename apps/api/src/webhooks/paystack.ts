/**
 * paystack.ts — Paystack webhook handler
 * Mirrors webhooks/stripe.ts structure exactly.
 * HMAC-SHA512 verification happens before any side effects.
 */

import {
  paystackEventToSnapshot,
  createPaystackSubscriptionChangedEvent,
  verifyPaystackSignature,
  type PaystackWebhookEvent,
} from "@whisperm/billing-runtime";

import { firstHeaderValue, type FastifyReplyLike, type FastifyRequestLike } from "../http/fastify.js";
import type { PaystackWebhookDependencies } from "../billing/contracts.js";

export interface PaystackWebhookRequest extends FastifyRequestLike {
  rawBody?: string;
}

const handledEvents = new Set([
  "subscription.create",
  "subscription.disable",
  "charge.success",
  "charge.failed",
]);

export const createPaystackWebhookHandler = (
  dependencies: PaystackWebhookDependencies,
  options: { paystackSecretKey: string },
) => async (request: PaystackWebhookRequest, reply: FastifyReplyLike): Promise<void> => {
  const signature = firstHeaderValue(request.headers, "x-paystack-signature");

  if (signature === undefined || signature.trim().length === 0) {
    reply.code(400).send({ ok: false, error: "PAYSTACK_SIGNATURE_MISSING" });
    return;
  }

  const rawBody =
    request.rawBody ??
    (typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {}));

  const signatureValid = await verifyPaystackSignature(rawBody, signature, options.paystackSecretKey);
  if (!signatureValid) {
    reply.code(400).send({ ok: false, error: "PAYSTACK_SIGNATURE_INVALID" });
    return;
  }

  let event: PaystackWebhookEvent;
  try {
    event = JSON.parse(rawBody) as PaystackWebhookEvent;
  } catch {
    reply.code(400).send({ ok: false, error: "PAYSTACK_PAYLOAD_INVALID" });
    return;
  }

  if (!handledEvents.has(event.event)) {
    reply.code(200).send({ ok: true, ignored: true });
    return;
  }

  const reservation = await dependencies.billingEventIngestion.reserve({
    provider: "PAYSTACK",
    providerEventId: `${event.event}:${(event.data as Record<string, unknown>)["id"] ?? (event.data as Record<string, unknown>)["reference"] ?? Date.now()}`,
    eventType: event.event,
    correlationId: request.correlationId ?? request.id ?? event.event,
  });

  if (reservation === "duplicate") {
    reply.code(200).send({ ok: true, duplicate: true });
    return;
  }

  const snapshot = paystackEventToSnapshot(event);
  await dependencies.subscriptions.upsertSubscription(snapshot);
  await dependencies.outbox.publishSubscriptionChanged(
    createPaystackSubscriptionChangedEvent(snapshot, dependencies.now?.() ?? new Date()),
  );

  reply.code(200).send({ ok: true, received: true });
};
