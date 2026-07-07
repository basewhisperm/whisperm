import assert from "node:assert/strict";
import test from "node:test";
import Stripe from "stripe";

import { processStripeWebhook } from "../dist/index.js";

const stripeSecretKey = "sk_test_123";
const stripeWebhookSecret = "whsec_test_secret";

const createDependencies = (outcome = "applied") => {
  const calls = [];
  return {
    calls,
    dependencies: {
      async applySubscriptionChange(input) {
        calls.push(input);
        return typeof outcome === "function" ? outcome(input) : outcome;
      },
    },
  };
};

const createSubscriptionEventPayload = (eventId = "evt_1", type = "customer.subscription.created", status = "active") => ({
  id: eventId,
  object: "event",
  api_version: "2026-05-27.dahlia",
  created: 1767225600,
  data: {
    object: {
      id: "sub_123",
      object: "subscription",
      customer: "cus_123",
      status,
      metadata: { tenantId: "tenant-1" },
      cancel_at_period_end: false,
      current_period_start: 1767225600,
      current_period_end: 1769904000,
      trial_end: null,
    },
  },
  livemode: false,
  pending_webhooks: 1,
  request: null,
  type,
});

const createInvoiceEventPayload = (eventId, type) => ({
  id: eventId,
  object: "event",
  api_version: "2026-05-27.dahlia",
  created: 1767225600,
  data: {
    object: {
      id: "in_123",
      object: "invoice",
      customer: "cus_123",
      subscription: "sub_123",
      metadata: { tenantId: "tenant-1" },
    },
  },
  livemode: false,
  pending_webhooks: 1,
  request: null,
  type,
});

const signPayload = (payload) => Stripe.webhooks.generateTestHeaderString({ payload, secret: stripeWebhookSecret });

const invoke = async (payload, dependencies, rawBody = JSON.stringify(payload), signature = signPayload(rawBody)) =>
  processStripeWebhook({ rawBody, signature }, dependencies, { stripeSecretKey, stripeWebhookSecret });

test("rejects an invalid signature before any persistence call", async () => {
  const { dependencies, calls } = createDependencies();
  const payload = JSON.stringify(createSubscriptionEventPayload());
  const result = await invoke(createSubscriptionEventPayload(), dependencies, payload, "bad-signature");

  assert.equal(result.status, 400);
  assert.equal(result.body.error, "STRIPE_SIGNATURE_INVALID");
  assert.equal(calls.length, 0);
});

test("subscription.created applies the subscription change", async () => {
  const { dependencies, calls } = createDependencies();
  const result = await invoke(createSubscriptionEventPayload("evt_created"), dependencies);

  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, "STRIPE");
  assert.equal(calls[0].providerEventId, "evt_created");
  assert.equal(calls[0].tenantId, "tenant-1");
  assert.equal(calls[0].snapshot.providerSubscriptionId, "sub_123");
  assert.equal(calls[0].snapshot.status, "ACTIVE");
});

test("subscription.updated maps past_due", async () => {
  const { dependencies, calls } = createDependencies();
  await invoke(createSubscriptionEventPayload("evt_updated", "customer.subscription.updated", "past_due"), dependencies);

  assert.equal(calls[0].snapshot.status, "PAST_DUE");
});

test("subscription.deleted maps canceled", async () => {
  const { dependencies, calls } = createDependencies();
  await invoke(createSubscriptionEventPayload("evt_deleted", "customer.subscription.deleted", "canceled"), dependencies);

  assert.equal(calls[0].snapshot.status, "CANCELED");
});

test("invoice.payment_failed sets past_due", async () => {
  const { dependencies, calls } = createDependencies();
  await invoke(createInvoiceEventPayload("evt_failed", "invoice.payment_failed"), dependencies);

  assert.equal(calls[0].snapshot.status, "PAST_DUE");
});

test("invoice.payment_succeeded sets active", async () => {
  const { dependencies, calls } = createDependencies();
  await invoke(createInvoiceEventPayload("evt_succeeded", "invoice.payment_succeeded"), dependencies);

  assert.equal(calls[0].snapshot.status, "ACTIVE");
});

test("a duplicate outcome from the port is reported back as duplicate", async () => {
  const seen = new Set();
  const { dependencies, calls } = createDependencies((input) => {
    if (seen.has(input.providerEventId)) return "duplicate";
    seen.add(input.providerEventId);
    return "applied";
  });
  const payload = createSubscriptionEventPayload("evt_duplicate");

  const first = await invoke(payload, dependencies);
  const second = await invoke(payload, dependencies);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(second.body, { ok: true, duplicate: true });
  assert.equal(calls.length, 2, "the port is called every time -- it owns the dedup decision atomically");
});

test("signature verification uses the raw body, not a re-serialized copy", async () => {
  const { dependencies, calls } = createDependencies();
  const rawBody = JSON.stringify(createSubscriptionEventPayload("evt_raw"), null, 2);
  const result = await processStripeWebhook({ rawBody, signature: signPayload(rawBody) }, dependencies, { stripeSecretKey, stripeWebhookSecret });

  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
});

test("an unhandled event type is acknowledged without calling the port", async () => {
  const { dependencies, calls } = createDependencies();
  const result = await invoke(createSubscriptionEventPayload("evt_unhandled", "customer.updated"), dependencies);

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, ignored: true });
  assert.equal(calls.length, 0);
});
