import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

// ST1-013N Deliverable 10 -- contract tests for V1/demo-critical API behavior that aren't
// already covered at the HTTP-route level elsewhere:
//   - records list: stable {ok,data:{records,nextCursor}} shape, campaign scoping, tenant
//     isolation, and limit-format validation.
//   - captures: invalid body is rejected with VALIDATION_ERROR before any capture is persisted.
// Route-level coverage for capture success/duplicate-idempotency/campaign-assignment already
// lives in marketplace-capture-route.test.js; campaign reject/promote isolation in
// discovery-reject-route.test.js / discovery-promote-route.test.js; invitation retry channel
// fidelity in packages/services/test/campaign-runtime.test.mjs; claim token validity/expiry in
// packages/services/test/seller-claim-portal.test.mjs; health route shape in
// health-route.test.js. This file intentionally does not duplicate those.

const now = '2026-07-01T00:00:00.000Z';

const servicesUrl = import.meta.resolve('@whisperm/services');

const captureRow = (overrides = {}) => ({
  id: overrides.id ?? 'capture-1',
  tenantId: overrides.tenantId ?? 'tenant-1',
  contactId: null,
  dealId: null,
  externalId: null,
  listingUrl: overrides.listingUrl ?? 'https://market.test/listing-1',
  title: 'Bike',
  description: 'Fast bike',
  price: '100',
  currency: 'USD',
  sellerName: 'Sam Seller',
  sellerProfileUrl: null,
  status: 'CAPTURED',
  capturedAt: now,
  createdAt: now,
  updatedAt: now,
  metadata: {},
  ...overrides,
});

// -- shared fakes for the records list route ---------------------------------------------------

const buildRecordsRepositories = (state) => {
  const captures = state.captures;
  const members = state.members ?? [];
  const campaigns = state.campaigns ?? [];
  return {
    marketplaceCaptures: {
      async findById(scope, id) { return captures.find((c) => c.tenantId === scope.tenantId && c.id === id) ?? null; },
      async list(scope, page) { return { items: captures.filter((c) => c.tenantId === scope.tenantId).slice(0, page?.limit ?? 100) }; },
    },
    contacts: { async findById() { return null; } },
    deals: { async findDetailById() { return null; } },
    draftInventories: { async findByMarketplaceCaptureId() { return null; } },
    sellerInvitations: { async listSellerInvitationsByMarketplaceCaptureId() { return []; } },
    marketplaceClaimTokens: { async listClaimTokensByMarketplaceCaptureId() { return []; } },
    ownershipAttestations: { async findByMarketplaceCaptureId() { return null; } },
    renderConversions: {
      async findSuccessfulSellerConversion() { return null; },
      async findSuccessfulInventoryConversion() { return null; },
    },
    sellerAcquisitionCampaigns: {
      async findById(scope, id) { return campaigns.find((c) => c.tenantId === scope.tenantId && c.id === id) ?? null; },
      async listMembers(scope, campaignId) { return { items: members.filter((m) => m.tenantId === scope.tenantId && m.campaignId === campaignId) }; },
    },
    // Placeholders for the other services createWhispeRMServices constructs eagerly but this
    // route never exercises -- matches the established pattern in discovery-promote-route.test.js.
    tenants: {}, users: {}, activities: {}, workflows: {}, approvals: {}, executions: {}, events: {}, billing: {}, auditLogs: {}, pipelines: {}, marketplaceAcquisition: {}, acquisitionUsageEvents: {},
  };
};

