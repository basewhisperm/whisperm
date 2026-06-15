import assert from 'node:assert/strict';
import test from 'node:test';

import { RenderInventoryConversionService } from '../dist/render-inventory-conversion.js';

const now = '2026-06-15T00:00:00.000Z';
const context = { tenantId: 'tenant-1', actorId: 'user-1', correlation: { correlationId: 'corr-1' } };

const capture = (overrides = {}) => ({
  id: 'capture-1',
  tenantId: 'tenant-1',
  contactId: 'contact-1',
  dealId: 'deal-1',
  externalId: 'listing-1',
  listingUrl: 'https://market.test/listing/1',
  title: 'Bike',
  description: 'Captured bike',
  price: '100',
  currency: 'USD',
  sellerName: 'Sam Seller',
  sellerProfileUrl: 'https://market.test/seller/sam',
  status: 'CLAIMED',
  capturedAt: now,
  createdAt: now,
  updatedAt: now,
  metadata: { marketplaceSource: 'MARKET_TEST' },
  ...overrides,
});

const draft = (overrides = {}) => ({
  id: 'draft-1',
  tenantId: 'tenant-1',
  marketplaceCaptureId: 'capture-1',
  contactId: 'contact-1',
  dealId: 'deal-1',
  title: 'Bike',
  description: 'Draft bike',
  price: '100',
  currency: 'USD',
  category: 'Bicycles',
  images: ['https://cdn.test/bike.jpg'],
  listingUrl: 'https://market.test/listing/1',
  marketplaceSource: 'MARKET_TEST',
  marketplaceListingId: 'listing-1',
  status: 'CLAIMED',
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

function deps(options = {}) {
  const state = {
    capture: options.capture ?? capture(),
    draft: options.draft === undefined ? draft() : options.draft,
    conversions: [],
    audits: [],
    inventoryCalls: [],
  };

  const service = new RenderInventoryConversionService({
    marketplaceCaptures: {
      async findById(scope, id) { return scope.tenantId === 'tenant-1' && id === state.capture.id ? state.capture : null; },
      async update(scope, id, input) { assert.equal(scope.tenantId, 'tenant-1'); assert.equal(id, state.capture.id); state.capture = { ...state.capture, ...input, updatedAt: now }; return state.capture; },
    },
    draftInventories: {
      async findByMarketplaceCaptureId(scope, id) { assert.equal(scope.tenantId, 'tenant-1'); return state.draft !== null && id === state.capture.id ? state.draft : null; },
      async update(scope, id, input) { assert.equal(scope.tenantId, 'tenant-1'); assert.equal(id, state.draft.id); state.draft = { ...state.draft, ...input, updatedAt: now }; return state.draft; },
    },
    renderConversions: {
      async findSuccessfulInventoryConversion() { return options.existing ?? null; },
      async create(scope, input) { const row = { id: 'conv-1', createdAt: now, updatedAt: now, ...input }; state.conversions.push(row); return row; },
      async update(scope, id, input) { const row = { ...state.conversions.at(-1), id, ...input, updatedAt: now }; state.conversions.push(row); return row; },
    },
    auditLogs: {
      async append(scope, input) { state.audits.push(input); return { id: `audit-${state.audits.length}`, tenantId: scope.tenantId, occurredAt: now, ...input }; },
    },
    connector: {
      async createRenderInventory(input) {
        state.inventoryCalls.push(input);
        if (options.connectorFails) throw new Error('inventory down');
        return { renderInventoryId: 'render-inventory-1', status: 'CREATED' };
      },
    },
    clock: () => new Date(now),
  });

  return { service, state };
}

async function rejectsWithCode(fn, code) {
  await assert.rejects(fn, (error) => error?.code === code);
}

test('claimed draft inventory converts to Render inventory without completing acquisition', async () => {
  const setup = deps();
  const result = await setup.service.convertClaimedInventoryToRender(context, { tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1' });

  assert.equal(result.renderInventoryId, 'render-inventory-1');
  assert.equal(result.conversionStatus, 'SUCCESS');
  assert.equal(result.acquisitionConverted, false);
  assert.equal(setup.state.capture.status, 'CLAIMED');
  assert.equal(setup.state.draft.status, 'CONVERTED');
  assert.equal(setup.state.conversions.at(-1).status, 'SUCCESS');
  assert.equal(setup.state.conversions.at(-1).externalId, 'draft-1');
  assert.equal(setup.state.conversions.at(-1).metadata.renderInventoryId, 'render-inventory-1');
  assert.equal(setup.state.inventoryCalls[0].title, 'Bike');
  assert.equal(setup.state.inventoryCalls[0].idempotencyKey, 'render-inventory:tenant-1:draft-1');
  assert.equal(setup.state.audits.some((audit) => audit.action === 'RENDER_INVENTORY_CONVERSION_SUCCEEDED'), true);
});

test('unclaimed capture or draft cannot convert inventory', async () => {
  await rejectsWithCode(() => deps({ capture: capture({ status: 'INVITED' }) }).service.convertClaimedInventoryToRender(context, { tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1' }), 'SERVICE_INVALID_STATE_TRANSITION');
  await rejectsWithCode(() => deps({ draft: draft({ status: 'DRAFT' }) }).service.convertClaimedInventoryToRender(context, { tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1' }), 'SERVICE_INVALID_STATE_TRANSITION');
});

test('missing draft cannot convert inventory', async () => {
  await rejectsWithCode(() => deps({ draft: null }).service.convertClaimedInventoryToRender(context, { tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1' }), 'SERVICE_NOT_FOUND');
});

test('duplicate inventory conversion returns existing render inventory id without provider call', async () => {
  const setup = deps({ existing: { id: 'conv-old', tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1', externalId: 'render-existing', status: 'SUCCESS', conversionKind: 'INVENTORY', createdAt: now, updatedAt: now } });
  const result = await setup.service.convertClaimedInventoryToRender(context, { tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1' });

  assert.equal(result.renderInventoryId, 'render-existing');
  assert.equal(result.idempotent, true);
  assert.equal(setup.state.inventoryCalls.length, 0);
});

test('connector failure marks inventory conversion failed', async () => {
  const setup = deps({ connectorFails: true });
  await rejectsWithCode(() => setup.service.convertClaimedInventoryToRender(context, { tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1' }), 'SERVICE_REPOSITORY_FAILED');
  assert.equal(setup.state.conversions.at(-1).status, 'FAILED');
});

test('tenant isolation preserved', async () => {
  const setup = deps();
  await rejectsWithCode(() => setup.service.convertClaimedInventoryToRender({ ...context, tenantId: 'tenant-2' }, { tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1' }), 'SERVICE_TENANT_MISMATCH');
});
