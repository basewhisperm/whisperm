import assert from 'node:assert/strict';
import test from 'node:test';
import { MarketplaceDiscoveryService, DiscoveryPromotionError } from '@whisperm/services';
import { PersistenceError } from '@whisperm/types';

const now = '2026-07-01T00:00:00.000Z';

class MemoryDiscoveryRepo {
  sellers = [];
  async findDiscoveredSellerById(ctx, sellerId) {
    return this.sellers.find((seller) => seller.tenantId === ctx.tenantId && seller.id === sellerId) ?? null;
  }
  async updateDiscoveredSellerStatus(ctx, sellerId, status, extra = {}) {
    const index = this.sellers.findIndex((seller) => seller.tenantId === ctx.tenantId && seller.id === sellerId);
    assert.notEqual(index, -1);
    this.sellers[index] = { ...this.sellers[index], status, ...extra, updatedAt: now };
    return this.sellers[index];
  }
}

class MemoryCaptureRepo {
  captures = [];
  nextCapture = 1;
  failNextCreate = false;

  async createMarketplaceCapture(ctx, input) {
    if (this.failNextCreate) {
      this.failNextCreate = false;
      throw new Error('capture backend unavailable');
    }
    const existing = this.captures.find((capture) => capture.tenantId === ctx.tenantId && capture.listingUrl === input.listingUrl);
    if (existing !== undefined) {
      throw new PersistenceError({ code: 'PERSISTENCE_CONFLICT', message: 'Marketplace capture already exists', status: 409 });
    }
    const capture = { id: `capture-${this.nextCapture++}`, status: 'CAPTURED', capturedAt: now, createdAt: now, updatedAt: now, metadata: {}, ...input };
    this.captures.push(capture);
    return capture;
  }

  async findMarketplaceCaptureByListingUrl(ctx, listingUrl) {
    return this.captures.find((capture) => capture.tenantId === ctx.tenantId && capture.listingUrl === listingUrl) ?? null;
  }
}

class MemoryCampaignRepo {
  campaigns = [];
  members = [];
  nextMember = 1;
  failNextAddSeller = false;

  async findById(ctx, id) {
    return this.campaigns.find((campaign) => campaign.tenantId === ctx.tenantId && campaign.id === id) ?? null;
  }

  async addSeller(ctx, input) {
    if (this.failNextAddSeller) {
      this.failNextAddSeller = false;
      throw new Error('campaign assignment backend unavailable');
    }
    const existing = this.members.find((member) => member.tenantId === ctx.tenantId && member.campaignId === input.campaignId && member.marketplaceCaptureId === input.marketplaceCaptureId);
    if (existing !== undefined) {
      throw new PersistenceError({ code: 'PERSISTENCE_CONFLICT', message: 'Seller already belongs to this acquisition campaign', status: 409 });
    }
    const member = { id: `member-${this.nextMember++}`, status: 'ADDED', assignedAt: now, createdAt: now, updatedAt: now, ...input };
    this.members.push(member);
    return member;
  }

  async findMemberByCapture(ctx, campaignId, marketplaceCaptureId) {
    return this.members.find((member) => member.tenantId === ctx.tenantId && member.campaignId === campaignId && member.marketplaceCaptureId === marketplaceCaptureId) ?? null;
  }

  async listMembers(ctx, campaignId) {
    return { items: this.members.filter((member) => member.tenantId === ctx.tenantId && member.campaignId === campaignId) };
  }
}