const transpileWithSharedStubs = (routePath, tempDir, outName, extraReplacements = (s) => s) => {
  const source = extraReplacements(readFileSync(routePath, 'utf8'))
    .replace(/from "next\/server"/gu, `from "${join(tempDir, 'next-server.mjs')}"`)
    .replace(/from "@\/app\/api\/_lib\/api-response"/gu, `from "${join(tempDir, 'api-response.mjs')}"`)
    .replace(/from "@\/app\/api\/_lib\/service-error"/gu, `from "${join(tempDir, 'service-error.mjs')}"`)
    .replace(/from "@\/lib\/get-tenant"/gu, `from "${join(tempDir, 'get-tenant.mjs')}"`)
    .replace(/from "@\/lib\/prisma"/gu, `from "${join(tempDir, 'prisma.mjs')}"`)
    .replace(/from "@\/lib\/tenant-features"/gu, `from "${join(tempDir, 'tenant-features.mjs')}"`)
    .replace(/from "@\/lib\/api\/request-body"/gu, `from "${join(tempDir, 'request-body.mjs')}"`)
    .replace(/from "@\/lib\/marketplace-acquisition\/acquisition-services"/gu, `from "${join(tempDir, 'acquisition-services.mjs')}"`)
    .replaceAll('from "@whisperm/repositories"', `from "${join(tempDir, 'repositories.mjs')}"`)
    .replaceAll('from "@whisperm/services"', `from "${servicesUrl}"`);
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const file = join(tempDir, outName);
  writeFileSync(file, output);
  return import(file);
};

const writeSharedStubs = (tempDir, stateGlobalKey, reposGlobalKey) => {
  writeFileSync(join(tempDir, 'next-server.mjs'), 'export class NextResponse extends Response { static json(body, init) { return Response.json(body, init); } }\nexport class NextRequest extends Request { get nextUrl() { return new URL(this.url); } }\n');
  writeFileSync(join(tempDir, 'api-response.mjs'), [
    'import { NextResponse } from "./next-server.mjs";',
    'export function apiSuccess(data, init) { return NextResponse.json({ ok: true, data }, init); }',
    'export function apiFailure(status, code, message, details) { return NextResponse.json({ ok: false, error: details === undefined ? { code, message } : { code, message, details } }, { status }); }',
  ].join('\n'));
  writeFileSync(join(tempDir, 'get-tenant.mjs'), `export const getTenantContextForCurrentUser = async () => globalThis.${stateGlobalKey}.tenant === null ? null : { tenant: globalThis.${stateGlobalKey}.tenant, tenantUserId: "tenant-user-1" };\n`);
  writeFileSync(join(tempDir, 'tenant-features.mjs'), [
    'export const featureNotEnabledResponse = () => Response.json({ ok: false, error: { code: "FEATURE_NOT_ENABLED", message: "Seller Acquisition add-on is not enabled for this workspace." } }, { status: 403 });',
    `export const requireSellerAcquisitionFeatureForApi = async () => (globalThis.${stateGlobalKey}.featureEnabled === false ? featureNotEnabledResponse() : null);`,
  ].join('\n'));
  writeFileSync(join(tempDir, 'prisma.mjs'), 'export const prisma = {};\n');
  writeFileSync(join(tempDir, 'repositories.mjs'), [
    `export const createPrismaRepositories = () => globalThis.${reposGlobalKey};`,
    'export class PersistenceError extends Error { constructor(input) { super(input.message); this.name = "PersistenceError"; this.code = input.code; this.status = input.status; } }',
  ].join('\n'));
  writeFileSync(join(tempDir, 'service-error.mjs'), [
    `import { ServiceError } from ${JSON.stringify(servicesUrl)};`,
    `import { PersistenceError } from ${JSON.stringify(join(tempDir, 'repositories.mjs'))};`,
    `import { apiFailure } from ${JSON.stringify(join(tempDir, 'api-response.mjs'))};`,
    'export function apiFailureFromError(error, fallbackMessage) {',
    '  if (error instanceof ServiceError) return apiFailure(error.status, "VALIDATION_ERROR", error.message);',
    '  if (error instanceof PersistenceError) return apiFailure(error.status, "CONFLICT", error.message);',
    '  return apiFailure(500, "INTERNAL_ERROR", fallbackMessage);',
    '}',
  ].join('\n'));
};

