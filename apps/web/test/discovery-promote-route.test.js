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
  sellers: [{
    id: 'seller-1',
    tenantId,
    discoveryRunId: 'run-1',
    campaignId: 'campaign-1',
    marketplaceSourceId: 'source-1',
    status: 'QUALIFIED',
    qualificationScore: 90,
    sellerName: 'Ama Seller',
    listingUrl: 'https://jiji.com.gh/cars/listing-1',
    title: 'Clean Toyota Corolla',
    createdAt: now,
    updatedAt: now,
  }],
  campaigns: [{ id: 'campaign-1', tenantId, name: 'Test Campaign', status: 'ACTIVE', createdAt: now, updatedAt: now }],
  captures: [],
  members: [],
  nextCapture: 1,
  nextMember: 1,
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

const captureRepo = (state) => ({
  async createMarketplaceCapture(ctx, input) {
    const existing = state.captures.find((capture) => capture.tenantId === ctx.tenantId && capture.listingUrl === input.listingUrl);
    if (existing !== undefined) {
      const err = new Error('Marketplace capture already exists');
      err.code = 'PERSISTENCE_CONFLICT';
      err.status = 409;
      throw err;
    }
    const capture = { id: `capture-${state.nextCapture++}`, status: 'CAPTURED', capturedAt: now, createdAt: now, updatedAt: now, metadata: {}, ...input };
    state.captures.push(capture);
    return capture;
  },
  async findMarketplaceCaptureByListingUrl(ctx, listingUrl) {
    return state.captures.find((capture) => capture.tenantId === ctx.tenantId && capture.listingUrl === listingUrl) ?? null;
  },
});

