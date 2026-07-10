import assert from 'node:assert/strict';
import test from 'node:test';
import { SellerAcquisitionRecordService } from '@whisperm/services';

const now = '2026-06-15T00:00:00.000Z';
const tenantId = 'tenant-1';
const otherTenantId = 'tenant-2';
const ctx = { tenantId };

const capture = (overrides = {}) => ({ id: 'capture-1', tenantId, contactId: 'contact-1', dealId: null, externalId: 'listing-1', listingUrl: 'https://market.test/1', title: 'Bike', description: 'Fast', price: '100', currency: 'USD', sellerName: 'Sam', sellerProfileUrl: null, status: 'CAPTURED', capturedAt: now, createdAt: now, updatedAt: now, metadata: {}, ...overrides });
const contact = (overrides = {}) => ({ id: 'contact-1', tenantId, email: 'sam@example.com', phone: '+2348012345678', firstName: 'Sam', lastName: 'Seller', stage: 'PROSPECT', createdAt: now, updatedAt: now, ...overrides });
const draft = (overrides = {}) => ({ id: 'draft-1', tenantId, marketplaceCaptureId: 'capture-1', contactId: 'contact-1', dealId: null, title: 'Bike', description: 'Fast', price: '100', currency: 'USD', category: 'Bikes', images: ['https://cdn.test/draft.jpg'], listingUrl: 'https://market.test/1', marketplaceSource: 'MARKET', marketplaceListingId: 'listing-1', status: 'DRAFT', createdAt: now, updatedAt: now, ...overrides });
const invitation = (overrides = {}) => ({ id: 'invite-1', tenantId, marketplaceCaptureId: 'capture-1', channel: 'WHATSAPP', status: 'SENT', inviteUrl: 'https://claim.test/t', recipient: '+2348012345678', expiresAt: '2026-07-01T00:00:00.000Z', metadata: {}, createdAt: now, updatedAt: now, ...overrides });
const token = (overrides = {}) => ({ id: 'token-1', tenantId, marketplaceCaptureId: 'capture-1', tokenHash: 'hash', status: 'SENT', sentAt: now, expiresAt: '2026-07-01T00:00:00.000Z', metadata: {}, createdAt: now, updatedAt: now, ...overrides });
const attestation = () => ({ id: 'att-1', tenantId, marketplaceCaptureId: 'capture-1', draftInventoryId: 'draft-1', contactId: 'contact-1', claimantName: 'Sam', claimantPhone: '+2348012345678', claimantEmail: null, marketplaceIdentity: null, attestationStatement: 'I own this', acceptedTerms: true, attestedAt: now, evidence: {}, metadata: {}, createdAt: now, updatedAt: now });
const conversion = (kind, overrides = {}) => ({ id: `conv-${kind}`, tenantId, marketplaceCaptureId: 'capture-1', contactId: 'contact-1', dealId: null, externalId: kind === 'INVENTORY' ? 'draft-1' : 'listing-1', renderSellerId: kind === 'SELLER' ? 'seller-1' : null, conversionKind: kind, status: 'SUCCESS', attemptCount: 1, maxAttempts: 3, completedAt: now, convertedAt: now, metadata: {}, createdAt: now, updatedAt: now, ...overrides });

const service = (state) => new SellerAcquisitionRecordService({
  marketplaceCaptures: {
    async findById(scope, id) { assert.equal(scope.tenantId, tenantId); return id === state.capture.id ? state.capture : null; },
    async list(scope, page) { assert.equal(scope.tenantId, tenantId); assert.equal(page.limit, 100); return { items: [state.capture, ...(state.otherCaptures ?? [])] }; },
  },
  contacts: { async findById(scope, id) { assert.equal(scope.tenantId, tenantId); return id === state.contact?.id ? state.contact : null; } },
  deals: { async findDetailById(workspaceId, dealId) { assert.equal(workspaceId, tenantId); return state.deal?.deal.id === dealId ? state.deal : null; } },
  draftInventories: { async findByMarketplaceCaptureId(scope, id) { assert.equal(scope.tenantId, tenantId); return state.draft?.marketplaceCaptureId === id ? state.draft : null; } },
  sellerInvitations: { async listSellerInvitationsByMarketplaceCaptureId(scope, id) { assert.equal(scope.tenantId, tenantId); return (state.invitations ?? []).filter((row) => row.marketplaceCaptureId === id); } },
  marketplaceClaimTokens: { async listClaimTokensByMarketplaceCaptureId(scope, id) { assert.equal(scope.tenantId, tenantId); return (state.tokens ?? []).filter((row) => row.marketplaceCaptureId === id); } },
  ownershipAttestations: { async findByMarketplaceCaptureId(scope, id) { assert.equal(scope.tenantId, tenantId); return state.attestation?.marketplaceCaptureId === id ? state.attestation : null; } },
  renderConversions: {
    async findSuccessfulSellerConversion(scope, id) { assert.equal(scope.tenantId, tenantId); return (state.conversions ?? []).find((row) => row.marketplaceCaptureId === id && row.conversionKind === 'SELLER' && row.status === 'SUCCESS') ?? null; },
    async findSuccessfulInventoryConversion(scope, id, draftInventoryId) { assert.equal(scope.tenantId, tenantId); return (state.conversions ?? []).find((row) => row.marketplaceCaptureId === id && row.conversionKind === 'INVENTORY' && row.status === 'SUCCESS' && row.externalId === draftInventoryId) ?? null; },
  },
});

