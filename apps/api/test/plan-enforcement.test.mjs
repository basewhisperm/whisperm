/**
 * plan-enforcement.test.mjs
 *
 * Tests for issue #60 — S3.3 Plan enforcement: tier limits wired into API.
 * Uses the existing BillingQuotaReader / PipelineQuotaReader DI pattern.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  planLimits,
  evaluateContactCreateQuota,
  evaluatePipelineCreateQuota,
  ApiError,
  createApiServer,
  createReportsService,
} from "../dist/index.js";

const now = new Date("2026-06-15T12:00:00.000Z");

// ---------------------------------------------------------------------------
// 1–4: planLimits unit tests
// ---------------------------------------------------------------------------

test("1. Starter limits match spec", () => {
  const l = planLimits("STARTER");
  assert.equal(l.quotas.contacts, 50);
  assert.equal(l.quotas.pipelines, 1);
  assert.equal(l.quotas.teamMembers, 1);
  assert.equal(l.features.reports, false);
  assert.equal(l.features.healthScores, false);
  assert.equal(l.features.apiAccess, false);
});

test("2. Growth limits match spec", () => {
  const l = planLimits("GROWTH");
  assert.equal(l.quotas.contacts, null);
  assert.equal(l.quotas.pipelines, 5);
  assert.equal(l.quotas.teamMembers, 5);
  assert.equal(l.features.reports, true);
  assert.equal(l.features.healthScores, true);
  assert.equal(l.features.apiAccess, false);
});

test("3. Pro limits match spec", () => {
  const l = planLimits("PRO");
  assert.equal(l.quotas.contacts, null);
  assert.equal(l.quotas.pipelines, null);
  assert.equal(l.quotas.teamMembers, null);
  assert.equal(l.features.reports, true);
  assert.equal(l.features.healthScores, true);
  assert.equal(l.features.apiAccess, true);
});

test("4. Unknown plan falls back to Starter safely", () => {
  const l = planLimits("ENTERPRISE");
  assert.equal(l.quotas.contacts, 50);
  assert.equal(l.features.reports, false);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeContactQuota = (plan, count) => ({
  async findCurrentPlan() { return plan; },
  async countContacts() { return count; },
});

const makePipelineQuota = (plan, count) => ({
  async findCurrentPlan() { return plan; },
  async countPipelines() { return count; },
});

const ctx = (tenantId = "ws-1") => ({
  tenantId,
  correlation: { correlationId: "test-corr" },
});

// ---------------------------------------------------------------------------
// 5–7: Contact quota
// ---------------------------------------------------------------------------

test("5. Starter: 50th contact allowed (count=49)", async () => {
  const d = await evaluateContactCreateQuota(makeContactQuota("STARTER", 49), ctx(), now);
  assert.equal(d.allowed, true);
});

test("6. Starter: 51st contact blocked (count=50)", async () => {
  const d = await evaluateContactCreateQuota(makeContactQuota("STARTER", 50), ctx(), now);
  assert.equal(d.allowed, false);
  assert.equal(d.code, "quota_exceeded");
  assert.equal(d.limit, 50);
});

test("7. Growth: contacts unlimited — allowed at any count", async () => {
  const d = await evaluateContactCreateQuota(makeContactQuota("GROWTH", 999999), ctx(), now);
  assert.equal(d.allowed, true);
});

// ---------------------------------------------------------------------------
// 8–10: Pipeline quota
// ---------------------------------------------------------------------------

test("8. Starter: 2nd pipeline blocked (count=1)", async () => {
  const d = await evaluatePipelineCreateQuota(makePipelineQuota("STARTER", 1), ctx(), now);
  assert.equal(d.allowed, false);
  assert.equal(d.limit, 1);
});

test("9. Growth: 6th pipeline blocked (count=5)", async () => {
  const d = await evaluatePipelineCreateQuota(makePipelineQuota("GROWTH", 5), ctx(), now);
  assert.equal(d.allowed, false);
  assert.equal(d.limit, 5);
});

test("10. Pro: pipelines unlimited", async () => {
  const d = await evaluatePipelineCreateQuota(makePipelineQuota("PRO", 999999), ctx(), now);
  assert.equal(d.allowed, true);
});

// ---------------------------------------------------------------------------
// HTTP integration: POST /contacts quota via server
// ---------------------------------------------------------------------------

const baseDeps = (overrides = {}) => ({
  createEventId: () => "event-1",
  apiKeyAuthenticator: {
    async authenticate(input) {
      if (input.apiKey !== "valid-key") throw new ApiError({ code: "API_KEY_INVALID", message: "bad key" });
      return { tenantId: input.tenantId };
    },
  },
  hmacVerifier: { async verify() { return true; } },
  idempotency: { async reserve() { return "reserved"; }, async markSucceeded() {}, async markFailed() {} },
  persistence: { async persistInboundEvent() {} },
  queue: { async enqueueInboundEvent() {} },
  ...overrides,
});

const contactsByTenant = (counts) => {
  const map = new Map(Object.entries(counts).map(([k, n]) =>
    [k, Array.from({ length: n }, (_, i) => ({ id: `${k}-${i}` }))]
  ));
  return map;
};

const makeContactService = (byTenant) => ({
  async create(ctx, input) {
    const list = byTenant.get(ctx.tenantId) ?? [];
    const contact = { id: `new-${list.length}`, ...input };
    byTenant.set(ctx.tenantId, [...list, contact]);
    return contact;
  },
  async list(ctx) { return { items: byTenant.get(ctx.tenantId) ?? [] }; },
  async get(ctx, id) { return (byTenant.get(ctx.tenantId) ?? []).find(c => c.id === id) ?? null; },
  async update(ctx, id, input) { return { id, ...input }; },
});

const makeContactQuotaService = (byTenant, planByTenant = new Map()) => ({
  async findCurrentPlan(ctx) { return planByTenant.get(ctx.tenantId) ?? "STARTER"; },
  async countContacts(ctx) { return (byTenant.get(ctx.tenantId) ?? []).length; },
});

const injectContactCreate = (server, tenantId, index) => server.inject({
  method: "POST",
  url: "/contacts",
  headers: { "x-tenant-id": tenantId, "x-correlation-id": "corr-1", "content-type": "application/json" },
  payload: { tenantId, email: `user${index}@example.com`, stage: "PROSPECT" },
});

test("11. Starter: 51st contact returns 402 QUOTA_EXCEEDED via HTTP", async () => {
  const byTenant = contactsByTenant({ "tenant-1": 50 });
  const server = createApiServer(baseDeps({
    contacts: makeContactService(byTenant),
    contactQuota: makeContactQuotaService(byTenant),
    now: () => now,
  }));
  const res = await injectContactCreate(server, "tenant-1", 51);
  assert.equal(res.statusCode, 402);
  assert.equal(res.json().error.code, "QUOTA_EXCEEDED");
  assert.equal(byTenant.get("tenant-1").length, 50);
});

test("12. Starter: 50th contact returns 201", async () => {
  const byTenant = contactsByTenant({ "tenant-1": 49 });
  const server = createApiServer(baseDeps({
    contacts: makeContactService(byTenant),
    contactQuota: makeContactQuotaService(byTenant),
    now: () => now,
  }));
  const res = await injectContactCreate(server, "tenant-1", 50);
  assert.equal(res.statusCode, 201);
});

test("13. Growth: contact creation not blocked at any count", async () => {
  const byTenant = contactsByTenant({ "tenant-growth": 999 });
  const planMap = new Map([["tenant-growth", "GROWTH"]]);
  const server = createApiServer(baseDeps({
    contacts: makeContactService(byTenant),
    contactQuota: makeContactQuotaService(byTenant, planMap),
    now: () => now,
  }));
  const res = await injectContactCreate(server, "tenant-growth", 1000);
  assert.equal(res.statusCode, 201);
});

// ---------------------------------------------------------------------------
// HTTP integration: GET /reports feature gate
// ---------------------------------------------------------------------------

const makeReportsServer = (plan) => {
  const readModel = {
    async getCurrentPlan() { return { plan }; },
    async revenueByStage() { return []; },
    async clientAcquisitionSources() { return []; },
    async averageDaysToClose() { return { avgDaysToClose: null }; },
    async renewalRate() { return { rate: null }; },
  };
  return createApiServer(baseDeps({
    reports: createReportsService(readModel, () => now),
  }));
};

const injectReports = (server) => server.inject({
  method: "GET",
  url: "/reports?period=this_month",
  headers: { "x-tenant-id": "tenant-a", "x-correlation-id": "corr-1" },
});

test("14. Starter: GET /reports returns 402", async () => {
  const res = await injectReports(makeReportsServer("STARTER"));
  assert.equal(res.statusCode, 402);
  assert.equal(res.json().error.code, "REPORTS_PLAN_REQUIRED");
});

test("15. Growth: GET /reports returns 200", async () => {
  const res = await injectReports(makeReportsServer("GROWTH"));
  assert.equal(res.statusCode, 200);
});

test("16. Pro: GET /reports returns 200", async () => {
  const res = await injectReports(makeReportsServer("PRO"));
  assert.equal(res.statusCode, 200);
});

// ---------------------------------------------------------------------------
// Job path: quota decision used before action
// ---------------------------------------------------------------------------

test("17. Job does not create contact after quota exceeded", async () => {
  let actionCalled = false;
  const decision = await evaluateContactCreateQuota(makeContactQuota("STARTER", 50), ctx(), now);
  if (decision.allowed) { actionCalled = true; }
  assert.equal(decision.allowed, false);
  assert.equal(actionCalled, false);
});

test("18. Job creates contact when within quota", async () => {
  let actionCalled = false;
  const decision = await evaluateContactCreateQuota(makeContactQuota("STARTER", 49), ctx(), now);
  if (decision.allowed) { actionCalled = true; }
  assert.equal(decision.allowed, true);
  assert.equal(actionCalled, true);
});