const campaignRepo = (state) => ({
  async findById(ctx, id) {
    return state.campaigns.find((campaign) => campaign.tenantId === ctx.tenantId && campaign.id === id) ?? null;
  },
  async addSeller(ctx, input) {
    const existing = state.members.find((member) => member.tenantId === ctx.tenantId && member.campaignId === input.campaignId && member.marketplaceCaptureId === input.marketplaceCaptureId);
    if (existing !== undefined) {
      const err = new Error('Seller already belongs to this acquisition campaign');
      err.code = 'PERSISTENCE_CONFLICT';
      err.status = 409;
      throw err;
    }
    const member = { id: `member-${state.nextMember++}`, status: 'ADDED', assignedAt: now, createdAt: now, updatedAt: now, ...input };
    state.members.push(member);
    return member;
  },
  async findMemberByCapture(ctx, campaignId, marketplaceCaptureId) {
    return state.members.find((member) => member.tenantId === ctx.tenantId && member.campaignId === campaignId && member.marketplaceCaptureId === marketplaceCaptureId) ?? null;
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
    .replaceAll('from "@whisperm/services"', `from "${servicesUrl}"`);
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const file = join(tempDir, 'promote-route.mjs');
  writeFileSync(file, output);
  return import(file);
};

const makeRequest = () => ({ headers: new Headers(), async json() { return {}; } });

const createHarness = async (state) => {
  const tempDir = join(tmpdir(), `whisperm-discovery-promote-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempDir);
  writeFileSync(join(tempDir, 'next-server.mjs'), 'export class NextResponse extends Response { static json(body, init) { return Response.json(body, init); } }\nexport class NextRequest extends Request {}\n');
  writeFileSync(join(tempDir, 'get-tenant.mjs'), 'export const getTenantContextForCurrentUser = async () => globalThis.__promoteRouteState.tenant === null ? null : { tenant: globalThis.__promoteRouteState.tenant, tenantUserId: "tenant-user-1" };\n');
  writeFileSync(join(tempDir, 'tenant-features.mjs'), [
    'export const featureNotEnabledResponse = () => Response.json({ ok: false, error: { message: "Seller Acquisition add-on is not enabled for this workspace." } }, { status: 403 });',
    'export const requireSellerAcquisitionFeatureForApi = async () => (globalThis.__promoteRouteState.featureEnabled ? null : featureNotEnabledResponse());',
  ].join('\n'));
  writeFileSync(join(tempDir, 'prisma.mjs'), 'export const prisma = {};\n');
  writeFileSync(join(tempDir, 'repositories.mjs'), [
    'export class PrismaMarketplaceDiscoveryRepository { constructor() { return globalThis.__promoteRouteRepos.discoveryRepo; } }',
    'export class PrismaMarketplaceAcquisitionRepository { constructor() { return globalThis.__promoteRouteRepos.captureRepo; } }',
    'export class PrismaSellerAcquisitionCampaignRepository { constructor() { return globalThis.__promoteRouteRepos.campaignRepo; } }',
  ].join('\n'));
  globalThis.__promoteRouteState = state;
  globalThis.__promoteRouteRepos = { discoveryRepo: discoveryRepo(state), captureRepo: captureRepo(state), campaignRepo: campaignRepo(state) };
  const base = new URL('../src/app/api/marketplace-acquisition/campaigns/[campaignId]/discovery/sellers/[sellerId]/promote/route.ts', import.meta.url).pathname;
  return {
    cleanup: () => { delete globalThis.__promoteRouteState; delete globalThis.__promoteRouteRepos; rmSync(tempDir, { recursive: true, force: true }); },
    route: await transpileRoute(base, tempDir),
  };
};

test('unauthorized request returns 401', async () => {
  const state = makeState();
  state.tenant = null;
  const harness = await createHarness(state);
  try {
    const response = await harness.route.POST(makeRequest(), { params: { campaignId: 'campaign-1', sellerId: 'seller-1' } });
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
    const response = await harness.route.POST(makeRequest(), { params: { campaignId: 'campaign-1', sellerId: 'seller-1' } });
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.ok, false);
  } finally {
    harness.cleanup();
  }
});

test('successful promote returns a real marketplaceCaptureId and campaignMemberId', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    const response = await harness.route.POST(makeRequest(), { params: { campaignId: 'campaign-1', sellerId: 'seller-1' } });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.ok, true);
    assert.equal(body.data.marketplaceCaptureId, state.captures[0].id);
    assert.equal(body.data.campaignMemberId, state.members[0].id);
    assert.equal(body.data.alreadyPromoted, false);
    assert.equal(state.sellers[0].status, 'PROMOTED');
    assert.equal(state.sellers[0].promotedCaptureId, state.captures[0].id);
  } finally {
    harness.cleanup();
  }
});

test('repeated promote returns the same capture/member without duplication', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    const first = await (await harness.route.POST(makeRequest(), { params: { campaignId: 'campaign-1', sellerId: 'seller-1' } })).json();
    const second = await (await harness.route.POST(makeRequest(), { params: { campaignId: 'campaign-1', sellerId: 'seller-1' } })).json();

    assert.equal(state.captures.length, 1);
    assert.equal(state.members.length, 1);
    assert.equal(second.data.marketplaceCaptureId, first.data.marketplaceCaptureId);
    assert.equal(second.data.campaignMemberId, first.data.campaignMemberId);
    assert.equal(second.data.alreadyPromoted, true);
  } finally {
    harness.cleanup();
  }
});

test('failure response is safe and human-readable', async () => {
  const state = makeState();
  state.sellers[0].listingUrl = 'not-a-url';
  const harness = await createHarness(state);
  try {
    const response = await harness.route.POST(makeRequest(), { params: { campaignId: 'campaign-1', sellerId: 'seller-1' } });
    const body = await response.json();
    assert.equal(response.status, 422);
    assert.equal(body.ok, false);
    assert.equal(typeof body.error.message, 'string');
    assert.ok(body.error.message.length > 0);
    assert.equal(state.sellers[0].status, 'QUALIFIED');
  } finally {
    harness.cleanup();
  }
});

test('promoting a seller from a different campaign is denied with a readable error', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    const response = await harness.route.POST(makeRequest(), { params: { campaignId: 'campaign-other', sellerId: 'seller-1' } });
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.ok, false);
    assert.equal(state.sellers[0].status, 'QUALIFIED');
  } finally {
    harness.cleanup();
  }
});
