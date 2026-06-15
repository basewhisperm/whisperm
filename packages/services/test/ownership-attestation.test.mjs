import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { OWNERSHIP_ATTESTATION_STATEMENT } from '@whisperm/types';
import { OwnershipAttestationService, ServiceError } from '../dist/index.js';

const hash = (token) => createHash('sha256').update(token, 'utf8').digest('hex');
const context = { tenantId: 'tenant-1', correlation: { correlationId: 'corr-1', requestId: 'req-1' } };
const base = () => {
  const state = {
    token: { id: 'token-1', tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1', tokenHash: hash('raw-token'), status: 'SENT', expiresAt: new Date(Date.now()+86400000).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    capture: { id: 'capture-1', tenantId: 'tenant-1', contactId: 'contact-1', listingUrl: 'https://example.test/listing', title: 'Listing', status: 'INVITED', capturedAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    draft: { id: 'draft-1', tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1', contactId: 'contact-1', title: 'Listing', status: 'CLAIM_PENDING', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    attestations: [], audits: []
  };
  const deps = {
    marketplaceClaimTokens: { async findByTokenHash(scope, tokenHash) { return scope.tenantId === state.token.tenantId && tokenHash === state.token.tokenHash ? state.token : null; }, async update(scope, id, input) { assert.equal(scope.tenantId, 'tenant-1'); assert.equal(id, state.token.id); state.token = { ...state.token, ...input, updatedAt: new Date().toISOString() }; return state.token; } },
    marketplaceCaptures: { async findById(scope, id) { return scope.tenantId === state.capture.tenantId && id === state.capture.id ? state.capture : null; }, async update(scope, id, input) { assert.equal(scope.tenantId, 'tenant-1'); assert.equal(id, state.capture.id); state.capture = { ...state.capture, ...input, updatedAt: new Date().toISOString() }; return state.capture; } },
    draftInventories: { async findByMarketplaceCaptureId(scope, id) { return scope.tenantId === state.draft.tenantId && id === state.draft.marketplaceCaptureId ? state.draft : null; }, async update(scope, id, input) { assert.equal(scope.tenantId, 'tenant-1'); assert.equal(id, state.draft.id); state.draft = { ...state.draft, ...input, updatedAt: new Date().toISOString() }; return state.draft; } },
    ownershipAttestations: { async findByMarketplaceCaptureId(scope, id) { return state.attestations.find((a) => a.tenantId === scope.tenantId && a.marketplaceCaptureId === id) ?? null; }, async create(scope, input) { assert.equal(scope.tenantId, input.tenantId); const row = { id: `att-${state.attestations.length+1}`, createdAt: input.attestedAt, ...input }; state.attestations.push(row); return row; } },
    auditLogs: { async append(scope, input) { state.audits.push({ ...input, tenantId: scope.tenantId, id: `audit-${state.audits.length+1}`, occurredAt: new Date().toISOString() }); return state.audits.at(-1); } },
    transactions: { async run(_ctx, work) { return work(deps); } }
  };
  return { state, service: new OwnershipAttestationService(deps) };
};
const valid = { tenantId: 'tenant-1', token: 'raw-token', claimantName: 'A Seller', acceptedTerms: true, claimantPhone: '+15555550100', claimantEmail: 'seller@example.test', marketplaceIdentity: 'seller-handle' };

test('claim accept creates immutable ownership attestation and response', async () => {
  const { state, service } = base();
  const result = await service.acceptClaim(context, valid);
  assert.equal(result.status, 'CLAIMED');
  assert.equal(result.attestationId, 'att-1');
  assert.equal(result.token, undefined);
  assert.equal(state.attestations.length, 1);
  assert.equal(state.attestations[0].attestationStatement, OWNERSHIP_ATTESTATION_STATEMENT);
  assert.equal(state.attestations[0].tenantId, 'tenant-1');
  assert.equal(state.attestations[0].marketplaceCaptureId, 'capture-1');
  assert.equal(state.attestations[0].draftInventoryId, 'draft-1');
  assert.equal(state.attestations[0].claimTokenId, 'token-1');
  assert.equal(state.capture.status, 'CLAIMED');
  assert.equal(state.draft.status, 'CLAIMED');
  assert.equal(state.audits[0].action, 'OWNERSHIP_ATTESTED');
  assert.equal(JSON.stringify(result).includes('raw-token'), false);
});

test('claim accept validates claimant name and accepted terms', async () => {
  const { service } = base();
  await assert.rejects(service.acceptClaim(context, { ...valid, claimantName: '' }), ServiceError);
  await assert.rejects(service.acceptClaim(context, { ...valid, acceptedTerms: false }), ServiceError);
});

test('duplicate, expired, converted, and cross-tenant claims do not create attestation', async () => {
  const a = base();
  await a.service.acceptClaim(context, valid);
  await assert.rejects(a.service.acceptClaim(context, valid), /Claim has already been accepted|Ownership attestation already exists/);
  assert.equal(a.state.attestations.length, 1);

  const expired = base(); expired.state.token.expiresAt = new Date(Date.now()-1000).toISOString();
  await assert.rejects(expired.service.acceptClaim(context, valid), /expired/);
  assert.equal(expired.state.attestations.length, 0);

  const converted = base(); converted.state.capture.status = 'CONVERTED';
  await assert.rejects(converted.service.acceptClaim(context, valid), /current state/);
  assert.equal(converted.state.attestations.length, 0);

  const isolated = base();
  await assert.rejects(isolated.service.acceptClaim({ ...context, tenantId: 'tenant-2' }, { ...valid, tenantId: 'tenant-2' }), /not found/i);
  assert.equal(isolated.state.attestations.length, 0);
});
