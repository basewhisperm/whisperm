import assert from "node:assert/strict";
import test from "node:test";

import { ApiError, createApiServer, createReportsService, resolveReportPeriod } from "../dist/index.js";

const now = new Date("2026-06-15T12:00:00.000Z");

const baseDependencies = (reports, overrides = {}) => ({
  createEventId: () => "event-1",
  apiKeyAuthenticator: {
    async authenticate(input) {
      if (input.apiKey !== "valid-api-key") throw new ApiError({ code: "API_KEY_INVALID", message: "SDK API key is invalid" });
      return { tenantId: input.tenantId, apiKeyId: "api-key-1" };
    },
  },
  hmacVerifier: { async verify() { return true; } },
  idempotency: { async reserve() { return "reserved"; }, async markSucceeded() {}, async markFailed() {} },
  persistence: { async persistInboundEvent() {} },
  queue: { async enqueueInboundEvent() {} },
  reports,
  ...overrides,
});

const reportsRequest = (server, period = "this_month", headers = {}) => server.inject({
  method: "GET",
  url: `/reports?period=${period}`,
  headers: { "x-tenant-id": "tenant-a", "x-user-id": "user-a", "x-correlation-id": "corr-reports", ...headers },
});

const createReadModel = (overrides = {}) => ({
  async getCurrentPlan(context) {
    assert.equal(context.tenantId, "tenant-a");
    return { plan: "GROWTH" };
  },
  async revenueByStage(context, period) {
    assert.equal(context.tenantId, "tenant-a");
    assert.equal(period.startDate.toISOString(), "2026-06-01T00:00:00.000Z");
    assert.equal(period.endDate.toISOString(), "2026-07-01T00:00:00.000Z");
    return [];
  },
  async clientAcquisitionSources(context) {
    assert.equal(context.tenantId, "tenant-a");
    return [];
  },
  async averageDaysToClose(context) {
    assert.equal(context.tenantId, "tenant-a");
    return { avgDaysToClose: null };
  },
  async renewalRate(context) {
    assert.equal(context.tenantId, "tenant-a");
    return { rate: null };
  },
  ...overrides,
});

const reportsService = (readModel) => createReportsService(readModel, () => now);

test("resolveReportPeriod returns this month boundaries", () => {
  const period = resolveReportPeriod("this_month", now);
  assert.equal(period.startDate.toISOString(), "2026-06-01T00:00:00.000Z");
  assert.equal(period.endDate.toISOString(), "2026-06-30T00:00:00.000Z");
});

test("resolveReportPeriod returns last month boundaries", () => {
  const period = resolveReportPeriod("last_month", now);
  assert.equal(period.startDate.toISOString(), "2026-05-01T00:00:00.000Z");
  assert.equal(period.endDate.toISOString(), "2026-05-31T00:00:00.000Z");
});

test("resolveReportPeriod returns quarter boundaries", () => {
  const period = resolveReportPeriod("quarter", now);
  assert.equal(period.startDate.toISOString(), "2026-04-01T00:00:00.000Z");
  assert.equal(period.endDate.toISOString(), "2026-06-30T00:00:00.000Z");
});

test("resolveReportPeriod returns year boundaries", () => {
  const period = resolveReportPeriod("year", now);
  assert.equal(period.startDate.toISOString(), "2026-01-01T00:00:00.000Z");
  assert.equal(period.endDate.toISOString(), "2026-12-31T00:00:00.000Z");
});

test("GET /reports rejects invalid period", async () => {
  const server = createApiServer(baseDependencies(reportsService(createReadModel())));
  const response = await reportsRequest(server, "invalid");

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "REQUEST_BODY_INVALID");
});

test("GET /reports returns 402 for Starter plan", async () => {
  const server = createApiServer(baseDependencies(reportsService(createReadModel({
    async getCurrentPlan() { return { plan: "STARTER" }; },
    async revenueByStage() { assert.fail("reports should not query aggregates for Starter"); },
  }))));

  const response = await reportsRequest(server);

  assert.equal(response.statusCode, 402);
  assert.equal(response.json().error.code, "REPORTS_PLAN_REQUIRED");
});

test("GET /reports returns 200 for Growth plan", async () => {
  const server = createApiServer(baseDependencies(reportsService(createReadModel({ async getCurrentPlan() { return { plan: "GROWTH" }; } }))));

  const response = await reportsRequest(server);

  assert.equal(response.statusCode, 200);
});

test("GET /reports returns 200 for Pro plan", async () => {
  const server = createApiServer(baseDependencies(reportsService(createReadModel({ async getCurrentPlan() { return { plan: "PRO" }; } }))));

  const response = await reportsRequest(server);

  assert.equal(response.statusCode, 200);
});

