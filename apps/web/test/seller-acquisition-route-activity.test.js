import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

import { SellerClaimPortalService } from '@whisperm/services';

const now = '2026-06-15T00:00:00.000Z';
const tenantId = 'tenant-1';
const captureId = 'capture-1';
const token = 'raw-token';
const hashClaimToken = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

const makeState = () => ({
  tenant: { id: tenantId },
  token: { id: 'token-1', tenantId, marketplaceCaptureId: captureId, tokenHash: hashClaimToken(token), status: 'SENT', expiresAt: '2026-06-30T00:00:00.000Z', metadata: {} },
  capture: { id: captureId, tenantId, contactId: 'contact-1', dealId: 'deal-1', externalId: 'listing-1', listingUrl: 'https://market.test/listing/1', title: 'Bike', description: 'Fast bike', price: '100', currency: 'USD', sellerName: 'Sam Seller', sellerProfileUrl: 'https://market.test/seller/sam', status: 'CLAIM_STARTED', capturedAt: now, createdAt: now, updatedAt: now, metadata: { sellerPhone: '+15555550123', sellerEmail: 'sam@example.com', sellerLocation: 'Austin', marketplaceSource: 'MARKET_TEST' } },
  draft: { id: 'draft-1', tenantId, marketplaceCaptureId: captureId, contactId: 'contact-1', dealId: 'deal-1', title: 'Bike', description: 'Fast bike', price: '100', currency: 'USD', category: 'Bicycles', images: ['https://cdn.test/bike.jpg'], listingUrl: 'https://market.test/listing/1', marketplaceSource: 'MARKET_TEST', marketplaceListingId: 'listing-1', status: 'DRAFT', createdAt: now, updatedAt: now },
  contact: { id: 'contact-1', tenantId, firstName: 'Sam', lastName: 'Seller', email: 'sam@example.com', phone: '+15555550123', stage: 'PROSPECT', createdAt: now, updatedAt: now },
  attestations: [], conversions: [], activities: [], audits: [], stageUpdates: [],
});

const activityRepo = (state) => ({
  async create(scope, input) { assert.equal(scope.tenantId, tenantId); state.activities.push(input); return { id: `activity-${state.activities.length}`, ...input, createdAt: now, updatedAt: now }; },
});

const repositories = (state) => ({
  marketplaceCaptures: { async findById(scope, id) { assert.equal(scope.tenantId, tenantId); return id === state.capture.id ? state.capture : null; }, async update(scope, id, input) { assert.equal(id, state.capture.id); state.capture = { ...state.capture, ...input, updatedAt: now }; return state.capture; } },
  draftInventories: { async findByMarketplaceCaptureId(scope, id) { assert.equal(scope.tenantId, tenantId); return id === state.capture.id ? state.draft : null; }, async update(scope, id, input) { assert.equal(id, state.draft.id); state.draft = { ...state.draft, ...input, updatedAt: now }; return state.draft; } },
  ownershipAttestations: { async findByMarketplaceCaptureId(scope, id) { assert.equal(scope.tenantId, tenantId); return state.attestations.find((row) => row.marketplaceCaptureId === id) ?? null; }, async create(scope, input) { const row = { id: `att-${state.attestations.length + 1}`, ...input, createdAt: now, updatedAt: now }; state.attestations.push(row); return row; } },
  pipelines: { async findByDefaultKey(id, key) { assert.equal(id, tenantId); assert.equal(key, 'marketplace_acquisition'); return { id: 'pipeline-1', tenantId, stages: [{ id: 'stage-started', name: 'Claim Started' }, { id: 'stage-claimed', name: 'Claimed' }, { id: 'stage-converted', name: 'Converted' }] }; } },
  deals: { async updateStage(id, dealId, stageId) { state.stageUpdates.push({ tenantId: id, dealId, stageId }); return { id: dealId, tenantId: id, pipelineStageId: stageId, updatedAt: now }; } },
  contacts: { async findById(scope, id) { assert.equal(scope.tenantId, tenantId); return id === state.contact.id ? state.contact : null; } },
  renderConversions: {
    async findSuccessfulSellerConversion() { return state.conversions.find((row) => row.conversionKind === 'SELLER' && row.status === 'SUCCESS') ?? null; },
    async findSuccessfulInventoryConversion() { return state.conversions.find((row) => row.conversionKind === 'INVENTORY' && row.status === 'SUCCESS') ?? null; },
    async create(scope, input) { const row = { id: `conv-${state.conversions.length + 1}`, createdAt: now, updatedAt: now, ...input }; state.conversions.push(row); return row; },
    async update(scope, id, input) { const index = state.conversions.findIndex((row) => row.id === id); const row = { ...state.conversions[index], ...input, id, updatedAt: now }; state.conversions[index] = row; return row; },
  },
  auditLogs: { async append(scope, input) { state.audits.push(input); return { id: `audit-${state.audits.length}`, ...input, createdAt: now }; } },
  activities: activityRepo(state),
});

