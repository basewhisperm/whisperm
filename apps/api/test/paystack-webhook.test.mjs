import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";

import {
  createPaystackWebhookHandler,
  resolveBillingProvider,
  mapPaystackSubscriptionEventToStatus,
  PAYSTACK_PRICING_GHS,
} from "../dist/index.js";

const paystackSecretKey = "sk_test_paystack_secret";
const occurredAt = new Date("2026-01-01T00:00:00.000Z");

const signPayload = (payload) =>
  createHmac("sha512", paystackSecretKey).update(payload).digest("hex");

const createReply = () => {
  const state = { statusCode: 200, payload: undefined };
  return {
    code(s) { state.statusCode = s; return this; },
    send(p) { state.payload = p; },
    state,
  };
};

const createDeps = (reservationResult = "reserved") => {
  const calls = { reservations: [], subscriptions: [], outbox: [] };
  return {
    calls,
    dependencies: {
      now: () => occurredAt,
      billingEventIngestion: {
        async reserve(input) { calls.reservations.push(input); return reservationResult; },
      },
      subscriptions: {
        async upsertSubscription(snapshot) { calls.subscriptions.push(snapshot); },
      },
      outbox: {
        async publishSubscriptionChanged(event) { calls.outbox.push(event); },
      },
    },
  };
};

const makeSubEvent = (eventType = "subscription.create", id = "evt-1") => ({
  event: eventType,
  data: {
    id,
    subscription_code: "SUB_abc123",
    email_token: "token123",
    status: "active",
    customer: {
      id: 1001,
      customer_code: "CUS_gh001",
      email: "kwame@example.com",
      metadata: { tenantId: "tenant-gh-1" },
    },
    plan: { plan_code: "PLN_starter_gh", name: "Starter", interval: "monthly" },
    next_payment_date: "2026-02-01T00:00:00.000Z",
  },
});

const makeChargeEvent = (eventType = "charge.success", reference = "ref_001") => ({
  event: eventType,
  data: {
    id: 9001,
    reference,
    status: eventType === "charge.success" ? "success" : "failed",
    amount: 490000,
    currency: "GHS",
    customer: { id: 1001, customer_code: "CUS_gh001", email: "kwame@example.com" },
    subscription_code: "SUB_abc123",
    metadata: { tenantId: "tenant-gh-1" },
  },
});

const makeReq = (payload, sig = null) => ({
  id: "req-1",
  correlationId: "corr-1",
  headers: { "x-paystack-signature": sig ?? signPayload(payload) },
  rawBody: payload,
});

test("1. GH workspace resolves to Paystack", () => {
  assert.equal(resolveBillingProvider({ country: "GH" }), "PAYSTACK");
});

test("2. US workspace resolves to Stripe", () => {
  assert.equal(resolveBillingProvider({ country: "US" }), "STRIPE");
});

test("3. Unknown country falls back to Stripe", () => {
  assert.equal(resolveBillingProvider({ country: null }), "STRIPE");
  assert.equal(resolveBillingProvider({}), "STRIPE");
  assert.equal(resolveBillingProvider({ country: "DE" }), "STRIPE");
});

test("4. Invalid HMAC returns 400", async () => {
  const { dependencies } = createDeps();
  const handler = createPaystackWebhookHandler(dependencies, { paystackSecretKey });
  const payload = JSON.stringify(makeSubEvent());
  const reply = createReply();
  await handler(makeReq(payload, "bad-signature"), reply);
  assert.equal(reply.state.statusCode, 400);
  assert.equal(reply.state.payload.error, "PAYSTACK_SIGNATURE_INVALID");
});

test("5. Invalid HMAC causes no DB writes", async () => {
  const { dependencies, calls } = createDeps();
  const handler = createPaystackWebhookHandler(dependencies, { paystackSecretKey });
  const payload = JSON.stringify(makeSubEvent());
  const reply = createReply();
  await handler(makeReq(payload, "bad-signature"), reply);
  assert.equal(calls.reservations.length, 0);
  assert.equal(calls.subscriptions.length, 0);
  assert.equal(calls.outbox.length, 0);
});

test("6. Valid signature processes event", async () => {
  const { dependencies, calls } = createDeps();
  const handler = createPaystackWebhookHandler(dependencies, { paystackSecretKey });
  const payload = JSON.stringify(makeSubEvent());
  const reply = createReply();
  await handler(makeReq(payload), reply);
  assert.equal(reply.state.statusCode, 200);
  assert.equal(reply.state.payload.received, true);
  assert.equal(calls.subscriptions.length, 1);
});

