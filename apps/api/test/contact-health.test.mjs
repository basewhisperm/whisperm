import assert from "node:assert/strict";
import test from "node:test";

import { computeContactHealth } from "../dist/crm/contact-health.js";

const now = new Date("2026-06-15T12:00:00.000Z");
const daysAgo = (days) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

const assertFillBetween = (actual, min, max) => {
  assert.equal(actual >= min, true);
  assert.equal(actual <= max, true);
};

test("computeContactHealth returns red empty health for null last touch", () => {
  assert.deepEqual(computeContactHealth(null, now), { status: "red", fillPct: 0, daysSinceLastTouch: null });
});

test("computeContactHealth returns green for one day idle", () => {
  const health = computeContactHealth(daysAgo(1), now);
  assert.equal(health.status, "green");
  assert.equal(health.daysSinceLastTouch, 1);
  assertFillBetween(health.fillPct, 70, 100);
});

test("computeContactHealth returns green for seven days idle", () => {
  const health = computeContactHealth(daysAgo(7), now);
  assert.equal(health.status, "green");
  assert.equal(health.daysSinceLastTouch, 7);
  assertFillBetween(health.fillPct, 70, 100);
});

test("computeContactHealth returns amber for eight days idle", () => {
  const health = computeContactHealth(daysAgo(8), now);
  assert.equal(health.status, "amber");
  assert.equal(health.daysSinceLastTouch, 8);
  assertFillBetween(health.fillPct, 35, 69);
});

test("computeContactHealth returns amber for fourteen days idle", () => {
  const health = computeContactHealth(daysAgo(14), now);
  assert.equal(health.status, "amber");
  assert.equal(health.daysSinceLastTouch, 14);
  assertFillBetween(health.fillPct, 35, 69);
});

test("computeContactHealth returns red for fifteen days idle", () => {
  const health = computeContactHealth(daysAgo(15), now);
  assert.equal(health.status, "red");
  assert.equal(health.daysSinceLastTouch, 15);
  assertFillBetween(health.fillPct, 0, 34);
});