const record = (state) => service(state).findByCaptureId(ctx, 'capture-1');

test('missing phone blocks seller acquisition qualification', async () => {
  const result = await record({ capture: capture({ metadata: {} }), contact: contact({ phone: null }), draft: draft() });
  assert.equal(result.isQualifiedSellerLead, false);
  assert.deepEqual(result.missingRequirements.includes('PHONE_REQUIRED'), true);
  assert.equal(result.healthStatus, 'BLOCKED');
  assert.equal(result.nextAction, 'REVEAL_PHONE');
});

test('phone plus draft and no invitation is ready to send invitation', async () => {
  const result = await record({ capture: capture(), contact: contact(), draft: draft() });
  assert.equal(result.healthStatus, 'READY');
  assert.equal(result.nextAction, 'SEND_INVITATION');
});

test('failed latest invitation requires retry', async () => {
  const result = await record({ capture: capture(), contact: contact(), draft: draft(), invitations: [invitation({ status: 'FAILED' })] });
  assert.equal(result.healthStatus, 'ACTION_REQUIRED');
  assert.equal(result.nextAction, 'RETRY_INVITATION');
});

test('claimed lead without seller conversion converts seller next', async () => {
  const result = await record({ capture: capture({ status: 'CLAIMED' }), contact: contact(), draft: draft(), invitations: [invitation()], tokens: [token()], attestation: attestation() });
  assert.equal(result.nextAction, 'CONVERT_SELLER');
});

test('seller converted but inventory not converted converts inventory next', async () => {
  const result = await record({ capture: capture({ status: 'CLAIMED' }), contact: contact(), draft: draft(), invitations: [invitation()], attestation: attestation(), conversions: [conversion('SELLER')] });
  assert.equal(result.nextAction, 'CONVERT_INVENTORY');
});

test('seller and inventory converted but capture not completed completes acquisition next', async () => {
  const result = await record({ capture: capture({ status: 'CLAIMED' }), contact: contact(), draft: draft(), invitations: [invitation()], attestation: attestation(), conversions: [conversion('SELLER'), conversion('INVENTORY')] });
  assert.equal(result.nextAction, 'COMPLETE_ACQUISITION');
});

test('fully completed and converted is completed with no next action', async () => {
  const result = await record({ capture: capture({ status: 'CONVERTED' }), contact: contact(), draft: draft(), invitations: [invitation()], attestation: attestation(), conversions: [conversion('SELLER'), conversion('INVENTORY')] });
  assert.equal(result.healthStatus, 'COMPLETED');
  assert.equal(result.nextAction, 'NONE');
});

test('expired capture returns expired with no next action', async () => {
  const result = await record({ capture: capture({ status: 'EXPIRED' }), contact: contact(), draft: draft(), invitations: [invitation()] });
  assert.equal(result.healthStatus, 'EXPIRED');
  assert.equal(result.nextAction, 'NONE');
});

test('draft inventory images are preferred over capture metadata images', async () => {
  const result = await record({ capture: capture({ metadata: { images: ['https://cdn.test/capture.jpg'] } }), contact: contact(), draft: draft({ images: ['https://cdn.test/draft.jpg'] }) });
  assert.deepEqual(result.images, ['https://cdn.test/draft.jpg']);
});

test('tenant isolation is preserved for list and detail repository calls', async () => {
  const result = await service({ capture: capture(), contact: contact(), draft: draft(), otherCaptures: [capture({ id: 'other-capture', tenantId: otherTenantId })] }).list(ctx);
  assert.equal(result[0].capture.tenantId, tenantId);
});

