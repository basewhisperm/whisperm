import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

// ST1-010: apps/web/test/acquisition-usage-metering.test.js previously only regex-matched the
// usage route/service source text (e.g. asserting the literal string "createIfNotExists" appears
// somewhere in the service file). That proves nothing about whether the route actually returns a
// truthful summary, rejects bad periods, or leaks another tenant's usage. This harness transpiles
// and invokes the real usage route against a fake acquisitionUsageEvents repository so a response
// shape or tenant-isolation regression actually fails the test.

const tenantId = 'tenant-1';
const otherTenantId = 'tenant-2';

const usageEventsRepo = (state) => ({
  async createIfNotExists(scope, input) {
    const existing = state.usageEvents.find((e) => e.tenantId === scope.tenantId && e.idempotencyKey === input.idempotencyKey);
    if (existing !== undefined) return existing;
    const record = { id: `usage-${state.usageEvents.length + 1}`, tenantId: scope.tenantId, quantity: 1, billable: true, ...input };
    state.usageEvents.push(record);
    return record;
  },
  async summarizeByTenantAndPeriod(scope, periodStart, periodEnd) {
    const startMs = periodStart.getTime();
    const endMs = periodEnd.getTime();
    const rows = state.usageEvents.filter((e) => e.tenantId === scope.tenantId && Date.parse(e.occurredAt) >= startMs && Date.parse(e.occurredAt) <= endMs);
    const byType = new Map();
    for (const row of rows) {
      const bucket = byType.get(row.eventType) ?? { eventType: row.eventType, quantity: 0, billableQuantity: 0 };
      bucket.quantity += row.quantity;
      if (row.billable) bucket.billableQuantity += row.quantity;
      byType.set(row.eventType, bucket);
    }
    const totals = [...byType.values()];
    return {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      totals,
      totalQuantity: totals.reduce((sum, t) => sum + t.quantity, 0),
      billableTotalQuantity: totals.reduce((sum, t) => sum + t.billableQuantity, 0),
    };
  },
  async listByTenantAndPeriod() { return { items: [] }; },
});

const servicesUrl = import.meta.resolve('@whisperm/services');
const zodUrl = import.meta.resolve('zod');

const transpileRoute = (routePath, tempDir) => {
  const source = readFileSync(routePath, 'utf8')
    .replace(/from "next\/server"/gu, `from "${join(tempDir, 'next-server.mjs')}"`)
    .replace(/from "@\/lib\/get-tenant"/gu, `from "${join(tempDir, 'get-tenant.mjs')}"`)
    .replace(/from "@\/lib\/prisma"/gu, `from "${join(tempDir, 'prisma.mjs')}"`)
    .replace(/from "@\/lib\/tenant-features"/gu, `from "${join(tempDir, 'tenant-features.mjs')}"`)
    .replace(/from "@\/lib\/billing\/plan-usage"/gu, `from "${join(tempDir, 'plan-usage.mjs')}"`)
    .replaceAll('from "@whisperm/repositories"', `from "${join(tempDir, 'repositories.mjs')}"`)
    .replaceAll('from "@whisperm/services"', `from "${servicesUrl}"`)
    .replaceAll('from "zod"', `from "${zodUrl}"`);
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const file = join(tempDir, 'usage-route.mjs');
  writeFileSync(file, output);
  return import(file);
};

const makeRequest = (query = '') => {
  const url = `https://app.test/api/marketplace-acquisition/usage${query}`;
  const request = new Request(url);
  request.nextUrl = new URL(url);
  return request;
};