const claimService = (state) => new SellerClaimPortalService({
  clock: () => new Date(now),
  claimTokens: { async findByTokenHash(tokenHash) { return tokenHash === state.token.tokenHash ? state.token : null; }, async update(scope, id, input) { assert.equal(scope.tenantId, tenantId); state.token = { ...state.token, ...input }; return state.token; } },
  ...repositories(state),
});

const servicesUrl = import.meta.resolve('@whisperm/services');

const transpileRoute = (routePath, tempDir) => {
  let source = readFileSync(routePath, 'utf8')
    .replace(/from "next\/server"/gu, `from "${join(tempDir, 'next-server.mjs')}"`)
    .replace(/from "@\/lib\/get-tenant"/gu, `from "${join(tempDir, 'get-tenant.mjs')}"`)
    .replace(/from "@\/lib\/prisma"/gu, `from "${join(tempDir, 'prisma.mjs')}"`)
    .replace(/from "@\/lib\/tenant-features"/gu, `from "${join(tempDir, 'tenant-features.mjs')}"`)
    .replace(/from "@\/lib\/claims\/seller-claim-service"/gu, `from "${join(tempDir, 'claim-service.mjs')}"`)
    .replaceAll('from "@whisperm/repositories"', `from "${join(tempDir, 'repositories.mjs')}"`)
    .replaceAll('from "@whisperm/services"', `from "${servicesUrl}"`);
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const file = join(tempDir, `${relative(new URL('../src/app/api/marketplace-acquisition', import.meta.url).pathname, routePath).replaceAll('/', '-')}.mjs`);
  writeFileSync(file, output);
  return import(file);
};

const makeRequest = (body) => ({ headers: new Headers({ 'x-correlation-id': 'corr-route', 'x-request-id': 'req-route' }), async json() { return body ?? {}; } });

