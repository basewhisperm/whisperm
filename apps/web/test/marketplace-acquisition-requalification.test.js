import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

// ST1-010: the requalification contract (ST1-007) was previously only proven with
// regex assertions against source text (apps/web/test/seller-acquisition-edit.test.js),
// which cannot catch a broken wire-up between the route, SellerAcquisitionEditService, and
// MarketplaceRequalificationService. This harness transpiles and invokes the real
// records/[captureId] PATCH route against fake repositories, so a regression that stops
// requalification from firing, or that duplicates the Contact/Deal pair, actually fails.

const now = '2026-07-05T00:00:00.000Z';
const tenantId = 'tenant-1';

const makeState = () => ({
  tenant: { id: tenantId },
  featureEnabled: true,
  captures: [{
    id: 'capture-1',
    tenantId,
    listingUrl: 'https://jiji.com.gh/cars/listing-1',
    title: 'Clean Toyota Corolla',
    description: null,
    price: null,
    currency: 'GHS',
    sellerName: 'Ama Seller',
    sellerProfileUrl: null,
    marketplaceSourceId: null,
    externalId: null,
    metadata: {},
    contactId: null,
    dealId: null,
    status: 'CAPTURED',
    capturedAt: now,
    createdAt: now,
    updatedAt: now,
  }],
  pipeline: {
    id: 'pipeline-1',
    name: 'Marketplace Acquisition',
    isDefault: true,
    defaultKey: 'MARKETPLACE_ACQUISITION',
    createdAt: now,
    updatedAt: now,
    stages: [
      { id: 'stage-captured', pipelineId: 'pipeline-1', name: 'Captured', position: 1, createdAt: now, updatedAt: now },
      { id: 'stage-invited', pipelineId: 'pipeline-1', name: 'Invited', position: 2, createdAt: now, updatedAt: now },
    ],
  },
  contacts: [],
  deals: [],
  draftInventories: [],
  activities: [],
  auditLogs: [],
  usageEvents: [],
  members: [],
  nextId: 1,
});

const pipelinesRepo = (state) => ({
  async findByDefaultKey() { return state.pipeline; },
  async findByWorkspace() { return state.pipeline; },
});

const marketplaceCapturesRepo = (state) => ({
  async findById(scope, id) { return state.captures.find((c) => c.tenantId === scope.tenantId && c.id === id) ?? null; },
  async findByListingUrl(scope, listingUrl) { return state.captures.find((c) => c.tenantId === scope.tenantId && c.listingUrl === listingUrl) ?? null; },
  async findByExternalId(scope, externalId) { return state.captures.find((c) => c.tenantId === scope.tenantId && c.externalId === externalId) ?? null; },
  async findByDealId(scope, dealId) { return state.captures.find((c) => c.tenantId === scope.tenantId && c.dealId === dealId) ?? null; },
  async findByIds(scope, ids) { return state.captures.filter((c) => c.tenantId === scope.tenantId && ids.includes(c.id)); },
  async list(scope) { return { items: state.captures.filter((c) => c.tenantId === scope.tenantId) }; },
  async create(scope, input) {
    const record = { id: `capture-${state.nextId++}`, tenantId: scope.tenantId, status: input.status ?? 'CAPTURED', capturedAt: now, createdAt: now, updatedAt: now, contactId: null, dealId: null, externalId: null, ...input };
    state.captures.push(record);
    return record;
  },
  async update(scope, id, input) {
    const index = state.captures.findIndex((c) => c.tenantId === scope.tenantId && c.id === id);
    state.captures[index] = { ...state.captures[index], ...input, updatedAt: now };
    return state.captures[index];
  },
});

// The route constructs this directly via `new PrismaMarketplaceAcquisitionRepository(...)`
// (distinct from the `marketplaceCaptures` repository above), backed by the same records so
// an edit performed through one is immediately visible through the other.
const marketplaceAcquisitionLegacyRepo = (state) => ({
  async findMarketplaceCaptureById(scope, id) { return state.captures.find((c) => c.tenantId === scope.tenantId && c.id === id) ?? null; },
  async updateMarketplaceCapture(scope, id, input) {
    const index = state.captures.findIndex((c) => c.tenantId === scope.tenantId && c.id === id);
    state.captures[index] = { ...state.captures[index], ...input, updatedAt: now };
    return state.captures[index];
  },
});

