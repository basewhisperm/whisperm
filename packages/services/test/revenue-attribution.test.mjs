import assert from 'node:assert/strict';
import test from 'node:test';
import { RevenueAttributionRuntimeError, RevenueAttributionRuntimeService } from '../dist/index.js';

const now = new Date('2026-01-01T00:00:00.000Z');
const context = { tenantId: 'tenant-1', correlation: { correlationId: 'corr-revenue' } };

function makeDeal(overrides = {}) {
  return {
    id: 'deal-1',
    tenantId: 'tenant-1',
    contactId: 'contact-1',
    pipelineId: 'pipeline-1',
    pipelineStageId: 'stage-1',
    title: 'Bike deal',
    value: null,
    currency: 'USD',
    closedAt: null,
    metadata: {},
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

function makeOpportunity(overrides = {}) {
  return {
    id: 'opp-1',
    tenantId: 'tenant-1',
    marketplaceCaptureId: 'capture-1',
    discoveredSellerId: 'seller-1',
    campaignId: 'campaign-1',
    contactId: 'contact-1',
    dealId: 'deal-1',
    status: 'CONVERTED',
    qualificationStatus: 'QUALIFIED',
    qualificationScore: '0.8500',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

function makeCapture(overrides = {}) {
  return {
    id: 'capture-1',
    tenantId: 'tenant-1',
    marketplaceSourceId: 'source-1',
    contactId: 'contact-1',
    dealId: 'deal-1',
    listingUrl: 'https://market.test/1',
    title: 'Bike',
    status: 'CONVERTED',
    capturedAt: now.toISOString(),
    metadata: { marketplace: 'Jiji', crmConversionIdempotencyKey: 'crm-key-1' },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

function makeService(overrides = {}) {
  const state = {
    deals: [makeDeal()],
    opportunities: [makeOpportunity()],
    captures: [makeCapture()],
    discoveredSellers: [{ id: 'seller-1', tenantId: 'tenant-1', discoveryRunId: 'run-1' }],
    invitations: [{ id: 'invitation-1' }],
    claimTokens: [{ id: 'claim-1' }],
    executions: [{ id: 'execution-1', tenantId: 'tenant-1', campaignId: 'campaign-1', status: 'COMPLETED', trigger: 'MANUAL', metrics: { targetingSnapshot: { marketplaceSourceKey: 'jiji' } }, createdAt: now.toISOString(), updatedAt: now.toISOString() }],
    jobs: [],
    ...overrides,
  };

  const deals = {
    async findById(tenantId, dealId) {
      return state.deals.find((deal) => deal.tenantId === tenantId && deal.id === dealId) ?? null;
    },
    async update(tenantId, dealId, input) {
      const index = state.deals.findIndex((deal) => deal.tenantId === tenantId && deal.id === dealId);
      const current = state.deals[index];
      const updated = { ...current, ...input, metadata: input.metadata ?? current.metadata, updatedAt: new Date(now.getTime() + state.deals.length * 1000 + 1).toISOString() };
      state.deals[index] = updated;
      return updated;
    },
  };

  const businessGrowthOpportunities = {
    async findByDealId(ctx, dealId) {
      assert.equal(ctx.tenantId, 'tenant-1');
      return state.opportunities.find((opp) => opp.dealId === dealId) ?? null;
    },
    async findByMarketplaceCaptureId(ctx, captureId) {
      return state.opportunities.find((opp) => opp.marketplaceCaptureId === captureId) ?? null;
    },
    async recordRevenueAttribution(ctx, opportunityId, input) {
      const opp = state.opportunities.find((item) => item.id === opportunityId);
      Object.assign(opp, {
        attributedRevenueAmount: input.revenueAmount,
        attributedRevenueCurrency: input.revenueCurrency,
        revenueAttributedAt: input.attributedAt,
        attributionCompleteness: input.completeness,
        attributionMissingLinks: input.missingLinks,
      });
      return opp;
    },
  };

  const marketplaceCaptures = {
    async findById(ctx, captureId) {
      return state.captures.find((capture) => capture.id === captureId) ?? null;
    },
    async findByDealId(ctx, dealId) {
      return state.captures.find((capture) => capture.dealId === dealId) ?? null;
    },
  };

  const marketplaceDiscovery = {
    async findDiscoveredSellerById(ctx, sellerId) {
      return state.discoveredSellers.find((seller) => seller.id === sellerId) ?? null;
    },
  };

  const sellerInvitations = {
    async listSellerInvitationsByMarketplaceCaptureId() {
      return state.invitations;
    },
  };

  const claimTokens = {
    async listClaimTokensByMarketplaceCaptureId() {
      return state.claimTokens;
    },
  };

  const campaignRuntimeExecutions = {
    async listByCampaignId(ctx, campaignId) {
      return { items: state.executions.filter((execution) => execution.campaignId === campaignId) };
    },
  };

  const scheduler = state.withScheduler ? { async schedule(job) { state.jobs.push(job); } } : undefined;

  const service = new RevenueAttributionRuntimeService({
    clock: () => now,
    deals,
    businessGrowthOpportunities,
    marketplaceCaptures,
    marketplaceDiscovery,
    sellerInvitations,
    claimTokens,
    campaignRuntimeExecutions,
    scheduler,
  });

  return { service, state };
}

test('non-won deal does not create a final revenue attribution snapshot', async () => {
  const { service, state } = makeService();
  const result = await service.evaluateForDeal(context, { tenantId: 'tenant-1', dealId: 'deal-1' });
  assert.equal(result.status, 'NOT_ELIGIBLE');
  assert.equal(state.deals[0].metadata.revenueAttribution, undefined);
});

test('won deal resolves the full deal -> opportunity -> acquisition -> campaign chain', async () => {
  const { service, state } = makeService({ deals: [makeDeal({ value: '500', closedAt: now.toISOString() })] });
  const result = await service.computeAttribution(context, { tenantId: 'tenant-1', dealId: 'deal-1' });
  assert.equal(result.status, 'ATTRIBUTED');
  assert.equal(result.snapshot.attributionCompleteness, 'COMPLETE');
  assert.equal(result.snapshot.revenueAmount, '500');
  assert.equal(result.snapshot.contactId, 'contact-1');
  assert.equal(result.snapshot.opportunityId, 'opp-1');
  assert.equal(result.snapshot.captureId, 'capture-1');
  assert.equal(result.snapshot.campaignId, 'campaign-1');
  assert.equal(result.snapshot.campaignRuntimeExecutionId, 'execution-1');
  assert.equal(result.snapshot.discoveryRunId, 'run-1');
  assert.equal(result.snapshot.invitationId, 'invitation-1');
  assert.equal(result.snapshot.claimId, 'claim-1');
  assert.equal(result.snapshot.conversionExecutionId, 'crm-key-1');
  assert.equal(result.snapshot.providerKey, 'jiji');
  assert.equal(result.snapshot.marketplaceSource, 'Jiji');
  assert.deepEqual(result.snapshot.missingLinks, []);
  assert.equal(state.deals[0].metadata.revenueAttribution.dealId, 'deal-1');
  assert.equal(state.opportunities[0].attributionCompleteness, 'COMPLETE');
});

test('partial attribution is produced when acquisition links are missing', async () => {
  const { service } = makeService({
    deals: [makeDeal({ value: '250', closedAt: now.toISOString() })],
    opportunities: [],
    captures: [],
  });
  const result = await service.computeAttribution(context, { tenantId: 'tenant-1', dealId: 'deal-1' });
  assert.equal(result.status, 'ATTRIBUTED');
  assert.equal(result.snapshot.attributionCompleteness, 'PARTIAL');
  assert.ok(result.snapshot.missingLinks.includes('OPPORTUNITY'));
  assert.ok(result.snapshot.missingLinks.includes('MARKETPLACE_CAPTURE'));
  assert.ok(result.snapshot.missingLinks.includes('CAMPAIGN'));
});

test('recomputation is idempotent and revenue updates are reflected', async () => {
  const { service, state } = makeService({ deals: [makeDeal({ value: '500', closedAt: now.toISOString() })] });
  const first = await service.computeAttribution(context, { tenantId: 'tenant-1', dealId: 'deal-1' });
  assert.equal(first.idempotent, false);

  const cached = await service.evaluateForDeal(context, { tenantId: 'tenant-1', dealId: 'deal-1' });
  assert.equal(cached.idempotent, true);
  assert.equal(cached.snapshot.revenueAmount, '500');

  const forced = await service.recompute(context, { tenantId: 'tenant-1', dealId: 'deal-1' });
  assert.equal(forced.idempotent, false);
  assert.equal(forced.snapshot.recomputeCount, 1);

  state.deals[0] = { ...state.deals[0], value: '750', updatedAt: new Date(now.getTime() + 60_000).toISOString() };
  const afterRevenueUpdate = await service.computeAttribution(context, { tenantId: 'tenant-1', dealId: 'deal-1' });
  assert.equal(afterRevenueUpdate.idempotent, false);
  assert.equal(afterRevenueUpdate.snapshot.revenueAmount, '750');
});

test('duplicate attribution records are prevented across repeated evaluation calls', async () => {
  const { service, state } = makeService({ deals: [makeDeal({ value: '500', closedAt: now.toISOString() })] });
  await service.evaluateForDeal(context, { tenantId: 'tenant-1', dealId: 'deal-1' });
  await service.evaluateForDeal(context, { tenantId: 'tenant-1', dealId: 'deal-1' });
  await service.evaluateForDeal(context, { tenantId: 'tenant-1', dealId: 'deal-1' });
  assert.equal(state.deals.length, 1);
  assert.equal(state.opportunities.length, 1);
});

test('worker/runtime tenant isolation violations are terminal and non-retryable', async () => {
  const { service } = makeService({ deals: [makeDeal({ value: '500', closedAt: now.toISOString() })] });
  await assert.rejects(
    () => service.computeAttribution({ ...context, tenantId: 'other-tenant' }, { tenantId: 'tenant-1', dealId: 'deal-1' }),
    (error) => {
      assert.ok(error instanceof RevenueAttributionRuntimeError);
      assert.equal(error.code, 'TENANT_ISOLATION_VIOLATION');
      assert.equal(error.retryable, false);
      return true;
    },
  );
});

test('deal not found is a terminal failure', async () => {
  const { service } = makeService();
  await assert.rejects(
    () => service.computeAttribution(context, { tenantId: 'tenant-1', dealId: 'missing-deal' }),
    (error) => {
      assert.ok(error instanceof RevenueAttributionRuntimeError);
      assert.equal(error.code, 'DEAL_NOT_FOUND');
      assert.equal(error.retryable, false);
      return true;
    },
  );
});

test('transient persistence failures during evaluation are retryable', async () => {
  const failingService = new RevenueAttributionRuntimeService({
    clock: () => now,
    deals: {
      async findById() { return makeDeal({ value: '500', closedAt: now.toISOString() }); },
      async update() { throw new Error('connection reset'); },
    },
    businessGrowthOpportunities: {
      async findByDealId() { return null; },
      async findByMarketplaceCaptureId() { return null; },
      async recordRevenueAttribution() { throw new Error('should not be called'); },
    },
  });
  await assert.rejects(
    () => failingService.computeAttribution(context, { tenantId: 'tenant-1', dealId: 'deal-1' }),
    (error) => {
      assert.ok(error instanceof RevenueAttributionRuntimeError);
      assert.equal(error.code, 'TRANSIENT_PERSISTENCE_FAILURE');
      assert.equal(error.retryable, true);
      return true;
    },
  );
});

test('CRM conversion evaluate hook enqueues attribution job when scheduler is configured', async () => {
  const { service, state } = makeService({ deals: [makeDeal({ value: '500', closedAt: now.toISOString() })], withScheduler: true });
  const result = await service.evaluateForDeal(context, { tenantId: 'tenant-1', dealId: 'deal-1' });
  assert.equal(result.status, 'ATTRIBUTION_READY');
  assert.equal(state.jobs.length, 1);
  assert.equal(state.jobs[0].jobType, 'marketplace.revenue.attribution.evaluate');
  assert.equal(state.deals[0].metadata.revenueAttribution, undefined);
});
