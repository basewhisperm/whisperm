import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";

import { processPaystackWebhook, resolveBillingProvider, mapPaystackSubscriptionEventToStatus, PAYSTACK_PRICING_GHS } from "../dist/index.js";

const paystackSecretKey = "sk_test_paystack_secret";

const signPayload = (payload) => createHmac("sha512", paystackSecretKey).update(payload).digest("hex");

const createDeps = (outcome = "applied") => {
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

// Deliberately omits `data.id` -- the previous implementation fell back to Date.now() whenever
// id/reference were both absent, which was every subscription.create/subscription.disable event
// in production (Paystack never puts either field at the top level of a subscription payload).
// Every fixture here matches real Paystack payload shape.
const makeSubEvent = (eventType = "subscription.create") => ({
  event: eventType,
  data: {
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

const invoke = (payload, dependencies, signature = signPayload(payload)) =>
  processPaystackWebhook({ rawBody: payload, signature }, dependencies, { paystackSecretKey });

test("GH workspace resolves to Paystack, others to Stripe", () => {
  assert.equal(resolveBillingProvider({ country: "GH" }), "PAYSTACK");
  assert.equal(resolveBillingProvider({ country: "US" }), "STRIPE");
  assert.equal(resolveBillingProvider({ country: null }), "STRIPE");
});

test("invalid HMAC returns 400 and calls no ports", async () => {
  const { dependencies, calls } = createDeps();
  const payload = JSON.stringify(makeSubEvent());
  const result = await invoke(payload, dependencies, "bad-signature");
  assert.equal(result.status, 400);
  assert.equal(result.body.error, "PAYSTACK_SIGNATURE_INVALID");
  assert.equal(calls.length, 0);
});

test("valid signature applies the subscription change", async () => {
  const { dependencies, calls } = createDeps();
  const result = await invoke(JSON.stringify(makeSubEvent()), dependencies);
  assert.equal(result.status, 200);
  assert.equal(result.body.received, true);
  assert.equal(calls.length, 1);
});

test("subscription.create maps to ACTIVE", async () => {
  const { dependencies, calls } = createDeps();
  await invoke(JSON.stringify(makeSubEvent("subscription.create")), dependencies);
  assert.equal(calls[0].tenantId, "tenant-gh-1");
  assert.equal(calls[0].snapshot.status, "ACTIVE");
  assert.equal(calls[0].snapshot.providerSubscriptionId, "SUB_abc123");
});

test("subscription.disable maps to CANCELED", async () => {
  const { dependencies, calls } = createDeps();
  await invoke(JSON.stringify(makeSubEvent("subscription.disable")), dependencies);
  assert.equal(calls[0].snapshot.status, "CANCELED");
  assert.equal(calls[0].snapshot.cancelAtPeriodEnd, true);
});

test("charge.success maps to ACTIVE, charge.failed maps to PAST_DUE", async () => {
  const { dependencies: successDeps, calls: successCalls } = createDeps();
  await invoke(JSON.stringify(makeChargeEvent("charge.success")), successDeps);
  assert.equal(successCalls[0].snapshot.status, "ACTIVE");

  const { dependencies: failedDeps, calls: failedCalls } = createDeps();
  await invoke(JSON.stringify(makeChargeEvent("charge.failed")), failedDeps);
  assert.equal(failedCalls[0].snapshot.status, "PAST_DUE");
});

test("a duplicate outcome from the port is reported back as duplicate", async () => {
  const { dependencies } = createDeps("duplicate");
  const result = await invoke(JSON.stringify(makeSubEvent()), dependencies);
  assert.equal(result.body.duplicate, true);
});

test("BUGFIX: subscription.create/disable events (no top-level id or reference) still get a stable, deterministic idempotency key from subscription_code", async () => {
  const { dependencies: firstDeps, calls: firstCalls } = createDeps();
  const { dependencies: secondDeps, calls: secondCalls } = createDeps();
  const payload = JSON.stringify(makeSubEvent("subscription.create"));

  await invoke(payload, firstDeps);
  await invoke(payload, secondDeps);

  assert.equal(firstCalls[0].providerEventId, secondCalls[0].providerEventId, "the same event must always derive the same key, not a fresh one per delivery");
  assert.equal(firstCalls[0].providerEventId, "SUB_abc123");
});

test("charge events derive their idempotency key from reference, distinct per charge", async () => {
  const { dependencies, calls } = createDeps();
  await invoke(JSON.stringify(makeChargeEvent("charge.success", "ref_AAA")), dependencies);
  await invoke(JSON.stringify(makeChargeEvent("charge.success", "ref_BBB")), dependencies);

  assert.equal(calls[0].providerEventId, "ref_AAA");
  assert.equal(calls[1].providerEventId, "ref_BBB");
});

test("GHS pricing constants defined for all tiers", () => {
  assert.ok(PAYSTACK_PRICING_GHS.STARTER.amountPesewas > 0);
  assert.ok(PAYSTACK_PRICING_GHS.GROWTH.amountPesewas > 0);
  assert.ok(PAYSTACK_PRICING_GHS.PRO.amountPesewas > 0);
});

test("status mapping covers all handled event types", () => {
  assert.equal(mapPaystackSubscriptionEventToStatus("subscription.create"), "ACTIVE");
  assert.equal(mapPaystackSubscriptionEventToStatus("subscription.disable"), "CANCELED");
  assert.equal(mapPaystackSubscriptionEventToStatus("charge.success"), "ACTIVE");
  assert.equal(mapPaystackSubscriptionEventToStatus("charge.failed"), "PAST_DUE");
});