const contactsRepo = (state) => ({
  async create(scope, input) {
    const record = { id: `contact-${state.nextId++}`, tenantId: scope.tenantId, createdAt: now, updatedAt: now, stage: input.stage ?? 'PROSPECT', email: input.email ?? null, phone: input.phone ?? null, firstName: input.firstName ?? null, lastName: input.lastName ?? null, externalId: null, metadata: input.metadata ?? {} };
    state.contacts.push(record);
    return record;
  },
  async createMany() { return 0; },
  async count(scope) { return state.contacts.filter((c) => c.tenantId === scope.tenantId).length; },
  async findById(scope, id) { return state.contacts.find((c) => c.tenantId === scope.tenantId && c.id === id) ?? null; },
  async findByIds(scope, ids) { return state.contacts.filter((c) => c.tenantId === scope.tenantId && ids.includes(c.id)); },
  async findByPhone(scope, phone) { return state.contacts.find((c) => c.tenantId === scope.tenantId && c.phone === phone) ?? null; },
  async findByEmails(scope, emails) { return state.contacts.filter((c) => c.tenantId === scope.tenantId && emails.includes(c.email)); },
  async list(scope) { return { items: state.contacts.filter((c) => c.tenantId === scope.tenantId) }; },
  async update(scope, id, input) {
    const index = state.contacts.findIndex((c) => c.tenantId === scope.tenantId && c.id === id);
    state.contacts[index] = { ...state.contacts[index], ...input, updatedAt: now };
    return state.contacts[index];
  },
  async listLeadEvents() { return { items: [] }; },
});

const dealsRepo = (state) => ({
  async create(dealTenantId, input) {
    const record = { id: `deal-${state.nextId++}`, tenantId: dealTenantId, contactId: input.contactId ?? null, pipelineId: state.pipeline.id, pipelineStageId: input.pipelineStageId, ownerId: input.ownerId ?? null, externalId: input.externalId ?? null, title: input.title, value: input.value ?? null, currency: input.currency, probability: null, closedAt: null, metadata: input.metadata ?? {}, createdAt: now, updatedAt: now };
    state.deals.push(record);
    return record;
  },
  async list() { return []; },
  async findById(dealTenantId, id) { return state.deals.find((d) => d.tenantId === dealTenantId && d.id === id) ?? null; },
  async findByExternalId(dealTenantId, externalId) { return state.deals.find((d) => d.tenantId === dealTenantId && d.externalId === externalId) ?? null; },
  async findBoardByPipeline() { return null; },
  async updateStageWithOptimisticLock() { throw new Error('not implemented in fake'); },
  async findDetailById() { return null; },
  async findDetailsByIds() { return []; },
  async updateStage(dealTenantId, dealId, stageId) {
    const index = state.deals.findIndex((d) => d.tenantId === dealTenantId && d.id === dealId);
    state.deals[index] = { ...state.deals[index], pipelineStageId: stageId, updatedAt: now };
    return state.deals[index];
  },
  async findByContact() { return []; },
  async update(dealTenantId, dealId, input) {
    const index = state.deals.findIndex((d) => d.tenantId === dealTenantId && d.id === dealId);
    state.deals[index] = { ...state.deals[index], ...input, updatedAt: now };
    return state.deals[index];
  },
});

const draftInventoriesRepo = (state) => ({
  async create(scope, input) {
    const record = { id: `draft-${state.nextId++}`, tenantId: scope.tenantId, createdAt: now, updatedAt: now, ...input };
    state.draftInventories.push(record);
    return record;
  },
  async findByMarketplaceCaptureId(scope, id) { return state.draftInventories.find((d) => d.tenantId === scope.tenantId && d.marketplaceCaptureId === id) ?? null; },
  async listByMarketplaceCaptureIds() { return []; },
  async findByMarketplaceListing() { return null; },
  async upsertForCapture(scope, input) {
    const existing = state.draftInventories.find((d) => d.tenantId === scope.tenantId && d.marketplaceCaptureId === input.marketplaceCaptureId);
    if (existing !== undefined) { Object.assign(existing, input, { updatedAt: now }); return existing; }
    const record = { id: `draft-${state.nextId++}`, tenantId: scope.tenantId, createdAt: now, updatedAt: now, ...input };
    state.draftInventories.push(record);
    return record;
  },
  async update(scope, id, input) {
    const index = state.draftInventories.findIndex((d) => d.tenantId === scope.tenantId && d.id === id);
    state.draftInventories[index] = { ...state.draftInventories[index], ...input, updatedAt: now };
    return state.draftInventories[index];
  },
});

