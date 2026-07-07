import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

// This route previously did not exist at all: the Deals/Pipeline board's drag-and-drop UI
// (apps/web/src/app/(app)/deals/page.tsx) called PATCH /api/deals/:dealId/stage, but no route
// file answered it, so every drag silently 404'd while the optimistic UI update made it look
// like the move succeeded. This harness proves the route now exists, authenticates, scopes to
// the caller's tenant, and delegates to the canonical DealService.moveStage (optimistic locking,
// audit log, domain event) rather than writing the stage directly.

const tenantId = 'tenant-1';
const now = '2026-07-05T00:00:00.000Z';

const makeState = () => ({
  tenantContext: { tenant: { id: tenantId }, tenantUserId: 'user-1' },
  deals: [{ id: 'deal-1', tenantId, pipelineId: 'pipeline-1', pipelineStageId: 'stage-captured', updatedAt: now }],
  moveStageCalls: [],
  moveStageError: null,
});

const makeRequest = (body) => ({
  headers: new Headers(),
  async json() { return body; },
});

const transpileRoute = (routePath, tempDir) => {
  const source = readFileSync(routePath, 'utf8')
    .replace(/from "next\/server"/gu, `from "${join(tempDir, 'next-server.mjs')}"`)
    .replace(/from "@\/lib\/get-tenant"/gu, `from "${join(tempDir, 'get-tenant.mjs')}"`)
    .replace(/from "@\/lib\/prisma"/gu, `from "${join(tempDir, 'prisma.mjs')}"`)
    .replace(/from "@\/lib\/api\/request-body"/gu, `from "${join(tempDir, 'request-body.mjs')}"`)
    .replaceAll('from "@whisperm/repositories"', `from "${join(tempDir, 'repositories.mjs')}"`)
    .replaceAll('from "@whisperm/services"', `from "${join(tempDir, 'services.mjs')}"`);
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const file = join(tempDir, 'deals-stage-route.mjs');
  writeFileSync(file, output);
  return import(file);
};

const createHarness = async (state) => {
  const tempDir = join(tmpdir(), `whisperm-deals-stage-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempDir);
  writeFileSync(join(tempDir, 'next-server.mjs'), 'export class NextResponse extends Response { static json(body, init) { return Response.json(body, init); } }\nexport class NextRequest extends Request {}\n');
  writeFileSync(join(tempDir, 'get-tenant.mjs'), 'export const getTenantContextForCurrentUser = async () => globalThis.__dealsStageState.tenantContext;\n');
  writeFileSync(join(tempDir, 'prisma.mjs'), 'export const prisma = {};\n');
  writeFileSync(join(tempDir, 'request-body.mjs'), [
    'export class RequestBodyError extends Error { constructor(message, status = 400, code = "REQUEST_BODY_INVALID") { super(message); this.status = status; this.code = code; } }',
    'export const readJsonBody = async (request) => {',
    '  try { return await request.json(); }',
    '  catch { throw new RequestBodyError("Request body must be valid JSON."); }',
    '};',
  ].join('\n'));
  writeFileSync(join(tempDir, 'repositories.mjs'), [
    'export class PrismaDealsRepository {',
    '  async findById(dealTenantId, id) {',
    '    return globalThis.__dealsStageState.deals.find((d) => d.tenantId === dealTenantId && d.id === id) ?? null;',
    '  }',
    '}',
    'export const createPrismaRepositories = () => ({});',
  ].join('\n'));
  writeFileSync(join(tempDir, 'services.mjs'), [
    'export class ServiceError extends Error {',
    '  constructor(input) { super(input.message); this.code = input.code; this.status = input.status; }',
    '}',
    'export const createWhispeRMServices = () => ({',
    '  deals: {',
    '    async moveStage(context, dealId, input) {',
    '      globalThis.__dealsStageState.moveStageCalls.push({ context, dealId, input });',
    '      if (globalThis.__dealsStageState.moveStageError) throw new ServiceError(globalThis.__dealsStageState.moveStageError);',
    '      const deal = globalThis.__dealsStageState.deals.find((d) => d.id === dealId);',
    '      const updated = { ...deal, pipelineStageId: input.stageId, updatedAt: "' + now + '" };',
    '      Object.assign(deal, updated);',
    '      return updated;',
    '    },',
    '  },',
    '});',
  ].join('\n'));
  globalThis.__dealsStageState = state;
  const base = new URL('../src/app/api/deals/[dealId]/stage/route.ts', import.meta.url).pathname;
  return {
    cleanup: () => { delete globalThis.__dealsStageState; rmSync(tempDir, { recursive: true, force: true }); },
    route: await transpileRoute(base, tempDir),
  };
};

test('unauthenticated request returns 401', async () => {
  const state = makeState();
  state.tenantContext = null;
  const harness = await createHarness(state);
  try {
    const response = await harness.route.PATCH(makeRequest({ stageId: 'stage-invited' }), { params: { dealId: 'deal-1' } });
    assert.equal(response.status, 401);
  } finally {
    harness.cleanup();
  }
});

test('missing stageId returns 400 and never calls moveStage', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    const response = await harness.route.PATCH(makeRequest({}), { params: { dealId: 'deal-1' } });
    assert.equal(response.status, 400);
    assert.equal(state.moveStageCalls.length, 0);
  } finally {
    harness.cleanup();
  }
});

test('unknown deal returns 404 and never calls moveStage', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    const response = await harness.route.PATCH(makeRequest({ stageId: 'stage-invited' }), { params: { dealId: 'missing-deal' } });
    assert.equal(response.status, 404);
    assert.equal(state.moveStageCalls.length, 0);
  } finally {
    harness.cleanup();
  }
});

test('a valid move delegates to the canonical DealService.moveStage with the tenant, actor, and optimistic-lock timestamp', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    const response = await harness.route.PATCH(makeRequest({ stageId: 'stage-invited' }), { params: { dealId: 'deal-1' } });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.ok, true);
    assert.equal(body.data.pipelineStageId, 'stage-invited');
    assert.equal(state.moveStageCalls.length, 1);
    assert.equal(state.moveStageCalls[0].context.tenantId, tenantId);
    assert.equal(state.moveStageCalls[0].context.actorId, 'user-1');
    assert.equal(state.moveStageCalls[0].input.stageId, 'stage-invited');
    assert.equal(state.moveStageCalls[0].input.expectedUpdatedAt, now);
  } finally {
    harness.cleanup();
  }
});

test('an optimistic-lock conflict from the service surfaces as the service-reported status, not a generic 500', async () => {
  const state = makeState();
  state.moveStageError = { code: 'SERVICE_CONFLICT', status: 409, message: 'Optimistic lock conflict' };
  const harness = await createHarness(state);
  try {
    const response = await harness.route.PATCH(makeRequest({ stageId: 'stage-invited' }), { params: { dealId: 'deal-1' } });
    assert.equal(response.status, 409);
  } finally {
    harness.cleanup();
  }
});
