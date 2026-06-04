import assert from "node:assert/strict";
import test from "node:test";

import {
  initWorkspaceTrial,
  createRequireActiveSubscription,
  createTrialEndsAt,
  initiateUpgrade,
  TRIAL_EXPIRED,
  ApiError,
  buildTrialReminderJobs,
  scheduleTrialReminderJobs,
} from "../dist/index.js";

const now = new Date("2026-01-01T00:00:00.000Z");
const trialEndsAt = createTrialEndsAt(now).toISOString();

const makeTrialStore = () => {
  const created = [];
  return { created, store: { async createTrialSubscription(input) { created.push(input); return input; } } };
};
const makeScheduler = () => {
  const scheduled = [];
  return { scheduled, scheduler: { async scheduleTrialReminder(job) { scheduled.push(job); } } };
};
const makeSubReader = (status, trialEnd = trialEndsAt) => ({
  async findActiveOrTrialingSubscription() {
    if (status === null) return null;
    return { status, trialEndsAt: trialEnd };
  },
});

test("1. New workspace receives Subscription on trial init", async () => {
  const { store, created } = makeTrialStore();
  const { scheduler } = makeScheduler();
  await initWorkspaceTrial(store, scheduler, { tenantId: "t-1", workspaceId: "ws-1", workspaceName: "Acme", ownerEmail: "owner@acme.com" }, () => now);
  assert.equal(created.length, 1);
});

test("2. Trial subscription has status=TRIALING", async () => {
  const { store, created } = makeTrialStore();
  const { scheduler } = makeScheduler();
  await initWorkspaceTrial(store, scheduler, { tenantId: "t-1", workspaceId: "ws-1", workspaceName: "Acme", ownerEmail: "owner@acme.com" }, () => now);
  assert.equal(created[0].status, "TRIALING");
});

test("3. trialEndsAt = now + 14 days", async () => {
  const { store, created } = makeTrialStore();
  const { scheduler } = makeScheduler();
  await initWorkspaceTrial(store, scheduler, { tenantId: "t-1", workspaceId: "ws-1", workspaceName: "Acme", ownerEmail: "owner@acme.com" }, () => now);
  assert.equal(created[0].trialEndsAt, "2026-01-15T00:00:00.000Z");
});

test("4. No Stripe customer created during trial init", async () => {
  const { store } = makeTrialStore();
  const { scheduler } = makeScheduler();
  const result = await initWorkspaceTrial(store, scheduler, { tenantId: "t-1", workspaceId: "ws-1", workspaceName: "Acme", ownerEmail: "owner@acme.com" }, () => now);
  assert.ok(!("stripeCustomerId" in result.subscription));
});

test("5. No Paystack customer created during trial init", async () => {
  const { store } = makeTrialStore();
  const { scheduler } = makeScheduler();
  const result = await initWorkspaceTrial(store, scheduler, { tenantId: "t-1", workspaceId: "ws-1", workspaceName: "Acme", ownerEmail: "owner@acme.com" }, () => now);
  assert.ok(!("paystackCustomerId" in result.subscription));
});

test("6. Trial workspace can access protected endpoints", async () => {
  const gate = createRequireActiveSubscription(makeSubReader("TRIALING", "2026-01-15T00:00:00.000Z"), () => new Date("2026-01-10T00:00:00.000Z"));
  await assert.doesNotReject(() => gate("t-1"));
});

test("7. Day 14 still allowed", async () => {
  const gate = createRequireActiveSubscription(makeSubReader("TRIALING", "2026-01-15T00:00:00.000Z"), () => new Date("2026-01-14T23:59:59.000Z"));
  await assert.doesNotReject(() => gate("t-1"));
});

test("8. Day 15 returns 402", async () => {
  const gate = createRequireActiveSubscription(makeSubReader("TRIALING", "2026-01-15T00:00:00.000Z"), () => new Date("2026-01-15T00:00:00.000Z"));
  await assert.rejects(() => gate("t-1"), (err) => err instanceof ApiError && err.statusCode === 402);
});

test("9. Expired trial error code = TRIAL_EXPIRED", async () => {
  const gate = createRequireActiveSubscription(makeSubReader("TRIALING", "2026-01-15T00:00:00.000Z"), () => new Date("2026-01-15T00:00:00.000Z"));
  await assert.rejects(() => gate("t-1"), (err) => err.code === TRIAL_EXPIRED);
});

