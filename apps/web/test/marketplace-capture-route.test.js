import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const now = '2026-07-04T00:00:00.000Z';
const tenantId = 'tenant-1';

// ST-005: exercises the real capture route + real @whisperm/services capture-time canonical
// CRM conversion logic end to end, with only @/lib/* and @whisperm/repositories stubbed --
// proves the API contract (contactId/dealId/crmConversionStatus) and that repeated calls
// never duplicate CRM records, instead of asserting on route source text.
const makeState = () => ({ contacts: new Map(), captures: new Map(), deals: new Map(), drafts: new Map(), activities: [], audits: [], usageEvents: [] });

const record = (base) => ({ createdAt: now, updatedAt: now, ...base });

const repositories = (state) => ({
  pipelines: {
    async findByWorkspace() { return null; },
    async findByDefaultKey(workspaceId, defaultKey) {
      if (workspaceId !== tenantId || defaultKey !== 'marketplace_acquisition') return null;
      return record({ id: 'pipeline-1', tenantId: workspaceId, name: 'Marketplace Acquisition', defaultKey, stages: [
        record({ id: 'stage-captured', tenantId: workspaceId, pipelineId: 'pipeline-1', name: 'Captured', position: 1 }),
        record({ id: 'stage-invited', tenantId: workspaceId, pipelineId: 'pipeline-1', name: 'Invited', position: 2 }),
      ] });
    },
  },
  contacts: {
    async findById(scope, id) { return state.contacts.get(id) ?? null; },
    async findByPhone(scope, phone) { return [...state.contacts.values()].find((c) => c.tenantId === scope.tenantId && c.phone === phone) ?? null; },
    async findByEmails(scope, emails) { return [...state.contacts.values()].filter((c) => c.tenantId === scope.tenantId && emails.includes(c.email)); },
    async list(scope) { return { items: [...state.contacts.values()].filter((c) => c.tenantId === scope.tenantId) }; },
    async create(scope, input) { const contact = record({ id: `contact-${state.contacts.size + 1}`, tenantId: input.tenantId, email: input.email ?? null, phone: input.phone ?? null, firstName: input.firstName ?? null, metadata: input.metadata ?? {} }); state.contacts.set(contact.id, contact); return contact; },
  },
  marketplaceCaptures: {
    async findByListingUrl(scope, listingUrl) { return state.captures.get(`${scope.tenantId}:${listingUrl}`) ?? null; },
    async findByExternalId(scope, externalId) { return [...state.captures.values()].find((c) => c.tenantId === scope.tenantId && c.externalId === externalId) ?? null; },
    async findByDealId(scope, dealId) { return [...state.captures.values()].find((c) => c.tenantId === scope.tenantId && c.dealId === dealId) ?? null; },
    async list(scope) { return { items: [...state.captures.values()].filter((c) => c.tenantId === scope.tenantId) }; },
    async create(scope, input) { const capture = record({ id: `capture-${state.captures.size + 1}`, tenantId: input.tenantId, contactId: input.contactId ?? null, dealId: null, externalId: input.externalId ?? null, listingUrl: input.listingUrl, title: input.title, price: input.price ?? null, currency: input.currency ?? null, status: input.status ?? 'CAPTURED', metadata: input.metadata ?? {} }); state.captures.set(`${scope.tenantId}:${input.listingUrl}`, capture); return capture; },
    async update(scope, id, input) { const entry = [...state.captures.entries()].find(([, c]) => c.tenantId === scope.tenantId && c.id === id); const updated = { ...entry[1], ...input, updatedAt: now }; state.captures.set(entry[0], updated); return updated; },
  },
  draftInventories: {
    async create(scope, input) { const draft = record({ id: `draft-${state.drafts.size + 1}`, ...input }); state.drafts.set(`${scope.tenantId}:${input.marketplaceCaptureId}`, draft); return draft; },
    async findByMarketplaceCaptureId(scope, id) { return state.drafts.get(`${scope.tenantId}:${id}`) ?? null; },
    async findByMarketplaceListing() { return null; },
    async upsertForCapture(scope, input) { const existing = state.drafts.get(`${scope.tenantId}:${input.marketplaceCaptureId}`); if (existing) return existing; const draft = record({ id: `draft-${state.drafts.size + 1}`, ...input }); state.drafts.set(`${scope.tenantId}:${input.marketplaceCaptureId}`, draft); return draft; },
    async update(scope, id, input) { const entry = [...state.drafts.entries()].find(([, d]) => d.id === id); const updated = { ...entry[1], ...input, updatedAt: now }; state.drafts.set(entry[0], updated); return updated; },
  },
  deals: {
    async findByExternalId(workspaceId, externalId) { return [...state.deals.values()].find((d) => d.tenantId === workspaceId && d.externalId === externalId) ?? null; },
    async findById(workspaceId, id) { return [...state.deals.values()].find((d) => d.tenantId === workspaceId && d.id === id) ?? null; },
    async create(workspaceId, input) { const deal = record({ id: `deal-${state.deals.size + 1}`, tenantId: workspaceId, pipelineId: 'pipeline-1', ...input }); state.deals.set(deal.id, deal); return deal; },
    async updateStage(workspaceId, dealId, stageId) { const deal = state.deals.get(dealId); const updated = { ...deal, pipelineStageId: stageId, updatedAt: now }; state.deals.set(dealId, updated); return updated; },
  },
  activities: { async create(scope, input) { state.activities.push(input); return record({ id: `activity-${state.activities.length}`, ...input }); } },
  auditLogs: { async append(scope, input) { state.audits.push(input); return record({ id: `audit-${state.audits.length}`, ...input }); } },
  sellerAcquisitionCampaigns: {
    async addSeller(scope, input) {
      const mode = state.campaignAssignmentMode ?? 'SUCCEED';
      if (mode === 'CONFLICT') {
        throw new state.PersistenceError({ code: 'PERSISTENCE_CONFLICT', message: 'Seller already belongs to this acquisition campaign', status: 409 });
      }
      if (mode === 'FAIL') {
        throw new state.PersistenceError({ code: 'PERSISTENCE_NOT_FOUND', message: 'Seller acquisition campaign not found', status: 404 });
      }
      state.campaignMembers = state.campaignMembers ?? [];
      const member = record({ id: `member-${state.campaignMembers.length + 1}`, ...input });
      state.campaignMembers.push(member);
      return member;
    },
  },
});

