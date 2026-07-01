import assert from 'node:assert/strict';
import test from 'node:test';
import { MarketplaceDiscoveryService, SellerQualificationService } from '@whisperm/services';

const now = '2026-07-01T00:00:00.000Z';
const context = { tenantId: 'tenant-1', actorId: 'actor-1' };

class MemoryDiscoveryRepo {
  runs = [];
  sellers = [];
  nextRun = 1;
  nextSeller = 1;
  async createDiscoveryRun(ctx, input) {
    assert.equal(ctx.tenantId, input.tenantId);
    const run = { id: `run-${this.nextRun++}`, status: 'PENDING', sellersFound: 0, sellersQualified: 0, sellersRejected: 0, sellersDuplicate: 0, metadata: {}, createdAt: now, updatedAt: now, ...input };
    this.runs.push(run);
    return run;
  }
  async updateDiscoveryRun(ctx, runId, input) {
    const index = this.runs.findIndex((run) => run.tenantId === ctx.tenantId && run.id === runId);
    assert.notEqual(index, -1);
    this.runs[index] = { ...this.runs[index], ...input, updatedAt: now };
    return this.runs[index];
  }
  async findDiscoveryRunById(ctx, runId) { return this.runs.find((run) => run.tenantId === ctx.tenantId && run.id === runId) ?? null; }
  async listDiscoveryRunsByCampaign(ctx, campaignId) { return this.runs.filter((run) => run.tenantId === ctx.tenantId && run.campaignId === campaignId); }
  async createDiscoveredSeller(ctx, input) {
    assert.equal(ctx.tenantId, input.tenantId);
    const row = { id: `seller-${this.nextSeller++}`, qualificationScore: 0, status: 'PENDING', createdAt: now, updatedAt: now, ...input };
    this.sellers.push(row);
    return row;
  }
  async updateDiscoveredSellerStatus(ctx, sellerId, status, extra = {}) {
    const index = this.sellers.findIndex((seller) => seller.tenantId === ctx.tenantId && seller.id === sellerId);
    assert.notEqual(index, -1);
    this.sellers[index] = { ...this.sellers[index], status, ...extra, updatedAt: now };
    return this.sellers[index];
  }
  async findDiscoveredSellerByListingUrl(ctx, runId, listingUrl) { return this.sellers.find((seller) => seller.tenantId === ctx.tenantId && seller.discoveryRunId === runId && seller.listingUrl === listingUrl) ?? null; }
  async findDiscoveredSellerByIdentityKey(ctx, campaignId, sellerIdentityKey) { return this.sellers.find((seller) => seller.tenantId === ctx.tenantId && seller.campaignId === campaignId && seller.sellerIdentityKey === sellerIdentityKey) ?? null; }
  async listDiscoveredSellersByRun(ctx, runId, status) { return this.sellers.filter((seller) => seller.tenantId === ctx.tenantId && seller.discoveryRunId === runId && (status === undefined || seller.status === status)); }
  async listDiscoveredSellersByCampaign(ctx, campaignId, status) { return this.sellers.filter((seller) => seller.tenantId === ctx.tenantId && seller.campaignId === campaignId && (status === undefined || seller.status === status)); }
  async countDiscoveredSellersByCampaign(ctx, campaignId, status) { return (await this.listDiscoveredSellersByCampaign(ctx, campaignId, status)).length; }
}

const runInput = (entries, overrides = {}) => ({
  campaignId: 'campaign-1',
  marketplaceSourceId: 'source-1',
  marketplaceSourceKey: 'JIJI',
  mode: 'MANUAL_SEED',
  entries,
  discoveryCreditsRemaining: 50,
  ...overrides,
});

const baseEntry = (overrides = {}) => ({
  listingUrl: 'https://jiji.com.gh/cars/listing-1',
  marketplaceSourceKey: 'JIJI',
  sellerName: 'Ama Seller',
  sellerProfileUrl: 'https://jiji.com.gh/seller/ama',
  phone: '+233555000000',
  title: 'Clean Toyota Corolla',
  category: 'Cars',
  price: '10000',
  location: 'Accra',
  images: ['https://cdn.example/image.jpg'],
  ...overrides,
});

const serviceWithRepo = () => {
  const repo = new MemoryDiscoveryRepo();
  return { repo, service: new MarketplaceDiscoveryService({ discoveryRepo: repo }) };
};