const activitiesRepo = (state) => ({
  async create(context, input) { const record = { id: `activity-${state.nextId++}`, createdAt: now, updatedAt: now, ...input }; state.activities.push(record); return record; },
  async list() { return { items: [] }; },
  async listByDeal() { return { items: [] }; },
  async listActivitiesByMarketplaceCaptureId() { return []; },
  async listActivitiesByMarketplaceCaptureIds() { return []; },
});

const auditLogsRepo = (state) => ({
  async append(scope, input) { const record = { id: `audit-${state.nextId++}`, createdAt: now, ...input }; state.auditLogs.push(record); return record; },
  async listByTarget() { return { items: [] }; },
});

const acquisitionUsageEventsRepo = (state) => ({
  async createIfNotExists(scope, input) {
    const existing = state.usageEvents.find((e) => e.tenantId === scope.tenantId && e.idempotencyKey === input.idempotencyKey);
    if (existing !== undefined) return existing;
    const record = { id: `usage-${state.usageEvents.length + 1}`, tenantId: scope.tenantId, quantity: 1, billable: true, ...input, createdAt: now };
    state.usageEvents.push(record);
    return record;
  },
  async summarizeByTenantAndPeriod() { return { periodStart: now, periodEnd: now, totals: [], totalQuantity: 0, billableTotalQuantity: 0 }; },
  async listByTenantAndPeriod() { return { items: [] }; },
});

const sellerAcquisitionCampaignsRepo = (state) => ({
  async findById(ctx, id) { return null; },
  async listMembersByCapture(scope, marketplaceCaptureId) {
    return state.members.filter((m) => m.tenantId === scope.tenantId && m.marketplaceCaptureId === marketplaceCaptureId);
  },
  async updateMember(scope, memberId, update) {
    const index = state.members.findIndex((m) => m.tenantId === scope.tenantId && m.id === memberId);
    state.members[index] = { ...state.members[index], ...update, updatedAt: now };
    return state.members[index];
  },
});

const fakeCreatePrismaRepositories = (state) => () => ({
  tenants: {},
  users: {},
  contacts: contactsRepo(state),
  pipelines: pipelinesRepo(state),
  deals: dealsRepo(state),
  activities: activitiesRepo(state),
  marketplaceCaptures: marketplaceCapturesRepo(state),
  sellerAcquisitionCampaigns: sellerAcquisitionCampaignsRepo(state),
  draftInventories: draftInventoriesRepo(state),
  campaigns: {},
  workflows: {},
  approvals: {},
  executions: {},
  events: {},
  billing: {},
  auditLogs: auditLogsRepo(state),
  marketplaceAcquisition: marketplaceAcquisitionLegacyRepo(state),
  acquisitionUsageEvents: acquisitionUsageEventsRepo(state),
});

const servicesUrl = import.meta.resolve('@whisperm/services');
const zodUrl = import.meta.resolve('zod');

const transpileRoute = (routePath, tempDir) => {
  const source = readFileSync(routePath, 'utf8')
    .replace(/from "next\/server"/gu, `from "${join(tempDir, 'next-server.mjs')}"`)
    .replace(/from "@\/lib\/api\/request-body"/gu, `from "${join(tempDir, 'request-body.mjs')}"`)
    .replace(/from "@\/lib\/get-tenant"/gu, `from "${join(tempDir, 'get-tenant.mjs')}"`)
    .replace(/from "@\/lib\/prisma"/gu, `from "${join(tempDir, 'prisma.mjs')}"`)
    .replace(/from "@\/lib\/tenant-features"/gu, `from "${join(tempDir, 'tenant-features.mjs')}"`)
    .replace(/from "@\/lib\/marketplace-acquisition\/acquisition-services"/gu, `from "${join(tempDir, 'acquisition-services.mjs')}"`)
    .replaceAll('from "@whisperm/repositories"', `from "${join(tempDir, 'repositories.mjs')}"`)
    .replaceAll('from "@whisperm/services"', `from "${servicesUrl}"`)
    .replaceAll('from "zod"', `from "${zodUrl}"`);
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const file = join(tempDir, 'records-route.mjs');
  writeFileSync(file, output);
  return import(file);
};