const usageEventRepository = (state) => ({
  async createIfNotExists(scope, input) {
    const existing = state.usageEvents.find((event) => event.idempotencyKey === input.idempotencyKey);
    if (existing) return existing;
    const event = record({ id: `usage-${state.usageEvents.length + 1}`, ...input });
    state.usageEvents.push(event);
    return event;
  },
});

const sharedModuleReplacements = (tempDir) => (source) => source
  .replace(/from "next\/server"/gu, `from "${join(tempDir, 'next-server.mjs')}"`)
  .replace(/from "@\/lib\/get-tenant"/gu, `from "${join(tempDir, 'get-tenant.mjs')}"`)
  .replace(/from "@\/lib\/prisma"/gu, `from "${join(tempDir, 'prisma.mjs')}"`)
  .replace(/from "@\/lib\/tenant-features"/gu, `from "${join(tempDir, 'tenant-features.mjs')}"`)
  .replace(/from "@\/lib\/api\/request-body"/gu, `from "${join(tempDir, 'request-body.mjs')}"`)
  .replace(/from "@\/lib\/marketplace-acquisition\/acquisition-services"/gu, `from "${join(tempDir, 'acquisition-services.mjs')}"`)
  .replaceAll('from "@whisperm/repositories"', `from "${join(tempDir, 'repositories.mjs')}"`)
  .replaceAll('from "@whisperm/services"', `from "${import.meta.resolve('@whisperm/services')}"`);