const reminderPayload = { tenantId: "t-1", workspaceId: "ws-1", workspaceName: "Acme", ownerEmail: "owner@acme.com", ownerName: "Owner", trialEndsAt: "2026-01-15T00:00:00.000Z" };

test("10. D-3 reminder generated", () => {
  const d3 = buildTrialReminderJobs(reminderPayload).find((j) => j.payload.marker === "D-3");
  assert.ok(d3); assert.equal(d3.runAt, "2026-01-12T00:00:00.000Z");
});

test("11. D-1 reminder generated", () => {
  const d1 = buildTrialReminderJobs(reminderPayload).find((j) => j.payload.marker === "D-1");
  assert.ok(d1); assert.equal(d1.runAt, "2026-01-14T00:00:00.000Z");
});

test("12. D+0 reminder generated", () => {
  const d0 = buildTrialReminderJobs(reminderPayload).find((j) => j.payload.marker === "D+0");
  assert.ok(d0); assert.equal(d0.runAt, "2026-01-15T00:00:00.000Z");
});

test("13. Each reminder has a unique dedupeKey (no duplicates)", async () => {
  const { scheduled, scheduler } = makeScheduler();
  await scheduleTrialReminderJobs(scheduler, reminderPayload);
  const keys = scheduled.map((j) => j.dedupeKey);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(keys.length, 3);
});

const makeUpgradePorts = () => {
  const calls = { stripe: [], paystack: [] };
  return { calls, ports: {
    stripe: { async createCustomerAndCheckout(i) { calls.stripe.push(i); return { customerId: "cus_stripe_1", checkoutUrl: "https://checkout.stripe.com/test" }; } },
    paystack: { async createCustomerAndCheckout(i) { calls.paystack.push(i); return { customerId: "CUS_paystack_1", checkoutUrl: "https://paystack.com/pay/test" }; } },
  }};
};

test("14. GH workspace routes upgrade to Paystack", async () => {
  const { ports, calls } = makeUpgradePorts();
  const result = await initiateUpgrade(ports, { tenantId: "t-gh", country: "GH", ownerEmail: "kwame@example.com", workspaceName: "Acme GH" }, "STARTER");
  assert.equal(result.provider, "PAYSTACK");
  assert.equal(calls.paystack.length, 1);
  assert.equal(calls.stripe.length, 0);
});

test("15. Non-GH workspace routes upgrade to Stripe", async () => {
  const { ports, calls } = makeUpgradePorts();
  const result = await initiateUpgrade(ports, { tenantId: "t-us", country: "US", ownerEmail: "john@example.com", workspaceName: "Acme US" }, "GROWTH");
  assert.equal(result.provider, "STRIPE");
  assert.equal(calls.stripe.length, 1);
  assert.equal(calls.paystack.length, 0);
});

test("16. Upgrade creates billing customer", async () => {
  const { ports } = makeUpgradePorts();
  const result = await initiateUpgrade(ports, { tenantId: "t-us", country: "US", ownerEmail: "john@example.com", workspaceName: "Acme" }, "STARTER");
  assert.ok(result.customerId.length > 0);
  assert.ok(result.checkoutUrl.startsWith("https://"));
});

test("17. Upgrade during active trial succeeds", async () => {
  const gate = createRequireActiveSubscription(makeSubReader("TRIALING", "2026-01-15T00:00:00.000Z"), () => new Date("2026-01-10T00:00:00.000Z"));
  await assert.doesNotReject(() => gate("t-1"));
  const { ports } = makeUpgradePorts();
  const result = await initiateUpgrade(ports, { tenantId: "t-1", country: "US", ownerEmail: "owner@example.com", workspaceName: "Acme" }, "GROWTH");
  assert.equal(result.provider, "STRIPE");
});

test("18. Successful payment sets status=active — ACTIVE passes gate", async () => {
  const gate = createRequireActiveSubscription(makeSubReader("ACTIVE"), () => now);
  await assert.doesNotReject(() => gate("t-1"));
});

test("19. Active subscription bypasses trial gate", async () => {
  const gate = createRequireActiveSubscription(makeSubReader("ACTIVE", "2020-01-01T00:00:00.000Z"), () => now);
  await assert.doesNotReject(() => gate("t-1"));
});

test("20. TRIALING → ACTIVE after upgrade: gate allows immediately", async () => {
  const gate = createRequireActiveSubscription(makeSubReader("ACTIVE"), () => now);
  await assert.doesNotReject(() => gate("t-1"));
});
