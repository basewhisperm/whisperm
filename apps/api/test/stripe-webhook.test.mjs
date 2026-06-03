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

const createDependencies = (reservationResult = "reserved") => {
  const calls = {
    reservations: [],
    subscriptions: [],
    outbox: [],
  };

  return {
    calls,
    dependencies: {
      now: () => occurredAt,
      billingEventIngestion: {
        async reserve(input) {
          calls.reservations.push(input);
          return reservationResult;
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

const createSubscriptionEventPayload = (eventId = "evt_1", type = "customer.subscription.created") => ({
  id: eventId,
  object: "event",
  api_version: "2026-05-27.dahlia",
  created: 1767225600,
  data: {
    object: {
      id: "sub_123",
      object: "subscription",
      customer: "cus_123",
      status: "active",
      metadata: {
        tenantId: "tenant-1",
      },
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

const signPayload = (payload) => Stripe.webhooks.generateTestHeaderString({
  payload,
  secret: stripeWebhookSecret,
});

test("stripe webhook rejects invalid signing secret with 400", async () => {
  const { dependencies, calls } = createDependencies();
  const handler = createStripeWebhookHandler(dependencies, {
    stripeSecretKey,
    stripeWebhookSecret,
  });

  const payload = JSON.stringify(createSubscriptionEventPayload());
  const reply = createReply();

  await handler({
    id: "req-1",
    correlationId: "corr-1",
    headers: { "stripe-signature": "bad-signature" },
    rawBody: payload,
  }, reply);

  assert.equal(reply.state.statusCode, 400);
  assert.equal(reply.state.payload.error, "STRIPE_SIGNATURE_INVALID");
  assert.equal(calls.reservations.length, 0);
  assert.equal(calls.subscriptions.length, 0);
  assert.equal(calls.outbox.length, 0);
});

test("stripe webhook treats duplicate event IDs as idempotent", async () => {
  const { dependencies, calls } = createDependencies("duplicate");
  const handler = createStripeWebhookHandler(dependencies, {
    stripeSecretKey,
    stripeWebhookSecret,
  });

  const payload = JSON.stringify(createSubscriptionEventPayload("evt_duplicate"));
  const reply = createReply();

  await handler({
    id: "req-1",
    correlationId: "corr-1",
    headers: { "stripe-signature": signPayload(payload) },
    rawBody: payload,
  }, reply);

  assert.equal(reply.state.statusCode, 200);
  assert.deepEqual(reply.state.payload, { ok: true, duplicate: true });
  assert.equal(calls.reservations.length, 1);
  assert.equal(calls.reservations[0].providerEventId, "evt_duplicate");
  assert.equal(calls.subscriptions.length, 0);
  assert.equal(calls.outbox.length, 0);
});

test("stripe subscription.created upserts subscription and publishes subscription.changed", async () => {
  const { dependencies, calls } = createDependencies();
  const handler = createStripeWebhookHandler(dependencies, {
    stripeSecretKey,
    stripeWebhookSecret,
  });

  const payload = JSON.stringify(createSubscriptionEventPayload("evt_created"));
  const reply = createReply();

  await handler({
    id: "req-1",
    correlationId: "corr-1",
    headers: { "stripe-signature": signPayload(payload) },
    rawBody: payload,
  }, reply);

  assert.equal(reply.state.statusCode, 200);
  assert.equal(reply.state.payload.received, true);

  assert.equal(calls.reservations.length, 1);
  assert.equal(calls.reservations[0].provider, "STRIPE");
  assert.equal(calls.reservations[0].providerEventId, "evt_created");

  assert.equal(calls.subscriptions.length, 1);
  assert.equal(calls.subscriptions[0].tenantId, "tenant-1");
  assert.equal(calls.subscriptions[0].providerSubscriptionId, "sub_123");
  assert.equal(calls.subscriptions[0].status, "ACTIVE");

  assert.equal(calls.outbox.length, 1);
  assert.equal(calls.outbox[0].type, "subscription.changed");
  assert.equal(calls.outbox[0].tenantId, "tenant-1");
  assert.equal(calls.outbox[0].occurredAt, occurredAt.toISOString());
});

test("stripe invoice events are acknowledged without subscription mutation", async () => {
  const { dependencies, calls } = createDependencies();
  const handler = createStripeWebhookHandler(dependencies, {
    stripeSecretKey,
    stripeWebhookSecret,
  });

  const payload = JSON.stringify({
    id: "evt_invoice",
    object: "event",
    api_version: "2026-05-27.dahlia",
    created: 1767225600,
    data: { object: { id: "in_123", object: "invoice" } },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: "invoice.payment_succeeded",
  });

  const reply = createReply();

  await handler({
    id: "req-1",
    correlationId: "corr-1",
    headers: { "stripe-signature": signPayload(payload) },
    rawBody: payload,
  }, reply);

  assert.equal(reply.state.statusCode, 200);
  assert.equal(reply.state.payload.deferred, true);
  assert.equal(calls.reservations.length, 1);
  assert.equal(calls.subscriptions.length, 0);
  assert.equal(calls.outbox.length, 0);
});