const createHarness = async (state) => {
  const tempDir = join(tmpdir(), `whisperm-usage-route-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempDir);
  writeFileSync(join(tempDir, 'next-server.mjs'), 'export class NextResponse extends Response { static json(body, init) { return Response.json(body, init); } }\nexport class NextRequest extends Request {}\n');
  writeFileSync(join(tempDir, 'get-tenant.mjs'), 'export const getTenantForCurrentUser = async () => globalThis.__usageRouteState.tenant;\n');
  writeFileSync(join(tempDir, 'tenant-features.mjs'), [
    'export const featureNotEnabledResponse = () => Response.json({ ok: false, error: { message: "Seller Acquisition add-on is not enabled for this workspace." } }, { status: 403 });',
    'export const requireSellerAcquisitionFeatureForApi = async () => (globalThis.__usageRouteState.featureEnabled ? null : featureNotEnabledResponse());',
  ].join('\n'));
  writeFileSync(join(tempDir, 'prisma.mjs'), 'export const prisma = {};\n');
  writeFileSync(join(tempDir, 'plan-usage.mjs'), 'export const getCurrentPlanUsage = async () => ({ plan: "STARTER", includedBillableActions: 250, usedBillableActions: 2, remainingBillableActions: 248 });\n');
  writeFileSync(join(tempDir, 'repositories.mjs'), [
    'export const createPrismaRepositories = () => ({ acquisitionUsageEvents: globalThis.__usageRouteRepos.acquisitionUsageEvents });',
  ].join('\n'));
  globalThis.__usageRouteState = state;
  globalThis.__usageRouteRepos = { acquisitionUsageEvents: usageEventsRepo(state) };
  const base = new URL('../src/app/api/marketplace-acquisition/usage/route.ts', import.meta.url).pathname;
  return {
    cleanup: () => { delete globalThis.__usageRouteState; delete globalThis.__usageRouteRepos; rmSync(tempDir, { recursive: true, force: true }); },
    route: await transpileRoute(base, tempDir),
  };
};

const makeState = () => ({
  tenant: { id: tenantId },
  featureEnabled: true,
  usageEvents: [
    { tenantId, eventType: 'SELLER_DISCOVERED', quantity: 1, billable: true, occurredAt: '2026-07-02T00:00:00.000Z', idempotencyKey: 'a' },
    { tenantId, eventType: 'SELLER_QUALIFIED', quantity: 1, billable: true, occurredAt: '2026-07-02T00:00:00.000Z', idempotencyKey: 'b' },
    { tenantId, eventType: 'SELLER_QUALIFIED', quantity: 1, billable: false, occurredAt: '2026-07-02T00:00:00.000Z', idempotencyKey: 'c' },
    { tenantId: otherTenantId, eventType: 'SELLER_QUALIFIED', quantity: 1, billable: true, occurredAt: '2026-07-02T00:00:00.000Z', idempotencyKey: 'd' },
  ],
});

test('unauthenticated requests never reach the service and get 401', async () => {
  const state = makeState();
  state.tenant = null;
  const harness = await createHarness(state);
  try {
    const response = await harness.route.GET(makeRequest());
    assert.equal(response.status, 401);
  } finally {
    harness.cleanup();
  }
});

test('feature-gated tenants never reach the service', async () => {
  const state = makeState();
  state.featureEnabled = false;
  const harness = await createHarness(state);
  try {
    const response = await harness.route.GET(makeRequest());
    assert.equal(response.status, 403);
  } finally {
    harness.cleanup();
  }
});

test('rejects an invalid period with 400 instead of a false 200', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    const response = await harness.route.GET(makeRequest('?periodStart=not-a-date&periodEnd=2026-07-03T00:00:00.000Z'));
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.ok, false);
  } finally {
    harness.cleanup();
  }
});

test('rejects periodStart after periodEnd', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    const response = await harness.route.GET(makeRequest('?periodStart=2026-07-03T00:00:00.000Z&periodEnd=2026-07-01T00:00:00.000Z'));
    assert.equal(response.status, 400);
  } finally {
    harness.cleanup();
  }
});

test('returns the real per-tenant summary, never another tenant\'s totals', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    const response = await harness.route.GET(makeRequest('?periodStart=2026-07-01T00:00:00.000Z&periodEnd=2026-07-03T00:00:00.000Z'));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.ok, true);
    // 2 SELLER_QUALIFIED events for tenant-1 (one billable, one not) must be summed, not
    // duplicated, and tenant-2's event must never leak in.
    const qualified = body.data.totals.find((t) => t.eventType === 'SELLER_QUALIFIED');
    assert.equal(qualified.quantity, 2);
    assert.equal(qualified.billableQuantity, 1);
    assert.equal(body.data.billableTotalQuantity, 2);
    assert.equal(body.data.plan, 'STARTER');
    assert.equal(body.data.includedBillableActions, 250);
    assert.equal(body.data.remainingBillableActions, 248);
  } finally {
    harness.cleanup();
  }
});

test('a duplicate idempotency key does not double-count usage', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  await usageEventsRepo(state).createIfNotExists({ tenantId }, { eventType: 'SELLER_QUALIFIED', quantity: 1, billable: true, occurredAt: '2026-07-02T00:00:00.000Z', idempotencyKey: 'b' });
  try {
    const response = await harness.route.GET(makeRequest('?periodStart=2026-07-01T00:00:00.000Z&periodEnd=2026-07-03T00:00:00.000Z'));
    const body = await response.json();
    const qualified = body.data.totals.find((t) => t.eventType === 'SELLER_QUALIFIED');
    assert.equal(qualified.quantity, 2, 'duplicate idempotencyKey "b" must not be recorded twice');
  } finally {
    harness.cleanup();
  }
});

test('defaults to the current UTC month when no period is given', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    const response = await harness.route.GET(makeRequest());
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(typeof body.data.periodStart === 'string' && typeof body.data.periodEnd === 'string');
  } finally {
    harness.cleanup();
  }
});

test('a repository failure returns a safe 500 rather than a false 200', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  globalThis.__usageRouteRepos.acquisitionUsageEvents.summarizeByTenantAndPeriod = async () => { throw new Error('summary computation failed'); };
  try {
    const response = await harness.route.GET(makeRequest());
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.ok, false);
  } finally {
    harness.cleanup();
  }
});
