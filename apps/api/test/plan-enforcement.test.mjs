import assert from "node:assert/strict";
import test from "node:test";

import {
  planLimits,
  enforceQuota,
  assertFeature,
  setPlanResolver,
  setCurrentCountResolver,
  setFeaturePlanResolver,
  PLAN_LIMIT_EXCEEDED,
  ApiError,
  createApiServer,
  createReportsService,
} from "../dist/index.js";

const wireQuota = (plan, count) => {
  const resolver = async () => plan;
  setPlanResolver(resolver);
  setCurrentCountResolver(async () => count);
  setFeaturePlanResolver(resolver);
};

const assertPlanLimitExceeded = async (promise) => {
  try {
    await promise;
    assert.fail("Expected ApiError with PLAN_LIMIT_EXCEEDED");
  } catch (err) {
    assert.ok(err instanceof ApiError, `Expected ApiError, got ${err?.constructor?.name}`);
    assert.equal(err.code, PLAN_LIMIT_EXCEEDED);
    assert.equal(err.statusCode, 402);
  }
};

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

test("5. Starter: 50th contact allowed (count=49)", async () => {
  wireQuota("STARTER", 49);
  await assert.doesNotReject(() => enforceQuota({ tenantId: "ws-1", resource: "contacts" }));
});

test("6. Starter: 51st contact returns 402 PLAN_LIMIT_EXCEEDED (count=50)", async () => {
  wireQuota("STARTER", 50);
  await assertPlanLimitExceeded(enforceQuota({ tenantId: "ws-1", resource: "contacts" }));
});

test("7. Growth: contacts unlimited — passes at any count", async () => {
  wireQuota("GROWTH", 999999);
  await assert.doesNotReject(() => enforceQuota({ tenantId: "ws-2", resource: "contacts" }));
});

test("8. Starter: 2nd pipeline returns 402 (count=1)", async () => {
  wireQuota("STARTER", 1);
  await assertPlanLimitExceeded(enforceQuota({ tenantId: "ws-1", resource: "pipelines" }));
});

test("9. Growth: 6th pipeline returns 402 (count=5)", async () => {
  wireQuota("GROWTH", 5);
  await assertPlanLimitExceeded(enforceQuota({ tenantId: "ws-2", resource: "pipelines" }));
});

test("10. Pro: pipelines unlimited", async () => {
  wireQuota("PRO", 999999);
  await assert.doesNotReject(() => enforceQuota({ tenantId: "ws-3", resource: "pipelines" }));
});

test("11. Starter: 2nd team member returns 402 (count=1)", async () => {
  wireQuota("STARTER", 1);
  await assertPlanLimitExceeded(enforceQuota({ tenantId: "ws-1", resource: "teamMembers" }));
});

test("12. Growth: 6th team member returns 402 (count=5)", async () => {
  wireQuota("GROWTH", 5);
  await assertPlanLimitExceeded(enforceQuota({ tenantId: "ws-2", resource: "teamMembers" }));
});

test("13. Pro: team members unlimited", async () => {
  wireQuota("PRO", 999999);
  await assert.doesNotReject(() => enforceQuota({ tenantId: "ws-3", resource: "teamMembers" }));
});

test("14. Starter: reports throws 402", async () => {
  wireQuota("STARTER", 0);
  await assertPlanLimitExceeded(assertFeature({ tenantId: "ws-1", feature: "reports" }));
});

test("15. Growth: reports allowed", async () => {
  wireQuota("GROWTH", 0);
  await assert.doesNotReject(() => assertFeature({ tenantId: "ws-2", feature: "reports" }));
});

test("16. Pro: reports allowed", async () => {
  wireQuota("PRO", 0);
  await assert.doesNotReject(() => assertFeature({ tenantId: "ws-3", feature: "reports" }));
});

test("17. Starter: healthScores throws 402", async () => {
  wireQuota("STARTER", 0);
  await assertPlanLimitExceeded(assertFeature({ tenantId: "ws-1", feature: "healthScores" }));
});

