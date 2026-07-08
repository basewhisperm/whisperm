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
  attestations: [], conversions: [], invitations: [], claimTokens: [], activities: [], audits: [], stageUpdates: [], dealUpdates: [], usageEvents: [],
});

const activityRepo = (state) => ({
  async create(scope, input) { assert.equal(scope.tenantId, tenantId); state.activities.push(input); return { id: `activity-${state.activities.length}`, ...input, createdAt: now, updatedAt: now }; },
});

const repositories = (state) => ({
  marketplaceCaptures: { async findById(scope, id) { assert.equal(scope.tenantId, tenantId); return id === state.capture.id ? state.capture : null; }, async findByDealId(scope, dealId) { assert.equal(scope.tenantId, tenantId); return state.capture.dealId === dealId ? state.capture : null; }, async update(scope, id, input) { assert.equal(id, state.capture.id); state.capture = { ...state.capture, ...input, updatedAt: now }; return state.capture; } },
  draftInventories: { async findByMarketplaceCaptureId(scope, id) { assert.equal(scope.tenantId, tenantId); return id === state.capture.id ? state.draft : null; }, async update(scope, id, input) { assert.equal(id, state.draft.id); state.draft = { ...state.draft, ...input, updatedAt: now }; return state.draft; } },
  ownershipAttestations: { async findByMarketplaceCaptureId(scope, id) { assert.equal(scope.tenantId, tenantId); return state.attestations.find((row) => row.marketplaceCaptureId === id) ?? null; }, async create(scope, input) { const row = { id: `att-${state.attestations.length + 1}`, ...input, createdAt: now, updatedAt: now }; state.attestations.push(row); return row; } },
  pipelines: { async findByDefaultKey(id, key) { assert.equal(id, tenantId); assert.equal(key, 'marketplace_acquisition'); return { id: 'pipeline-1', tenantId, stages: [{ id: 'stage-started', name: 'Claim Started' }, { id: 'stage-claimed', name: 'Claimed' }, { id: 'stage-converted', name: 'Converted' }] }; } },
  deals: {
    dealsById: new Map([['deal-1', { id: 'deal-1', tenantId, metadata: { source: 'MARKETPLACE_ACQUISITION' }, updatedAt: now }]]),
    async updateStage(id, dealId, stageId) { state.stageUpdates.push({ tenantId: id, dealId, stageId }); return { id: dealId, tenantId: id, pipelineStageId: stageId, updatedAt: now }; },
    async findById(id, dealId) { assert.equal(id, tenantId); return this.dealsById.get(dealId) ?? null; },
    async update(id, dealId, input) { assert.equal(id, tenantId); const existing = this.dealsById.get(dealId); const updated = { ...existing, ...input, updatedAt: now }; this.dealsById.set(dealId, updated); state.dealUpdates.push({ id: dealId, ...input }); return updated; },
  },
  contacts: { async findById(scope, id) { assert.equal(scope.tenantId, tenantId); return id === state.contact.id ? state.contact : null; } },
  marketplaceClaimTokens: {
    async create(scope, input) {
      assert.equal(scope.tenantId, tenantId);
      const row = { id: `token-${state.claimTokens.length + 1}`, createdAt: now, updatedAt: now, ...input };
      state.claimTokens.push(row);
      state.token = row;
      return row;
    },
    async findByTokenHash(scope, tokenHash) {
      assert.equal(scope.tenantId, tenantId);
      return state.claimTokens.find((row) => row.tokenHash === tokenHash) ?? (state.token.tokenHash === tokenHash ? state.token : null);
    },
    async update(scope, id, input) {
      assert.equal(scope.tenantId, tenantId);
      const index = state.claimTokens.findIndex((row) => row.id === id);
      const current = index === -1 ? state.token : state.claimTokens[index];
      const row = { ...current, ...input, updatedAt: now };
      if (index === -1) state.token = row;
      else state.claimTokens[index] = row;
      if (state.token.id === id) state.token = row;
      return row;
    },
    async listClaimTokensByMarketplaceCaptureId(scope, marketplaceCaptureId) {
      assert.equal(scope.tenantId, tenantId);
      return state.claimTokens.filter((row) => row.marketplaceCaptureId === marketplaceCaptureId);
    },
  },
  sellerInvitations: {
    async create(scope, input) {
      assert.equal(scope.tenantId, tenantId);
      const row = { id: `invite-${state.invitations.length + 1}`, createdAt: now, updatedAt: now, ...input };
      state.invitations.push(row);
      return row;
    },
    async update(scope, id, input) {
      assert.equal(scope.tenantId, tenantId);
      const index = state.invitations.findIndex((row) => row.id === id);
      assert.notEqual(index, -1);
      const row = { ...state.invitations[index], ...input, updatedAt: now };
      state.invitations[index] = row;
      return row;
    },
    async listSellerInvitationsByMarketplaceCaptureId(scope, id) {
      assert.equal(scope.tenantId, tenantId);
      return state.invitations.filter((row) => row.marketplaceCaptureId === id);
    },
  },
  renderConversions: {
    async findSuccessfulSellerConversion() { return state.conversions.find((row) => row.conversionKind === 'SELLER' && row.status === 'SUCCESS') ?? null; },
    async findSuccessfulInventoryConversion() { return state.conversions.find((row) => row.conversionKind === 'INVENTORY' && row.status === 'SUCCESS') ?? null; },
    async create(scope, input) { const row = { id: `conv-${state.conversions.length + 1}`, createdAt: now, updatedAt: now, ...input }; state.conversions.push(row); return row; },
    async update(scope, id, input) { const index = state.conversions.findIndex((row) => row.id === id); const row = { ...state.conversions[index], ...input, id, updatedAt: now }; state.conversions[index] = row; return row; },
  },
  auditLogs: { async append(scope, input) { state.audits.push(input); return { id: `audit-${state.audits.length}`, ...input, createdAt: now }; } },
  activities: activityRepo(state),
  // ST1-008: RevenueAttributionRuntimeService dependencies for the completion route's canonical
  // revenue-attribution trigger. No opportunity exists in this fixture, so attribution resolves
  // to a PARTIAL-but-ATTRIBUTED snapshot -- these tests assert activity/audit behavior, not
  // attribution outcomes, so a minimal working mock is sufficient.
  businessGrowthOpportunities: {
    async findByDealId() { return null; },
    async findByMarketplaceCaptureId() { return null; },
    async recordRevenueAttribution(scope, opportunityId, input) { return { id: opportunityId, ...input }; },
  },
  acquisitionUsageEvents: {
    async createIfNotExists(scope, input) {
      assert.equal(scope.tenantId, tenantId);
      const row = { id: `usage-${state.usageEvents.length + 1}`, ...input, createdAt: now, updatedAt: now };
      state.usageEvents.push(row);
      return row;
    },
    async summarizeByTenantAndPeriod() { return { totals: [], periodStart: now, periodEnd: now }; },
    async listByTenantAndPeriod() { return { items: [], nextCursor: undefined }; },
  },
});

