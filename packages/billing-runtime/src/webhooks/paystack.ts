/**
 * paystack.ts — Paystack webhook processing.
 * Mirrors webhooks/stripe.ts structure. HMAC-SHA512 verification happens before any side effects.
 */
import { paystackEventToSnapshot, verifyPaystackSignature, type PaystackWebhookEvent, type PaystackSubscriptionData, type PaystackChargeData } from "../providers/paystack.js";
import type { BillingWebhookPort, WebhookResult } from "./contracts.js";

const handledEvents = new Set(["subscription.create", "subscription.disable", "charge.success", "charge.failed"]);

/**
 * Every handled event type carries a field that's stable across webhook retries for the *same*
 * underlying event: subscription events always carry subscription_code, charge events always
 * carry reference. The previous version fell back to Date.now() when neither id nor reference
 * was present -- which was every subscription.create/subscription.disable event, since those
 * never carry either field at the top level -- silently defeating dedup for half the handled
 * event types (every retry got a fresh, never-seen-before key).
 */
const providerEventIdFor = (event: PaystackWebhookEvent): string => {
  if (event.event === "charge.success" || event.event === "charge.failed") {
    return (event.data as PaystackChargeData).reference;
  }
  return (event.data as PaystackSubscriptionData).subscription_code;
};

export interface PaystackWebhookInput {
  readonly rawBody: string;
  readonly signature: string | null | undefined;
}

export interface PaystackWebhookOptions {
  readonly paystackSecretKey: string;
}

export const processPaystackWebhook = async (
  input: PaystackWebhookInput,
  dependencies: BillingWebhookPort,
  options: PaystackWebhookOptions,
): Promise<WebhookResult> => {
  if (input.signature === null || input.signature === undefined || input.signature.trim().length === 0) {
    return { status: 400, body: { ok: false, error: "PAYSTACK_SIGNATURE_MISSING" } };
  }

  const signatureValid = await verifyPaystackSignature(input.rawBody, input.signature, options.paystackSecretKey);
  if (!signatureValid) {
    return { status: 400, body: { ok: false, error: "PAYSTACK_SIGNATURE_INVALID" } };
  }

  let event: PaystackWebhookEvent;
  try {
    event = JSON.parse(input.rawBody) as PaystackWebhookEvent;
  } catch {
    return { status: 400, body: { ok: false, error: "PAYSTACK_PAYLOAD_INVALID" } };
  }

  if (!handledEvents.has(event.event)) {
    return { status: 200, body: { ok: true, ignored: true } };
  }

  const snapshot = paystackEventToSnapshot(event);

  const outcome = await dependencies.applySubscriptionChange({
    tenantId: snapshot.tenantId,
    provider: "PAYSTACK",
    providerEventId: providerEventIdFor(event),
    eventType: event.event,
    snapshot,
  });

  if (outcome === "duplicate") {
    return { status: 200, body: { ok: true, duplicate: true } };
  }

  return { status: 200, body: { ok: true, received: true } };
};
