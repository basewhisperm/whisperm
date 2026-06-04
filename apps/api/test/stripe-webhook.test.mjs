import assert from "node:assert/strict";
import test from "node:test";
import Stripe from "stripe";

import { createStripeWebhookHandler } from "../dist/index.js";

const stripeSecretKey = "sk_test_123";
const stripeWebhookSecret = "whsec_test_secret";
const occurredAt = new Date("2026-01-01T00:00:00.000Z");

const createReply = () => {
  const state = { statusCode: 200, payload: undefined };
  return {
    code(statusCode) {
      state.statusCode = statusCode;
      return this;
    },
    send(payload) {
      state.payload = payload;
    },
    state,
  };
};

const createDependencies = (reserve = async () => "reserved") => {
  const calls = { reservations: [], subscriptions: [], outbox: [] };
  return {
    calls,
    dependencies: {
      now: () => occurredAt,
      billingEventIngestion: {
        async reserve(input) {
          calls.reservations.push(input);
          return reserve(input, calls);
        },
      },
      subscriptions: {
        async upsertSubscription(snapshot) {
          calls.subscriptions.push(snapshot);
        },
      },
      outbox: {
        async publishSubscriptionChanged(event) {
          calls.outbox.push(event);
        },
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

const invoke = async (payload, dependencies, rawBody = JSON.stringify(payload), signature = signPayload(rawBody)) => {
  const handler = createStripeWebhookHandler(dependencies, { stripeSecretKey, stripeWebhookSecret });
  const reply = createReply();
  await handler({ id: "req-1", correlationId: "corr-1", headers: { "stripe-signature": signature }, rawBody }, reply);
  return reply;
};

test("stripe webhook rejects invalid signature before DB writes", async () => {
  const { dependencies, calls } = createDependencies();
  const payload = JSON.stringify(createSubscriptionEventPayload());
  const reply = await invoke(createSubscriptionEventPayload(), dependencies, payload, "bad-signature");

  assert.equal(reply.state.statusCode, 400);
  assert.equal(reply.state.payload.error, "STRIPE_SIGNATURE_INVALID");
  assert.equal(calls.reservations.length, 0);
  assert.equal(calls.subscriptions.length, 0);
  assert.equal(calls.outbox.length, 0);
});

test("stripe subscription.created upserts subscription and publishes subscription.changed", async () => {
  const { dependencies, calls } = createDependencies();
  const reply = await invoke(createSubscriptionEventPayload("evt_created"), dependencies);

  assert.equal(reply.state.statusCode, 200);
  assert.equal(calls.reservations[0].providerEventId, "evt_created");
  assert.equal(calls.subscriptions.length, 1);
  assert.equal(calls.subscriptions[0].tenantId, "tenant-1");
  assert.equal(calls.subscriptions[0].providerSubscriptionId, "sub_123");
  assert.equal(calls.subscriptions[0].status, "ACTIVE");
  assert.equal(calls.outbox.length, 1);
  assert.equal(calls.outbox[0].type, "subscription.changed");
  assert.equal(calls.outbox[0].source, "stripe");
  assert.equal(calls.outbox[0].stripeEventId, "evt_created");
});

test("stripe subscription.updated upserts subscription", async () => {
  const { dependencies, calls } = createDependencies();
  await invoke(createSubscriptionEventPayload("evt_updated", "customer.subscription.updated", "past_due"), dependencies);

  assert.equal(calls.subscriptions.length, 1);
  assert.equal(calls.subscriptions[0].status, "PAST_DUE");
});

test("stripe subscription.deleted maps canceled status", async () => {
  const { dependencies, calls } = createDependencies();
  await invoke(createSubscriptionEventPayload("evt_deleted", "customer.subscription.deleted", "canceled"), dependencies);

  assert.equal(calls.subscriptions.length, 1);
  assert.equal(calls.subscriptions[0].status, "CANCELED");
});

test("stripe invoice.payment_failed sets subscription past_due", async () => {
  const { dependencies, calls } = createDependencies();
  await invoke(createInvoiceEventPayload("evt_failed", "invoice.payment_failed"), dependencies);

  assert.equal(calls.subscriptions.length, 1);
  assert.equal(calls.subscriptions[0].status, "PAST_DUE");
  assert.equal(calls.outbox.length, 1);
});

test("stripe invoice.payment_succeeded sets subscription active", async () => {
  const { dependencies, calls } = createDependencies();
  await invoke(createInvoiceEventPayload("evt_succeeded", "invoice.payment_succeeded"), dependencies);

  assert.equal(calls.subscriptions.length, 1);
  assert.equal(calls.subscriptions[0].status, "ACTIVE");
});

test("stripe duplicate event IDs are idempotent and publish outbox once", async () => {
  const seen = new Set();
  const { dependencies, calls } = createDependencies(async (input) => {
    if (seen.has(input.providerEventId)) return "duplicate";
    seen.add(input.providerEventId);
    return "reserved";
  });
  const payload = createSubscriptionEventPayload("evt_duplicate");

  const first = await invoke(payload, dependencies);
  const second = await invoke(payload, dependencies);

  assert.equal(first.state.statusCode, 200);
  assert.equal(second.state.statusCode, 200);
  assert.deepEqual(second.state.payload, { ok: true, duplicate: true });
  assert.equal(calls.reservations.length, 2);
  assert.equal(calls.subscriptions.length, 1);
  assert.equal(calls.outbox.length, 1);
});

test("stripe verification uses raw body instead of JSON-reencoded body", async () => {
  const { dependencies, calls } = createDependencies();
  const rawBody = JSON.stringify(createSubscriptionEventPayload("evt_raw"), null, 2);
  const handler = createStripeWebhookHandler(dependencies, { stripeSecretKey, stripeWebhookSecret });
  const reply = createReply();

  await handler({
    id: "req-1",
    correlationId: "corr-1",
    headers: { "stripe-signature": signPayload(rawBody) },
    rawBody,
    body: JSON.parse(rawBody),
  }, reply);

  assert.equal(reply.state.statusCode, 200);
  assert.equal(calls.subscriptions.length, 1);
});
