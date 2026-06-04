import assert from "node:assert/strict";
import test from "node:test";

import { ApiError, createApiServer, createDashboardService } from "../dist/index.js";

const now = new Date("2026-06-15T12:00:00.000Z");

const baseDependencies = (dashboard, overrides = {}) => ({
  now: () => now,
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
  dashboard,
  ...overrides,
});

const dashboardRequest = (server, headers = {}) => server.inject({
  method: "GET",
  url: "/dashboard",
  headers: { "x-tenant-id": "tenant-a", "x-user-id": "user-a", "x-correlation-id": "corr-dashboard", ...headers },
});

const createReadModel = (overrides = {}) => ({
  async countActiveContacts(context) {
    assert.equal(context.tenantId, "tenant-a");
    return 3;
  },
  async sumOpenPipelineValue(context) {
    assert.equal(context.tenantId, "tenant-a");
    return 12000;
  },
  async sumWonValueForPeriod(context, period) {
    assert.equal(context.tenantId, "tenant-a");
    assert.equal(period.from.toISOString(), "2026-06-01T00:00:00.000Z");
    assert.equal(period.to.toISOString(), "2026-07-01T00:00:00.000Z");
    return 5000;
  },
  async listContactsForHealth(context) {
    assert.equal(context.tenantId, "tenant-a");
    return [];
  },
  async listLatestActivities(context, limit) {
    assert.equal(context.tenantId, "tenant-a");
    assert.equal(limit, 10);
    return [];
  },
  ...overrides,
});

test("GET /dashboard requires auth", async () => {
  const server = createApiServer(baseDependencies(createDashboardService(createReadModel(), () => now)));

  const response = await dashboardRequest(server, { "x-user-id": "" });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, "TENANT_CONTEXT_MISMATCH");
});

test("GET /dashboard returns workspace-scoped metrics", async () => {
  const server = createApiServer(baseDependencies(createDashboardService(createReadModel(), () => now)));

  const response = await dashboardRequest(server);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store, no-cache, must-revalidate");
  assert.deepEqual(response.json().data.metrics, {
    activeClients: 3,
    pipelineValue: 12000,
    wonsThisMonth: 5000,
    avgResponseTimeDays: null,
  });
});

test("healthPanel sorts null and idle contacts first by lastTouchAt ASC", async () => {
  const readModel = createReadModel({
    async listContactsForHealth() {
      return [
        { id: "recent", firstName: "Recent", lastTouchAt: "2026-06-14T12:00:00.000Z" },
        { id: "old", firstName: "Old", lastTouchAt: "2026-05-25T12:00:00.000Z" },
        { id: "never", firstName: "Never", lastTouchAt: null },
      ];
    },
  });
  const server = createApiServer(baseDependencies(createDashboardService(readModel, () => now)));

  const response = await dashboardRequest(server);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().data.healthPanel.map((item) => item.contactId), ["never", "old", "recent"]);
  assert.equal(response.json().data.healthPanel[0].status, "red");
  assert.equal(response.json().data.healthPanel[0].fillPct, 0);
});

test("health statuses follow green amber and red day thresholds", async () => {
  const readModel = createReadModel({
    async listContactsForHealth() {
      return [
        { id: "green", firstName: "Green", lastTouchAt: "2026-06-08T12:00:00.000Z" },
        { id: "amber", firstName: "Amber", lastTouchAt: "2026-06-06T12:00:00.000Z" },
        { id: "red", firstName: "Red", lastTouchAt: "2026-05-31T12:00:00.000Z" },
      ];
    },
  });
  const server = createApiServer(baseDependencies(createDashboardService(readModel, () => now)));

  const response = await dashboardRequest(server);
  const statuses = Object.fromEntries(response.json().data.healthPanel.map((item) => [item.contactId, item.status]));

  assert.equal(response.statusCode, 200);
  assert.equal(statuses.green, "green");
  assert.equal(statuses.amber, "amber");
  assert.equal(statuses.red, "red");
});

test("activityFeed returns latest 10 activities only for the workspace", async () => {
  const activities = Array.from({ length: 12 }, (_, index) => ({
    id: `activity-${index + 1}`,
    contactId: index % 2 === 0 ? "contact-a" : null,
    dealId: index % 2 === 1 ? "deal-a" : null,
    type: "NOTE",
    note: `note ${index + 1}`,
    createdById: "user-a",
    createdAt: new Date(now.getTime() - index * 1000).toISOString(),
  }));
  const readModel = createReadModel({
    async listLatestActivities(context, limit) {
      assert.equal(context.tenantId, "tenant-a");
      return activities.slice(0, limit);
    },
  });
  const server = createApiServer(baseDependencies(createDashboardService(readModel, () => now)));

  const response = await dashboardRequest(server);

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.activityFeed.length, 10);
  assert.deepEqual(response.json().data.activityFeed.map((item) => item.id), activities.slice(0, 10).map((item) => item.id));
});

test("followUpAlerts includes contacts older than 7 days and excludes recent contacts", async () => {
  const readModel = createReadModel({
    async listContactsForHealth() {
      return [
        { id: "recent", firstName: "Recent", lastTouchAt: "2026-06-12T12:00:00.000Z" },
        { id: "old", firstName: "Old", lastTouchAt: "2026-06-07T12:00:00.000Z" },
        { id: "never", firstName: "Never", lastTouchAt: null },
      ];
    },
  });
  const server = createApiServer(baseDependencies(createDashboardService(readModel, () => now)));

  const response = await dashboardRequest(server);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().data.followUpAlerts.map((item) => item.contactId), ["never", "old"]);
});

test("dashboard aggregation uses a bounded number of read-model calls for 200 contacts", async () => {
  const calls = [];
  const readModel = createReadModel({
    async countActiveContacts() { calls.push("countActiveContacts"); return 200; },
    async sumOpenPipelineValue() { calls.push("sumOpenPipelineValue"); return 1000; },
    async sumWonValueForPeriod() { calls.push("sumWonValueForPeriod"); return 500; },
    async listContactsForHealth() {
      calls.push("listContactsForHealth");
      return Array.from({ length: 200 }, (_, index) => ({ id: `contact-${index}`, firstName: `Contact ${index}`, lastTouchAt: "2026-06-14T12:00:00.000Z" }));
    },
    async listLatestActivities() { calls.push("listLatestActivities"); return []; },
  });
  const server = createApiServer(baseDependencies(createDashboardService(readModel, () => now)));

  const response = await dashboardRequest(server);

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.healthPanel.length, 200);
  assert.deepEqual(calls.sort(), ["countActiveContacts", "listContactsForHealth", "listLatestActivities", "sumOpenPipelineValue", "sumWonValueForPeriod"].sort());
});
