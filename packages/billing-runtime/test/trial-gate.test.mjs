import assert from "node:assert/strict";
import test from "node:test";

import { createTrialEndsAt, createTrialGate, isTrialExpired } from "../dist/index.js";

const now = new Date("2026-01-01T00:00:00.000Z");

test("createTrialEndsAt gives tenants 14 days free", () => {
  assert.equal(createTrialEndsAt(now).toISOString(), "2026-01-15T00:00:00.000Z");
});

test("trial expiry helper treats expiry instant as expired", () => {
  assert.equal(isTrialExpired("2026-01-01T00:00:00.000Z", now), true);
  assert.equal(isTrialExpired("2026-01-02T00:00:00.000Z", now), false);
});

test("trial gate allows active subscription", async () => {
  const gate = createTrialGate({
    async findActiveOrTrialingSubscription() {
      return { status: "ACTIVE" };
    },
  }, () => now);

  assert.equal(await gate("tenant-1"), "allowed");
});

test("trial gate allows unexpired trialing subscription", async () => {
  const gate = createTrialGate({
    async findActiveOrTrialingSubscription() {
      return { status: "TRIALING", trialEndsAt: "2026-01-02T00:00:00.000Z" };
    },
  }, () => now);

  assert.equal(await gate("tenant-1"), "allowed");
});

test("trial gate blocks expired trialing subscription", async () => {
  const gate = createTrialGate({
    async findActiveOrTrialingSubscription() {
      return { status: "TRIALING", trialEndsAt: "2026-01-01T00:00:00.000Z" };
    },
  }, () => now);

  assert.equal(await gate("tenant-1"), "payment_required");
});

test("trial gate blocks missing subscription", async () => {
  const gate = createTrialGate({
    async findActiveOrTrialingSubscription() {
      return null;
    },
  }, () => now);

  assert.equal(await gate("tenant-1"), "payment_required");
});

test("trial gate blocks non-active non-trialing subscription states", async () => {
  for (const status of ["PAST_DUE", "CANCELED", "UNPAID", "INCOMPLETE", "INCOMPLETE_EXPIRED"]) {
    const gate = createTrialGate({
      async findActiveOrTrialingSubscription() {
        return { status };
      },
    }, () => now);

    assert.equal(await gate("tenant-1"), "payment_required");
  }
});
