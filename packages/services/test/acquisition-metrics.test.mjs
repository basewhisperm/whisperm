import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AcquisitionMetricsService,
  calculateAcquisitionMetrics,
  isEligibleForInvitation,
  resolveQueueState,
} from '@whisperm/services';

// A minimal QueueStateInput-shaped fixture. Every field defaults to the
// "phone ready, draft present, no invitation yet" happy path so each test
// only needs to override what it's actually exercising.
const seller = (overrides = {}) => ({
  capture: { metadata: {} },
  contact: { phone: '+2348012345678' },
  draftInventory: { id: 'draft-1' },
  latestInvitation: null,
  ownershipAttestation: null,
  healthStatus: 'READY',
  nextAction: 'SEND_INVITATION',
  missingRequirements: [],
  ...overrides,
});

test('seller missing phone resolves to REVIEW', () => {
  const result = resolveQueueState(seller({
    contact: { phone: null },
    healthStatus: 'BLOCKED',
    nextAction: 'REVEAL_PHONE',
    missingRequirements: ['PHONE_REQUIRED'],
  }));
  assert.equal(result.state, 'REVIEW');
});

test('seller with a malformed phone resolves to REVIEW even though a phone value is present', () => {
  const result = resolveQueueState(seller({ contact: { phone: '123' } }));
  assert.equal(result.state, 'REVIEW');
});

test('seller with a valid phone but no draft inventory yet resolves to PHONE_READY', () => {
  const result = resolveQueueState(seller({
    draftInventory: null,
    healthStatus: 'BLOCKED',
    nextAction: 'NONE',
  }));
  assert.equal(result.state, 'PHONE_READY');
});

test('seller with phone and draft, no invitation sent, resolves to INVITATION_READY', () => {
  const result = resolveQueueState(seller({ nextAction: 'SEND_INVITATION' }));
  assert.equal(result.state, 'INVITATION_READY');
});

test('seller invited then failed keeps resolving to INVITATION_READY so it stays eligible for a bulk retry', () => {
  const result = resolveQueueState(seller({
    latestInvitation: { status: 'FAILED' },
    healthStatus: 'ACTION_REQUIRED',
    nextAction: 'RETRY_INVITATION',
  }));
  assert.equal(result.state, 'INVITATION_READY');
  assert.equal(isEligibleForInvitation(seller({ latestInvitation: { status: 'FAILED' }, healthStatus: 'ACTION_REQUIRED', nextAction: 'RETRY_INVITATION' })), true);
});

test('seller with an invitation still queued (PENDING) resolves to INVITATION_PENDING', () => {
  const result = resolveQueueState(seller({
    latestInvitation: { status: 'PENDING' },
    healthStatus: 'BLOCKED',
    nextAction: 'NONE',
  }));
  assert.equal(result.state, 'INVITATION_PENDING');
});

test('seller invited (delivered) and not yet claimed resolves to WAITING_CLAIM', () => {
  const result = resolveQueueState(seller({
    latestInvitation: { status: 'SENT' },
    healthStatus: 'READY',
    nextAction: 'WAIT_FOR_CLAIM',
  }));
  assert.equal(result.state, 'WAITING_CLAIM');
});

test('seller claimed and awaiting CRM conversion resolves to CLAIMED', () => {
  const result = resolveQueueState(seller({
    latestInvitation: { status: 'SENT' },
    ownershipAttestation: { id: 'att-1' },
    healthStatus: 'READY',
    nextAction: 'CONVERT_SELLER',
  }));
  assert.equal(result.state, 'CLAIMED');
});

test('seller converted as CRM contact and awaiting inventory conversion resolves to READY_CONVERSION', () => {
  const result = resolveQueueState(seller({
    latestInvitation: { status: 'SENT' },
    ownershipAttestation: { id: 'att-1' },
    healthStatus: 'READY',
    nextAction: 'CONVERT_INVENTORY',
  }));
  assert.equal(result.state, 'READY_CONVERSION');
});

test('seller with both conversions done resolves to CONVERTED whether or not the acquisition has been marked complete', () => {
  const readyToComplete = resolveQueueState(seller({
    latestInvitation: { status: 'SENT' },
    ownershipAttestation: { id: 'att-1' },
    healthStatus: 'READY',
    nextAction: 'COMPLETE_ACQUISITION',
  }));
  assert.equal(readyToComplete.state, 'CONVERTED');

  const completed = resolveQueueState(seller({
    latestInvitation: { status: 'SENT' },
    ownershipAttestation: { id: 'att-1' },
    healthStatus: 'COMPLETED',
    nextAction: 'NONE',
  }));
  assert.equal(completed.state, 'CONVERTED');
});