// ST1-013N: the tests above rely on fakes that assert scope.tenantId === 'tenant-1' -- a bug
// that read the wrong tenant's data would be caught by the assertion firing, but the fakes
// can't prove the *service* itself is safe if handed a real, unmodified multi-tenant
// repository. This test uses a repository fake that actually filters by whichever tenantId is
// passed (matching PrismaMarketplaceAcquisitionRepository's `{ tenantId: context.tenantId, id }`
// where-clause behavior), so it proves tenant A genuinely cannot read tenant B's capture record
// through this service, not merely that the fake was called with the tenantId it expected.
test('tenant A cannot read tenant B capture through findByCaptureId, and vice versa', async () => {
  const captureA = capture({ id: 'shared-capture-id', tenantId: 'tenant-a', title: 'Tenant A listing' });
  const captureB = capture({ id: 'shared-capture-id', tenantId: 'tenant-b', title: 'Tenant B listing' });
  const contactA = contact({ id: 'contact-a', tenantId: 'tenant-a' });
  const contactB = contact({ id: 'contact-b', tenantId: 'tenant-b' });
  const captures = [captureA, captureB];

  const multiTenantService = new SellerAcquisitionRecordService({
    marketplaceCaptures: {
      async findById(scope, id) { return captures.find((row) => row.tenantId === scope.tenantId && row.id === id) ?? null; },
      async list(scope, page) { return { items: captures.filter((row) => row.tenantId === scope.tenantId) }; },
    },
    contacts: { async findById(scope, id) { return [contactA, contactB].find((row) => row.tenantId === scope.tenantId && row.id === id) ?? null; } },
    deals: { async findDetailById() { return null; } },
    draftInventories: { async findByMarketplaceCaptureId() { return null; } },
    sellerInvitations: { async listSellerInvitationsByMarketplaceCaptureId() { return []; } },
    marketplaceClaimTokens: { async listClaimTokensByMarketplaceCaptureId() { return []; } },
    ownershipAttestations: { async findByMarketplaceCaptureId() { return null; } },
    renderConversions: {
      async findSuccessfulSellerConversion() { return null; },
      async findSuccessfulInventoryConversion() { return null; },
    },
  });

  const asTenantA = await multiTenantService.findByCaptureId({ tenantId: 'tenant-a' }, 'shared-capture-id');
  const asTenantB = await multiTenantService.findByCaptureId({ tenantId: 'tenant-b' }, 'shared-capture-id');
  assert.equal(asTenantA.capture.title, 'Tenant A listing');
  assert.equal(asTenantB.capture.title, 'Tenant B listing');
  assert.notEqual(asTenantA.capture.title, asTenantB.capture.title);

  const listAsTenantA = await multiTenantService.list({ tenantId: 'tenant-a' });
  assert.deepEqual(listAsTenantA.map((r) => r.capture.tenantId), ['tenant-a']);
  const listAsTenantB = await multiTenantService.list({ tenantId: 'tenant-b' });
  assert.deepEqual(listAsTenantB.map((r) => r.capture.tenantId), ['tenant-b']);

  // A completely unknown tenant (never seeded any data) must see nothing at all.
  const asUnknownTenant = await multiTenantService.findByCaptureId({ tenantId: 'tenant-c' }, 'shared-capture-id');
  assert.equal(asUnknownTenant, null);
});


test('inventory conversion lookup uses draft inventory id instead of capture external id', async () => {
  const result = await record({
    capture: capture({ status: 'CLAIMED', externalId: 'listing-1' }),
    contact: contact(),
    draft: draft({ id: 'draft-1' }),
    invitations: [invitation()],
    attestation: attestation(),
    conversions: [conversion('SELLER'), conversion('INVENTORY', { externalId: 'draft-1' })],
  });
  assert.notEqual(result.nextAction, 'CONVERT_INVENTORY');
  assert.equal(result.nextAction, 'COMPLETE_ACQUISITION');
});


test('groups captures with normalized seller profile URL when phone is missing', async () => {
  const first = capture({ id: 'capture-1', contactId: null, sellerProfileUrl: 'https://market.test/sellers/SAM?ref=one', metadata: {} });
  const second = capture({ id: 'capture-2', contactId: null, sellerProfileUrl: 'https://market.test/sellers/sam?ref=two', listingUrl: 'https://market.test/2', externalId: 'listing-2', metadata: {} });
  const result = await service({ capture: first, contact: null, draft: draft({ contactId: null }), otherCaptures: [second] }).list(ctx);
  assert.equal(result.length, 1);
  assert.equal(result[0].portfolio.listingCount, 2);
  assert.deepEqual(new Set(result[0].portfolio.captureIds), new Set(['capture-1', 'capture-2']));
});

test('does not collapse anonymous no-phone captures into one seller', async () => {
  const first = capture({ id: 'capture-1', contactId: null, sellerName: null, marketplaceSourceId: null, metadata: {} });
  const second = capture({ id: 'capture-2', contactId: null, sellerName: null, marketplaceSourceId: null, listingUrl: 'https://market.test/2', externalId: 'listing-2', metadata: {} });
  const result = await service({ capture: first, contact: null, draft: draft({ contactId: null }), otherCaptures: [second] }).list(ctx);
  assert.equal(result.length, 2);
});

