import assert from 'node:assert/strict';
import test from 'node:test';
import { CrmConversionRuntimeError, CrmConversionRuntimeService } from '../dist/index.js';

const now = new Date('2026-01-01T00:00:00.000Z');
const context = { tenantId: 'tenant-1', correlation: { correlationId: 'corr-crm' } };

function makeCapture(overrides = {}) {
  return { id: 'capture-1', tenantId: 'tenant-1', contactId: null, dealId: null, listingUrl: 'https://market.test/1', title: 'Bike', description: 'Nice bike', price: '100', currency: 'USD', sellerName: 'Sam Seller', status: 'CLAIMED', capturedAt: now.toISOString(), metadata: { sellerPhone: '+15555550123', sellerEmail: 'sam@example.com' }, createdAt: now.toISOString(), updatedAt: now.toISOString(), ...overrides };
}

function makeService(overrides = {}) {
  const state = {
    capture: makeCapture(),
    draft: { id: 'draft-1', tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1', contactId: null, dealId: null, title: 'Bike', description: 'Nice bike', price: '100', currency: 'USD', category: 'Bikes', images: [], listingUrl: 'https://market.test/1', marketplaceSource: 'market', status: 'CLAIMED', createdAt: now.toISOString(), updatedAt: now.toISOString() },
    contacts: [], deals: [], opportunities: [], audits: [], activities: [], jobs: [], ...overrides,
  };
  const service = new CrmConversionRuntimeService({
    clock: () => now,
    marketplaceCaptures: { async findById(ctx, id) { assert.equal(ctx.tenantId, 'tenant-1'); return id === state.capture.id ? state.capture : null; }, async update(ctx, id, input) { assert.equal(ctx.tenantId, 'tenant-1'); assert.equal(id, state.capture.id); state.capture = { ...state.capture, ...input, metadata: { ...(state.capture.metadata ?? {}), ...(input.metadata ?? {}) } }; return state.capture; } },
    draftInventories: { async findByMarketplaceCaptureId(ctx, id) { assert.equal(ctx.tenantId, 'tenant-1'); return id === state.capture.id ? state.draft : null; } },
    claimTokens: { async listClaimTokensByMarketplaceCaptureId() { return []; } },
    contacts: {
      async findByPhone(ctx, phone) { assert.equal(ctx.tenantId, 'tenant-1'); return state.contacts.find((contact) => contact.phone === phone) ?? null; },
      async findByEmails(ctx, emails) { assert.equal(ctx.tenantId, 'tenant-1'); return state.contacts.filter((contact) => emails.includes(contact.email)); },
      async create(ctx, input) { assert.equal(ctx.tenantId, input.tenantId); const contact = { id: `contact-${state.contacts.length + 1}`, ...input, createdAt: now.toISOString(), updatedAt: now.toISOString() }; state.contacts.push(contact); return contact; },
    },
    pipelines: { async findByDefaultKey(tenantId, key) { assert.equal(tenantId, 'tenant-1'); assert.equal(key, 'marketplace_acquisition'); return { id: 'pipeline-1', tenantId, name: 'Marketplace Acquisition', isDefault: true, defaultKey: key, stages: [{ id: 'stage-claimed', tenantId, pipelineId: 'pipeline-1', name: 'Claimed', position: 1, createdAt: now.toISOString(), updatedAt: now.toISOString() }] }; }, async findByWorkspace() { return null; } },
    deals: { async findByExternalId(tenantId, externalId) { assert.equal(tenantId, 'tenant-1'); return state.deals.find((deal) => deal.externalId === externalId) ?? null; }, async create(tenantId, input) { assert.equal(tenantId, input.tenantId); const deal = { id: `deal-${state.deals.length + 1}`, pipelineId: 'pipeline-1', ...input, createdAt: now.toISOString(), updatedAt: now.toISOString() }; state.deals.push(deal); return deal; } },
    businessGrowthOpportunities: {
      async createOrUpdateFromMarketplaceCapture(ctx, input) { assert.equal(ctx.tenantId, input.tenantId); const existing = state.opportunities.find((opportunity) => opportunity.marketplaceCaptureId === input.marketplaceCaptureId); if (existing) return Object.assign(existing, input, { updatedAt: now.toISOString() }); const opportunity = { id: `opp-${state.opportunities.length + 1}`, ...input, status: input.status ?? 'CLAIMED', createdAt: now.toISOString(), updatedAt: now.toISOString() }; state.opportunities.push(opportunity); return opportunity; },
      async linkContact(ctx, id, contactId) { const opportunity = state.opportunities.find((item) => item.id === id); opportunity.contactId = contactId; return opportunity; },
      async linkDeal(ctx, id, dealId) { const opportunity = state.opportunities.find((item) => item.id === id); opportunity.dealId = dealId; return opportunity; },
      async updateConversionStatus(ctx, id, status) { const opportunity = state.opportunities.find((item) => item.id === id); opportunity.status = status; return opportunity; },
    },
    auditLogs: { async append(ctx, input) { assert.equal(ctx.tenantId, input.tenantId); state.audits.push(input); return { id: `audit-${state.audits.length}`, ...input, createdAt: now.toISOString() }; } },
    activities: { async create(ctx, input) { state.activities.push(input); return { id: `activity-${state.activities.length}`, ...input, createdAt: now.toISOString(), updatedAt: now.toISOString() }; } },
    scheduler: { async schedule(job) { state.jobs.push(job); } },
    revenueAttribution: state.revenueAttribution,
  });
  return { service, state };
}

test('completed claim enqueues CRM conversion job while incomplete claim does not', async () => {
  const ready = makeService();
  const result = await ready.service.enqueueForCompletedClaim(context, { tenantId: 'tenant-1', claimTokenId: 'token-1', marketplaceCaptureId: 'capture-1' });
  assert.equal(result.status, 'CONVERSION_READY');
  assert.equal(ready.state.jobs[0].jobType, 'marketplace.crm.conversion.execute');

  const incomplete = makeService({ capture: makeCapture({ status: 'INVITED' }) });
  const skipped = await incomplete.service.enqueueForCompletedClaim(context, { tenantId: 'tenant-1', claimTokenId: 'token-1', marketplaceCaptureId: 'capture-1' });
  assert.equal(skipped.status, 'NOT_READY');
  assert.equal(incomplete.state.jobs.length, 0);
});

test('worker runtime conversion creates contact and deal through existing owners and marks opportunity converted idempotently', async () => {
  const { service, state } = makeService();
  const result = await service.executeConversion(context, { tenantId: 'tenant-1', claimTokenId: 'token-1', marketplaceCaptureId: 'capture-1' });
  assert.equal(result.status, 'CONVERTED');
  assert.equal(state.contacts.length, 1);
  assert.equal(state.deals.length, 1);
  assert.equal(state.opportunities[0].status, 'CONVERTED');
  assert.equal(state.capture.status, 'CONVERTED');
  const retry = await service.executeConversion(context, { tenantId: 'tenant-1', claimTokenId: 'token-1', marketplaceCaptureId: 'capture-1' });
  assert.equal(retry.idempotent, true);
  assert.equal(state.contacts.length, 1);
  assert.equal(state.deals.length, 1);
});

test('CRM conversion completion triggers configured revenue attribution evaluation for the linked deal', async () => {
  const evaluations = [];
  const { service } = makeService({
    revenueAttribution: { async evaluateForDeal(evalContext, input) { evaluations.push({ evalContext, input }); return { status: 'NOT_ELIGIBLE', dealId: input.dealId, idempotent: true }; } },
  });
  const result = await service.executeConversion(context, { tenantId: 'tenant-1', claimTokenId: 'token-1', marketplaceCaptureId: 'capture-1' });
  assert.equal(result.status, 'CONVERTED');
  assert.equal(evaluations.length, 1);
  assert.equal(evaluations[0].input.dealId, result.dealId);
  assert.equal(evaluations[0].input.tenantId, 'tenant-1');
});

test('tenant isolation violations and insufficient contact data are observable terminal failures', async () => {
  const { service } = makeService();
  await assert.rejects(() => service.executeConversion({ ...context, tenantId: 'other' }, { tenantId: 'tenant-1', claimTokenId: 'token-1', marketplaceCaptureId: 'capture-1' }), CrmConversionRuntimeError);
  const noContact = makeService({ capture: makeCapture({ metadata: {} }) });
  const result = await noContact.service.executeConversion(context, { tenantId: 'tenant-1', claimTokenId: 'token-1', marketplaceCaptureId: 'capture-1' });
  assert.equal(result.status, 'NEEDS_MANUAL_REVIEW');
  assert.equal(result.failureCode, 'CONTACT_DATA_INSUFFICIENT');
});