const claimService = (state) => new SellerClaimPortalService({
  clock: () => new Date(now),
  claimTokens: { async findByTokenHash(tokenHash) { return tokenHash === state.token.tokenHash ? state.token : null; }, async update(scope, id, input) { assert.equal(scope.tenantId, tenantId); state.token = { ...state.token, ...input }; return state.token; } },
  ...repositories(state),
});

const servicesUrl = import.meta.resolve('@whisperm/services');
const typesUrl = import.meta.resolve('@whisperm/types');

const sharedModuleReplacements = (tempDir) => (source) => source
  .replace(/from "next\/server"/gu, `from "${join(tempDir, 'next-server.mjs')}"`)
  .replaceAll('from "@whisperm/provider-adapters"', `from "${join(tempDir, 'provider-adapters.mjs')}"`)
  .replaceAll('from "@whisperm/types"', `from "${typesUrl}"`)
  .replaceAll('from "@whisperm/repositories"', `from "${join(tempDir, 'repositories.mjs')}"`)
  .replaceAll('from "@whisperm/services"', `from "${servicesUrl}"`);

// The invite route pulls in these two web-only lib modules (not aliased elsewhere in this
// harness); transpile the real source with the same stub redirections so the E2E test still
// exercises the actual inline-dispatch logic instead of a hand-written stand-in.
const transpileWebLib = (relativeLibPath, tempDir, fileName) => {
  const libPath = new URL(`../src/${relativeLibPath}`, import.meta.url).pathname;
  const source = sharedModuleReplacements(tempDir)(readFileSync(libPath, 'utf8'));
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const file = join(tempDir, fileName);
  writeFileSync(file, output);
  return file;
};

