import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

// ST1-010: the deals/[dealId]/stage route is the single canonical trigger for revenue
// attribution (ST1-008) -- no web-level executable test previously existed for it at all. The
// deep attribution algorithm itself is already proven at the service layer
// (packages/services/test/revenue-attribution.test.mjs), so this harness fakes
// createWhispeRMServices/RevenueAttributionRuntimeService with a scripted, inspectable
// deals.recordOutcome and focuses on what the *route* owns: auth, feature gating, stage
// transition validation, only invoking attribution on a transition into "Converted", and
// correctly mapping the attribution result into the response body -- exactly the seam where a
// "revenue attribution unreachable" or "wrong status parsing" regression would hide.

const tenantId = 'tenant-1';
const now = '2026-07-05T00:00:00.000Z';

const makeState = () => ({
  tenant: { id: tenantId },
  featureEnabled: true,
  pipeline: {
    id: 'pipeline-1',
    stages: [
      { id: 'stage-captured', name: 'Captured' },
      { id: 'stage-invited', name: 'Invited' },
      { id: 'stage-claim-started', name: 'Claim Started' },
      { id: 'stage-claimed', name: 'Claimed' },
      { id: 'stage-converted', name: 'Converted' },
      { id: 'stage-expired', name: 'Expired' },
    ],
  },
  deals: [{ id: 'deal-1', tenantId, pipelineId: 'pipeline-1', pipelineStageId: 'stage-claimed', closedAt: null, updatedAt: now }],
  captures: [{ id: 'capture-1', tenantId, dealId: 'deal-1', status: 'CLAIMED' }],
  recordOutcomeCalls: [],
  recordOutcomeResult: null,
});

const pipelinesRepo = (state) => ({ async findByDefaultKey() { return state.pipeline; } });
const dealsRepo = (state) => ({
  async findById(dealTenantId, id) { return state.deals.find((d) => d.tenantId === dealTenantId && d.id === id) ?? null; },
  async updateStage(dealTenantId, id, stageId) {
    const index = state.deals.findIndex((d) => d.tenantId === dealTenantId && d.id === id);
    state.deals[index] = { ...state.deals[index], pipelineStageId: stageId, updatedAt: now };
    return state.deals[index];
  },
});
const capturesRepo = (state) => ({
  async findByDealId(scope, dealId) { return state.captures.find((c) => c.tenantId === scope.tenantId && c.dealId === dealId) ?? null; },
  async update(scope, id, input) {
    const index = state.captures.findIndex((c) => c.tenantId === scope.tenantId && c.id === id);
    state.captures[index] = { ...state.captures[index], ...input };
    return state.captures[index];
  },
});

const servicesUrl = import.meta.resolve('@whisperm/services');

const transpileRoute = (routePath, tempDir) => {
  const source = readFileSync(routePath, 'utf8')
    .replace(/from "next\/server"/gu, `from "${join(tempDir, 'next-server.mjs')}"`)
    .replace(/from "@\/lib\/get-tenant"/gu, `from "${join(tempDir, 'get-tenant.mjs')}"`)
    .replace(/from "@\/lib\/prisma"/gu, `from "${join(tempDir, 'prisma.mjs')}"`)
    .replace(/from "@\/lib\/tenant-features"/gu, `from "${join(tempDir, 'tenant-features.mjs')}"`)
    .replaceAll('from "@whisperm/repositories"', `from "${join(tempDir, 'repositories.mjs')}"`)
    .replaceAll('from "@whisperm/services"', `from "${join(tempDir, 'services.mjs')}"`)
    .replaceAll('from "@whisperm/types"', `from "${join(tempDir, 'types.mjs')}"`);
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const file = join(tempDir, 'stage-route.mjs');
  writeFileSync(file, output);
  return import(file);
};

const makeRequest = (stageName) => ({ headers: new Headers(), async json() { return { stageName }; } });

