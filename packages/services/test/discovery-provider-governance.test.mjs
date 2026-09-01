import assert from 'node:assert/strict';
import test from 'node:test';
import { DiscoveryExecutionWorker, MarketplaceDiscoveryService, normalizeProviderResultForDiscovery } from '@whisperm/services';
import { DiscoveryProviderError } from '@whisperm/provider-adapters';

const now = '2026-07-01T00:00:00.000Z';

class CampaignRepo {
  constructor(metadata) { this.metadata = metadata; }
  async findById(ctx, id) { return { id, tenantId: ctx.tenantId, name: 'Campaign', status: 'ACTIVE', scheduleEnabled: false, metadata: this.metadata, createdAt: now, updatedAt: now }; }
  async create() { throw new Error('not used'); }
  async list() { return { items: [] }; }
  async update() { throw new Error('not used'); }
  async listDueScheduled() { return { items: [] }; }
  async addSeller() { throw new Error('not used'); }
  async removeSeller() { throw new Error('not used'); }
  async listMembers() { return { items: [] }; }
}

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
  async updateDiscoveredSellerStatus() { throw new Error('not used'); }
  async findDiscoveredSellerByListingUrl(ctx, runId, listingUrl) { return this.sellers.find((seller) => seller.tenantId === ctx.tenantId && seller.discoveryRunId === runId && seller.listingUrl === listingUrl) ?? null; }
  async findDiscoveredSellerByIdentityKey(ctx, campaignId, sellerIdentityKey) { return this.sellers.find((seller) => seller.tenantId === ctx.tenantId && seller.campaignId === campaignId && seller.sellerIdentityKey === sellerIdentityKey) ?? null; }
  async listDiscoveredSellersByRun(ctx, runId, status) { return this.sellers.filter((seller) => seller.tenantId === ctx.tenantId && seller.discoveryRunId === runId && (status === undefined || seller.status === status)); }
  async listDiscoveredSellersByCampaign(ctx, campaignId, status) { return this.sellers.filter((seller) => seller.tenantId === ctx.tenantId && seller.campaignId === campaignId && (status === undefined || seller.status === status)); }
  async countDiscoveredSellersByCampaign(ctx, campaignId, status) { return (await this.listDiscoveredSellersByCampaign(ctx, campaignId, status)).length; }
}

const metadata = {
  discoveryExecution: {
    marketplaceSourceId: 'source-1',
    marketplaceSourceKey: 'JIJI',
    limit: 3,
    discoveryCreditsRemaining: 3,
    search: { query: 'cars', location: 'Accra' },
  },
};

const workerInput = { tenantId: 'tenant-1', campaignId: 'campaign-1', executionId: 'execution-1', trigger: 'MANUAL', correlation: { correlationId: 'corr-1' } };

const createWorker = (provider, repo = new MemoryDiscoveryRepo()) => ({
  repo,
  worker: new DiscoveryExecutionWorker({ campaigns: new CampaignRepo(metadata), discoveryService: new MarketplaceDiscoveryService({ discoveryRepo: repo }), providers: [provider] }),
});

test('worker resolves discovery provider through registry and persists via marketplace discovery ownership', async () => {
  const calls = [];
  const provider = {
    providerKey: 'jiji-provider',
    marketplaceSource: 'JIJI',
    async discover(request) {
      calls.push(request);
      return { providerKey: this.providerKey, marketplaceSource: this.marketplaceSource, results: [
        { source: 'JIJI', externalListingId: 'listing-1', listingUrl: 'https://jiji.com.gh/cars/listing-1', sellerName: 'Ama Seller', sellerPhone: '+233555000000', title: 'Toyota', price: '10000', currency: 'GHS', rawProviderPayload: { id: 'listing-1' } },
        { source: 'JIJI', externalListingId: 'listing-1-dupe', listingUrl: 'https://jiji.com.gh/cars/listing-1', sellerName: 'Ama Seller', sellerPhone: '+233555000000', title: 'Toyota' },
      ] };
    },
  };
  const { repo, worker } = createWorker(provider);

  const result = await worker.execute(workerInput);

  assert.equal(result.status, 'COMPLETED');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tenant.tenantId, 'tenant-1');
  assert.equal(calls[0].campaign.executionId, 'execution-1');
  assert.equal(calls[0].marketplaceSource, 'JIJI');
  assert.equal(result.metrics.providerKey, 'jiji-provider');
  assert.equal(result.metrics.marketplaceSource, 'JIJI');
  assert.equal(result.metrics.returnedCount, 2);
  assert.equal(result.metrics.normalizedCount, 2);
  assert.equal(result.metrics.skippedDuplicateCount, 1);
  assert.equal(repo.runs.length, 1);
  assert.equal(repo.sellers.length, 2);
  assert.equal(repo.sellers.filter((seller) => seller.status === 'DUPLICATE').length, 1);
});

