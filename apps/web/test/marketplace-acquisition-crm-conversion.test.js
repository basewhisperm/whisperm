import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

// ST1-010: apps/web/test/seller-claim-portal.test.js previously only regex-matched the claim
// route/page source text. It could not catch the one contract that matters most for canonical CRM
// conversion (ST-005/ST1-006): claim acceptance must never create a second Contact/Deal pair --
// capture-time conversion is the only canonical creation path, claim acceptance only verifies/
// enriches what already exists. This harness transpiles and invokes the real claim-accept route
// against fake repositories so a regression that starts creating Contacts/Deals on claim -- or
// that fails to report the existing linkage -- actually fails the test.

const tenantId = 'tenant-1';
const now = '2026-07-05T00:00:00.000Z';

const makeState = () => ({
  claimTokens: [{ id: 'token-1', tenantId, marketplaceCaptureId: 'capture-1', tokenHash: null, status: 'SENT', expiresAt: '2099-01-01T00:00:00.000Z', claimedAt: null, metadata: {} }],
  captures: [{ id: 'capture-1', tenantId, listingUrl: 'https://jiji.com.gh/cars/listing-1', title: 'Clean Corolla', status: 'INVITED', contactId: 'contact-1', dealId: 'deal-1', metadata: {}, sellerName: 'Ama Seller' }],
  contacts: [{ id: 'contact-1', tenantId }],
  deals: [{ id: 'deal-1', tenantId, pipelineStageId: 'stage-invited', metadata: {}, updatedAt: now }],
  draftInventories: [{ id: 'draft-1', tenantId, marketplaceCaptureId: 'capture-1', contactId: 'contact-1', status: 'DRAFT' }],
  attestations: [],
  pipeline: { id: 'pipeline-1', defaultKey: 'MARKETPLACE_ACQUISITION', stages: [
    { id: 'stage-captured', name: 'Captured' },
    { id: 'stage-invited', name: 'Invited' },
    { id: 'stage-claim-started', name: 'Claim Started' },
    { id: 'stage-claimed', name: 'Claimed' },
  ] },
  auditLogs: [],
  activities: [],
  nextId: 1,
});

// hashClaimToken (real, from @whisperm/services) is used by the real SellerClaimPortalService to
// hash the raw token before lookup, so the fake repository must be keyed by that same hash --
// stub findByTokenHash by ignoring the hash value entirely and matching on state.claimTokens[0].
const claimTokenRepo = (state) => ({
  async findByTokenHash(tokenHash) {
    const token = state.claimTokens[0];
    return token === undefined ? null : { ...token, tokenHash };
  },
  async update(scope, tokenId, input) {
    const index = state.claimTokens.findIndex((t) => t.id === tokenId);
    state.claimTokens[index] = { ...state.claimTokens[index], ...input };
    return state.claimTokens[index];
  },
});

const marketplaceCapturesRepo = (state) => ({
  async findById(scope, id) { return state.captures.find((c) => c.tenantId === scope.tenantId && c.id === id) ?? null; },
  async update(scope, id, input) {
    const index = state.captures.findIndex((c) => c.tenantId === scope.tenantId && c.id === id);
    state.captures[index] = { ...state.captures[index], ...input };
    return state.captures[index];
  },
});

const draftInventoriesRepo = (state) => ({
  async findByMarketplaceCaptureId(scope, id) { return state.draftInventories.find((d) => d.tenantId === scope.tenantId && d.marketplaceCaptureId === id) ?? null; },
  async update(scope, id, input) {
    const index = state.draftInventories.findIndex((d) => d.tenantId === scope.tenantId && d.id === id);
    state.draftInventories[index] = { ...state.draftInventories[index], ...input };
    return state.draftInventories[index];
  },
});

const ownershipAttestationsRepo = (state) => ({
  async findByMarketplaceCaptureId(scope, id) { return state.attestations.find((a) => a.tenantId === scope.tenantId && a.marketplaceCaptureId === id) ?? null; },
  async create(scope, input) {
    const record = { id: `attestation-${state.nextId++}`, ...input };
    state.attestations.push(record);
    return record;
  },
});

const pipelinesRepo = (state) => ({ async findByDefaultKey() { return state.pipeline; } });

const dealsRepo = (state) => ({
  async findById(dealTenantId, id) { return state.deals.find((d) => d.tenantId === dealTenantId && d.id === id) ?? null; },
  async update(dealTenantId, id, input) {
    const index = state.deals.findIndex((d) => d.tenantId === dealTenantId && d.id === id);
    state.deals[index] = { ...state.deals[index], ...input, updatedAt: now };
    return state.deals[index];
  },
  async updateStage(dealTenantId, id, stageId) {
    const index = state.deals.findIndex((d) => d.tenantId === dealTenantId && d.id === id);
    state.deals[index] = { ...state.deals[index], pipelineStageId: stageId, updatedAt: now };
    return state.deals[index];
  },
  // Fails loudly (rather than silently succeeding) if claim acceptance ever tries to create a
  // second Deal -- claim acceptance must only reuse the Contact/Deal pair from capture time.
  async create() { throw new Error('SellerClaimPortalService must never create a Deal'); },
});