test("GET /reports is workspace-scoped and never accepts workspaceId from request", async () => {
  const seenTenants = [];
  const server = createApiServer(baseDependencies(reportsService(createReadModel({
    async getCurrentPlan(context) { seenTenants.push(context.tenantId); return { plan: "GROWTH" }; },
    async revenueByStage(context) { seenTenants.push(context.tenantId); return []; },
    async clientAcquisitionSources(context) { seenTenants.push(context.tenantId); return []; },
    async averageDaysToClose(context) { seenTenants.push(context.tenantId); return { avgDaysToClose: null }; },
    async renewalRate(context) { seenTenants.push(context.tenantId); return { rate: null }; },
  }))));

  const response = await server.inject({
    method: "GET",
    url: "/reports?period=this_month&workspaceId=tenant-b",
    headers: { "x-tenant-id": "tenant-a", "x-user-id": "user-a" },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual([...new Set(seenTenants)], ["tenant-a"]);
});

test("GET /reports prevents cross-workspace leakage", async () => {
  const server = createApiServer(baseDependencies(reportsService(createReadModel({
    async getCurrentPlan(context) { assert.equal(context.tenantId, "tenant-b"); return { plan: "GROWTH" }; },
    async revenueByStage(context) {
      assert.equal(context.tenantId, "tenant-b");
      return [{ stageId: "stage-b", stageName: "Tenant B", revenue: 10 }];
    },
    async clientAcquisitionSources(context) { assert.equal(context.tenantId, "tenant-b"); return []; },
    async averageDaysToClose(context) { assert.equal(context.tenantId, "tenant-b"); return { avgDaysToClose: null }; },
    async renewalRate(context) { assert.equal(context.tenantId, "tenant-b"); return { rate: null }; },
  }))));

  const response = await reportsRequest(server, "this_month", { "x-tenant-id": "tenant-b" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().data.revenueByStage, [{ stageId: "stage-b", stageName: "Tenant B", revenue: 10 }]);
});

test("GET /reports returns revenue grouped by stage", async () => {
  const server = createApiServer(baseDependencies(reportsService(createReadModel({
    async revenueByStage() {
      return [
        { stageId: "qualified", stageName: "Qualified", revenue: 300 },
        { stageId: "proposal", stageName: "Proposal", revenue: 700 },
      ];
    },
  }))));

  const response = await reportsRequest(server);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().data.revenueByStage, [
    { stageId: "qualified", stageName: "Qualified", revenue: 300 },
    { stageId: "proposal", stageName: "Proposal", revenue: 700 },
  ]);
});

test("GET /reports returns average days to close", async () => {
  const server = createApiServer(baseDependencies(reportsService(createReadModel({
    async averageDaysToClose() { return { avgDaysToClose: 14.5 }; },
  }))));

  const response = await reportsRequest(server);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().data.averageDaysToClose, { avgDaysToClose: 14.5 });
});

test("GET /reports returns safe defaults for empty datasets", async () => {
  const server = createApiServer(baseDependencies(reportsService(createReadModel())));

  const response = await reportsRequest(server);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().data, {
    period: "this_month",
    dateRange: { startDate: "2026-06-01", endDate: "2026-06-30" },
    revenueByStage: [],
    clientAcquisitionSources: [],
    averageDaysToClose: { avgDaysToClose: null },
    renewalRate: { rate: null },
  });
});

test("GET /reports returns acquisition source aggregation", async () => {
  const server = createApiServer(baseDependencies(reportsService(createReadModel({
    async clientAcquisitionSources() {
      return [{ source: "referral", count: 2 }, { source: "website", count: 1 }];
    },
  }))));

  const response = await reportsRequest(server);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().data.clientAcquisitionSources, [{ source: "referral", count: 2 }, { source: "website", count: 1 }]);
});

test("period=this_month only queries current calendar month data", async () => {
  const server = createApiServer(baseDependencies(reportsService(createReadModel({
    async revenueByStage(context, period) {
      assert.equal(period.startDate.toISOString(), "2026-06-01T00:00:00.000Z");
      assert.equal(period.endDate.toISOString(), "2026-07-01T00:00:00.000Z");
      return [];
    },
  }))));

  const response = await reportsRequest(server, "this_month");

  assert.equal(response.statusCode, 200);
});

test("period=last_month excludes current month data", async () => {
  const readModel = createReadModel({
    async revenueByStage(context, period) {
      assert.equal(period.startDate.toISOString(), "2026-05-01T00:00:00.000Z");
      assert.equal(period.endDate.toISOString(), "2026-06-01T00:00:00.000Z");
      return [];
    },
  });
  const server = createApiServer(baseDependencies(reportsService(readModel)));

  const response = await reportsRequest(server, "last_month");

  assert.equal(response.statusCode, 200);
});