test('relationship memory spans duplicate seller captures across marketplaces and invitations', async () => {
  const first = capture({ id: 'capture-1', marketplaceSourceId: 'facebook', metadata: { sellerPhone: '+2348012345678', campaignId: 'campaign-a', qualificationStatus: 'DISQUALIFIED' }, capturedAt: '2026-06-15T00:00:00.000Z', createdAt: '2026-06-15T00:00:00.000Z' });
  const second = capture({ id: 'capture-2', contactId: 'contact-1', marketplaceSourceId: 'craigslist', listingUrl: 'https://market.test/2', externalId: 'listing-2', metadata: { sellerPhone: '+2348012345678', campaignId: 'campaign-b', qualificationStatus: 'QUALIFIED' }, capturedAt: '2026-06-16T00:00:00.000Z', createdAt: '2026-06-16T00:00:00.000Z' });
  const result = await service({
    capture: first,
    contact: contact(),
    draft: draft(),
    otherCaptures: [second],
    invitations: [
      invitation({ id: 'invite-1', marketplaceCaptureId: 'capture-1', createdAt: '2026-06-17T00:00:00.000Z' }),
      invitation({ id: 'invite-2', marketplaceCaptureId: 'capture-2', status: 'FAILED', createdAt: '2026-06-18T00:00:00.000Z' }),
    ],
    tokens: [token({ marketplaceCaptureId: 'capture-2', status: 'CLAIMED', createdAt: '2026-06-19T00:00:00.000Z' })],
    attestation: attestation(),
    conversions: [conversion('SELLER', { marketplaceCaptureId: 'capture-2', convertedAt: '2026-06-20T00:00:00.000Z' })],
  }).list(ctx);

  assert.equal(result.length, 1);
  const memory = result[0].relationshipMemory;
  assert.ok(memory);
  assert.deepEqual(new Set(memory.captureIds), new Set(['capture-1', 'capture-2']));
  assert.deepEqual(new Set(memory.marketplacesSeen), new Set(['MARKET', 'craigslist']));
  assert.deepEqual(new Set(memory.campaignIds), new Set(['campaign-a', 'campaign-b']));
  assert.equal(memory.hasPriorInvitation, true);
  assert.equal(memory.hasClaimed, true);
  assert.equal(memory.wasPreviouslyDisqualified, true);
  assert.equal(memory.hasConverted, true);
  assert.ok(memory.timeline.find((event) => event.label.includes('invitation sent')));
  assert.ok(memory.timeline.find((event) => event.label === 'Seller claimed'));
  assert.ok(memory.timeline.find((event) => event.label === 'Seller converted'));
});

test('relationship memory surfaces revenue attribution event and summary from the linked deal', async () => {
  const revenueAttribution = {
    attributionStatus: 'ATTRIBUTED',
    attributedAt: '2026-06-21T00:00:00.000Z',
    revenueAmount: '500',
    revenueCurrency: 'USD',
    campaignId: 'campaign-a',
    marketplaceSource: 'MARKET',
    attributionCompleteness: 'COMPLETE',
    missingLinks: [],
  };
  const deal = { deal: { id: 'deal-1', tenantId, title: 'Bike deal', value: '500', currency: 'USD', closedAt: '2026-06-21T00:00:00.000Z', metadata: { revenueAttribution }, createdAt: now, updatedAt: now }, contact: null, owner: null, activity: [] };
  const result = await record({ capture: capture({ dealId: 'deal-1', status: 'CONVERTED' }), contact: contact(), draft: draft(), attestation: attestation(), conversions: [conversion('SELLER'), conversion('INVENTORY')], deal });

  assert.equal(result.deal.deal.id, 'deal-1');
  assert.equal(result.relationshipMemory.hasRevenueAttributed, true);
  assert.equal(result.relationshipMemory.attributedRevenueAmount, '500');
  assert.equal(result.relationshipMemory.attributedRevenueCurrency, 'USD');
  assert.equal(result.relationshipMemory.attributionCompleteness, 'COMPLETE');
  const revenueEvent = result.relationshipMemory.timeline.find((event) => event.kind === 'REVENUE');
  assert.ok(revenueEvent);
  assert.equal(revenueEvent.metadata.revenueAmount, '500');
  assert.equal(revenueEvent.metadata.completeness, 'COMPLETE');
});

test('runtime relationship context exposes prior invitation and qualification state', async () => {
  const result = await record({ capture: capture({ metadata: { qualificationStatus: 'DISQUALIFIED' } }), contact: contact(), draft: draft(), invitations: [invitation()] });
  assert.equal(result.relationshipMemory.hasPriorInvitation, true);
  assert.equal(result.relationshipMemory.wasPreviouslyDisqualified, true);
});