const baseSeller = (overrides = {}) => ({
  id: 'seller-1',
  tenantId: 'tenant-1',
  discoveryRunId: 'run-1',
  campaignId: 'campaign-1',
  marketplaceSourceId: 'source-1',
  status: 'QUALIFIED',
  qualificationScore: 90,
  sellerName: 'Ama Seller',
  phone: '+233555000000',
  listingUrl: 'https://jiji.com.gh/cars/listing-1',
  title: 'Clean Toyota Corolla',
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const harness = () => {
  const discoveryRepo = new MemoryDiscoveryRepo();
  const marketplaceCaptures = new MemoryCaptureRepo();
  const campaigns = new MemoryCampaignRepo();
  campaigns.campaigns.push({ id: 'campaign-1', tenantId: 'tenant-1', name: 'Test Campaign', status: 'ACTIVE', createdAt: now, updatedAt: now });
  const service = new MarketplaceDiscoveryService({ discoveryRepo, marketplaceCaptures, campaigns });
  return { discoveryRepo, marketplaceCaptures, campaigns, service };
};

const context = { tenantId: 'tenant-1', actorId: 'actor-1' };

test('promoting a discovered seller creates a real MarketplaceCapture', async () => {
  const { discoveryRepo, marketplaceCaptures, service } = harness();
  discoveryRepo.sellers.push(baseSeller());

  const result = await service.promoteSellerToCapture(context, 'campaign-1', 'seller-1');

  assert.equal(marketplaceCaptures.captures.length, 1);
  assert.equal(marketplaceCaptures.captures[0].listingUrl, 'https://jiji.com.gh/cars/listing-1');
  assert.equal(result.marketplaceCaptureId, marketplaceCaptures.captures[0].id);
});

test('promoting a discovered seller creates a SellerAcquisitionCampaignMember', async () => {
  const { discoveryRepo, campaigns, service } = harness();
  discoveryRepo.sellers.push(baseSeller());

  const result = await service.promoteSellerToCapture(context, 'campaign-1', 'seller-1');

  assert.equal(campaigns.members.length, 1);
  assert.equal(campaigns.members[0].campaignId, 'campaign-1');
  assert.equal(campaigns.members[0].marketplaceCaptureId, result.marketplaceCaptureId);
  assert.equal(result.campaignMemberId, campaigns.members[0].id);
});

test('promotedCaptureId on the discovered seller equals the real MarketplaceCapture.id', async () => {
  const { discoveryRepo, marketplaceCaptures, service } = harness();
  discoveryRepo.sellers.push(baseSeller());

  await service.promoteSellerToCapture(context, 'campaign-1', 'seller-1');

  assert.equal(discoveryRepo.sellers[0].status, 'PROMOTED');
  assert.equal(discoveryRepo.sellers[0].promotedCaptureId, marketplaceCaptures.captures[0].id);
});

test('second promotion is idempotent: no duplicate capture or member is created', async () => {
  const { discoveryRepo, marketplaceCaptures, campaigns, service } = harness();
  discoveryRepo.sellers.push(baseSeller());

  const first = await service.promoteSellerToCapture(context, 'campaign-1', 'seller-1');
  const second = await service.promoteSellerToCapture(context, 'campaign-1', 'seller-1');

  assert.equal(marketplaceCaptures.captures.length, 1);
  assert.equal(campaigns.members.length, 1);
  assert.equal(second.alreadyPromoted, true);
  assert.equal(first.alreadyPromoted, false);
  assert.equal(second.marketplaceCaptureId, first.marketplaceCaptureId);
  assert.equal(second.campaignMemberId, first.campaignMemberId);
});

test('tenant mismatch on the discovered seller is denied', async () => {
  const { discoveryRepo, service } = harness();
  discoveryRepo.sellers.push(baseSeller());

  await assert.rejects(
    () => service.promoteSellerToCapture({ tenantId: 'tenant-2', actorId: 'actor-1' }, 'campaign-1', 'seller-1'),
    (error) => error instanceof DiscoveryPromotionError && error.code === 'SELLER_NOT_FOUND',
  );
});

test('campaign mismatch is denied when the seller belongs to a different campaign', async () => {
  const { discoveryRepo, campaigns, service } = harness();
  campaigns.campaigns.push({ id: 'campaign-2', tenantId: 'tenant-1', name: 'Other Campaign', status: 'ACTIVE', createdAt: now, updatedAt: now });
  discoveryRepo.sellers.push(baseSeller({ campaignId: 'campaign-2' }));

  await assert.rejects(
    () => service.promoteSellerToCapture(context, 'campaign-1', 'seller-1'),
    (error) => error instanceof DiscoveryPromotionError && error.code === 'CAMPAIGN_MISMATCH',
  );
});

test('campaign belonging to another tenant is denied', async () => {
  const { discoveryRepo, campaigns, service } = harness();
  campaigns.campaigns.push({ id: 'campaign-cross-tenant', tenantId: 'tenant-2', name: 'Foreign Campaign', status: 'ACTIVE', createdAt: now, updatedAt: now });
  discoveryRepo.sellers.push(baseSeller({ campaignId: 'campaign-cross-tenant' }));

  await assert.rejects(
    () => service.promoteSellerToCapture(context, 'campaign-cross-tenant', 'seller-1'),
    (error) => error instanceof DiscoveryPromotionError && error.code === 'CAMPAIGN_NOT_FOUND',
  );
});

test('promotion does not mark the seller PROMOTED when capture creation fails', async () => {
  const { discoveryRepo, marketplaceCaptures, campaigns, service } = harness();
  discoveryRepo.sellers.push(baseSeller());
  marketplaceCaptures.failNextCreate = true;

  await assert.rejects(() => service.promoteSellerToCapture(context, 'campaign-1', 'seller-1'));

  assert.equal(discoveryRepo.sellers[0].status, 'QUALIFIED');
  assert.equal(discoveryRepo.sellers[0].promotedCaptureId, undefined);
  assert.equal(marketplaceCaptures.captures.length, 0);
  assert.equal(campaigns.members.length, 0);
});

test('promotion does not mark the seller PROMOTED when campaign assignment fails', async () => {
  const { discoveryRepo, campaigns, service } = harness();
  discoveryRepo.sellers.push(baseSeller());
  campaigns.failNextAddSeller = true;

  await assert.rejects(
    () => service.promoteSellerToCapture(context, 'campaign-1', 'seller-1'),
    (error) => error instanceof DiscoveryPromotionError && error.code === 'CAPTURE_ASSIGNMENT_FAILED',
  );

  assert.equal(discoveryRepo.sellers[0].status, 'QUALIFIED');
  assert.equal(discoveryRepo.sellers[0].promotedCaptureId, undefined);
  assert.equal(campaigns.members.length, 0);
});

test('missing listing URL/title returns a useful insufficient-data error', async () => {
  const { discoveryRepo, service } = harness();
  discoveryRepo.sellers.push(baseSeller({ listingUrl: '', title: undefined, sellerName: undefined }));

  await assert.rejects(
    () => service.promoteSellerToCapture(context, 'campaign-1', 'seller-1'),
    (error) => error instanceof DiscoveryPromotionError && error.code === 'INSUFFICIENT_CAPTURE_DATA',
  );
});

test('invalid (non-URL) listing URL returns a useful insufficient-data error', async () => {
  const { discoveryRepo, service } = harness();
  discoveryRepo.sellers.push(baseSeller({ listingUrl: 'not-a-url' }));

  await assert.rejects(
    () => service.promoteSellerToCapture(context, 'campaign-1', 'seller-1'),
    (error) => error instanceof DiscoveryPromotionError && error.code === 'INSUFFICIENT_CAPTURE_DATA',
  );
});

test('promoted seller is discoverable through the normal campaign member query path', async () => {
  const { discoveryRepo, campaigns, service } = harness();
  discoveryRepo.sellers.push(baseSeller());

  const result = await service.promoteSellerToCapture(context, 'campaign-1', 'seller-1');
  const page = await campaigns.listMembers(context, 'campaign-1');

  assert.equal(page.items.some((member) => member.id === result.campaignMemberId), true);
});

test('promotion race that hits a campaign-member conflict still resolves to the existing member', async () => {
  const { discoveryRepo, campaigns, marketplaceCaptures, service } = harness();
  discoveryRepo.sellers.push(baseSeller());

  const originalFindMemberByCapture = campaigns.findMemberByCapture.bind(campaigns);
  let calls = 0;
  campaigns.findMemberByCapture = async (ctx, campaignId, marketplaceCaptureId) => {
    calls += 1;
    if (calls === 1) return null;
    return originalFindMemberByCapture(ctx, campaignId, marketplaceCaptureId);
  };
  campaigns.members.push({ id: 'member-preexisting', tenantId: 'tenant-1', campaignId: 'campaign-1', marketplaceCaptureId: 'capture-1', status: 'ADDED', assignedAt: now, createdAt: now, updatedAt: now });
  marketplaceCaptures.captures.push({ id: 'capture-1', tenantId: 'tenant-1', listingUrl: baseSeller().listingUrl, title: 'Existing capture', status: 'CAPTURED', capturedAt: now, createdAt: now, updatedAt: now, metadata: {} });

  const result = await service.promoteSellerToCapture(context, 'campaign-1', 'seller-1');

  assert.equal(result.campaignMemberId, 'member-preexisting');
  assert.equal(campaigns.members.length, 1);
});