const transpileRoute = (routePath, tempDir) => {
  let source = sharedModuleReplacements(tempDir)(readFileSync(routePath, 'utf8'))
    .replace(/from "@\/lib\/get-tenant"/gu, `from "${join(tempDir, 'get-tenant.mjs')}"`)
    .replace(/from "@\/lib\/acquisition-governance"/gu, `from "${join(tempDir, 'acquisition-governance.mjs')}"`)
    .replace(/from "@\/lib\/prisma"/gu, `from "${join(tempDir, 'prisma.mjs')}"`)
    .replace(/from "@\/lib\/tenant-features"/gu, `from "${join(tempDir, 'tenant-features.mjs')}"`)
    .replace(/from "@\/lib\/claims\/seller-claim-service"/gu, `from "${join(tempDir, 'claim-service.mjs')}"`)
    .replace(/from "@\/lib\/api\/request-body"/gu, `from "${join(tempDir, 'request-body.mjs')}"`);
  if (source.includes('@/lib/marketplace-acquisition/invitation-executor')) {
    const file = transpileWebLib('lib/marketplace-acquisition/invitation-executor.ts', tempDir, 'invitation-executor.mjs');
    source = source.replace(/from "@\/lib\/marketplace-acquisition\/invitation-executor"/gu, `from "${file}"`);
  }
  if (source.includes('@/lib/marketplace-acquisition/invitation-execution-response')) {
    const file = transpileWebLib('lib/marketplace-acquisition/invitation-execution-response.ts', tempDir, 'invitation-execution-response.mjs');
    source = source.replace(/from "@\/lib\/marketplace-acquisition\/invitation-execution-response"/gu, `from "${file}"`);
  }
  if (source.includes('@/lib/marketplace-acquisition/invitation-eligibility')) {
    const file = transpileWebLib('lib/marketplace-acquisition/invitation-eligibility.ts', tempDir, 'invitation-eligibility.mjs');
    source = source.replace(/from "@\/lib\/marketplace-acquisition\/invitation-eligibility"/gu, `from "${file}"`);
  }
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
  writeFileSync(join(tempDir, 'get-tenant.mjs'), 'export const getTenantForCurrentUser = async () => globalThis.__routeState.tenant;\nexport const getTenantContextForCurrentUser = async () => (globalThis.__routeState.tenant === null ? null : { tenant: globalThis.__routeState.tenant, tenantUserId: "tenant-user-1" });\n');
  writeFileSync(join(tempDir, 'prisma.mjs'), [
    'export const prisma = {',
    '  marketplaceCapture: {',
    '    async findFirst(args) {',
    '      const state = globalThis.__routeState;',
    '      if (!state?.capture || args.where.tenantId !== state.capture.tenantId || args.where.id !== state.capture.id) return null;',
    '      return {',
    '        ...state.capture,',
    '        contact: state.contact,',
    '        campaignMemberships: [{ campaignId: "campaign-1" }],',
    '        sellerInvitations: [...state.invitations].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 1),',
    '        claimTokens: [...state.claimTokens, state.token].filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 1),',
    '      };',
    '    },',
    '  },',
    '  sellerAcquisitionCampaignMember: {',
    '    async findFirst(args) {',
    '      return { campaignId: "campaign-1" };',
    '    },',
    '  },',
    '  queueJob: {',
    '    async create(args) {',
    '      return { id: "queue-job-1", ...args.data };',
    '    },',
    '  },',
    '};',
    '',
  ].join('\n'));
  writeFileSync(join(tempDir, 'tenant-features.mjs'), [
    'export const SELLER_ACQUISITION_FEATURE = "SELLER_ACQUISITION";',
    `export const isTenantFeatureEnabled = async () => ${options.featureEnabled === false ? 'false' : 'true'};`,
    `export const isProtectedTenantFeatureEnabled = async () => ${options.featureEnabled === false ? 'false' : 'true'};`,
    'export const featureNotEnabledResponse = () => Response.json({ ok: false, error: { message: "Seller Acquisition add-on is not enabled for this workspace.", code: "FEATURE_NOT_ENABLED" } }, { status: 403 });',
    'export const requireSellerAcquisitionFeatureForApi = async () => (await isProtectedTenantFeatureEnabled()) ? null : featureNotEnabledResponse();',
    '',
  ].join('\n'));
  writeFileSync(join(tempDir, 'repositories.mjs'), [
    'export class PrismaAuditLogRepository { constructor() { return globalThis.__routeRepositories.auditLogs; } }',
    'export class PrismaContactRepository { constructor() { return globalThis.__routeRepositories.contacts; } }',
    'export class PrismaDealsRepository { constructor() { return globalThis.__routeRepositories.deals; } }',
    'export class PrismaMarketplaceCaptureRepository { constructor() { return globalThis.__routeRepositories.marketplaceCaptures; } }',
    'export class PrismaMarketplaceClaimTokenRepository { constructor() { return globalThis.__routeRepositories.marketplaceClaimTokens; } }',
    'export class PrismaPipelineRepository { constructor() { return globalThis.__routeRepositories.pipelines; } }',
    'export class PrismaSellerInvitationRepository { constructor() { return globalThis.__routeRepositories.sellerInvitations; } }',
    'export class PrismaAcquisitionUsageEventRepository { constructor() { return globalThis.__routeRepositories.acquisitionUsageEvents; } }',
    'export class PrismaBusinessGrowthOpportunityRepository { constructor() { return globalThis.__routeRepositories.businessGrowthOpportunities; } }',
    'export class PersistenceError extends Error { constructor(input = {}) { super(input.message ?? "Persistence error"); this.code = input.code ?? "PERSISTENCE_ERROR"; this.status = input.status ?? 500; this.details = input.details; } }',
    'export class PrismaSellerAcquisitionCampaignRepository { constructor() { return { async findById() { return { id: "campaign-1", tenantId: "tenant-1", name: "Test Campaign", status: "ACTIVE", createdAt: "2026-06-15T00:00:00.000Z", updatedAt: "2026-06-15T00:00:00.000Z", metadata: {} }; } }; } }',
    'export class PrismaCampaignRuntimeExecutionRepository { constructor() { return { async create(scope, input) { const row = { id: "execution-1", ...input, createdAt: "2026-06-15T00:00:00.000Z", updatedAt: "2026-06-15T00:00:00.000Z" }; globalThis.__routeState.execution = row; return row; }, async findById(scope, id) { const row = globalThis.__routeState.execution; return row && row.id === id ? row : null; }, async update(scope, id, input) { const row = { ...(globalThis.__routeState.execution ?? { id, tenantId: scope.tenantId, campaignId: "campaign-1" }), ...input, id, updatedAt: "2026-06-15T00:00:00.000Z" }; globalThis.__routeState.execution = row; return row; } }; } }',
    'export const createPrismaRepositories = () => globalThis.__routeRepositories;',
    '',
  ].join('\n'));
  writeFileSync(join(tempDir, 'acquisition-governance.mjs'), 'export const acquisitionGovernanceService = () => ({ authorizeAcquisitionAction: async () => ({ status: "ALLOW", capability: "INVITATION", reason: null, message: "ok", limits: [], warnings: [], auditEvent: { action: "ACQUISITION_GOVERNANCE_ALLOW", capability: "INVITATION", status: "ALLOW", reason: null, recordedAt: new Date().toISOString(), persisted: false } }) });\nexport const authorizeAcquisitionActionForApi = async () => ({ decision: await acquisitionGovernanceService().authorizeAcquisitionAction(), denied: null });\n');
  writeFileSync(join(tempDir, 'claim-service.mjs'), 'export const createSellerClaimService = () => globalThis.__routeClaimService;\n');
  writeFileSync(join(tempDir, 'request-body.mjs'), 'export class RequestBodyError extends Error { constructor(message, code = "REQUEST_BODY_INVALID", status = 400) { super(message); this.code = code; this.status = status; } }\nexport const readJsonBody = async (request) => request.json();\n');
  writeFileSync(join(tempDir, 'provider-adapters.mjs'), [
    // ST1-013: invitation-executor.ts now wires notifications through the canonical registry
    // factory instead of calling the individual create*FromEnv functions directly, so the stub
    // exposes that same surface here (still backed by the per-test globalThis provider fixtures).
    'export const createMessagingProviderRegistryFromEnv = () => ({',
    '  getWhatsAppProvider: () => globalThis.__routeWhatsappProvider,',
    '  getSmsProvider: () => globalThis.__routeSmsProvider,',
    '  getEmailProvider: () => undefined,',
    '  isAvailable: (id) => (id === "WHATSAPP" ? globalThis.__routeWhatsappProvider !== undefined : id === "SMS" ? globalThis.__routeSmsProvider !== undefined : false),',
    '  health: () => [],',
    '});',
    'export const createConsoleMessagingProviderLogger = () => ({ info() {}, warn() {}, error() {} });',
    'export const buildSellerInvitationNotificationPorts = (registry, env) => ({',
    '  whatsappEnabled: env.SELLER_INVITATION_WHATSAPP_ENABLED !== "false",',
    '  fallbackToSmsWhenWhatsappMissing: env.SELLER_INVITATION_FALLBACK_TO_SMS !== "false",',
    '  inviteBaseUrl: env.SELLER_INVITATION_BASE_URL,',
    '  ...(registry.getWhatsAppProvider() ? { whatsapp: registry.getWhatsAppProvider() } : {}),',
    '  ...(registry.getSmsProvider() ? { sms: registry.getSmsProvider() } : {}),',
    '});',
    '',
  ].join('\n'));
  globalThis.__routeState = state;
  globalThis.__routeRepositories = repositories(state);
  globalThis.__routeClaimService = claimService(state);
  globalThis.__routeSmsProvider = options.smsProvider;
  globalThis.__routeWhatsappProvider = options.whatsappProvider;
  const base = new URL('../src/app/api/marketplace-acquisition/', import.meta.url).pathname;
  return {
    cleanup: () => { delete globalThis.__routeState; delete globalThis.__routeRepositories; delete globalThis.__routeClaimService; delete globalThis.__routeSmsProvider; delete globalThis.__routeWhatsappProvider; rmSync(tempDir, { recursive: true, force: true }); },
    invite: await transpileRoute(join(base, 'captures/[id]/invite/route.ts'), tempDir),
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

test('unauthenticated capture completion request returns 401 and never touches revenue attribution', async () => {
  const state = makeState();
  state.tenant = null;
  const harness = await createHarness(state);
  try {
    const response = await harness.complete.POST(makeRequest(), { params: { id: captureId } });
    assert.equal(response.status, 401);
    assert.equal(state.dealUpdates.length, 0);
    assert.equal(state.audits.length, 0);
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
  let completeBody;
  let repeatCompleteBody;
  try {
    for (const [route, body] of [[harness.accept, { acceptedTerms: true, claimantName: 'Sam Seller' }], [harness.seller], [harness.inventory], [harness.complete]]) {
      const response = await route.POST(makeRequest(body), { params: route === harness.accept ? { token } : { id: captureId } });
      if (route === harness.complete) completeBody = await response.clone().json();
      assert.equal(response.status, 200, await response.text());
    }
    // ST1-008: repeated completion requests must stay idempotent -- no duplicate revenue attribution.
    const repeatResponse = await harness.complete.POST(makeRequest(), { params: { id: captureId } });
    assert.equal(repeatResponse.status, 200, await repeatResponse.clone().text());
    repeatCompleteBody = await repeatResponse.json();
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
  // ST1-008: capture completion is the canonical trigger that moves a deal to its
  // revenue-generating outcome and executes revenue attribution automatically.
  assert.equal(completeBody.ok, true);
  assert.equal(completeBody.data.revenueAttributed, true);
  assert.equal(completeBody.data.dealId, 'deal-1');
  assert.ok(completeBody.data.attributionId);
  assert.equal(state.dealUpdates.some((update) => update.id === 'deal-1' && update.closedAt != null), true);
  // The repeat call reports the same canonical attribution outcome without duplicating it.
  assert.equal(repeatCompleteBody.data.idempotent, true);
  assert.equal(repeatCompleteBody.data.revenueAttributed, true);
  assert.equal(repeatCompleteBody.data.attributionId, completeBody.data.attributionId);
  assert.equal(state.dealUpdates.filter((update) => update.id === 'deal-1' && update.closedAt != null).length, 1);
});


test('seller acquisition invite-to-completion route E2E creates claim token and completes conversion lifecycle', async () => {
  const state = makeState();
  state.capture.status = 'CAPTURED';
  state.draft.status = 'DRAFT';

  const sentMessages = [];
  const harness = await createHarness(state, {
    smsProvider: { async send(message) { sentMessages.push(message); } },
  });

  const originalFetch = globalThis.fetch;
  const originalEnv = {
    SELLER_INVITATION_SMS_PROVIDER: process.env.SELLER_INVITATION_SMS_PROVIDER,
    SELLER_INVITATION_SMS_API_URL: process.env.SELLER_INVITATION_SMS_API_URL,
    SELLER_INVITATION_SMS_API_KEY: process.env.SELLER_INVITATION_SMS_API_KEY,
    SELLER_INVITATION_SMS_SENDER_ID: process.env.SELLER_INVITATION_SMS_SENDER_ID,
    SELLER_INVITATION_WHATSAPP_ENABLED: process.env.SELLER_INVITATION_WHATSAPP_ENABLED,
    SELLER_INVITATION_BASE_URL: process.env.SELLER_INVITATION_BASE_URL,
    RENDER_API_BASE_URL: process.env.RENDER_API_BASE_URL,
    RENDER_API_KEY: process.env.RENDER_API_KEY,
    RENDER_INTERNAL_API_KEY: process.env.RENDER_INTERNAL_API_KEY,
  };

  process.env.SELLER_INVITATION_SMS_PROVIDER = 'test';
  process.env.SELLER_INVITATION_SMS_API_URL = 'https://sms.test/send';
  process.env.SELLER_INVITATION_SMS_API_KEY = 'sms-key';
  process.env.SELLER_INVITATION_SMS_SENDER_ID = 'WhispeRM';
  process.env.SELLER_INVITATION_WHATSAPP_ENABLED = 'false';
  process.env.SELLER_INVITATION_BASE_URL = 'https://app.example/claim';
  process.env.RENDER_API_BASE_URL = 'https://render.test';
  process.env.RENDER_API_KEY = 'test-key';
  process.env.RENDER_INTERNAL_API_KEY = 'test-internal-key';

  globalThis.fetch = async (url) => Response.json(
    url.toString().includes('/seller-accounts')
      ? { renderSellerId: 'render-seller-1' }
      : { listing: { id: 'render-inventory-1' } },
    { status: 201 },
  );

  try {
    const inviteResponse = await harness.invite.POST(makeRequest({ preferredChannel: 'SMS' }), { params: { id: captureId } });
    const inviteText = await inviteResponse.text();
    assert.equal(inviteResponse.status, 200, inviteText);
    const inviteJson = JSON.parse(inviteText);

    // ST-003: a 2xx invite response must mean the invitation was actually sent, not merely
    // queued -- COMPLETED here reflects the real inline SMS send via the stubbed provider.
    assert.deepEqual(inviteJson, {
      ok: true,
      executionId: 'execution-1',
      status: 'SENT',
      invitationId: 'invite-1',
    });
    assert.equal(sentMessages.length, 1);

    // ST-003: the invite now genuinely creates its own claim token/invite link (rather than
    // enqueueing a no-op job), so the claim step must use the real token from the sent SMS
    // body instead of the pre-seeded fixture token.
    const sentToken = sentMessages[0].body.split('/').pop();

    for (const [route, body] of [
      [harness.accept, { acceptedTerms: true, claimantName: 'Sam Seller' }],
      [harness.seller],
      [harness.inventory],
      [harness.complete],
    ]) {
      const response = await route.POST(makeRequest(body), { params: route === harness.accept ? { token: sentToken } : { id: captureId } });
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

  assert.equal(state.capture.status, 'CONVERTED');
  assert.equal(state.conversions.find((row) => row.conversionKind === 'SELLER')?.renderSellerId, 'render-seller-1');
  assert.equal(state.conversions.find((row) => row.conversionKind === 'INVENTORY')?.metadata.renderInventoryId, 'render-inventory-1');
  assert.equal(state.activities.some((activity) => activity.metadata.eventType === 'RENDER_SELLER_CONVERSION_SUCCEEDED'), true);
  assert.equal(state.activities.some((activity) => activity.metadata.eventType === 'RENDER_INVENTORY_CONVERSION_SUCCEEDED'), true);
  assert.equal(state.activities.some((activity) => activity.metadata.eventType === 'MARKETPLACE_CAPTURE_COMPLETED'), true);
});

test('claim accept API returns canonical CRM linkage and is idempotent across repeated calls', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    const first = await harness.accept.POST(makeRequest({ acceptedTerms: true, claimantName: 'Sam Seller' }), { params: { token } });
    const firstText = await first.text();
    assert.equal(first.status, 200, firstText);
    const firstBody = JSON.parse(firstText);
    assert.equal(firstBody.status, 'CLAIMED');
    assert.equal(firstBody.contactId, 'contact-1');
    assert.equal(firstBody.dealId, 'deal-1');
    assert.equal(firstBody.crmConversionStatus, 'UPDATED');
    assert.equal(state.dealUpdates.length, 1);

    const second = await harness.accept.POST(makeRequest({ acceptedTerms: true, claimantName: 'Sam Seller' }), { params: { token } });
    const secondText = await second.text();
    assert.equal(second.status, 200, secondText);
    const secondBody = JSON.parse(secondText);
    assert.equal(secondBody.status, 'CLAIMED');
    assert.equal(secondBody.contactId, 'contact-1');
    assert.equal(secondBody.dealId, 'deal-1');
    assert.equal(secondBody.crmConversionStatus, 'ALREADY_CONVERTED');
    assert.equal(state.dealUpdates.length, 1, 'repeated claim accept must not duplicate CRM enrichment');
    assert.equal(state.attestations.length, 1, 'repeated claim accept must not create a duplicate attestation');
  } finally {
    harness.cleanup();
  }
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
