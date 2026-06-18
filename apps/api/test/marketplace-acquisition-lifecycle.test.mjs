import assert from 'node:assert/strict';
import test from 'node:test';

import { createApiServer } from '../dist/index.js';

const headers = {
  'x-tenant-id': 'tenant-lifecycle',
  'x-user-id': 'user-lifecycle',
  'x-permissions': 'marketplace_acquisition.capture,marketplace_acquisition.invite,marketplace_acquisition.convert',
  'x-correlation-id': 'corr-lifecycle',
};

const payload = {
  listingUrl: 'https://market.example/listings/sa-14',
  sellerName: 'Sam Seller',
  sellerProfileUrl: 'https://market.example/sellers/sam',
  marketplaceIdentifier: 'seller-sam',
  phone: '+15555550123',
  email: 'sam@example.com',
  location: 'Austin',
  title: '2020 Delivery Van',
  description: 'Clean van ready for route delivery.',
  price: '12000',
  currency: 'USD',
  category: 'Vehicles',
  marketplaceSource: 'market.example',
  marketplaceListingId: 'listing-sa-14',
  images: ['https://market.example/images/van.jpg'],
};

const json = (response) => response.json();

function createLifecycleServer() {
  const state = {
    contacts: [],
    deals: [],
    drafts: [],
    captures: [],
    invitations: [],
    tokens: new Map(),
    attestations: [],
    conversions: [],
    activities: [],
  };

  const server = createApiServer({
    apiKeyAuthenticator: { async authenticate() { return { tenantId: 'tenant-lifecycle' }; } },
    hmacVerifier: { async verify() { return true; } },
    marketplaceAcquisition: {
      async capture(context, input) {
        assert.equal(context.tenantId, 'tenant-lifecycle');
        const contact = { id: 'contact-1', tenantId: context.tenantId, name: input.sellerName, phone: input.phone, email: input.email };
        const deal = { id: 'deal-1', tenantId: context.tenantId, title: input.title, pipelineDefaultKey: 'marketplace_acquisition', stage: 'Captured' };
        const draft = { id: 'draft-1', tenantId: context.tenantId, marketplaceCaptureId: 'capture-1', contactId: contact.id, dealId: deal.id, title: input.title, status: 'DRAFT' };
        const capture = { captureId: 'capture-1', id: 'capture-1', tenantId: context.tenantId, contactId: contact.id, dealId: deal.id, draftInventoryId: draft.id, status: 'CAPTURED' };
        state.contacts.push(contact);
        state.deals.push(deal);
        state.drafts.push(draft);
        state.captures.push(capture);
        state.activities.push({ type: 'MARKETPLACE_CAPTURED', captureId: capture.id });
        return { ...capture, isNew: true };
      },
    },
    marketplaceAcquisitionLifecycle: {
      async createInvitation(context, input) {
        assert.equal(context.tenantId, 'tenant-lifecycle');
        assert.equal(input.captureId, 'capture-1');
        const token = 'claim-token-sa-14';
        const invitation = { id: 'invite-1', tenantId: context.tenantId, marketplaceCaptureId: input.captureId, channel: input.preferredChannel ?? 'SMS', inviteUrl: `https://app.example.com/claim/${token}`, status: 'SENT' };
        state.invitations.push(invitation);
        state.tokens.set(token, { id: 'token-1', tenantId: context.tenantId, marketplaceCaptureId: input.captureId, status: 'SENT' });
        state.captures[0] = { ...state.captures[0], status: 'INVITED' };
        state.deals[0] = { ...state.deals[0], stage: 'Invited' };
        state.activities.push({ type: 'MARKETPLACE_INVITATION_SENT', captureId: input.captureId });
        return invitation;
      },
      async previewClaim(context, token) {
        assert.equal(token, 'claim-token-sa-14');
        const record = state.tokens.get(token);
        assert.equal(record?.tenantId, 'tenant-lifecycle');
        state.tokens.set(token, { ...record, status: 'OPENED' });
        state.captures[0] = { ...state.captures[0], status: 'CLAIM_STARTED' };
        state.deals[0] = { ...state.deals[0], stage: 'Claim Started' };
        state.activities.push({ type: 'MARKETPLACE_CLAIM_STARTED', captureId: record.marketplaceCaptureId });
        return { tokenStatus: 'OPENED', capture: { id: record.marketplaceCaptureId }, currentStage: 'Claim Started' };
      },
      async acceptClaim(context, token, input) {
        assert.equal(input.acceptedTerms, true);
        const record = state.tokens.get(token);
        state.tokens.set(token, { ...record, status: 'CLAIMED' });
        const attestation = { id: 'attestation-1', tenantId: record.tenantId, marketplaceCaptureId: record.marketplaceCaptureId, status: 'ACCEPTED' };
        state.attestations.push(attestation);
        state.captures[0] = { ...state.captures[0], status: 'CLAIMED' };
        state.drafts[0] = { ...state.drafts[0], status: 'CLAIMED' };
        state.deals[0] = { ...state.deals[0], stage: 'Claimed' };
        state.activities.push({ type: 'OWNERSHIP_ATTESTED', captureId: record.marketplaceCaptureId });
        return { status: 'CLAIMED', captureId: record.marketplaceCaptureId, draftInventoryId: 'draft-1', attestationId: attestation.id };
      },
      async convertInventory(context, input) {
        assert.equal(context.tenantId, input.tenantId);
        state.drafts[0] = { ...state.drafts[0], status: 'CONVERTED', renderInventoryId: 'render-inventory-1' };
        const conversion = { id: 'inventory-conversion-1', kind: 'INVENTORY', status: 'SUCCESS', marketplaceCaptureId: input.marketplaceCaptureId };
        state.conversions.push(conversion);
        state.activities.push({ type: 'RENDER_INVENTORY_CONVERSION_SUCCEEDED', captureId: input.marketplaceCaptureId });
        return { captureId: input.marketplaceCaptureId, draftInventoryId: 'draft-1', renderInventoryId: 'render-inventory-1', conversionStatus: 'SUCCESS', conversionId: conversion.id };
      },
      async completeCapture(context, input) {
        assert.equal(state.conversions.some((conversion) => conversion.kind === 'SELLER' && conversion.status === 'SUCCESS'), true);
        assert.equal(state.conversions.some((conversion) => conversion.kind === 'INVENTORY' && conversion.status === 'SUCCESS'), true);
        state.captures[0] = { ...state.captures[0], status: 'CONVERTED' };
        state.deals[0] = { ...state.deals[0], stage: 'Converted' };
        state.activities.push({ type: 'MARKETPLACE_CAPTURE_COMPLETED', captureId: input.marketplaceCaptureId });
        return { captureId: input.marketplaceCaptureId, draftInventoryId: 'draft-1', sellerConversionId: 'seller-conversion-1', inventoryConversionId: 'inventory-conversion-1', status: 'CONVERTED' };
      },
    },
    renderSellerConversion: {
      async convertClaimedSellerToRender(context, input) {
        assert.equal(context.tenantId, input.tenantId);
        assert.equal(state.attestations[0].status, 'ACCEPTED');
        const conversion = { id: 'seller-conversion-1', kind: 'SELLER', status: 'SUCCESS', marketplaceCaptureId: input.marketplaceCaptureId };
        state.conversions.push(conversion);
        state.activities.push({ type: 'RENDER_SELLER_CONVERSION_SUCCEEDED', captureId: input.marketplaceCaptureId });
        return { captureId: input.marketplaceCaptureId, contactId: 'contact-1', attestationId: 'attestation-1', renderSellerId: 'render-seller-1', conversionStatus: 'SUCCESS' };
      },
    },
  });

  return { server, state };
}