const makeRequest = (body = {}) => ({ headers: new Headers(), async json() { return body; } });

const createHarness = async (state) => {
  const tempDir = join(tmpdir(), `whisperm-requalification-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempDir);
  writeFileSync(join(tempDir, 'next-server.mjs'), 'export class NextResponse extends Response { static json(body, init) { return Response.json(body, init); } }\nexport class NextRequest extends Request {}\n');
  writeFileSync(join(tempDir, 'request-body.mjs'), [
    'export class RequestBodyError extends Error { constructor(message, status = 400, code) { super(message); this.status = status; this.code = code ?? (status === 413 ? "REQUEST_BODY_TOO_LARGE" : "REQUEST_BODY_INVALID"); } }',
    'export const readJsonBody = async (request) => { try { return await request.json(); } catch { throw new RequestBodyError("Request body must be valid JSON.", 400); } };',
  ].join('\n'));
  writeFileSync(join(tempDir, 'get-tenant.mjs'), 'export const getTenantContextForCurrentUser = async () => globalThis.__requalRouteState.tenant === null ? null : { tenant: globalThis.__requalRouteState.tenant, tenantUserId: "tenant-user-1" };\n');
  writeFileSync(join(tempDir, 'tenant-features.mjs'), [
    'export const featureNotEnabledResponse = () => Response.json({ ok: false, error: { message: "Seller Acquisition add-on is not enabled for this workspace." } }, { status: 403 });',
    'export const requireSellerAcquisitionFeatureForApi = async () => (globalThis.__requalRouteState.featureEnabled ? null : featureNotEnabledResponse());',
  ].join('\n'));
  writeFileSync(join(tempDir, 'prisma.mjs'), 'export const prisma = {};\n');
  writeFileSync(join(tempDir, 'repositories.mjs'), [
    'export class PrismaMarketplaceAcquisitionRepository { constructor() { return globalThis.__requalRouteRepos.marketplaceAcquisition; } }',
    'export const createPrismaRepositories = () => globalThis.__requalRouteRepos.createRepositories();',
  ].join('\n'));
  writeFileSync(join(tempDir, 'acquisition-services.mjs'), [
    `import { createPrismaRepositories } from ${JSON.stringify(join(tempDir, 'repositories.mjs'))};`,
    `import { AcquisitionUsageMeteringService, createWhispeRMServices } from ${JSON.stringify(servicesUrl)};`,
    'export const createAcquisitionServiceBundle = () => {',
    '  const repositories = createPrismaRepositories();',
    '  const usageMetering = new AcquisitionUsageMeteringService({ usageEvents: repositories.acquisitionUsageEvents });',
    '  const services = createWhispeRMServices({ ...repositories, usageMetering });',
    '  return { repositories, usageMetering, services };',
    '};',
  ].join('\n'));
  globalThis.__requalRouteState = state;
  globalThis.__requalRouteRepos = {
    marketplaceAcquisition: marketplaceAcquisitionLegacyRepo(state),
    createRepositories: fakeCreatePrismaRepositories(state),
  };
  const base = new URL('../src/app/api/marketplace-acquisition/records/[captureId]/route.ts', import.meta.url).pathname;
  return {
    cleanup: () => { delete globalThis.__requalRouteState; delete globalThis.__requalRouteRepos; rmSync(tempDir, { recursive: true, force: true }); },
    route: await transpileRoute(base, tempDir),
  };
};

test('unauthorized request returns 401', async () => {
  const state = makeState();
  state.tenant = null;
  const harness = await createHarness(state);
  try {
    const response = await harness.route.PATCH(makeRequest({ sellerPhone: '+233555000111' }), { params: { captureId: 'capture-1' } });
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
    const response = await harness.route.PATCH(makeRequest({ sellerPhone: '+233555000111' }), { params: { captureId: 'capture-1' } });
    assert.equal(response.status, 403);
  } finally {
    harness.cleanup();
  }
});

test('adding a phone number to an unqualified capture triggers requalification and creates a Contact/Deal pair', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    const response = await harness.route.PATCH(makeRequest({ sellerPhone: '+233555000111' }), { params: { captureId: 'capture-1' } });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.ok, true);
    assert.equal(body.data.qualificationStatus, 'QUALIFIED');
    assert.equal(body.data.crmConversionStatus, 'CREATED');
    assert.equal(body.data.requalified, true);
    assert.equal(body.data.invitationEligible, true);
    assert.equal(body.data.record.capture.id, 'capture-1');
    // ST1-009: requalification must record billable usage events, same as capture-time conversion.
    assert.equal(state.usageEvents.filter((e) => e.eventType === 'SELLER_QUALIFIED').length, 1);
    assert.equal(state.usageEvents.filter((e) => e.eventType === 'CRM_CONVERSION_CREATED').length, 1);
    assert.equal(state.contacts.length, 1);
    assert.equal(state.deals.length, 1);
    assert.equal(state.captures[0].contactId, state.contacts[0].id);
    assert.equal(state.captures[0].dealId, state.deals[0].id);
    assert.equal(state.captures[0].metadata.sellerPhone, '+233555000111');
  } finally {
    harness.cleanup();
  }
});

test('editing an unrelated field (title) does not trigger requalification', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    const response = await harness.route.PATCH(makeRequest({ title: 'Updated title' }), { params: { captureId: 'capture-1' } });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.data.requalified, false);
    assert.equal(state.contacts.length, 0);
    assert.equal(state.deals.length, 0);
  } finally {
    harness.cleanup();
  }
});

test('a second phone edit after requalification does not create a second Contact or Deal', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    const first = await (await harness.route.PATCH(makeRequest({ sellerPhone: '+233555000111' }), { params: { captureId: 'capture-1' } })).json();
    const second = await (await harness.route.PATCH(makeRequest({ sellerPhone: '+233555000222' }), { params: { captureId: 'capture-1' } })).json();

    assert.equal(state.contacts.length, 1);
    assert.equal(state.deals.length, 1);
    assert.equal(second.data.contactId, first.data.contactId);
    assert.equal(second.data.dealId, first.data.dealId);
    // Already qualified on the second edit, so requalification runs again but is a no-op transition.
    assert.equal(second.data.requalified, false);
    assert.equal(second.data.crmConversionStatus, 'EXISTING');
  } finally {
    harness.cleanup();
  }
});

test('an existing campaign membership is refreshed to QUALIFIED once requalification succeeds', async () => {
  const state = makeState();
  state.members.push({ id: 'member-1', tenantId, campaignId: 'campaign-1', marketplaceCaptureId: 'capture-1', status: 'ADDED', contactId: null, dealId: null, assignedAt: now, createdAt: now, updatedAt: now });
  const harness = await createHarness(state);
  try {
    const response = await harness.route.PATCH(makeRequest({ sellerPhone: '+233555000111' }), { params: { captureId: 'capture-1' } });
    assert.equal(response.status, 200);
    assert.equal(state.members[0].status, 'QUALIFIED');
    assert.equal(state.members[0].contactId, state.contacts[0].id);
    assert.equal(state.members[0].dealId, state.deals[0].id);
  } finally {
    harness.cleanup();
  }
});

test('editing a capture that does not exist returns 404', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    const response = await harness.route.PATCH(makeRequest({ title: 'Anything' }), { params: { captureId: 'does-not-exist' } });
    assert.equal(response.status, 404);
  } finally {
    harness.cleanup();
  }
});

test('an invalid body (no fields) returns 400 rather than a false success', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    const response = await harness.route.PATCH(makeRequest({}), { params: { captureId: 'capture-1' } });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.ok, false);
  } finally {
    harness.cleanup();
  }
});
