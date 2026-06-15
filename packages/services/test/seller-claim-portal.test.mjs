import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { SellerClaimPortalError, SellerClaimPortalService } from '../dist/index.js';

const now = new Date('2026-01-01T00:00:00.000Z');
const hash = (token) => createHash('sha256').update(token).digest('hex');
const baseContext = { correlation: { correlationId: 'corr-1' } };

function makeService(overrides = {}) {
  const state = {
    token: { id: 'token-1', tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1', tokenHash: hash('raw-token'), status: 'SENT', expiresAt: '2026-01-08T00:00:00.000Z', metadata: {} },
    capture: { id: 'capture-1', tenantId: 'tenant-1', contactId: 'contact-1', dealId: 'deal-1', listingUrl: 'https://market.test/listing/1', title: 'Bike', description: 'Nice bike', price: '100', currency: 'USD', sellerName: 'Sam Seller', status: 'INVITED', capturedAt: now.toISOString(), metadata: { sellerPhone: '+15555550123', sellerEmail: 'sam@example.com', sellerLocation: 'Austin' }, createdAt: now.toISOString(), updatedAt: now.toISOString() },
    draft: { id: 'draft-1', tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1', contactId: 'contact-1', dealId: 'deal-1', title: 'Bike', description: 'Nice bike', price: '100', currency: 'USD', category: 'Bicycles', images: ['https://cdn.test/bike.jpg'], listingUrl: 'https://market.test/listing/1', marketplaceSource: 'market', status: 'DRAFT', createdAt: now.toISOString(), updatedAt: now.toISOString() },
    stages: [], audits: [], attestations: [], ...overrides,
  };
  const service = new SellerClaimPortalService({
    clock: () => now,
    claimTokens: { async findByTokenHash(tokenHash) { return tokenHash === state.token.tokenHash ? state.token : null; }, async update(context, id, input) { assert.equal(context.tenantId, state.token.tenantId); assert.equal(id, state.token.id); state.token = { ...state.token, ...input }; return state.token; } },
    marketplaceCaptures: { async findById(context, id) { assert.equal(context.tenantId, 'tenant-1'); return id === state.capture.id ? state.capture : null; }, async update(context, id, input) { assert.equal(context.tenantId, 'tenant-1'); assert.equal(id, state.capture.id); state.capture = { ...state.capture, ...input }; return state.capture; } },
    draftInventories: { async findByMarketplaceCaptureId(context, id) { assert.equal(context.tenantId, 'tenant-1'); return id === state.capture.id ? state.draft : null; }, async update(context, id, input) { assert.equal(context.tenantId, 'tenant-1'); assert.equal(id, state.draft.id); state.draft = { ...state.draft, ...input }; return state.draft; } },
    ownershipAttestations: {
      async findByMarketplaceCaptureId(context, id) { assert.equal(context.tenantId, 'tenant-1'); return state.attestations.find((row) => row.marketplaceCaptureId === id) ?? null; },
      async create(context, input) { assert.equal(context.tenantId, 'tenant-1'); const row = { id: `att-${state.attestations.length + 1}`, ...input, createdAt: now.toISOString(), updatedAt: now.toISOString() }; state.attestations.push(row); return row; },
    },
    pipelines: { async findByDefaultKey(tenantId, key) { assert.equal(tenantId, 'tenant-1'); assert.equal(key, 'marketplace_acquisition'); return { id: 'pipeline-1', tenantId, name: 'Marketplace Acquisition', defaultKey: key, stages: [{ id: 'stage-started', name: 'Claim Started' }, { id: 'stage-claimed', name: 'Claimed' }] }; } },
    deals: { async updateStage(tenantId, dealId, stageId) { state.stages.push(stageId); return { id: dealId, tenantId, pipelineStageId: stageId, updatedAt: now.toISOString() }; } },
    auditLogs: { async append(context, input) { assert.equal(context.tenantId, input.tenantId); state.audits.push(input); return { id: `audit-${state.audits.length}`, ...input, createdAt: now.toISOString() }; } },
  });
  return { service, state };
}

test('valid token returns preview without raw token and moves Invited to Claim Started', async () => {
  const { service, state } = makeService();
  const preview = await service.preview(baseContext, 'raw-token');
  assert.equal(preview.currentStage, 'Claim Started');
  assert.equal(state.capture.status, 'CLAIM_STARTED');
  assert.equal(preview.seller.phoneMasked, '***-***-0123');
  assert.equal(JSON.stringify(preview).includes('raw-token'), false);
});

test('preview does not move terminal records and expired tokens are rejected safely', async () => {
  for (const status of ['CLAIMED', 'CONVERTED', 'EXPIRED']) {
    const { service, state } = makeService({ capture: { ...makeService().state.capture, status } });
    await service.preview(baseContext, 'raw-token');
    assert.deepEqual(state.stages, []);
  }
  const { service } = makeService({ token: { ...makeService().state.token, expiresAt: '2025-01-01T00:00:00.000Z' } });
  assert.equal((await service.preview(baseContext, 'raw-token')).tokenStatus, 'EXPIRED');
});

test('accept requires terms, claims capture and draft, is idempotent, and blocks converted or expired', async () => {
  const { service, state } = makeService({ capture: { ...makeService().state.capture, status: 'CLAIM_STARTED' } });
  await assert.rejects(() => service.accept(baseContext, 'raw-token', { acceptedTerms: false }));
  const result = await service.accept(baseContext, 'raw-token', { acceptedTerms: true, claimantName: 'Sam' });
  assert.equal(result.status, 'CLAIMED');
  assert.equal(result.attestationId, 'att-1');
  assert.equal(state.capture.status, 'CLAIMED');
  assert.equal(state.draft.status, 'CLAIMED');
  assert.equal(state.attestations.length, 1);
  assert.equal(state.attestations[0].attestationStatement.length > 0, true);
  assert.equal(state.audits.some((audit) => audit.action === 'OWNERSHIP_ATTESTED'), true);
  assert.equal((await service.accept(baseContext, 'raw-token', { acceptedTerms: true })).status, 'CLAIMED');
  await assert.rejects(() => makeService({ capture: { ...state.capture, status: 'CONVERTED' } }).service.accept(baseContext, 'raw-token', { acceptedTerms: true }), SellerClaimPortalError);
  await assert.rejects(() => makeService({ token: { ...state.token, status: 'EXPIRED' } }).service.accept(baseContext, 'raw-token', { acceptedTerms: true }), SellerClaimPortalError);
});