test('route-level marketplace acquisition lifecycle captures, invites, claims, attests, converts, and completes', async () => {
  const { server, state } = createLifecycleServer();

  const capture = await server.inject({ method: 'POST', url: '/marketplace-acquisition/captures', headers, payload });
  assert.equal(capture.statusCode, 201);
  assert.equal(json(capture).data.captureId, 'capture-1');
  assert.equal(state.contacts.length, 1);
  assert.equal(state.deals.length, 1);
  assert.equal(state.drafts.length, 1);

  const invite = await server.inject({ method: 'POST', url: '/marketplace-acquisition/captures/capture-1/invite', headers, payload: { preferredChannel: 'SMS' } });
  assert.equal(invite.statusCode, 201);
  const inviteUrl = json(invite).data.inviteUrl;
  assert.match(inviteUrl, /claim-token-sa-14$/u);

  const claim = await server.inject({ method: 'GET', url: '/marketplace-acquisition/claims/claim-token-sa-14', headers: { 'x-correlation-id': 'corr-claim' } });
  assert.equal(claim.statusCode, 200);
  assert.equal(json(claim).data.currentStage, 'Claim Started');
  assert.equal(state.captures[0].status, 'CLAIM_STARTED');

  const attest = await server.inject({ method: 'POST', url: '/marketplace-acquisition/claims/claim-token-sa-14/accept', headers: { 'x-correlation-id': 'corr-attest' }, payload: { acceptedTerms: true, claimantName: 'Sam Seller' } });
  assert.equal(attest.statusCode, 200);
  assert.equal(json(attest).data.attestationId, 'attestation-1');
  assert.equal(state.captures[0].status, 'CLAIMED');

  const seller = await server.inject({ method: 'POST', url: '/marketplace-acquisition/captures/capture-1/convert/render-seller', headers });
  assert.equal(seller.statusCode, 200);
  assert.equal(json(seller).data.renderSellerId, 'render-seller-1');

  const inventory = await server.inject({ method: 'POST', url: '/marketplace-acquisition/captures/capture-1/convert/render-inventory', headers });
  assert.equal(inventory.statusCode, 200);
  assert.equal(json(inventory).data.renderInventoryId, 'render-inventory-1');
  assert.equal(state.drafts[0].status, 'CONVERTED');

  const complete = await server.inject({ method: 'POST', url: '/marketplace-acquisition/captures/capture-1/complete', headers });
  assert.equal(complete.statusCode, 200);
  assert.equal(json(complete).data.status, 'CONVERTED');
  assert.equal(state.captures[0].status, 'CONVERTED');
  assert.equal(state.deals[0].stage, 'Converted');
  assert.equal(state.activities.some((activity) => activity.type === 'MARKETPLACE_CAPTURE_COMPLETED'), true);
});