test('missing phone becomes NEEDS_REVIEW, not REJECTED', () => {
  const result = new SellerQualificationService().qualify(baseEntry({ phone: undefined }));
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.ok(result.reasons.includes('MISSING_PHONE'));
});

test('partial extraction becomes NEEDS_REVIEW', () => {
  const result = new SellerQualificationService().qualify(baseEntry({ sellerName: undefined, sellerProfileUrl: undefined, price: undefined, images: [] }));
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.ok(result.reasons.includes('PARTIAL_EXTRACTION'));
});

test('invalid URL becomes REJECTED with INVALID_URL', () => {
  const result = new SellerQualificationService().qualify(baseEntry({ listingUrl: 'not-a-url' }));
  assert.equal(result.status, 'REJECTED');
  assert.deepEqual(result.reasons, ['INVALID_URL']);
});

test('unsupported marketplace becomes REJECTED with UNSUPPORTED_MARKETPLACE', () => {
  const result = new SellerQualificationService().qualify(baseEntry({ marketplaceSourceKey: 'UNKNOWN' }));
  assert.equal(result.status, 'REJECTED');
  assert.ok(result.reasons.includes('UNSUPPORTED_MARKETPLACE'));
});

test('confidence score affects qualification state', () => {
  const high = new SellerQualificationService().qualify(baseEntry());
  const low = new SellerQualificationService().qualify(baseEntry({ sellerName: undefined, sellerProfileUrl: undefined, phone: undefined, title: undefined, category: undefined, price: undefined, location: undefined, images: [] }));
  assert.equal(high.status, 'QUALIFIED');
  assert.equal(low.status, 'REJECTED');
  assert.ok(high.confidence.overallConfidence > low.confidence.overallConfidence);
});

test('duplicate listing records duplicate reason', async () => {
  const { repo, service } = serviceWithRepo();
  await service.runDiscovery(context, runInput([baseEntry(), baseEntry()]));
  const duplicate = repo.sellers.find((seller) => seller.status === 'DUPLICATE');
  assert.ok(duplicate);
  assert.deepEqual(duplicate.metadata.reasons, ['DUPLICATE_LISTING']);
});

test('MANUAL_SEED metrics include qualified, needsReview, rejected, and duplicates', async () => {
  const { repo, service } = serviceWithRepo();
  const result = await service.runDiscovery(context, runInput([
    baseEntry(),
    baseEntry({ listingUrl: 'https://jiji.com.gh/cars/listing-2', phone: undefined, sellerProfileUrl: 'https://jiji.com.gh/seller/no-phone' }),
    baseEntry({ listingUrl: 'invalid-url', phone: '+233555000002', sellerProfileUrl: 'https://jiji.com.gh/seller/invalid' }),
    baseEntry(),
  ]));
  assert.equal(result.sellersQualified, 1);
  assert.equal(result.sellersNeedsReview, 1);
  assert.equal(result.sellersRejected, 2);
  assert.equal(result.sellersDuplicate, 1);
  assert.equal(repo.runs[0].metadata.qualified, 1);
  assert.equal(repo.runs[0].metadata.needsReview, 1);
  assert.equal(repo.runs[0].metadata.rejected, 2);
  assert.equal(repo.runs[0].metadata.duplicateListings, 1);
  assert.equal(repo.runs[0].metadata.submitted, 4);
  assert.ok('averageConfidence' in repo.runs[0].metadata);
});

test('tenant isolation remains enforced by discovery repository context', async () => {
  const { repo, service } = serviceWithRepo();
  await service.runDiscovery(context, runInput([baseEntry()]));
  assert.equal(await repo.countDiscoveredSellersByCampaign({ tenantId: 'tenant-2' }, 'campaign-1'), 0);
});

test('Campaign strategy is not modified by qualification', () => {
  const campaignStrategy = Object.freeze({ marketplaces: ['JIJI'], category: 'Cars' });
  const before = JSON.stringify(campaignStrategy);
  new SellerQualificationService().qualify(baseEntry({ campaignTargetMarketplaces: campaignStrategy.marketplaces }));
  assert.equal(JSON.stringify(campaignStrategy), before);
});

test('existing Campaign Runtime is not duplicated by discovery qualification slice', async () => {
  const source = await import('@whisperm/services');
  assert.equal(typeof source.CampaignRuntimeService, 'function');
  assert.equal(typeof source.MarketplaceDiscoveryService, 'function');
});