const createHarness = async (state) => {
  const tempDir = join(tmpdir(), `whisperm-capture-route-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempDir);
  writeFileSync(join(tempDir, 'next-server.mjs'), 'export class NextResponse extends Response { static json(body, init) { return Response.json(body, init); } }\nexport class NextRequest extends Request {}\n');
  writeFileSync(join(tempDir, 'get-tenant.mjs'), 'export const getTenantContextForCurrentUser = async () => globalThis.__captureRouteState.tenantContext;\n');
  writeFileSync(join(tempDir, 'prisma.mjs'), 'export const prisma = {};\n');
  writeFileSync(join(tempDir, 'tenant-features.mjs'), 'export const requireSellerAcquisitionFeatureForApi = async () => null;\n');
  writeFileSync(join(tempDir, 'request-body.mjs'), 'export class RequestBodyError extends Error { constructor(message, status = 400, code) { super(message); this.status = status; this.code = code; } }\nexport const readJsonBody = async (request) => request.json();\n');
  writeFileSync(join(tempDir, 'repositories.mjs'), [
    'export class PrismaAcquisitionUsageEventRepository { constructor() { return globalThis.__captureRouteUsageEvents; } }',
    'export class PersistenceError extends Error { constructor(input) { super(input.message); this.name = "PersistenceError"; this.code = input.code; this.status = input.status; this.details = input.details; } }',
    'export const createPrismaRepositories = () => globalThis.__captureRouteRepositories;',
    '',
  ].join('\n'));
  writeFileSync(join(tempDir, 'acquisition-services.mjs'), [
    `import { createPrismaRepositories } from ${JSON.stringify(join(tempDir, 'repositories.mjs'))};`,
    `import { AcquisitionUsageMeteringService, createWhispeRMServices } from ${JSON.stringify(import.meta.resolve('@whisperm/services'))};`,
    'export const createAcquisitionUsageMetering = (repositories) => new AcquisitionUsageMeteringService({ usageEvents: repositories.acquisitionUsageEvents });',
    'export const createAcquisitionServiceBundle = () => {',
    '  const repositories = createPrismaRepositories();',
    '  const usageMetering = createAcquisitionUsageMetering(repositories);',
    '  const services = createWhispeRMServices({ ...repositories, usageMetering });',
    '  return { repositories, usageMetering, services };',
    '};',
  ].join('\n'));

  globalThis.__captureRouteState = { tenantContext: { tenant: { id: tenantId }, tenantUserId: 'user-1' }, state };
  globalThis.__captureRouteUsageEvents = usageEventRepository(state);
  globalThis.__captureRouteRepositories = { ...repositories(state), acquisitionUsageEvents: globalThis.__captureRouteUsageEvents };

  // The route's `error instanceof PersistenceError` check must compare against the exact
  // PersistenceError class it imports (the stub below, since @whisperm/repositories is
  // replaced) -- so the fake sellerAcquisitionCampaigns.addSeller throws this same class.
  const repositoriesModule = await import(join(tempDir, 'repositories.mjs'));
  state.PersistenceError = repositoriesModule.PersistenceError;

  const routePath = new URL('../src/app/api/marketplace-acquisition/captures/route.ts', import.meta.url).pathname;
  const source = sharedModuleReplacements(tempDir)(readFileSync(routePath, 'utf8'));
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const file = join(tempDir, 'captures-route.mjs');
  writeFileSync(file, output);
  const route = await import(file);

  return {
    route,
    cleanup: () => { delete globalThis.__captureRouteState; delete globalThis.__captureRouteRepositories; delete globalThis.__captureRouteUsageEvents; rmSync(tempDir, { recursive: true, force: true }); },
  };
};

const makeRequest = (body) => new Request('https://app.test/api/marketplace-acquisition/captures', {
  method: 'POST',
  headers: { 'x-correlation-id': 'corr-capture', 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

test('capture API returns contactId/dealId and crmConversionStatus CREATED for a qualified seller', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    const response = await harness.route.POST(makeRequest({ listingUrl: 'https://market.example/listings/1', title: 'Bike', priceText: 'USD 100', sellerPhone: '+15555550123', sellerName: 'Sam Seller' }));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.ok, true);
    assert.equal(body.data.qualificationStatus, 'QUALIFIED');
    assert.equal(typeof body.data.contactId, 'string');
    assert.equal(typeof body.data.dealId, 'string');
    assert.equal(body.data.crmConversionStatus, 'CREATED');
    assert.equal(state.usageEvents.filter((event) => event.eventType === 'CRM_CONVERSION_CREATED').length, 1);
    assert.equal(state.usageEvents.filter((event) => event.eventType === 'SELLER_QUALIFIED').length, 1);
  } finally {
    harness.cleanup();
  }
});

test('capture API preserves a GHS price in both capture and draft inventory records', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    const response = await harness.route.POST(makeRequest({ listingUrl: 'https://market.example/listings/price', title: 'Priced listing', priceText: 'GHS 1', currency: 'GHS', sellerPhone: '+15555550124', sellerName: 'Priced Seller' }));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    const capture = [...state.captures.values()][0];
    const draft = [...state.drafts.values()][0];
    assert.equal(capture.price, '1');
    assert.equal(capture.currency, 'GHS');
    assert.equal(capture.metadata.originalPriceText, 'GHS 1');
    assert.equal(draft.price, '1');
    assert.equal(draft.currency, 'GHS');
  } finally {
    harness.cleanup();
  }
});

test('capture API returns NOT_ELIGIBLE and no CRM linkage for an unqualified seller (no phone)', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    const response = await harness.route.POST(makeRequest({ listingUrl: 'https://market.example/listings/2', title: 'Bike without phone', priceText: 'USD 100' }));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.data.qualificationStatus, 'UNQUALIFIED');
    assert.equal(body.data.crmConversionStatus, 'NOT_ELIGIBLE');
    assert.equal(body.data.contactId, undefined);
    assert.equal(body.data.dealId, undefined);
    assert.equal(state.usageEvents.length, 0);
  } finally {
    harness.cleanup();
  }
});

test('repeated capture API calls for the same listing do not duplicate Contact/Deal or usage events', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    const payload = { listingUrl: 'https://market.example/listings/3', title: 'Bike', priceText: 'USD 100', sellerPhone: '+15555550199', sellerName: 'Repeat Seller' };
    const first = await (await harness.route.POST(makeRequest(payload))).json();
    const second = await (await harness.route.POST(makeRequest(payload))).json();

    assert.equal(first.data.crmConversionStatus, 'CREATED');
    assert.equal(second.data.crmConversionStatus, 'EXISTING');
    assert.equal(first.data.contactId, second.data.contactId);
    assert.equal(first.data.dealId, second.data.dealId);
    assert.equal(state.contacts.size, 1);
    assert.equal(state.deals.size, 1);
    assert.equal(state.usageEvents.filter((event) => event.eventType === 'CRM_CONVERSION_CREATED').length, 1, 'CRM_CONVERSION_CREATED must fire exactly once across repeated capture calls');
    assert.equal(state.usageEvents.filter((event) => event.eventType === 'SELLER_QUALIFIED').length, 1, 'SELLER_QUALIFIED must fire exactly once across repeated capture calls');
  } finally {
    harness.cleanup();
  }
});

test('ST1-013M: campaign assignment success is reported explicitly and capture still succeeds', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    const response = await harness.route.POST(makeRequest({ campaignId: 'campaign-1', listingUrl: 'https://market.example/listings/4', title: 'Bike', priceText: 'USD 100', sellerPhone: '+15555550111', sellerName: 'Campaign Seller' }));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.ok, true);
    assert.deepEqual(body.campaignAssignment, { status: 'COMPLETED' });
    assert.equal(state.campaignMembers.length, 1);
    assert.equal(state.campaignMembers[0].campaignId, 'campaign-1');
    assert.equal(state.campaignMembers[0].marketplaceCaptureId, body.data.captureId);
  } finally {
    harness.cleanup();
  }
});

test('ST1-013M: campaign assignment failure is visible in the response and durably audited, capture still succeeds', async () => {
  const state = makeState();
  state.campaignAssignmentMode = 'FAIL';
  const harness = await createHarness(state);
  try {
    const response = await harness.route.POST(makeRequest({ campaignId: 'campaign-missing', listingUrl: 'https://market.example/listings/5', title: 'Bike', priceText: 'USD 100', sellerPhone: '+15555550112', sellerName: 'Failed Assignment Seller' }));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.ok, true, 'capture must still be reported successful even when campaign assignment fails');
    assert.equal(typeof body.data.captureId, 'string');
    assert.equal(body.campaignAssignment.status, 'FAILED');
    assert.equal(body.campaignAssignment.error.code, 'PERSISTENCE_NOT_FOUND');
    assert.equal(state.campaignMembers, undefined, 'a failed assignment must never create a campaign seller record');
    const assignmentFailureAudits = state.audits.filter((entry) => entry.action === 'MARKETPLACE_CAPTURE_CAMPAIGN_ASSIGNMENT_FAILED');
    assert.equal(assignmentFailureAudits.length, 1, 'assignment failure must be recorded durably in the audit log, not swallowed');
    assert.equal(assignmentFailureAudits[0].targetId, body.data.captureId);
    assert.equal(assignmentFailureAudits[0].metadata.campaignId, 'campaign-missing');
  } finally {
    harness.cleanup();
  }
});

test('ST1-013M: duplicate campaign assignment is idempotent, not reported as a failure', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    const payload = { campaignId: 'campaign-1', listingUrl: 'https://market.example/listings/6', title: 'Bike', priceText: 'USD 100', sellerPhone: '+15555550113', sellerName: 'Duplicate Assignment Seller' };
    const first = await (await harness.route.POST(makeRequest(payload))).json();
    assert.deepEqual(first.campaignAssignment, { status: 'COMPLETED' });

    // Simulate the underlying unique-constraint conflict a second identical assignment attempt
    // would hit against the same (tenantId, campaignId, marketplaceCaptureId) row.
    state.campaignAssignmentMode = 'CONFLICT';
    const second = await (await harness.route.POST(makeRequest(payload))).json();
    assert.equal(second.ok, true);
    assert.deepEqual(second.campaignAssignment, { status: 'ALREADY_ASSIGNED' });
    assert.equal(state.campaignMembers.length, 1, 'duplicate assignment must not create a second campaign seller record');
    const assignmentFailureAudits = state.audits.filter((entry) => entry.action === 'MARKETPLACE_CAPTURE_CAMPAIGN_ASSIGNMENT_FAILED');
    assert.equal(assignmentFailureAudits.length, 0, 'an idempotent duplicate is not a failure and must not be audited as one');
  } finally {
    harness.cleanup();
  }
});