const createHarness = async (state) => {
  const tempDir = join(tmpdir(), `whisperm-revenue-attribution-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempDir);
  writeFileSync(join(tempDir, 'next-server.mjs'), 'export class NextResponse extends Response { static json(body, init) { return Response.json(body, init); } }\nexport class NextRequest extends Request {}\n');
  writeFileSync(join(tempDir, 'types.mjs'), 'export const MARKETPLACE_ACQUISITION_PIPELINE_KEY = "MARKETPLACE_ACQUISITION";\n');
  writeFileSync(join(tempDir, 'get-tenant.mjs'), 'export const getTenantForCurrentUser = async () => globalThis.__stageRouteState.tenant;\n');
  writeFileSync(join(tempDir, 'tenant-features.mjs'), [
    'export const featureNotEnabledResponse = () => Response.json({ ok: false, error: { message: "Seller Acquisition add-on is not enabled for this workspace." } }, { status: 403 });',
    'export const requireSellerAcquisitionFeatureForApi = async () => (globalThis.__stageRouteState.featureEnabled ? null : featureNotEnabledResponse());',
  ].join('\n'));
  writeFileSync(join(tempDir, 'prisma.mjs'), 'export const prisma = {};\n');
  writeFileSync(join(tempDir, 'repositories.mjs'), [
    'export class PrismaDealsRepository { constructor() { return globalThis.__stageRouteRepos.deals; } }',
    'export class PrismaPipelineRepository { constructor() { return globalThis.__stageRouteRepos.pipelines; } }',
    'export class PrismaMarketplaceCaptureRepository { constructor() { return globalThis.__stageRouteRepos.marketplaceCaptures; } }',
    'export class PrismaAcquisitionUsageEventRepository { constructor() { return {}; } }',
    'export const createPrismaRepositories = () => globalThis.__stageRouteRepos;',
  ].join('\n'));
  // Fakes createWhispeRMServices with a scripted, inspectable deals.recordOutcome so this test
  // proves route *wiring* (does it call recordOutcome only for Converted, and map the result
  // correctly?) without re-deriving the full attribution algorithm already proven at the service
  // layer (packages/services/test/revenue-attribution.test.mjs).
  writeFileSync(join(tempDir, 'services.mjs'), [
    'export class AcquisitionUsageMeteringService { constructor() {} }',
    'export class RevenueAttributionRuntimeService { constructor() {} }',
    'export const createWhispeRMServices = (dependencies) => ({',
    '  deals: {',
    '    async recordOutcome(context, dealId, input) {',
    '      globalThis.__stageRouteState.recordOutcomeCalls.push({ context, dealId, input });',
    '      const deal = await dependencies.deals.findById(context.tenantId, dealId);',
    '      const updated = { ...deal, closedAt: input.closedAt ?? deal.closedAt, updatedAt: "' + now + '" };',
    '      return { deal: updated, attribution: globalThis.__stageRouteState.recordOutcomeResult };',
    '    },',
    '  },',
    '});',
  ].join('\n'));
  globalThis.__stageRouteState = state;
  globalThis.__stageRouteRepos = {
    deals: dealsRepo(state),
    pipelines: pipelinesRepo(state),
    marketplaceCaptures: capturesRepo(state),
  };
  const base = new URL('../src/app/api/marketplace-acquisition/deals/[dealId]/stage/route.ts', import.meta.url).pathname;
  return {
    cleanup: () => { delete globalThis.__stageRouteState; delete globalThis.__stageRouteRepos; rmSync(tempDir, { recursive: true, force: true }); },
    route: await transpileRoute(base, tempDir),
  };
};

test('unauthorized request returns 401', async () => {
  const state = makeState();
  state.tenant = null;
  const harness = await createHarness(state);
  try {
    const response = await harness.route.PATCH(makeRequest('Converted'), { params: { dealId: 'deal-1' } });
    assert.equal(response.status, 401);
  } finally {
    harness.cleanup();
  }
});

test('feature-disabled request returns the existing feature-denied response', async () => {
  const state = makeState();
  state.featureEnabled = false;
  const harness = await createHarness(state);
  try {
    const response = await harness.route.PATCH(makeRequest('Converted'), { params: { dealId: 'deal-1' } });
    assert.equal(response.status, 403);
  } finally {
    harness.cleanup();
  }
});

test('an unsupported stage transition (Claimed -> Captured) is rejected with 422 and never invokes attribution', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    const response = await harness.route.PATCH(makeRequest('Captured'), { params: { dealId: 'deal-1' } });
    assert.equal(response.status, 422);
    assert.equal(state.recordOutcomeCalls.length, 0);
  } finally {
    harness.cleanup();
  }
});

test('transitioning a deal to Converted triggers revenue attribution and threads the result into the response', async () => {
  const state = makeState();
  state.recordOutcomeResult = { status: 'ATTRIBUTED', dealId: 'deal-1', idempotent: false, snapshot: { idempotencyKey: 'attribution:deal-1', revenueAmount: '150.00' } };
  const harness = await createHarness(state);
  try {
    const response = await harness.route.PATCH(makeRequest('Converted'), { params: { dealId: 'deal-1' } });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.ok, true);
    assert.equal(body.data.currentStage, 'Converted');
    assert.equal(body.data.dealStatus, 'Converted');
    assert.equal(body.data.captureStatus, 'CONVERTED');
    assert.equal(body.data.revenueAttributed, true);
    assert.equal(body.data.attributionId, 'attribution:deal-1');
    assert.equal(body.data.attributedAmount, '150.00');
    assert.equal(state.recordOutcomeCalls.length, 1);
    assert.equal(state.recordOutcomeCalls[0].dealId, 'deal-1');
  } finally {
    harness.cleanup();
  }
});

test('a valid transition to a non-Converted stage never calls recordOutcome and reports revenueAttributed:false', async () => {
  const state = makeState();
  state.deals[0].pipelineStageId = 'stage-captured';
  const harness = await createHarness(state);
  try {
    const response = await harness.route.PATCH(makeRequest('Invited'), { params: { dealId: 'deal-1' } });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.data.revenueAttributed, false);
    assert.equal(body.data.attributionId, null);
    assert.equal(state.recordOutcomeCalls.length, 0);
  } finally {
    harness.cleanup();
  }
});

test('re-closing an already-Converted deal is idempotent -- attribution is re-evaluated, not duplicated', async () => {
  const state = makeState();
  state.deals[0].pipelineStageId = 'stage-converted';
  state.captures[0].status = 'CONVERTED';
  state.recordOutcomeResult = { status: 'ATTRIBUTED', dealId: 'deal-1', idempotent: true, snapshot: { idempotencyKey: 'attribution:deal-1', revenueAmount: '150.00' } };
  const harness = await createHarness(state);
  try {
    const response = await harness.route.PATCH(makeRequest('Converted'), { params: { dealId: 'deal-1' } });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.data.revenueAttributed, true);
    assert.equal(body.data.attributionId, 'attribution:deal-1');
    assert.equal(state.recordOutcomeCalls.length, 1);
  } finally {
    harness.cleanup();
  }
});

test('when the service reports NOT_ELIGIBLE, the response says revenueAttributed:false rather than a false success', async () => {
  const state = makeState();
  state.recordOutcomeResult = { status: 'NOT_ELIGIBLE', dealId: 'deal-1', idempotent: false };
  const harness = await createHarness(state);
  try {
    const response = await harness.route.PATCH(makeRequest('Converted'), { params: { dealId: 'deal-1' } });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.revenueAttributed, false);
    assert.equal(body.data.attributionId, null);
  } finally {
    harness.cleanup();
  }
});

test('a deal belonging to a different tenant is not found', async () => {
  const state = makeState();
  state.deals[0].tenantId = 'tenant-other';
  const harness = await createHarness(state);
  try {
    const response = await harness.route.PATCH(makeRequest('Converted'), { params: { dealId: 'deal-1' } });
    assert.equal(response.status, 404);
    assert.equal(state.recordOutcomeCalls.length, 0);
  } finally {
    harness.cleanup();
  }
});