test('unsupported provider fails clearly and remains retry/dead-letter compatible', async () => {
  const repo = new MemoryDiscoveryRepo();
  const worker = new DiscoveryExecutionWorker({ campaigns: new CampaignRepo(metadata), discoveryService: new MarketplaceDiscoveryService({ discoveryRepo: repo }), providers: [] });

  const result = await worker.execute(workerInput);

  assert.equal(result.status, 'FAILED');
  assert.equal(result.errorCode, 'DISCOVERY_PROVIDER_UNSUPPORTED');
  assert.equal(result.metrics.failureCategory, 'UNSUPPORTED_PROVIDER');
  assert.equal(result.metrics.retryable, false);
});

test('provider result normalization maps governed fields into discovery entries', () => {
  const normalized = normalizeProviderResultForDiscovery({ source: 'JIJI', externalListingId: '1', listingUrl: 'https://jiji.com.gh/listing/1', sellerName: '  Seller  ', sellerPhone: '+2335', sellerEmail: 'seller@example.com', title: 'Car', description: 'Clean', price: 12, currency: 'GHS', category: 'Cars', location: 'Accra' });
  assert.deepEqual(normalized, { listingUrl: 'https://jiji.com.gh/listing/1', sellerName: 'Seller', phone: '+2335', email: 'seller@example.com', title: 'Car', description: 'Clean', price: 12, currency: 'GHS', category: 'Cars', location: 'Accra' });
});

test('provider failures are classified without exposing provider logic to runtime', async () => {
  const provider = { providerKey: 'jiji-provider', marketplaceSource: 'JIJI', async discover() { throw new DiscoveryProviderError({ code: 'DISCOVERY_PROVIDER_RATE_LIMITED', message: 'Provider rate limited', category: 'RATE_LIMITED', providerKey: 'jiji-provider', marketplaceSource: 'JIJI' }); } };
  const { worker } = createWorker(provider);

  const result = await worker.execute(workerInput);

  assert.equal(result.status, 'FAILED');
  assert.equal(result.errorCode, 'DISCOVERY_PROVIDER_RATE_LIMITED');
  assert.equal(result.metrics.failureCategory, 'RATE_LIMITED');
  assert.equal(result.metrics.retryable, true);
});

test('worker maps canonical campaign targeting and resolves its marketplace source id', async () => {
  const repo = new MemoryDiscoveryRepo();
  const campaignRepo = new CampaignRepo({ targeting: { marketplaceSourceKey: 'JIJI', keyword: 'cleaning supplies', location: 'Accra', executionLimit: 2, exclusionTerms: [] } });
  const calls = [];
  const provider = { providerKey: 'jiji-provider', marketplaceSource: 'JIJI', async discover(request) { calls.push(request); return { providerKey: this.providerKey, marketplaceSource: this.marketplaceSource, results: [] }; } };
  const worker = new DiscoveryExecutionWorker({
    campaigns: campaignRepo,
    discoveryService: new MarketplaceDiscoveryService({ discoveryRepo: repo }),
    providers: [provider],
    async resolveMarketplaceSourceId(input) { assert.deepEqual(input, { tenantId: 'tenant-1', marketplaceSourceKey: 'JIJI' }); return 'source-resolved'; },
  });
  const result = await worker.execute(workerInput);
  assert.equal(result.status, 'COMPLETED');
  assert.equal(calls[0].search.query, 'cleaning supplies');
  assert.equal(calls[0].search.location, 'Accra');
  assert.equal(calls[0].limits.limit, 2);
  assert.equal(repo.runs[0].marketplaceSourceId, 'source-resolved');
});