test('expired capture is BLOCKED and exposes a reason', () => {
  const result = resolveQueueState(seller({ healthStatus: 'EXPIRED', nextAction: 'NONE' }));
  assert.equal(result.state, 'BLOCKED');
  assert.equal(typeof result.blockedReason, 'string');
  assert.ok(result.blockedReason.length > 0);
});

test('an unclassifiable decide() fallback state is BLOCKED and exposes a reason', () => {
  const result = resolveQueueState(seller({ healthStatus: 'BLOCKED', nextAction: 'NONE' }));
  assert.equal(result.state, 'BLOCKED');
  assert.equal(typeof result.blockedReason, 'string');
  assert.ok(result.blockedReason.length > 0);
});

test('isEligibleForInvitation is false for every state except INVITATION_READY', () => {
  assert.equal(isEligibleForInvitation(seller({ contact: { phone: null }, missingRequirements: ['PHONE_REQUIRED'] })), false);
  assert.equal(isEligibleForInvitation(seller({ latestInvitation: { status: 'SENT' }, nextAction: 'WAIT_FOR_CLAIM' })), false);
  assert.equal(isEligibleForInvitation(seller({ nextAction: 'SEND_INVITATION' })), true);
});

test('calculateAcquisitionMetrics aggregates every seller exactly once across all buckets', () => {
  const sellers = [
    seller({ contact: { phone: null }, healthStatus: 'BLOCKED', nextAction: 'REVEAL_PHONE', missingRequirements: ['PHONE_REQUIRED'] }), // REVIEW
    seller({ draftInventory: null, healthStatus: 'BLOCKED', nextAction: 'NONE' }), // PHONE_READY
    seller({ nextAction: 'SEND_INVITATION' }), // INVITATION_READY
    seller({ latestInvitation: { status: 'FAILED' }, healthStatus: 'ACTION_REQUIRED', nextAction: 'RETRY_INVITATION' }), // INVITATION_READY
    seller({ latestInvitation: { status: 'PENDING' }, healthStatus: 'BLOCKED', nextAction: 'NONE' }), // INVITATION_PENDING
    seller({ latestInvitation: { status: 'SENT' }, healthStatus: 'READY', nextAction: 'WAIT_FOR_CLAIM' }), // WAITING_CLAIM
    seller({ latestInvitation: { status: 'SENT' }, ownershipAttestation: { id: 'a' }, healthStatus: 'READY', nextAction: 'CONVERT_SELLER' }), // CLAIMED
    seller({ latestInvitation: { status: 'SENT' }, ownershipAttestation: { id: 'a' }, healthStatus: 'READY', nextAction: 'CONVERT_INVENTORY' }), // READY_CONVERSION
    seller({ latestInvitation: { status: 'SENT' }, ownershipAttestation: { id: 'a' }, healthStatus: 'COMPLETED', nextAction: 'NONE' }), // CONVERTED
    seller({ healthStatus: 'EXPIRED', nextAction: 'NONE' }), // BLOCKED
  ];

  const metrics = calculateAcquisitionMetrics(sellers, 43);

  assert.equal(metrics.totalCaptured, 10);
  assert.equal(metrics.totalCampaignMembers, 43);
  assert.equal(metrics.needsReview, 1);
  assert.equal(metrics.phoneReady, 1);
  assert.equal(metrics.invitationReady, 2);
  assert.equal(metrics.invitationPending, 1);
  assert.equal(metrics.waitingClaim, 1);
  assert.equal(metrics.claimed, 1);
  assert.equal(metrics.readyConversion, 1);
  assert.equal(metrics.converted, 1);
  assert.equal(metrics.blocked, 1);

  const sumOfBuckets = metrics.needsReview + metrics.phoneReady + metrics.invitationReady
    + metrics.invitationPending + metrics.waitingClaim + metrics.claimed
    + metrics.readyConversion + metrics.converted + metrics.blocked;
  assert.equal(sumOfBuckets, metrics.totalCaptured, 'every seller must land in exactly one bucket');
});

