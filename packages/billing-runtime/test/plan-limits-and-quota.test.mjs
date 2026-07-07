import assert from "node:assert/strict";
import test from "node:test";

import { planLimits, evaluateContactCreateQuota, evaluatePipelineCreateQuota, evaluateTeamMemberQuota } from "../dist/index.js";

test("Starter limits match spec", () => {
  const l = planLimits("STARTER");
  assert.equal(l.quotas.contacts, 50);
  assert.equal(l.quotas.pipelines, 1);
  assert.equal(l.quotas.teamMembers, 1);
  assert.equal(l.features.reports, false);
  assert.equal(l.features.healthScores, false);
  assert.equal(l.features.apiAccess, false);
});

test("Growth limits match spec", () => {
  const l = planLimits("GROWTH");
  assert.equal(l.quotas.contacts, null);
  assert.equal(l.quotas.pipelines, 5);
  assert.equal(l.quotas.teamMembers, 5);
  assert.equal(l.features.reports, true);
  assert.equal(l.features.healthScores, true);
  assert.equal(l.features.apiAccess, false);
});

test("Pro limits match spec", () => {
  const l = planLimits("PRO");
  assert.equal(l.quotas.contacts, null);
  assert.equal(l.quotas.pipelines, null);
  assert.equal(l.quotas.teamMembers, null);
  assert.equal(l.features.reports, true);
  assert.equal(l.features.healthScores, true);
  assert.equal(l.features.apiAccess, true);
});

test("unknown plan falls back to Starter safely", () => {
  const l = planLimits("ENTERPRISE");
  assert.equal(l.quotas.contacts, 50);
  assert.equal(l.features.reports, false);
});

const makeContactQuota = (plan, count) => ({
  async findCurrentPlan() { return plan; },
  async countContacts() { return count; },
});

const makePipelineQuota = (plan, count) => ({
  async findCurrentPlan() { return plan; },
  async countPipelines() { return count; },
});

const ctx = (tenantId = "ws-1") => ({ tenantId, correlation: { correlationId: "test-corr" } });

test("Starter: 50th contact allowed (count=49)", async () => {
  const d = await evaluateContactCreateQuota(makeContactQuota("STARTER", 49), ctx());
  assert.equal(d.allowed, true);
});

test("Starter: 51st contact blocked (count=50)", async () => {
  const d = await evaluateContactCreateQuota(makeContactQuota("STARTER", 50), ctx());
  assert.equal(d.allowed, false);
  assert.equal(d.code, "quota_exceeded");
  assert.equal(d.limit, 50);
});

test("Growth: contacts unlimited -- allowed at any count", async () => {
  const d = await evaluateContactCreateQuota(makeContactQuota("GROWTH", 999999), ctx());
  assert.equal(d.allowed, true);
});

test("Starter: 2nd pipeline blocked (count=1)", async () => {
  const d = await evaluatePipelineCreateQuota(makePipelineQuota("STARTER", 1), ctx());
  assert.equal(d.allowed, false);
  assert.equal(d.limit, 1);
});

test("Growth: 6th pipeline blocked (count=5)", async () => {
  const d = await evaluatePipelineCreateQuota(makePipelineQuota("GROWTH", 5), ctx());
  assert.equal(d.allowed, false);
  assert.equal(d.limit, 5);
});

test("Pro: pipelines unlimited", async () => {
  const d = await evaluatePipelineCreateQuota(makePipelineQuota("PRO", 999999), ctx());
  assert.equal(d.allowed, true);
});

test("Starter: 2nd team member blocked (count=1)", async () => {
  const d = await evaluateTeamMemberQuota("STARTER", 1);
  assert.equal(d.allowed, false);
  assert.equal(d.limit, 1);
});

test("Growth: 6th team member blocked (count=5)", async () => {
  const d = await evaluateTeamMemberQuota("GROWTH", 5);
  assert.equal(d.allowed, false);
  assert.equal(d.limit, 5);
});

test("Pro: team members unlimited", async () => {
  const d = await evaluateTeamMemberQuota("PRO", 999999);
  assert.equal(d.allowed, true);
});

test("a quota decision is checked before the guarded action runs", async () => {
  let actionCalled = false;
  const decision = await evaluateContactCreateQuota(makeContactQuota("STARTER", 50), ctx());
  if (decision.allowed) actionCalled = true;
  assert.equal(decision.allowed, false);
  assert.equal(actionCalled, false);
});

test("the guarded action runs when within quota", async () => {
  let actionCalled = false;
  const decision = await evaluateContactCreateQuota(makeContactQuota("STARTER", 49), ctx());
  if (decision.allowed) actionCalled = true;
  assert.equal(decision.allowed, true);
  assert.equal(actionCalled, true);
});
