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
    phone: '+233555000000',
    listingUrl: 'https://jiji.com.gh/cars/listing-1',
    title: 'Clean Toyota Corolla',
    createdAt: now,
    updatedAt: now,
  }],
  campaigns: [{ id: 'campaign-1', tenantId, name: 'Test Campaign', status: 'ACTIVE', createdAt: now, updatedAt: now }],
  members: [],
  captures: [],
  contacts: [],
  deals: [],
  draftInventories: [],
  activities: [],
  auditLogs: [],
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
      { id: 'stage-claim-started', pipelineId: 'pipeline-1', name: 'Claim Started', position: 3, createdAt: now, updatedAt: now },
      { id: 'stage-claimed', pipelineId: 'pipeline-1', name: 'Claimed', position: 4, createdAt: now, updatedAt: now },
      { id: 'stage-converted', pipelineId: 'pipeline-1', name: 'Converted', position: 5, createdAt: now, updatedAt: now },
    ],
  },
  nextId: 1,
});

// -- discovery-run + seller-acquisition-campaign fakes (unchanged shape from ST-002) -------------

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
    const member = { id: `member-${state.nextId++}`, status: 'ADDED', assignedAt: now, createdAt: now, updatedAt: now, ...input };
    state.members.push(member);
    return member;
  },
  async findMemberByCapture(ctx, campaignId, marketplaceCaptureId) {
    return state.members.find((member) => member.tenantId === ctx.tenantId && member.campaignId === campaignId && member.marketplaceCaptureId === marketplaceCaptureId) ?? null;
  },
});

// -- canonical-capture-pipeline fakes (ST1-006: back the real MarketplaceAcquisitionCaptureService) --

const pipelinesRepo = (state) => ({
  async findByDefaultKey() { return state.pipeline; },
  async findByWorkspace() { return state.pipeline; },
  async updateStages() { return state.pipeline; },
});