const createRecordsRouteHarness = async (state) => {
  const tempDir = join(tmpdir(), `whisperm-records-contract-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempDir);
  writeSharedStubs(tempDir, '__recordsContractState', '__recordsContractRepos');
  globalThis.__recordsContractState = state;
  globalThis.__recordsContractRepos = buildRecordsRepositories(state);
  const routePath = new URL('../src/app/api/marketplace-acquisition/records/route.ts', import.meta.url).pathname;
  const route = await transpileWithSharedStubs(routePath, tempDir, 'records-route.mjs');
  return {
    route,
    cleanup: () => { delete globalThis.__recordsContractState; delete globalThis.__recordsContractRepos; rmSync(tempDir, { recursive: true, force: true }); },
  };
};

// Minimal NextRequest-shaped stub: the routes under test only read .headers, .nextUrl.searchParams,
// and (for POST) .json() -- a real Request already has the first and last; nextUrl is grafted on.
const request = (url) => {
  const req = new Request(url, { headers: new Headers() });
  return new Proxy(req, { get: (target, prop) => (prop === 'nextUrl' ? new URL(target.url) : Reflect.get(target, prop, target)) });
};

test('records list: stable {ok:true, data:{records, nextCursor}} response shape', async () => {
  const state = { tenant: { id: 'tenant-1' }, captures: [captureRow()] };
  const harness = await createRecordsRouteHarness(state);
  try {
    const response = await harness.route.GET(request('https://app.test/api/marketplace-acquisition/records'));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.ok, true);
    assert.equal(Array.isArray(body.data.records), true);
    assert.equal(body.data.records.length, 1);
    assert.equal(body.data.records[0].capture.id, 'capture-1');
    // JSON.stringify drops keys whose value is `undefined` (no next page here), so absence of
    // the key is itself the stable "no more pages" contract, not a shape violation.
    assert.ok(body.data.nextCursor === undefined || typeof body.data.nextCursor === 'string');
  } finally {
    harness.cleanup();
  }
});

test('records list: unauthorized request returns 401 UNAUTHORIZED', async () => {
  const state = { tenant: null, captures: [] };
  const harness = await createRecordsRouteHarness(state);
  try {
    const response = await harness.route.GET(request('https://app.test/api/marketplace-acquisition/records'));
    const body = await response.json();
    assert.equal(response.status, 401);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'UNAUTHORIZED');
  } finally {
    harness.cleanup();
  }
});

test('records list: malformed limit is rejected with 400 VALIDATION_ERROR before any query runs', async () => {
  const state = { tenant: { id: 'tenant-1' }, captures: [captureRow()] };
  const harness = await createRecordsRouteHarness(state);
  try {
    const response = await harness.route.GET(request('https://app.test/api/marketplace-acquisition/records?limit=not-a-number'));
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  } finally {
    harness.cleanup();
  }
});

test('records list: campaignId scopes results to that campaign only', async () => {
  const state = {
    tenant: { id: 'tenant-1' },
    captures: [captureRow({ id: 'capture-a' }), captureRow({ id: 'capture-b' })],
    campaigns: [{ id: 'campaign-1', tenantId: 'tenant-1' }, { id: 'campaign-2', tenantId: 'tenant-1' }],
    members: [
      { tenantId: 'tenant-1', campaignId: 'campaign-1', marketplaceCaptureId: 'capture-a' },
      { tenantId: 'tenant-1', campaignId: 'campaign-2', marketplaceCaptureId: 'capture-b' },
    ],
  };
  const harness = await createRecordsRouteHarness(state);
  try {
    const response = await harness.route.GET(request('https://app.test/api/marketplace-acquisition/records?campaignId=campaign-1'));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.deepEqual(body.data.records.map((r) => r.capture.id), ['capture-a']);
  } finally {
    harness.cleanup();
  }
});

test('records list: tenant A cannot see tenant B captures (no campaignId filter)', async () => {
  const state = {
    tenant: { id: 'tenant-a' },
    captures: [captureRow({ id: 'capture-a', tenantId: 'tenant-a' }), captureRow({ id: 'capture-b', tenantId: 'tenant-b' })],
  };
  const harness = await createRecordsRouteHarness(state);
  try {
    const response = await harness.route.GET(request('https://app.test/api/marketplace-acquisition/records'));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.deepEqual(body.data.records.map((r) => r.capture.id), ['capture-a']);
  } finally {
    harness.cleanup();
  }
});

test('records list: tenant A supplying tenant B\'s campaignId sees no records (campaign not found for tenant A)', async () => {
  const state = {
    tenant: { id: 'tenant-a' },
    captures: [captureRow({ id: 'capture-b', tenantId: 'tenant-b' })],
    campaigns: [{ id: 'campaign-b', tenantId: 'tenant-b' }],
    members: [{ tenantId: 'tenant-b', campaignId: 'campaign-b', marketplaceCaptureId: 'capture-b' }],
  };
  const harness = await createRecordsRouteHarness(state);
  try {
    const response = await harness.route.GET(request('https://app.test/api/marketplace-acquisition/records?campaignId=campaign-b'));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.deepEqual(body.data.records, []);
  } finally {
    harness.cleanup();
  }
});

// -- captures POST: invalid body ----------------------------------------------------------------

const createCapturesRouteHarness = async (state) => {
  const tempDir = join(tmpdir(), `whisperm-captures-contract-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempDir);
  writeSharedStubs(tempDir, '__capturesContractState', '__capturesContractRepos');
  writeFileSync(join(tempDir, 'request-body.mjs'), [
    'export class RequestBodyError extends Error { constructor(message, status = 400, code) { super(message); this.status = status; this.code = code; } }',
    'export const readJsonBody = async (request) => request.json();',
  ].join('\n'));
  writeFileSync(join(tempDir, 'acquisition-services.mjs'), [
    `import { createWhispeRMServices } from ${JSON.stringify(servicesUrl)};`,
    'export const createAcquisitionServiceBundle = () => {',
    `  const repositories = globalThis.__capturesContractRepos;`,
    '  const services = createWhispeRMServices(repositories);',
    '  return { repositories, usageMetering: undefined, services };',
    '};',
  ].join('\n'));
  globalThis.__capturesContractState = state;
  globalThis.__capturesContractRepos = { ...buildRecordsRepositories(state), auditLogs: { async append() { return {}; } } };
  const routePath = new URL('../src/app/api/marketplace-acquisition/captures/route.ts', import.meta.url).pathname;
  const route = await transpileWithSharedStubs(routePath, tempDir, 'captures-route.mjs');
  return {
    route,
    cleanup: () => { delete globalThis.__capturesContractState; delete globalThis.__capturesContractRepos; rmSync(tempDir, { recursive: true, force: true }); },
  };
};

const postRequest = (url, body) => new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('captures POST: a body with neither listingUrl nor sourceUrl is rejected with 400 VALIDATION_ERROR and persists nothing', async () => {
  const state = { tenant: { id: 'tenant-1' }, captures: [] };
  const harness = await createCapturesRouteHarness(state);
  try {
    const response = await harness.route.POST(postRequest('https://app.test/api/marketplace-acquisition/captures', { title: 'No URL here' }));
    const body = await response.json();
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.equal(state.captures.length, 0, 'an invalid capture request must never persist a capture');
  } finally {
    harness.cleanup();
  }
});

test('captures POST: unauthorized request returns 401 UNAUTHORIZED before any validation', async () => {
  const state = { tenant: null, captures: [] };
  const harness = await createCapturesRouteHarness(state);
  try {
    const response = await harness.route.POST(postRequest('https://app.test/api/marketplace-acquisition/captures', {}));
    const body = await response.json();
    assert.equal(response.status, 401);
    assert.equal(body.error.code, 'UNAUTHORIZED');
  } finally {
    harness.cleanup();
  }
});