const createHarness = async (state, options = {}) => {
  const tempDir = join(tmpdir(), `whisperm-route-activity-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempDir);
  writeFileSync(join(tempDir, 'next-server.mjs'), 'export class NextResponse extends Response { static json(body, init) { return Response.json(body, init); } }\nexport class NextRequest extends Request {}\n');
  writeFileSync(join(tempDir, 'get-tenant.mjs'), 'export const getTenantForCurrentUser = async () => globalThis.__routeState.tenant;\nexport const getTenantContextForCurrentUser = async () => ({ tenant: globalThis.__routeState.tenant, tenantUserId: "tenant-user-1" });\n');
  writeFileSync(join(tempDir, 'prisma.mjs'), 'export const prisma = {};\n');
  writeFileSync(join(tempDir, 'tenant-features.mjs'), [
    'export const SELLER_ACQUISITION_FEATURE = "SELLER_ACQUISITION";',
    `export const isTenantFeatureEnabled = async () => ${options.featureEnabled === false ? 'false' : 'true'};`,
    `export const isProtectedTenantFeatureEnabled = async () => ${options.featureEnabled === false ? 'false' : 'true'};`,
    'export const featureNotEnabledResponse = () => Response.json({ ok: false, error: { message: "Seller Acquisition add-on is not enabled for this workspace.", code: "FEATURE_NOT_ENABLED" } }, { status: 403 });',
    'export const requireSellerAcquisitionFeatureForApi = async () => (await isProtectedTenantFeatureEnabled()) ? null : featureNotEnabledResponse();',
    '',
  ].join('\n'));
  writeFileSync(join(tempDir, 'repositories.mjs'), 'export const createPrismaRepositories = () => globalThis.__routeRepositories;\n');
  writeFileSync(join(tempDir, 'claim-service.mjs'), 'export const createSellerClaimService = () => globalThis.__routeClaimService;\n');
  globalThis.__routeState = state;
  globalThis.__routeRepositories = repositories(state);
  globalThis.__routeClaimService = claimService(state);
  const base = new URL('../src/app/api/marketplace-acquisition/', import.meta.url).pathname;
  return {
    cleanup: () => { delete globalThis.__routeState; delete globalThis.__routeRepositories; delete globalThis.__routeClaimService; rmSync(tempDir, { recursive: true, force: true }); },
    accept: await transpileRoute(join(base, 'claims/[token]/accept/route.ts'), tempDir),
    seller: await transpileRoute(join(base, 'captures/[id]/convert/render-seller/route.ts'), tempDir),
    inventory: await transpileRoute(join(base, 'captures/[id]/convert/render-inventory/route.ts'), tempDir),
    complete: await transpileRoute(join(base, 'captures/[id]/complete/route.ts'), tempDir),
  };
};

test('authenticated seller acquisition route denies disabled tenant before protected work runs', async () => {
  const state = makeState();
  const harness = await createHarness(state, { featureEnabled: false });
  try {
    const response = await harness.seller.POST(makeRequest(), { params: { id: captureId } });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { ok: false, error: { message: 'Seller Acquisition add-on is not enabled for this workspace.', code: 'FEATURE_NOT_ENABLED' } });
    assert.equal(state.conversions.length, 0);
    assert.equal(state.activities.length, 0);
  } finally {
    harness.cleanup();
  }
});

test('seller acquisition route handlers create authenticated CRM activities for live conversion-to-completion lifecycle', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  const originalFetch = globalThis.fetch;
  const originalEnv = { RENDER_API_BASE_URL: process.env.RENDER_API_BASE_URL, RENDER_API_KEY: process.env.RENDER_API_KEY, RENDER_INTERNAL_API_KEY: process.env.RENDER_INTERNAL_API_KEY };
  process.env.RENDER_API_BASE_URL = 'https://render.test';
  process.env.RENDER_API_KEY = 'test-key';
  process.env.RENDER_INTERNAL_API_KEY = 'test-internal-key';
  globalThis.fetch = async (url) => Response.json(url.toString().includes('/seller-accounts') ? { renderSellerId: 'render-seller-1' } : { listing: { id: 'render-inventory-1' } }, { status: 201 });
  try {
    for (const [route, body] of [[harness.accept, { acceptedTerms: true, claimantName: 'Sam Seller' }], [harness.seller], [harness.inventory], [harness.complete]]) {
      const response = await route.POST(makeRequest(body), { params: route === harness.accept ? { token } : { id: captureId } });
      assert.equal(response.status, 200, await response.text());
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    harness.cleanup();
  }

  for (const eventType of ['RENDER_SELLER_CONVERSION_SUCCEEDED', 'RENDER_INVENTORY_CONVERSION_SUCCEEDED', 'MARKETPLACE_CAPTURE_COMPLETED']) {
    assert.equal(state.activities.some((activity) => activity.metadata.eventType === eventType), true);
  }
  assert.equal(state.activities.every((activity) => activity.tenantId === tenantId && activity.dealId === 'deal-1' && activity.contactId === 'contact-1'), true);
  assert.equal(state.activities.every((activity) => activity.createdById === 'tenant-user-1'), true);
  assert.equal(state.conversions.find((row) => row.conversionKind === 'SELLER')?.renderSellerId, 'render-seller-1');
  assert.equal(state.conversions.find((row) => row.conversionKind === 'INVENTORY')?.metadata.renderInventoryId, 'render-inventory-1');
  assert.equal(state.capture.status, 'CONVERTED');
});

test('seller acquisition route handlers create failure activities when conversion providers fail', async () => {
  const state = makeState();
  state.capture.status = 'CLAIMED';
  state.draft.status = 'CLAIMED';
  state.attestations.push({ id: 'att-1', tenantId, marketplaceCaptureId: captureId, contactId: 'contact-1', status: 'ATTESTED', verifiedAt: now, createdAt: now, updatedAt: now });
  const harness = await createHarness(state);
  const originalFetch = globalThis.fetch;
  const originalEnv = { RENDER_API_BASE_URL: process.env.RENDER_API_BASE_URL, RENDER_API_KEY: process.env.RENDER_API_KEY, RENDER_INTERNAL_API_KEY: process.env.RENDER_INTERNAL_API_KEY };
  process.env.RENDER_API_BASE_URL = 'https://render.test';
  process.env.RENDER_API_KEY = 'test-key';
  process.env.RENDER_INTERNAL_API_KEY = 'test-internal-key';
  globalThis.fetch = async () => Response.json({ error: 'down' }, { status: 503 });
  try {
    const sellerResponse = await harness.seller.POST(makeRequest(), { params: { id: captureId } });
    assert.equal(sellerResponse.status, 502);
    state.conversions = [];
    state.conversions.push({ id: 'seller-success', tenantId, marketplaceCaptureId: captureId, contactId: 'contact-1', sellerVerificationId: 'att-1', renderSellerId: 'render-seller-1', conversionKind: 'SELLER', status: 'SUCCESS', createdAt: now, updatedAt: now });
    const inventoryResponse = await harness.inventory.POST(makeRequest(), { params: { id: captureId } });
    assert.equal(inventoryResponse.status, 502, await inventoryResponse.text());
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    harness.cleanup();
  }

  assert.equal(state.activities.some((activity) => activity.metadata.eventType === 'RENDER_SELLER_CONVERSION_FAILED'), true);
  assert.equal(state.activities.some((activity) => activity.metadata.eventType === 'RENDER_INVENTORY_CONVERSION_FAILED'), true);
});