const marketplaceCapturesRepo = (state) => ({
  async create(scope, input) {
    const record = { id: `capture-${state.nextId++}`, tenantId: scope.tenantId, status: input.status ?? 'CAPTURED', capturedAt: now, createdAt: now, updatedAt: now, contactId: null, dealId: null, externalId: null, ...input };
    state.captures.push(record);
    return record;
  },
  async findByListingUrl(scope, listingUrl) {
    return state.captures.find((capture) => capture.tenantId === scope.tenantId && capture.listingUrl === listingUrl) ?? null;
  },
  async findByExternalId(scope, externalId) {
    return state.captures.find((capture) => capture.tenantId === scope.tenantId && capture.externalId === externalId) ?? null;
  },
  async findById(scope, id) {
    return state.captures.find((capture) => capture.tenantId === scope.tenantId && capture.id === id) ?? null;
  },
  async findByDealId(scope, dealId) {
    return state.captures.find((capture) => capture.tenantId === scope.tenantId && capture.dealId === dealId) ?? null;
  },
  async findByIds(scope, ids) {
    return state.captures.filter((capture) => capture.tenantId === scope.tenantId && ids.includes(capture.id));
  },
  async list(scope) {
    return { items: state.captures.filter((capture) => capture.tenantId === scope.tenantId) };
  },
  async update(scope, id, input) {
    const index = state.captures.findIndex((capture) => capture.tenantId === scope.tenantId && capture.id === id);
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
  async count(scope) { return state.contacts.filter((contact) => contact.tenantId === scope.tenantId).length; },
  async findById(scope, id) { return state.contacts.find((contact) => contact.tenantId === scope.tenantId && contact.id === id) ?? null; },
  async findByIds(scope, ids) { return state.contacts.filter((contact) => contact.tenantId === scope.tenantId && ids.includes(contact.id)); },
  async findByPhone(scope, phone) { return state.contacts.find((contact) => contact.tenantId === scope.tenantId && contact.phone === phone) ?? null; },
  async findByEmails(scope, emails) { return state.contacts.filter((contact) => contact.tenantId === scope.tenantId && emails.includes(contact.email)); },
  async list(scope) { return { items: state.contacts.filter((contact) => contact.tenantId === scope.tenantId) }; },
  async update(scope, id, input) {
    const index = state.contacts.findIndex((contact) => contact.tenantId === scope.tenantId && contact.id === id);
    state.contacts[index] = { ...state.contacts[index], ...input, updatedAt: now };
    return state.contacts[index];
  },
  async listLeadEvents() { return { items: [] }; },
});

const dealsRepo = (state) => ({
  async create(dealTenantId, input) {
    const record = {
      id: `deal-${state.nextId++}`,
      tenantId: dealTenantId,
      contactId: input.contactId ?? null,
      pipelineId: state.pipeline.id,
      pipelineStageId: input.pipelineStageId,
      ownerId: input.ownerId ?? null,
      externalId: input.externalId ?? null,
      title: input.title,
      value: input.value ?? null,
      currency: input.currency,
      probability: null,
      closedAt: null,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };
    state.deals.push(record);
    return record;
  },
  async list() { return []; },
  async findById(dealTenantId, id) { return state.deals.find((deal) => deal.tenantId === dealTenantId && deal.id === id) ?? null; },
  async findByExternalId(dealTenantId, externalId) { return state.deals.find((deal) => deal.tenantId === dealTenantId && deal.externalId === externalId) ?? null; },
  async findBoardByPipeline() { return null; },
  async updateStageWithOptimisticLock() { throw new Error('not implemented in fake'); },
  async findDetailById() { return null; },
  async findDetailsByIds() { return []; },
  async updateStage(dealTenantId, dealId, stageId) {
    const index = state.deals.findIndex((deal) => deal.tenantId === dealTenantId && deal.id === dealId);
    state.deals[index] = { ...state.deals[index], pipelineStageId: stageId, updatedAt: now };
    return state.deals[index];
  },
  async findByContact() { return []; },
  async update(dealTenantId, dealId, input) {
    const index = state.deals.findIndex((deal) => deal.tenantId === dealTenantId && deal.id === dealId);
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
  async findByMarketplaceCaptureId(scope, id) {
    return state.draftInventories.find((draft) => draft.tenantId === scope.tenantId && draft.marketplaceCaptureId === id) ?? null;
  },
  async listByMarketplaceCaptureIds() { return []; },
  async findByMarketplaceListing() { return null; },
  async upsertForCapture(scope, input) {
    const existing = state.draftInventories.find((draft) => draft.tenantId === scope.tenantId && draft.marketplaceCaptureId === input.marketplaceCaptureId);
    if (existing !== undefined) {
      Object.assign(existing, input, { updatedAt: now });
      return existing;
    }
    const record = { id: `draft-${state.nextId++}`, tenantId: scope.tenantId, createdAt: now, updatedAt: now, ...input };
    state.draftInventories.push(record);
    return record;
  },
  async update(scope, id, input) {
    const index = state.draftInventories.findIndex((draft) => draft.tenantId === scope.tenantId && draft.id === id);
    state.draftInventories[index] = { ...state.draftInventories[index], ...input, updatedAt: now };
    return state.draftInventories[index];
  },
});

const activitiesRepo = (state) => ({
  async create(context, input) {
    const record = { id: `activity-${state.nextId++}`, createdAt: now, updatedAt: now, ...input };
    state.activities.push(record);
    return record;
  },
  async list() { return { items: [] }; },
  async listByDeal() { return { items: [] }; },
  async listActivitiesByMarketplaceCaptureId() { return []; },
  async listActivitiesByMarketplaceCaptureIds() { return []; },
});

const auditLogsRepo = (state) => ({
  async append(scope, input) {
    const record = { id: `audit-${state.nextId++}`, createdAt: now, ...input };
    state.auditLogs.push(record);
    return record;
  },
  async listByTarget() { return { items: [] }; },
});

const fakeCreatePrismaRepositories = (state) => () => ({
  tenants: {},
  users: {},
  contacts: contactsRepo(state),
  pipelines: pipelinesRepo(state),
  deals: dealsRepo(state),
  activities: activitiesRepo(state),
  marketplaceCaptures: marketplaceCapturesRepo(state),
  draftInventories: draftInventoriesRepo(state),
  campaigns: {},
  workflows: {},
  approvals: {},
  executions: {},
  events: {},
  billing: {},
  auditLogs: auditLogsRepo(state),
  marketplaceAcquisition: {},
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
    'export class PrismaSellerAcquisitionCampaignRepository { constructor() { return globalThis.__promoteRouteRepos.campaignRepo; } }',
    'export const createPrismaRepositories = () => globalThis.__promoteRouteRepos.createRepositories();',
  ].join('\n'));
  globalThis.__promoteRouteState = state;
  globalThis.__promoteRouteRepos = {
    discoveryRepo: discoveryRepo(state),
    campaignRepo: campaignRepo(state),
    createRepositories: fakeCreatePrismaRepositories(state),
  };
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

test('successful promote of a seller with a phone number returns canonical Qualified/CRM-converted statuses', async () => {
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
    assert.equal(body.data.qualificationStatus, 'QUALIFIED');
    assert.equal(body.data.crmConversionStatus, 'CREATED');
    assert.equal(body.data.contactId, state.contacts[0].id);
    assert.equal(body.data.dealId, state.deals[0].id);
    assert.equal(state.sellers[0].status, 'PROMOTED');
    assert.equal(state.sellers[0].promotedCaptureId, state.captures[0].id);
  } finally {
    harness.cleanup();
  }
});

test('promoting a seller without a phone number returns Needs Qualification (UNQUALIFIED) and creates no Contact or Deal', async () => {
  const state = makeState();
  delete state.sellers[0].phone;
  const harness = await createHarness(state);
  try {
    const response = await harness.route.POST(makeRequest(), { params: { campaignId: 'campaign-1', sellerId: 'seller-1' } });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.data.qualificationStatus, 'UNQUALIFIED');
    assert.equal(body.data.crmConversionStatus, 'NOT_ELIGIBLE');
    assert.equal(body.data.contactId, undefined);
    assert.equal(body.data.dealId, undefined);
    assert.equal(state.contacts.length, 0);
    assert.equal(state.deals.length, 0);
    assert.equal(state.captures.length, 1);
  } finally {
    harness.cleanup();
  }
});

test('repeated promote returns the same capture/member without duplication and alreadyPromoted=true', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    const first = await (await harness.route.POST(makeRequest(), { params: { campaignId: 'campaign-1', sellerId: 'seller-1' } })).json();
    const second = await (await harness.route.POST(makeRequest(), { params: { campaignId: 'campaign-1', sellerId: 'seller-1' } })).json();

    assert.equal(state.captures.length, 1);
    assert.equal(state.contacts.length, 1);
    assert.equal(state.deals.length, 1);
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