test("7. subscription.create upserts subscription as ACTIVE and publishes outbox event", async () => {
  const { dependencies, calls } = createDeps();
  const handler = createPaystackWebhookHandler(dependencies, { paystackSecretKey });
  const payload = JSON.stringify(makeSubEvent("subscription.create"));
  const reply = createReply();
  await handler(makeReq(payload), reply);
  assert.equal(calls.subscriptions[0].tenantId, "tenant-gh-1");
  assert.equal(calls.subscriptions[0].status, "ACTIVE");
  assert.equal(calls.subscriptions[0].providerSubscriptionId, "SUB_abc123");
  assert.equal(calls.outbox[0].type, "subscription.changed");
  assert.equal(calls.outbox[0].occurredAt, occurredAt.toISOString());
});

test("8. subscription.disable sets status to CANCELED", async () => {
  const { dependencies, calls } = createDeps();
  const handler = createPaystackWebhookHandler(dependencies, { paystackSecretKey });
  const payload = JSON.stringify(makeSubEvent("subscription.disable"));
  const reply = createReply();
  await handler(makeReq(payload), reply);
  assert.equal(calls.subscriptions[0].status, "CANCELED");
  assert.equal(calls.subscriptions[0].cancelAtPeriodEnd, true);
});

test("9. charge.success sets status to ACTIVE", async () => {
  const { dependencies, calls } = createDeps();
  const handler = createPaystackWebhookHandler(dependencies, { paystackSecretKey });
  const payload = JSON.stringify(makeChargeEvent("charge.success"));
  const reply = createReply();
  await handler(makeReq(payload), reply);
  assert.equal(calls.subscriptions[0].status, "ACTIVE");
  assert.equal(calls.outbox.length, 1);
});

test("10. charge.failed sets status to PAST_DUE", async () => {
  const { dependencies, calls } = createDeps();
  const handler = createPaystackWebhookHandler(dependencies, { paystackSecretKey });
  const payload = JSON.stringify(makeChargeEvent("charge.failed"));
  const reply = createReply();
  await handler(makeReq(payload), reply);
  assert.equal(calls.subscriptions[0].status, "PAST_DUE");
  assert.equal(calls.outbox.length, 1);
});

test("11. Duplicate webhook event is ignored", async () => {
  const { dependencies, calls } = createDeps("duplicate");
  const handler = createPaystackWebhookHandler(dependencies, { paystackSecretKey });
  const payload = JSON.stringify(makeSubEvent("subscription.create", "evt-dup"));
  const reply = createReply();
  await handler(makeReq(payload), reply);
  assert.equal(reply.state.payload.duplicate, true);
  assert.equal(calls.reservations.length, 1);
  assert.equal(calls.subscriptions.length, 0);
  assert.equal(calls.outbox.length, 0);
});

test("12. Reservation is called before subscription mutation", async () => {
  const { dependencies, calls } = createDeps();
  const handler = createPaystackWebhookHandler(dependencies, { paystackSecretKey });
  const payload = JSON.stringify(makeSubEvent());
  const reply = createReply();
  await handler(makeReq(payload), reply);
  assert.equal(calls.reservations.length, 1);
  assert.equal(calls.reservations[0].provider, "PAYSTACK");
  assert.equal(calls.subscriptions.length, 1);
});

test("13. subscription.changed outbox event has correct shape", async () => {
  const { dependencies, calls } = createDeps();
  const handler = createPaystackWebhookHandler(dependencies, { paystackSecretKey });
  const payload = JSON.stringify(makeSubEvent("subscription.create"));
  const reply = createReply();
  await handler(makeReq(payload), reply);
  const e = calls.outbox[0];
  assert.equal(e.type, "subscription.changed");
  assert.equal(e.tenantId, "tenant-gh-1");
  assert.equal(typeof e.occurredAt, "string");
  assert.equal(e.subscription.providerSubscriptionId, "SUB_abc123");
});

test("14. Ghana signup chooses Paystack", () => {
  assert.equal(resolveBillingProvider({ country: "GH" }), "PAYSTACK");
});

test("15. Non-Ghana signup chooses Stripe", () => {
  for (const country of ["US", "GB", "NG", "CA", "AU"]) {
    assert.equal(resolveBillingProvider({ country }), "STRIPE");
  }
});

test("GHS pricing constants defined for all tiers", () => {
  assert.ok(PAYSTACK_PRICING_GHS.STARTER.amountPesewas > 0);
  assert.ok(PAYSTACK_PRICING_GHS.GROWTH.amountPesewas > 0);
  assert.ok(PAYSTACK_PRICING_GHS.PRO.amountPesewas > 0);
});

test("Status mapping covers all handled event types", () => {
  assert.equal(mapPaystackSubscriptionEventToStatus("subscription.create"), "ACTIVE");
  assert.equal(mapPaystackSubscriptionEventToStatus("subscription.disable"), "CANCELED");
  assert.equal(mapPaystackSubscriptionEventToStatus("charge.success"), "ACTIVE");
  assert.equal(mapPaystackSubscriptionEventToStatus("charge.failed"), "PAST_DUE");
});
