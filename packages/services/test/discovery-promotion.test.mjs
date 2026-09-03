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
  async listDiscoveredSellersByCampaign(ctx, campaignId, status) {
    return this.sellers.filter((seller) => seller.tenantId === ctx.tenantId && seller.campaignId === campaignId && (status === undefined || seller.status === status));
  }
}

/**
 * Stands in for `MarketplaceAcquisitionCaptureService.capture` (packages/services/src/index.ts),
 * the canonical acquisition pipeline: it is idempotent by listingUrl (capture), phone (contact),
 * and contact id (deal), and only creates a Contact/Deal pair when a phone number is present --
 * mirroring the ST1-004 qualification boundary and the ST1-005 canonical CRM conversion.
 */
class FakeCanonicalCapture {
  captures = [];
  contacts = [];
  deals = [];
  calls = [];
  nextId = 1;
  failNextCapture = false;

  async capture(context, input) {
    this.calls.push({ context, input });
    if (this.failNextCapture) {
      this.failNextCapture = false;
      throw new Error('capture backend unavailable');
    }

    let capture = this.captures.find((item) => item.tenantId === context.tenantId && item.listingUrl === input.listingUrl);
    const captureCreated = capture === undefined;
    if (capture === undefined) {
      capture = { id: `capture-${this.nextId++}`, tenantId: context.tenantId, listingUrl: input.listingUrl, title: input.title, contactId: undefined, dealId: undefined };
      this.captures.push(capture);
    }

    const phone = input.sellerPhone ?? input.phone;
    if (phone === undefined || phone === null) {
      return {
        captureId: capture.id,
        contactCreated: false,
        dealCreated: false,
        qualificationStatus: 'UNQUALIFIED',
        crmConversionStatus: 'NOT_ELIGIBLE',
      };
    }

    let contact = this.contacts.find((item) => item.tenantId === context.tenantId && item.phone === phone);
    const contactCreated = contact === undefined;
    if (contact === undefined) {
      contact = { id: `contact-${this.nextId++}`, tenantId: context.tenantId, phone };
      this.contacts.push(contact);
    }

    let deal = this.deals.find((item) => item.tenantId === context.tenantId && item.contactId === contact.id);
    const dealCreated = deal === undefined;
    if (deal === undefined) {
      deal = { id: `deal-${this.nextId++}`, tenantId: context.tenantId, contactId: contact.id };
      this.deals.push(deal);
    }

    if (captureCreated || capture.contactId !== contact.id) {
      capture.contactId = contact.id;
      capture.dealId = deal.id;
    }

    return {
      captureId: capture.id,
      contactId: contact.id,
      dealId: deal.id,
      contactCreated,
      dealCreated,
      qualificationStatus: 'QUALIFIED',
      crmConversionStatus: contactCreated || dealCreated ? 'CREATED' : 'EXISTING',
    };
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
  const canonicalCapture = new FakeCanonicalCapture();
  const campaigns = new MemoryCampaignRepo();
  campaigns.campaigns.push({ id: 'campaign-1', tenantId: 'tenant-1', name: 'Test Campaign', status: 'ACTIVE', createdAt: now, updatedAt: now });
  const service = new MarketplaceDiscoveryService({ discoveryRepo, canonicalCapture, campaigns });
  return { discoveryRepo, canonicalCapture, campaigns, service };
};

const context = { tenantId: 'tenant-1', actorId: 'actor-1' };

test('promoting a discovered seller creates a real MarketplaceCapture', async () => {
  const { discoveryRepo, canonicalCapture, service } = harness();
  discoveryRepo.sellers.push(baseSeller());

  const result = await service.promoteSellerToCapture(context, 'campaign-1', 'seller-1');

  assert.equal(canonicalCapture.captures.length, 1);
  assert.equal(canonicalCapture.captures[0].listingUrl, 'https://jiji.com.gh/cars/listing-1');
  assert.equal(result.marketplaceCaptureId, canonicalCapture.captures[0].id);
});

test('promote runs canonical qualification and reports QUALIFIED for a seller with a phone number', async () => {
  const { discoveryRepo, service } = harness();
  discoveryRepo.sellers.push(baseSeller());

  const result = await service.promoteSellerToCapture(context, 'campaign-1', 'seller-1');

  assert.equal(result.qualificationStatus, 'QUALIFIED');
});

test('qualified promotion creates a Contact', async () => {
  const { discoveryRepo, canonicalCapture, service } = harness();
  discoveryRepo.sellers.push(baseSeller());

  const result = await service.promoteSellerToCapture(context, 'campaign-1', 'seller-1');

  assert.equal(canonicalCapture.contacts.length, 1);
  assert.equal(result.contactId, canonicalCapture.contacts[0].id);
});

test('qualified promotion creates a Deal', async () => {
  const { discoveryRepo, canonicalCapture, service } = harness();
  discoveryRepo.sellers.push(baseSeller());

  const result = await service.promoteSellerToCapture(context, 'campaign-1', 'seller-1');

  assert.equal(canonicalCapture.deals.length, 1);
  assert.equal(result.dealId, canonicalCapture.deals[0].id);
});

test('malformed image URLs and empty category/location are sanitized before crossing into the canonical pipeline', async () => {
  const { discoveryRepo, canonicalCapture, service } = harness();
  discoveryRepo.sellers.push(baseSeller({
    images: ['not-a-url', 'https://cdn.example.com/photo.jpg', ''],
    category: '',
    location: '   ',
  }));

  await service.promoteSellerToCapture(context, 'campaign-1', 'seller-1');

  const input = canonicalCapture.calls[0].input;
  assert.deepEqual(input.images, ['https://cdn.example.com/photo.jpg']);
  assert.equal('category' in input, false);
  assert.equal('location' in input, false);
});

test('unqualified promotion (no phone) creates neither a Contact nor a Deal', async () => {
  const { discoveryRepo, canonicalCapture, service } = harness();
  discoveryRepo.sellers.push(baseSeller({ phone: undefined }));

  const result = await service.promoteSellerToCapture(context, 'campaign-1', 'seller-1');

  assert.equal(result.qualificationStatus, 'UNQUALIFIED');
  assert.equal(result.crmConversionStatus, 'NOT_ELIGIBLE');
  assert.equal(canonicalCapture.contacts.length, 0);
  assert.equal(canonicalCapture.deals.length, 0);
  assert.equal(result.contactId, undefined);
  assert.equal(result.dealId, undefined);
});

test('unqualified promotion still creates the MarketplaceCapture and a campaign member', async () => {
  const { discoveryRepo, canonicalCapture, campaigns, service } = harness();
  discoveryRepo.sellers.push(baseSeller({ phone: undefined }));

  const result = await service.promoteSellerToCapture(context, 'campaign-1', 'seller-1');

  assert.equal(canonicalCapture.captures.length, 1);
  assert.equal(campaigns.members.length, 1);
  assert.equal(result.status, 'PROMOTED');
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
  const { discoveryRepo, canonicalCapture, service } = harness();
  discoveryRepo.sellers.push(baseSeller());

  await service.promoteSellerToCapture(context, 'campaign-1', 'seller-1');

  assert.equal(discoveryRepo.sellers[0].status, 'PROMOTED');
  assert.equal(discoveryRepo.sellers[0].promotedCaptureId, canonicalCapture.captures[0].id);
});

test('second promotion is idempotent: no duplicate capture or member is created', async () => {
  const { discoveryRepo, canonicalCapture, campaigns, service } = harness();
  discoveryRepo.sellers.push(baseSeller());

  const first = await service.promoteSellerToCapture(context, 'campaign-1', 'seller-1');
  const second = await service.promoteSellerToCapture(context, 'campaign-1', 'seller-1');

  assert.equal(canonicalCapture.captures.length, 1);
  assert.equal(campaigns.members.length, 1);
  assert.equal(second.alreadyPromoted, true);
  assert.equal(first.alreadyPromoted, false);
  assert.equal(second.marketplaceCaptureId, first.marketplaceCaptureId);
  assert.equal(second.campaignMemberId, first.campaignMemberId);
});

test('repeated promotion does not duplicate the Contact', async () => {
  const { discoveryRepo, canonicalCapture, service } = harness();
  discoveryRepo.sellers.push(baseSeller());

  await service.promoteSellerToCapture(context, 'campaign-1', 'seller-1');
  await service.promoteSellerToCapture(context, 'campaign-1', 'seller-1');

  assert.equal(canonicalCapture.contacts.length, 1);
});

test('repeated promotion does not duplicate the Deal', async () => {
  const { discoveryRepo, canonicalCapture, service } = harness();
  discoveryRepo.sellers.push(baseSeller());

  await service.promoteSellerToCapture(context, 'campaign-1', 'seller-1');
  await service.promoteSellerToCapture(context, 'campaign-1', 'seller-1');

  assert.equal(canonicalCapture.deals.length, 1);
});

test('repeated promotion does not duplicate the campaign member', async () => {
  const { discoveryRepo, campaigns, service } = harness();
  discoveryRepo.sellers.push(baseSeller());

  await service.promoteSellerToCapture(context, 'campaign-1', 'seller-1');
  await service.promoteSellerToCapture(context, 'campaign-1', 'seller-1');

  assert.equal(campaigns.members.length, 1);
});

test('a seller later enriched with a phone number becomes qualified and CRM-converted on re-promotion', async () => {
  const { discoveryRepo, canonicalCapture, service } = harness();
  discoveryRepo.sellers.push(baseSeller({ phone: undefined }));

  const first = await service.promoteSellerToCapture(context, 'campaign-1', 'seller-1');
  assert.equal(first.qualificationStatus, 'UNQUALIFIED');

  discoveryRepo.sellers[0] = { ...discoveryRepo.sellers[0], phone: '+233555000000' };
  const second = await service.promoteSellerToCapture(context, 'campaign-1', 'seller-1');

  assert.equal(second.qualificationStatus, 'QUALIFIED');
  assert.equal(second.crmConversionStatus, 'CREATED');
  assert.equal(canonicalCapture.captures.length, 1);
  assert.equal(canonicalCapture.contacts.length, 1);
});

test('promote delegates to the canonical capture pipeline with a correlation id and the acting user for auditability', async () => {
  const { discoveryRepo, canonicalCapture, service } = harness();
  discoveryRepo.sellers.push(baseSeller());

  await service.promoteSellerToCapture(context, 'campaign-1', 'seller-1');

  assert.equal(canonicalCapture.calls.length, 1);
  assert.equal(canonicalCapture.calls[0].context.tenantId, 'tenant-1');
  assert.equal(canonicalCapture.calls[0].context.actorId, 'actor-1');
  assert.equal(typeof canonicalCapture.calls[0].context.correlation.correlationId, 'string');
  assert.ok(canonicalCapture.calls[0].context.correlation.correlationId.length > 0);
});

test('tenant mismatch on the discovered seller is denied', async () => {
  const { discoveryRepo, service } = harness();
  discoveryRepo.sellers.push(baseSeller());

  await assert.rejects(
    () => service.promoteSellerToCapture({ tenantId: 'tenant-2', actorId: 'actor-1' }, 'campaign-1', 'seller-1'),
    (error) => error instanceof DiscoveryPromotionError && error.code === 'SELLER_NOT_FOUND',
  );
});

test('tenant isolation: a canonical capture created for one tenant is invisible to another tenant', async () => {
  const { discoveryRepo, canonicalCapture, campaigns, service } = harness();
  campaigns.campaigns.push({ id: 'campaign-1', tenantId: 'tenant-2', name: 'Other Tenant Campaign', status: 'ACTIVE', createdAt: now, updatedAt: now });
  discoveryRepo.sellers.push(baseSeller());
  discoveryRepo.sellers.push(baseSeller({ id: 'seller-2', tenantId: 'tenant-2', listingUrl: 'https://jiji.com.gh/cars/listing-1' }));

  await service.promoteSellerToCapture(context, 'campaign-1', 'seller-1');
  await service.promoteSellerToCapture({ tenantId: 'tenant-2', actorId: 'actor-1' }, 'campaign-1', 'seller-2');

  assert.equal(canonicalCapture.captures.filter((capture) => capture.tenantId === 'tenant-1').length, 1);
  assert.equal(canonicalCapture.captures.filter((capture) => capture.tenantId === 'tenant-2').length, 1);
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
  const { discoveryRepo, canonicalCapture, campaigns, service } = harness();
  discoveryRepo.sellers.push(baseSeller());
  canonicalCapture.failNextCapture = true;

  await assert.rejects(() => service.promoteSellerToCapture(context, 'campaign-1', 'seller-1'));

  assert.equal(discoveryRepo.sellers[0].status, 'QUALIFIED');
  assert.equal(discoveryRepo.sellers[0].promotedCaptureId, undefined);
  assert.equal(canonicalCapture.captures.length, 0);
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

// ST1-013N: campaign isolation proof for rejectSeller (previously mutated any sellerId known
// to the tenant regardless of which campaign the request URL named -- see reject/route.ts).

test('rejectSeller sets status to REJECTED for a seller belonging to the specified campaign', async () => {
  const { discoveryRepo, service } = harness();
  discoveryRepo.sellers.push(baseSeller());

  const result = await service.rejectSeller(context, 'campaign-1', 'seller-1');

  assert.equal(result.status, 'REJECTED');
  assert.equal(discoveryRepo.sellers[0].status, 'REJECTED');
  assert.equal(discoveryRepo.sellers[0].reviewedBy, 'actor-1');
});

test('rejectSeller is denied with CAMPAIGN_MISMATCH when the seller belongs to a different campaign', async () => {
  const { discoveryRepo, campaigns, service } = harness();
  campaigns.campaigns.push({ id: 'campaign-2', tenantId: 'tenant-1', name: 'Other Campaign', status: 'ACTIVE', createdAt: now, updatedAt: now });
  discoveryRepo.sellers.push(baseSeller({ campaignId: 'campaign-2' }));

  await assert.rejects(
    () => service.rejectSeller(context, 'campaign-1', 'seller-1'),
    (error) => error instanceof DiscoveryPromotionError && error.code === 'CAMPAIGN_MISMATCH',
  );
  assert.equal(discoveryRepo.sellers[0].status, 'QUALIFIED');
});

test('rejectSeller is denied with SELLER_NOT_FOUND for a cross-tenant seller', async () => {
  const { discoveryRepo, service } = harness();
  discoveryRepo.sellers.push(baseSeller());

  await assert.rejects(
    () => service.rejectSeller({ tenantId: 'tenant-2', actorId: 'actor-1' }, 'campaign-1', 'seller-1'),
    (error) => error instanceof DiscoveryPromotionError && error.code === 'SELLER_NOT_FOUND',
  );
});

test('campaign isolation: the same seller identity can exist independently in campaign A and campaign B', async () => {
  const { discoveryRepo, campaigns, service } = harness();
  campaigns.campaigns.push({ id: 'campaign-b', tenantId: 'tenant-1', name: 'Campaign B', status: 'ACTIVE', createdAt: now, updatedAt: now });
  discoveryRepo.sellers.push(baseSeller({ id: 'seller-a', campaignId: 'campaign-1' }));
  discoveryRepo.sellers.push(baseSeller({ id: 'seller-b', campaignId: 'campaign-b', listingUrl: 'https://jiji.com.gh/cars/listing-1-b' }));

  // Reject the seller in campaign A.
  await service.rejectSeller(context, 'campaign-1', 'seller-a');
  const sellerA = await discoveryRepo.findDiscoveredSellerById(context, 'seller-a');
  const sellerB = await discoveryRepo.findDiscoveredSellerById(context, 'seller-b');
  assert.equal(sellerA.status, 'REJECTED');
  assert.equal(sellerB.status, 'QUALIFIED', 'campaign B seller must be untouched by campaign A reject');

  // Promote the (still-qualified) seller in campaign B.
  const promoted = await service.promoteSellerToCapture(context, 'campaign-b', 'seller-b');
  assert.equal(promoted.status, 'PROMOTED');

  const sellerAAfter = await discoveryRepo.findDiscoveredSellerById(context, 'seller-a');
  assert.equal(sellerAAfter.status, 'REJECTED', 'campaign A seller must remain rejected after campaign B promote');

  // Listing each campaign is independent.
  const listA = await discoveryRepo.listDiscoveredSellersByCampaign(context, 'campaign-1');
  const listB = await discoveryRepo.listDiscoveredSellersByCampaign(context, 'campaign-b');
  assert.deepEqual(listA.map((s) => s.id), ['seller-a']);
  assert.deepEqual(listB.map((s) => s.id), ['seller-b']);
  assert.equal(listA[0].status, 'REJECTED');
  assert.equal(listB[0].status, 'PROMOTED');

  // Cross-campaign mutation is rejected even after both operations above.
  await assert.rejects(
    () => service.rejectSeller(context, 'campaign-1', 'seller-b'),
    (error) => error instanceof DiscoveryPromotionError && error.code === 'CAMPAIGN_MISMATCH',
  );
  await assert.rejects(
    () => service.promoteSellerToCapture(context, 'campaign-b', 'seller-a'),
    (error) => error instanceof DiscoveryPromotionError && error.code === 'CAMPAIGN_MISMATCH',
  );
});

test('promotion race that hits a campaign-member conflict still resolves to the existing member', async () => {
  const { discoveryRepo, campaigns, canonicalCapture, service } = harness();
  discoveryRepo.sellers.push(baseSeller());

  const originalFindMemberByCapture = campaigns.findMemberByCapture.bind(campaigns);
  let calls = 0;
  campaigns.findMemberByCapture = async (ctx, campaignId, marketplaceCaptureId) => {
    calls += 1;
    if (calls === 1) return null;
    return originalFindMemberByCapture(ctx, campaignId, marketplaceCaptureId);
  };
  campaigns.members.push({ id: 'member-preexisting', tenantId: 'tenant-1', campaignId: 'campaign-1', marketplaceCaptureId: 'capture-1', status: 'ADDED', assignedAt: now, createdAt: now, updatedAt: now });
  canonicalCapture.captures.push({ id: 'capture-1', tenantId: 'tenant-1', listingUrl: baseSeller().listingUrl, title: 'Existing capture' });

  const result = await service.promoteSellerToCapture(context, 'campaign-1', 'seller-1');

  assert.equal(result.campaignMemberId, 'member-preexisting');
  assert.equal(campaigns.members.length, 1);
});
