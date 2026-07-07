import assert from "node:assert/strict";
import test from "node:test";

import {
  initWorkspaceTrial,
  createRequireActiveSubscription,
  createTrialEndsAt,
  initiateUpgrade,
  TRIAL_EXPIRED,
  BillingError,
} from "../dist/index.js";

const now = new Date("2026-01-01T00:00:00.000Z");
const trialEndsAt = createTrialEndsAt(now).toISOString();

const makeTrialStore = () => {
  const created = [];
  return { created, store: { async createTrialSubscription(input) { created.push(input); return input; } } };
};
const makeScheduler = () => ({ scheduler: { async scheduleTrialReminder() {} } });
const makeSubReader = (status, trialEnd = trialEndsAt) => ({
  async findActiveOrTrialingSubscription() {
    if (status === null) return null;
    return { status, trialEndsAt: trialEnd };
  },
});

test("new workspace receives a TRIALING subscription with trialEndsAt = now + 14 days", async () => {
  const { store, created } = makeTrialStore();
  const { scheduler } = makeScheduler();
  await initWorkspaceTrial(store, scheduler, { tenantId: "t-1", workspaceId: "ws-1", workspaceName: "Acme", ownerEmail: "owner@acme.com" }, () => now);
  assert.equal(created.length, 1);
  assert.equal(created[0].status, "TRIALING");
  assert.equal(created[0].trialEndsAt, "2026-01-15T00:00:00.000Z");
});

test("no Stripe/Paystack customer is created during trial init", async () => {
  const { store } = makeTrialStore();
  const { scheduler } = makeScheduler();
  const result = await initWorkspaceTrial(store, scheduler, { tenantId: "t-1", workspaceId: "ws-1", workspaceName: "Acme", ownerEmail: "owner@acme.com" }, () => now);
  assert.ok(!("stripeCustomerId" in result.subscription));
  assert.ok(!("paystackCustomerId" in result.subscription));
});

test("trial workspace can access protected endpoints through day 14", async () => {
  const gate = createRequireActiveSubscription(makeSubReader("TRIALING", "2026-01-15T00:00:00.000Z"), () => new Date("2026-01-14T23:59:59.000Z"));
  await assert.doesNotReject(() => gate("t-1"));
});

test("day 15 (trial end instant) is blocked with a 402 TRIAL_EXPIRED BillingError", async () => {
  const gate = createRequireActiveSubscription(makeSubReader("TRIALING", "2026-01-15T00:00:00.000Z"), () => new Date("2026-01-15T00:00:00.000Z"));
  await assert.rejects(() => gate("t-1"), (err) => err instanceof BillingError && err.statusCode === 402 && err.code === TRIAL_EXPIRED);
});

test("an ACTIVE subscription always passes the gate, regardless of trial end date", async () => {
  const gate = createRequireActiveSubscription(makeSubReader("ACTIVE", "2020-01-01T00:00:00.000Z"), () => now);
  await assert.doesNotReject(() => gate("t-1"));
});

test("no subscription at all is blocked", async () => {
  const gate = createRequireActiveSubscription(makeSubReader(null), () => now);
  await assert.rejects(() => gate("t-1"), (err) => err instanceof BillingError && err.statusCode === 402);
});

const makeUpgradePorts = () => {
  const calls = { stripe: [], paystack: [] };
  return { calls, ports: {
    stripe: { async createCustomerAndCheckout(i) { calls.stripe.push(i); return { customerId: "cus_stripe_1", checkoutUrl: "https://checkout.stripe.com/test" }; } },
    paystack: { async createCustomerAndCheckout(i) { calls.paystack.push(i); return { customerId: "CUS_paystack_1", checkoutUrl: "https://paystack.com/pay/test" }; } },
  }};
};

test("GH workspace routes upgrade to Paystack", async () => {
  const { ports, calls } = makeUpgradePorts();
  const result = await initiateUpgrade(ports, { tenantId: "t-gh", country: "GH", ownerEmail: "kwame@example.com", workspaceName: "Acme GH" }, "STARTER");
  assert.equal(result.provider, "PAYSTACK");
  assert.equal(calls.paystack.length, 1);
  assert.equal(calls.stripe.length, 0);
});

test("non-GH workspace routes upgrade to Stripe", async () => {
  const { ports, calls } = makeUpgradePorts();
  const result = await initiateUpgrade(ports, { tenantId: "t-us", country: "US", ownerEmail: "john@example.com", workspaceName: "Acme US" }, "GROWTH");
  assert.equal(result.provider, "STRIPE");
  assert.equal(calls.stripe.length, 1);
  assert.equal(calls.paystack.length, 0);
});

test("upgrade returns a usable checkout URL and provider customer id", async () => {
  const { ports } = makeUpgradePorts();
  const result = await initiateUpgrade(ports, { tenantId: "t-us", country: "US", ownerEmail: "john@example.com", workspaceName: "Acme" }, "STARTER");
  assert.ok(result.customerId.length > 0);
  assert.ok(result.checkoutUrl.startsWith("https://"));
});
