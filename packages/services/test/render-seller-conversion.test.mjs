import test from 'node:test';
import assert from 'node:assert/strict';
import { RenderSellerConversionService } from '../dist/render-seller-conversion.js';

const now = '2026-06-15T00:00:00.000Z';
const context = { tenantId: 'tenant-1', actorId: 'user-1', correlation: { correlationId: 'corr-1' } };
const capture = (overrides = {}) => ({ id: 'capture-1', tenantId: 'tenant-1', contactId: 'contact-1', dealId: 'deal-1', externalId: 'listing-1', listingUrl: 'https://market.test/listing/1', title: 'Bike', sellerName: 'Sam Seller', sellerProfileUrl: 'https://market.test/seller/sam', status: 'CLAIMED', capturedAt: now, createdAt: now, updatedAt: now, metadata: { sellerPhone: '+15555550123', sellerEmail: 'sam@example.com', sellerLocation: 'Austin', marketplaceSource: 'MARKET_TEST' }, ...overrides });
const draft = (overrides = {}) => ({ id: 'draft-1', tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1', contactId: 'contact-1', dealId: 'deal-1', title: 'Bike', status: 'CLAIMED', createdAt: now, updatedAt: now, ...overrides });
const attestation = (overrides = {}) => ({ id: 'att-1', tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1', contactId: 'contact-1', status: 'ATTESTED', verifiedAt: now, createdAt: now, updatedAt: now, ...overrides });
const contact = (overrides = {}) => ({ id: 'contact-1', tenantId: 'tenant-1', firstName: 'Sam', lastName: 'Seller', email: 'sam@example.com', phone: '+15555550123', stage: 'PROSPECT', createdAt: now, updatedAt: now, ...overrides });

function deps(options = {}) {
  const state = { conversions: [], audits: [], connectorCalls: [] };
  return { state, deps: {
    marketplaceCaptures: { async findById(scope, id) { return options.captureTenantMismatch ? null : (options.capture ?? capture()); } },
    draftInventories: { async findByMarketplaceCaptureId() { return options.draft === undefined ? draft() : options.draft; } },
    marketplaceSellerVerifications: { async findLatestByMarketplaceCaptureId() { return options.attestation === undefined ? attestation() : options.attestation; } },
    contacts: { async findById() { return options.contact === undefined ? contact() : options.contact; } },
    renderConversions: {
      async findSuccessfulSellerConversion() { return options.existing ?? null; },
      async create(scope, input) { const row = { id: 'conv-1', createdAt: now, updatedAt: now, ...input }; state.conversions.push(row); return row; },
      async update(scope, id, input) { const row = { ...state.conversions.at(-1), id, ...input, updatedAt: now }; state.conversions.push(row); return row; },
    },
    auditLogs: { async append(scope, input) { state.audits.push(input); return { id: `audit-${state.audits.length}`, tenantId: scope.tenantId, occurredAt: now, ...input }; } },
    connector: { async createRenderSeller(input) { state.connectorCalls.push(input); if (options.connectorFails) throw new Error('provider down'); return { renderSellerId: 'render-seller-1', status: 'CREATED' }; } },
    clock: () => new Date(now),
  }};
}

async function rejectsWithCode(fn, code) { await assert.rejects(fn, (error) => error?.code === code); }

test('claimed acquisition with attestation converts seller and stores render seller id', async () => {
  const setup = deps();
  const result = await new RenderSellerConversionService(setup.deps).convertClaimedSellerToRender(context, { tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1' });
  assert.equal(result.renderSellerId, 'render-seller-1');
  assert.equal(setup.state.conversions.at(-1).status, 'SUCCESS');
  assert.equal(setup.state.conversions.at(-1).renderSellerId, 'render-seller-1');
});

test('unclaimed acquisition cannot convert', async () => { const setup = deps({ capture: capture({ status: 'INVITED' }) }); await rejectsWithCode(() => new RenderSellerConversionService(setup.deps).convertClaimedSellerToRender(context, { tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1' }), 'SERVICE_INVALID_STATE_TRANSITION'); });
test('claimed acquisition without attestation cannot convert', async () => { const setup = deps({ attestation: null }); await rejectsWithCode(() => new RenderSellerConversionService(setup.deps).convertClaimedSellerToRender(context, { tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1' }), 'SERVICE_NOT_FOUND'); });
test('expired acquisition cannot convert', async () => { const setup = deps({ capture: capture({ status: 'EXPIRED' }) }); await rejectsWithCode(() => new RenderSellerConversionService(setup.deps).convertClaimedSellerToRender(context, { tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1' }), 'SERVICE_INVALID_STATE_TRANSITION'); });
test('converted acquisition does not create duplicate seller', async () => { const setup = deps({ existing: { id: 'conv-old', tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1', contactId: 'contact-1', sellerVerificationId: 'att-1', status: 'SUCCESS', renderSellerId: 'render-existing', conversionKind: 'SELLER', createdAt: now, updatedAt: now } }); const result = await new RenderSellerConversionService(setup.deps).convertClaimedSellerToRender(context, { tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1' }); assert.equal(result.renderSellerId, 'render-existing'); assert.equal(setup.state.connectorCalls.length, 0); });
test('duplicate conversion request returns existing renderSellerId', async () => { const setup = deps({ existing: { id: 'conv-old', tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1', contactId: 'contact-1', sellerVerificationId: 'att-1', status: 'SUCCESS', renderSellerId: 'render-existing', conversionKind: 'SELLER', createdAt: now, updatedAt: now } }); const result = await new RenderSellerConversionService(setup.deps).convertClaimedSellerToRender(context, { tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1' }); assert.equal(result.idempotent, true); });
test('connector failure marks conversion FAILED', async () => { const setup = deps({ connectorFails: true }); await rejectsWithCode(() => new RenderSellerConversionService(setup.deps).convertClaimedSellerToRender(context, { tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1' }), 'SERVICE_REPOSITORY_FAILED'); assert.equal(setup.state.conversions.at(-1).status, 'FAILED'); });
test('tenant isolation preserved', async () => { const setup = deps(); await rejectsWithCode(() => new RenderSellerConversionService(setup.deps).convertClaimedSellerToRender({ ...context, tenantId: 'tenant-2' }, { tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1' }), 'SERVICE_TENANT_MISMATCH'); });
test('TrustLayer is not required', async () => { const setup = deps({ attestation: attestation({ method: 'SELF_ATTESTATION', evidence: {} }) }); const result = await new RenderSellerConversionService(setup.deps).convertClaimedSellerToRender(context, { tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1' }); assert.equal(result.conversionStatus, 'SUCCESS'); });
test('Marketplace is not re-scraped and payload uses captured snapshot', async () => { const setup = deps(); await new RenderSellerConversionService(setup.deps).convertClaimedSellerToRender(context, { tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1' }); assert.equal(setup.state.connectorCalls[0].marketplaceSource, 'MARKET_TEST'); assert.equal(setup.state.connectorCalls[0].phone, '+15555550123'); });
test('seller-only conversion does not move acquisition to Converted', async () => { const setup = deps(); await new RenderSellerConversionService(setup.deps).convertClaimedSellerToRender(context, { tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1' }); assert.equal(setup.state.conversions.at(-1).status, 'SUCCESS'); assert.equal(setup.state.connectorCalls.length, 1); });
