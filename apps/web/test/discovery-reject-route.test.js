import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const now = '2026-07-01T00:00:00.000Z';
const tenantId = 'tenant-1';

const makeState = () => ({
  tenant: { id: tenantId },
  featureEnabled: true,
  sellers: [
    {
      id: 'seller-a',
      tenantId,
      discoveryRunId: 'run-1',
      campaignId: 'campaign-1',
      marketplaceSourceId: 'source-1',
      status: 'QUALIFIED',
      qualificationScore: 90,
      sellerName: 'Ama Seller',
      phone: '+233555000000',
      listingUrl: 'https://jiji.com.gh/cars/listing-a',
      title: 'Clean Toyota Corolla',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'seller-b',
      tenantId,
      discoveryRunId: 'run-2',
      campaignId: 'campaign-2',
      marketplaceSourceId: 'source-1',
      status: 'QUALIFIED',
      qualificationScore: 85,
      sellerName: 'Kofi Seller',
      phone: '+233555000001',
      listingUrl: 'https://jiji.com.gh/cars/listing-b',
      title: 'Clean Honda Civic',
      createdAt: now,
      updatedAt: now,
    },
  ],
  nextId: 1,
});

const discoveryRepo = (state) => ({
  async findDiscoveredSellerById(ctx, id) {
    return state.sellers.find((seller) => seller.tenantId === ctx.tenantId && seller.id === id) ?? null;
  },
  async updateDiscoveredSellerStatus(ctx, id, status, extra = {}) {
    const index = state.sellers.findIndex((seller) => seller.tenantId === ctx.tenantId && seller.id === id);
    state.sellers[index] = { ...state.sellers[index], status, ...extra, updatedAt: now };
    return state.sellers[index];
  },
});

const transpileRoute = (routePath, tempDir, outName) => {
  const source = readFileSync(routePath, 'utf8')
    .replace(/from "next\/server"/gu, `from "${join(tempDir, 'next-server.mjs')}"`)
    .replace(/from "@\/app\/api\/_lib\/api-response"/gu, `from "${join(tempDir, 'api-response.mjs')}"`)
    .replace(/from "@\/lib\/get-tenant"/gu, `from "${join(tempDir, 'get-tenant.mjs')}"`)
    .replace(/from "@\/lib\/prisma"/gu, `from "${join(tempDir, 'prisma.mjs')}"`)
    .replace(/from "@\/lib\/tenant-features"/gu, `from "${join(tempDir, 'tenant-features.mjs')}"`)
    .replaceAll('from "@whisperm/repositories"', `from "${join(tempDir, 'repositories.mjs')}"`)
    .replaceAll('from "@whisperm/services"', `from "${import.meta.resolve('@whisperm/services')}"`);
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const file = join(tempDir, outName);
  writeFileSync(file, output);
  return import(file);
};

const makeRequest = () => ({ headers: new Headers(), async json() { return {}; } });

const createHarness = async (state) => {
  const tempDir = join(tmpdir(), `whisperm-discovery-reject-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempDir);
  writeFileSync(join(tempDir, 'next-server.mjs'), 'export class NextResponse extends Response { static json(body, init) { return Response.json(body, init); } }\nexport class NextRequest extends Request {}\n');
  writeFileSync(join(tempDir, 'api-response.mjs'), [
    'import { NextResponse } from "./next-server.mjs";',
    'export function apiSuccess(data, init) { return NextResponse.json({ ok: true, data }, init); }',
    'export function apiFailure(status, code, message, details) { return NextResponse.json({ ok: false, error: details === undefined ? { code, message } : { code, message, details } }, { status }); }',
  ].join('\n'));
  writeFileSync(join(tempDir, 'get-tenant.mjs'), 'export const getTenantContextForCurrentUser = async () => globalThis.__rejectRouteState.tenant === null ? null : { tenant: globalThis.__rejectRouteState.tenant, tenantUserId: "tenant-user-1" };\n');
  writeFileSync(join(tempDir, 'tenant-features.mjs'), [
    'export const featureNotEnabledResponse = () => Response.json({ ok: false, error: { code: "FEATURE_NOT_ENABLED", message: "Seller Acquisition add-on is not enabled for this workspace." } }, { status: 403 });',
    'export const requireSellerAcquisitionFeatureForApi = async () => (globalThis.__rejectRouteState.featureEnabled ? null : featureNotEnabledResponse());',
  ].join('\n'));
  writeFileSync(join(tempDir, 'prisma.mjs'), 'export const prisma = {};\n');
  writeFileSync(join(tempDir, 'repositories.mjs'), [
    'export class PrismaMarketplaceDiscoveryRepository { constructor() { return globalThis.__rejectRouteRepos.discoveryRepo; } }',
  ].join('\n'));
  globalThis.__rejectRouteState = state;
  globalThis.__rejectRouteRepos = { discoveryRepo: discoveryRepo(state) };
  const base = new URL('../src/app/api/marketplace-acquisition/campaigns/[campaignId]/discovery/sellers/[sellerId]/reject/route.ts', import.meta.url).pathname;
  return {
    cleanup: () => { delete globalThis.__rejectRouteState; delete globalThis.__rejectRouteRepos; rmSync(tempDir, { recursive: true, force: true }); },
    route: await transpileRoute(base, tempDir, 'reject-route.mjs'),
  };
};

test('unauthorized request returns 401', async () => {
  const state = makeState();
  state.tenant = null;
  const harness = await createHarness(state);
  try {
    const response = await harness.route.POST(makeRequest(), { params: { campaignId: 'campaign-1', sellerId: 'seller-a' } });
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
    const response = await harness.route.POST(makeRequest(), { params: { campaignId: 'campaign-1', sellerId: 'seller-a' } });
    assert.equal(response.status, 403);
  } finally {
    harness.cleanup();
  }
});

test('rejecting a seller that belongs to the specified campaign succeeds', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    const response = await harness.route.POST(makeRequest(), { params: { campaignId: 'campaign-1', sellerId: 'seller-a' } });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.ok, true);
    assert.equal(body.data.seller.status, 'REJECTED');
    assert.equal(state.sellers[0].status, 'REJECTED');
  } finally {
    harness.cleanup();
  }
});

// ST1-013N: this is the regression test for the cross-campaign mutation bug -- previously the
// route never read campaignId at all, so rejecting seller-b (which belongs to campaign-2) via
// the campaign-1 URL silently succeeded.
test('rejecting a seller from a different campaign is denied and does not mutate the seller', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    const response = await harness.route.POST(makeRequest(), { params: { campaignId: 'campaign-1', sellerId: 'seller-b' } });
    const body = await response.json();
    assert.equal(response.status, 409, JSON.stringify(body));
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'SELLER_NOT_IN_CAMPAIGN');
    assert.equal(state.sellers[1].status, 'QUALIFIED', 'seller-b (campaign-2) must be untouched by a campaign-1 reject request');
  } finally {
    harness.cleanup();
  }
});

test('rejecting an unknown seller id returns NOT_FOUND', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    const response = await harness.route.POST(makeRequest(), { params: { campaignId: 'campaign-1', sellerId: 'seller-does-not-exist' } });
    const body = await response.json();
    assert.equal(response.status, 404, JSON.stringify(body));
    assert.equal(body.error.code, 'NOT_FOUND');
  } finally {
    harness.cleanup();
  }
});
