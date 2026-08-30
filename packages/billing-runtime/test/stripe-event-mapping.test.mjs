import assert from "node:assert/strict";
import test from "node:test";

import { stripeEventToSubscriptionSnapshot, stripeHandledSubscriptionEventTypes } from "../dist/index.js";

const subscriptionEvent = (overrides = {}) => ({
  type: "customer.subscription.updated",
  data: {
    object: {
      id: "sub_123",
      customer: "cus_123",
      status: "active",
      cancel_at_period_end: false,
      metadata: { tenantId: "tenant-1" },
      ...overrides,
    },
  },
});

const invoiceEvent = (type, overrides = {}) => ({
  type,
  data: {
    object: {
      customer: "cus_123",
      subscription: "sub_123",
      metadata: { tenantId: "tenant-1" },
      ...overrides,
    },
  },
});

test("maps a subscription lifecycle event to a snapshot via metadata.tenantId", () => {
  const snapshot = stripeEventToSubscriptionSnapshot(subscriptionEvent());
  assert.equal(snapshot?.tenantId, "tenant-1");
  assert.equal(snapshot?.provider, "STRIPE");
  assert.equal(snapshot?.status, "ACTIVE");
  assert.equal(snapshot?.providerSubscriptionId, "sub_123");
});

test("invoice.payment_succeeded maps to an ACTIVE snapshot, invoice.payment_failed to PAST_DUE", () => {
  const succeeded = stripeEventToSubscriptionSnapshot(invoiceEvent("invoice.payment_succeeded"));
  assert.equal(succeeded?.status, "ACTIVE");

  const failed = stripeEventToSubscriptionSnapshot(invoiceEvent("invoice.payment_failed"));
  assert.equal(failed?.status, "PAST_DUE");
});

test("an invoice event with no tenantId in metadata maps to undefined rather than throwing", () => {
  const event = invoiceEvent("invoice.payment_succeeded", { metadata: {} });
  assert.equal(stripeEventToSubscriptionSnapshot(event), undefined);
});

test("an unhandled event type maps to undefined", () => {
  const event = { type: "payment_intent.created", data: { object: {} } };
  assert.equal(stripeEventToSubscriptionSnapshot(event), undefined);
  assert.equal(stripeHandledSubscriptionEventTypes.has(event.type), false);
});

test("stripeHandledSubscriptionEventTypes lists exactly the event types this module maps", () => {
  assert.deepEqual(
    [...stripeHandledSubscriptionEventTypes].sort(),
    [
      "customer.subscription.created",
      "customer.subscription.deleted",
      "customer.subscription.updated",
      "invoice.payment_failed",
      "invoice.payment_succeeded",
    ].sort(),
  );
});