test("18. Starter: apiAccess throws 402", async () => {
  wireQuota("STARTER", 0);
  await assertPlanLimitExceeded(assertFeature({ tenantId: "ws-1", feature: "apiAccess" }));
});

test("19. Growth: apiAccess throws 402", async () => {
  wireQuota("GROWTH", 0);
  await assertPlanLimitExceeded(assertFeature({ tenantId: "ws-2", feature: "apiAccess" }));
});

test("20. Pro: apiAccess allowed", async () => {
  wireQuota("PRO", 0);
  await assert.doesNotReject(() => assertFeature({ tenantId: "ws-3", feature: "apiAccess" }));
});

test("21. enforceQuota skips count resolver for unlimited resources", async () => {
  let countCalls = 0;
  setPlanResolver(async () => "GROWTH");
  setCurrentCountResolver(async () => { countCalls++; return 0; });
  setFeaturePlanResolver(async () => "GROWTH");
  await enforceQuota({ tenantId: "ws-bg", resource: "contacts" });
  assert.equal(countCalls, 0, "Count resolver must not be called for unlimited resources");
});

test("22. Job does not create resource after limit exceeded", async () => {
  wireQuota("STARTER", 50);
  let jobActionCalled = false;
  const runJob = async (tenantId) => {
    await enforceQuota({ tenantId, resource: "contacts" });
    jobActionCalled = true;
  };
  try {
    await runJob("ws-1");
    assert.fail("Expected limit error");
  } catch (err) {
    assert.ok(err instanceof ApiError);
    assert.equal(err.code, PLAN_LIMIT_EXCEEDED);
  }
  assert.equal(jobActionCalled, false, "Job action must not run when quota exceeded");
});

const makeReportsServer = (plan) => {
  const resolver = async () => plan;
  setPlanResolver(resolver);
  setCurrentCountResolver(async () => 0);
  setFeaturePlanResolver(resolver);
  const now = new Date("2026-06-15T12:00:00.000Z");
  const readModel = {
    async getCurrentPlan() { return { plan }; },
    async revenueByStage() { return []; },
    async clientAcquisitionSources() { return []; },
    async averageDaysToClose() { return { avgDaysToClose: null }; },
    async renewalRate() { return { rate: null }; },
  };
  return createApiServer({
    createEventId: () => "event-1",
    apiKeyAuthenticator: { async authenticate(i) { if (i.apiKey !== "k") throw new ApiError({ code: "API_KEY_INVALID", message: "bad" }); return { tenantId: i.tenantId }; } },
    hmacVerifier: { async verify() { return true; } },
    idempotency: { async reserve() { return "reserved"; }, async markSucceeded() {}, async markFailed() {} },
    persistence: { async persistInboundEvent() {} },
    queue: { async enqueueInboundEvent() {} },
    reports: createReportsService(readModel, () => now),
  });
};

test("GET /reports returns 402 for Starter", async () => {
  const res = await makeReportsServer("STARTER").inject({ method: "GET", url: "/reports?period=this_month", headers: { "x-tenant-id": "t-1", "x-correlation-id": "c-1" } });
  assert.equal(res.statusCode, 402);
  assert.equal(res.json().error.code, PLAN_LIMIT_EXCEEDED);
});

test("GET /reports returns 200 for Growth", async () => {
  const res = await makeReportsServer("GROWTH").inject({ method: "GET", url: "/reports?period=this_month", headers: { "x-tenant-id": "t-1", "x-correlation-id": "c-1" } });
  assert.equal(res.statusCode, 200);
});

test("GET /reports returns 200 for Pro", async () => {
  const res = await makeReportsServer("PRO").inject({ method: "GET", url: "/reports?period=this_month", headers: { "x-tenant-id": "t-1", "x-correlation-id": "c-1" } });
  assert.equal(res.statusCode, 200);
});
