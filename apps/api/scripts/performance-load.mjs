import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { ApiError, createApiServer, createDashboardService } from "../dist/index.js";

const createDependencies = (overrides = {}) => ({
  now: () => new Date("2026-01-01T00:00:00.000Z"),
  apiKeyAuthenticator: { async authenticate(input) { return { tenantId: input.tenantId, apiKeyId: "api-key-1" }; } },
  hmacVerifier: { async verify() { return true; } },
  idempotency: { async reserve() { return "reserved"; }, async markSucceeded() {}, async markFailed() {} },
  persistence: { async persistInboundEvent() {} },
  queue: { async enqueueInboundEvent() {} },
  ...overrides,
});

const percentile = (values, p) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * p) - 1] ?? 0;
};

const measure = async (name, iterations, targetMs, work) => {
  const durations = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    await work(index);
    durations.push(performance.now() - started);
  }
  const p95 = percentile(durations, 0.95);
  console.log(`${name}: p95=${p95.toFixed(2)}ms target=${targetMs}ms iterations=${iterations}`);
  assert.ok(p95 < targetMs, `${name} p95 ${p95.toFixed(2)}ms exceeded ${targetMs}ms`);
};

const tenantId = "workspace-perf";
const contacts = Array.from({ length: 200 }, (_, index) => ({
  id: `contact-${String(index).padStart(3, "0")}`,
  firstName: "Perf",
  lastName: `Contact ${index}`,
  email: `perf-${index}@example.test`,
  lastTouchAt: new Date(Date.UTC(2025, 11, 1, 0, 0, index)).toISOString(),
}));
const activities = Array.from({ length: 20 }, (_, index) => ({
  id: `activity-${String(index).padStart(3, "0")}`,
  contactId: contacts[index % contacts.length].id,
  dealId: null,
  type: "NOTE",
  note: "Synthetic local performance activity",
  createdById: "user-perf",
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
}));

const dashboard = createDashboardService({
  async countActiveContacts(context) { assert.equal(context.tenantId, tenantId); return contacts.length; },
  async sumOpenPipelineValue(context) { assert.equal(context.tenantId, tenantId); return 50000; },
  async sumWonValueForPeriod(context) { assert.equal(context.tenantId, tenantId); return 12000; },
  async listContactsForHealth(context) { assert.equal(context.tenantId, tenantId); return contacts; },
  async listContactsForFollowUpAlerts(context) { assert.equal(context.tenantId, tenantId); return contacts.slice(0, 25); },
  async getFollowUpReminderEnabled(context) { assert.equal(context.tenantId, tenantId); return true; },
  async listLatestActivities(context, limit) { assert.equal(context.tenantId, tenantId); return activities.slice(0, limit); },
}, () => new Date("2026-01-01T00:00:00.000Z"));

const deals = {
  async board(context, pipelineId, pagination) {
    assert.equal(context.tenantId, tenantId);
    assert.equal(pipelineId, "pipeline-perf");
    const limit = pagination?.limit ?? 25;
    if (limit > 100) throw new ApiError({ code: "REQUEST_BODY_INVALID", message: "limit exceeds max", statusCode: 400 });
    return {
      pipeline: { id: pipelineId, name: "Perf Pipeline" },
      columns: [{
        id: "stage-perf",
        name: "Open",
        position: 1,
        deals: {
          limit,
          items: Array.from({ length: 50 }, (_, index) => ({ id: `deal-${index}`, title: `Deal ${index}`, dealValue: "1000", currency: "USD", owner: null, probability: 50, stageId: "stage-perf", updatedAt: "2026-01-01T00:00:00.000Z" })),
        },
      }],
    };
  },
  async createCard() { throw new Error("unexpected create"); },
  async moveStage() { throw new Error("unexpected move"); },
  async detail() { throw new Error("unexpected detail"); },
};

const server = createApiServer(createDependencies({ dashboard, deals }));

await measure("GET /dashboard with 200 contacts", 50, 300, async (index) => {
  const response = await server.inject({ method: "GET", url: "/dashboard", headers: { "x-tenant-id": tenantId, "x-user-id": "user-perf", "x-correlation-id": `perf-dashboard-${index}` } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.healthPanel.length, 200);
});

await measure("GET /pipelines/:id/board with 50 deals", 50, 500, async (index) => {
  const response = await server.inject({ method: "GET", url: "/pipelines/pipeline-perf/board?limit=50", headers: { "x-tenant-id": tenantId, "x-correlation-id": `perf-board-${index}` } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.columns[0].deals.items.length, 50);
});

await server.close();