const auditLogsRepo = (state) => ({ async append(scope, input) { state.auditLogs.push(input); return { id: `audit-${state.auditLogs.length}`, ...input }; } });
const activitiesRepo = (state) => ({ async create(context, input) { state.activities.push(input); return { id: `activity-${state.activities.length}`, ...input }; } });

const servicesUrl = import.meta.resolve('@whisperm/services');

const transpileFile = (filePath, tempDir, outName) => {
  const source = readFileSync(filePath, 'utf8')
    .replace(/from "next\/server"/gu, `from "${join(tempDir, 'next-server.mjs')}"`)
    .replace(/from "@\/lib\/claims\/seller-claim-service"/gu, `from "${join(tempDir, 'seller-claim-service.mjs')}"`)
    .replaceAll('from "@whisperm/services"', `from "${servicesUrl}"`);
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const file = join(tempDir, outName);
  writeFileSync(file, output);
  return file;
};

const createHarness = async (state) => {
  const tempDir = join(tmpdir(), `whisperm-crm-conversion-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempDir);
  writeFileSync(join(tempDir, 'next-server.mjs'), 'export class NextResponse extends Response { static json(body, init) { return Response.json(body, init); } }\nexport class NextRequest extends Request {}\n');
  writeFileSync(join(tempDir, 'seller-claim-service.mjs'), [
    `import { SellerClaimPortalService } from ${JSON.stringify(servicesUrl)};`,
    'export const createSellerClaimService = () => new SellerClaimPortalService(globalThis.__crmConversionRepos);',
  ].join('\n'));
  globalThis.__crmConversionRepos = {
    claimTokens: claimTokenRepo(state),
    marketplaceCaptures: marketplaceCapturesRepo(state),
    draftInventories: draftInventoriesRepo(state),
    ownershipAttestations: ownershipAttestationsRepo(state),
    pipelines: pipelinesRepo(state),
    deals: dealsRepo(state),
    auditLogs: auditLogsRepo(state),
    activities: activitiesRepo(state),
  };
  const routeFile = transpileFile(new URL('../src/app/api/marketplace-acquisition/claims/[token]/accept/route.ts', import.meta.url).pathname, tempDir, 'accept-route.mjs');
  return {
    cleanup: () => { delete globalThis.__crmConversionRepos; rmSync(tempDir, { recursive: true, force: true }); },
    route: await import(routeFile),
  };
};

const makeRequest = (body) => ({ headers: new Headers(), async json() { return body; } });

test('claim acceptance for an already-qualified capture reuses the existing Contact/Deal and never creates new ones', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    const response = await harness.route.POST(makeRequest({ acceptedTerms: true }), { params: { token: 'raw-token' } });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.status, 'CLAIMED');
    assert.equal(body.contactId, 'contact-1');
    assert.equal(body.dealId, 'deal-1');
    assert.equal(body.crmConversionStatus, 'UPDATED');
    assert.equal(state.contacts.length, 1);
    assert.equal(state.deals.length, 1);
  } finally {
    harness.cleanup();
  }
});

test('a repeated accept on an already-claimed capture is idempotent and still does not duplicate CRM records', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    await harness.route.POST(makeRequest({ acceptedTerms: true }), { params: { token: 'raw-token' } });
    const second = await harness.route.POST(makeRequest({ acceptedTerms: true }), { params: { token: 'raw-token' } });
    const body = await second.json();
    assert.equal(second.status, 200, JSON.stringify(body));
    assert.equal(body.crmConversionStatus, 'ALREADY_CONVERTED');
    assert.equal(state.contacts.length, 1);
    assert.equal(state.deals.length, 1);
  } finally {
    harness.cleanup();
  }
});

test('a capture with no Contact/Deal (never qualified) reports NOT_ELIGIBLE rather than converting on claim', async () => {
  const state = makeState();
  state.captures[0].contactId = null;
  state.captures[0].dealId = null;
  const harness = await createHarness(state);
  try {
    const response = await harness.route.POST(makeRequest({ acceptedTerms: true }), { params: { token: 'raw-token' } });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.crmConversionStatus, 'NOT_ELIGIBLE');
    assert.equal(body.contactId, undefined);
    assert.equal(body.dealId, undefined);
  } finally {
    harness.cleanup();
  }
});

test('an unknown claim token returns a safe 404, never a false success', async () => {
  const state = makeState();
  state.claimTokens = [];
  const harness = await createHarness(state);
  try {
    const response = await harness.route.POST(makeRequest({ acceptedTerms: true }), { params: { token: 'raw-token' } });
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.notEqual(body.error, undefined);
  } finally {
    harness.cleanup();
  }
});

test('an expired claim token is rejected with 410, not silently accepted', async () => {
  const state = makeState();
  state.claimTokens[0].expiresAt = '2020-01-01T00:00:00.000Z';
  const harness = await createHarness(state);
  try {
    const response = await harness.route.POST(makeRequest({ acceptedTerms: true }), { params: { token: 'raw-token' } });
    assert.equal(response.status, 410);
  } finally {
    harness.cleanup();
  }
});

test('accept requires acceptedTerms:true and rejects a missing/false value with 400', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    const response = await harness.route.POST(makeRequest({}), { params: { token: 'raw-token' } });
    assert.equal(response.status, 400);
  } finally {
    harness.cleanup();
  }
});