test('blocked sellers are excluded from every other bucket', () => {
  const sellers = [
    seller({ healthStatus: 'EXPIRED', nextAction: 'NONE' }),
    seller({ healthStatus: 'BLOCKED', nextAction: 'NONE' }),
  ];
  const metrics = calculateAcquisitionMetrics(sellers);
  assert.equal(metrics.blocked, 2);
  assert.equal(metrics.needsReview, 0);
  assert.equal(metrics.phoneReady, 0);
  assert.equal(metrics.invitationReady, 0);
  assert.equal(metrics.invitationPending, 0);
  assert.equal(metrics.waitingClaim, 0);
  assert.equal(metrics.claimed, 0);
  assert.equal(metrics.readyConversion, 0);
  assert.equal(metrics.converted, 0);
});

// ---------------------------------------------------------------------------
// AcquisitionMetricsService -- the async, repository-backed public surface.
// ---------------------------------------------------------------------------

class MemorySellerAcquisitionRecords {
  constructor(records) { this.records = records; }
  async list(_context, page) {
    return paginate(this.records, page);
  }
  async listByCampaignId(_context, campaignId, page) {
    return paginate(this.records.filter((record) => record.campaignId === campaignId), page);
  }
}

function paginate(records, page) {
  const limit = page?.limit ?? 100;
  const start = page?.cursor === undefined ? 0 : Number(page.cursor);
  const slice = records.slice(start, start + limit);
  const nextCursor = start + limit < records.length ? String(start + limit) : undefined;
  return { records: slice, nextCursor };
}

class MemorySellerAcquisitionCampaigns {
  constructor(campaigns, memberCounts) { this.campaigns = campaigns; this.memberCounts = memberCounts; }
  async countMembers(_context, campaignId) { return this.memberCounts[campaignId] ?? 0; }
  async findById(_context, campaignId) { return this.campaigns.find((campaign) => campaign.id === campaignId) ?? null; }
}

test('getGlobalMetrics paginates across every page of records before aggregating', async () => {
  const records = Array.from({ length: 5 }, (_, index) => seller({ capture: { metadata: { index } } }));
  const service = new AcquisitionMetricsService({
    sellerAcquisitionRecords: new MemorySellerAcquisitionRecords(records),
  });
  const metrics = await service.getGlobalMetrics({ tenantId: 'tenant-1' });
  assert.equal(metrics.totalCaptured, 5);
  assert.equal(metrics.invitationReady, 5);
});

test('getCampaignMetrics scopes to campaign membership and carries the campaign name and member count', async () => {
  const records = [
    { ...seller(), campaignId: 'campaign-1' },
    { ...seller({ healthStatus: 'EXPIRED', nextAction: 'NONE' }), campaignId: 'campaign-1' },
    { ...seller(), campaignId: 'campaign-2' },
  ];
  const service = new AcquisitionMetricsService({
    sellerAcquisitionRecords: new MemorySellerAcquisitionRecords(records),
    sellerAcquisitionCampaigns: new MemorySellerAcquisitionCampaigns(
      [{ id: 'campaign-1', name: 'Lagos Sellers' }],
      { 'campaign-1': 43 },
    ),
  });

  const metrics = await service.getCampaignMetrics({ tenantId: 'tenant-1' }, 'campaign-1');
  assert.equal(metrics.campaignId, 'campaign-1');
  assert.equal(metrics.campaignName, 'Lagos Sellers');
  assert.equal(metrics.totalCaptured, 2);
  assert.equal(metrics.totalCampaignMembers, 43);
  assert.equal(metrics.invitationReady, 1);
  assert.equal(metrics.blocked, 1);
});

test('getEligibleInvitationCount matches the invitationReady bucket', async () => {
  const records = [seller(), seller({ latestInvitation: { status: 'SENT' }, healthStatus: 'READY', nextAction: 'WAIT_FOR_CLAIM' })];
  const service = new AcquisitionMetricsService({ sellerAcquisitionRecords: new MemorySellerAcquisitionRecords(records) });
  const count = await service.getEligibleInvitationCount({ tenantId: 'tenant-1' });
  assert.equal(count, 1);
});

test('getQueueSummary without a campaignId returns the same shape as getGlobalMetrics', async () => {
  const records = [seller()];
  const service = new AcquisitionMetricsService({ sellerAcquisitionRecords: new MemorySellerAcquisitionRecords(records) });
  const summary = await service.getQueueSummary({ tenantId: 'tenant-1' });
  const globalMetrics = await service.getGlobalMetrics({ tenantId: 'tenant-1' });
  assert.deepEqual(summary, globalMetrics);
});
