import assert from 'node:assert/strict';
import test from 'node:test';
import { CampaignRuntimeService, GrowthLoopWorker } from '@whisperm/services';

const now = '2026-06-30T00:00:00.000Z';

const campaign = (overrides = {}) => ({
  id: 'campaign-1',
  tenantId: 'tenant-1',
  name: 'Growth',
  status: 'ACTIVE',
  currency: 'GHS',
  goalRevenue: null,
  goalSellerCount: null,
  scheduleEnabled: false,
  scheduleCadence: null,
  metadata: { targeting: { marketplaceSourceKey: 'JIJI', keyword: 'bikes', executionLimit: 20, exclusionTerms: [] } },
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

class MemoryCampaigns {
  constructor(campaigns, members = []) { this.campaigns = campaigns; this.members = members; }
  async findById(context, id) { return this.campaigns.find((row) => row.tenantId === context.tenantId && row.id === id) ?? null; }
  async update(context, id, input) {
    const row = await this.findById(context, id);
    assert.ok(row, 'campaign must exist for update');
    Object.assign(row, input, { updatedAt: now });
    return row;
  }
  async listMembers(context, campaignId) {
    return { items: this.members.filter((member) => member.tenantId === context.tenantId && member.campaignId === campaignId) };
  }
}

class MemoryDeals {
  constructor(deals) { this.deals = deals; }
  async findById(tenantId, dealId) { return this.deals.find((deal) => deal.tenantId === tenantId && deal.id === dealId) ?? null; }
}

class MemoryOpportunities {
  constructor(opportunities) { this.opportunities = opportunities; }
  async findByCampaignId(context, campaignId) {
    return { items: this.opportunities.filter((item) => item.tenantId === context.tenantId && item.campaignId === campaignId) };
  }
}

class MemoryAuditLogs {
  rows = [];
  async append(context, input) { this.rows.push({ ...input, tenantId: context.tenantId }); return { id: `audit-${this.rows.length}`, occurredAt: now, ...input }; }
}

const member = (overrides = {}) => ({ id: `member-${Math.random()}`, tenantId: 'tenant-1', campaignId: 'campaign-1', marketplaceCaptureId: `capture-${Math.random()}`, status: 'ADDED', dealId: null, ...overrides });
const deal = (overrides = {}) => ({ id: `deal-${Math.random()}`, tenantId: 'tenant-1', value: 0, currency: 'GHS', closedAt: null, ...overrides });

const buildService = ({ campaigns = [campaign()], members = [], deals = [], opportunities = [], auditLogs = new MemoryAuditLogs(), growthLoopQueue } = {}) => {
  const campaignsRepo = new MemoryCampaigns(campaigns, members);
  return {
    service: new CampaignRuntimeService({
      campaigns: campaignsRepo,
      executions: { async listByCampaignId() { return { items: [] }; } },
      deals: new MemoryDeals(deals),
      opportunities: new MemoryOpportunities(opportunities),
      auditLogs,
      ...(growthLoopQueue === undefined ? {} : { growthLoopQueue }),
    }),
    campaignsRepo,
    auditLogs,
  };
};

// ---------------------------------------------------------------------------
// Pure GrowthLoopWorker analysis
// ---------------------------------------------------------------------------

test('insufficient members produce a safe INSUFFICIENT_DATA status with no recommendations', () => {
  const worker = new GrowthLoopWorker();
  const result = worker.analyze({
    campaign: { id: 'campaign-1' },
    snapshot: baseSnapshot({ totalMembers: 1 }),
  });
  assert.equal(result.growthLoopStatus, 'INSUFFICIENT_DATA');
  assert.deepEqual(result.recommendations, []);
});

test('high revenue and high conversion produces SCALE_CAMPAIGN referencing targeting', () => {
  const worker = new GrowthLoopWorker();
  const result = worker.analyze({
    campaign: { id: 'campaign-1' },
    snapshot: baseSnapshot({ totalMembers: 10, convertedCountFor: 4, attributedRevenue: 5000, wonDealsCount: 4, conversionRate: 0.4 }),
  });
  assert.equal(result.growthLoopStatus, 'COMPLETED');
  const scale = result.recommendations.find((item) => item.type === 'SCALE_CAMPAIGN');
  assert.ok(scale, 'expected a SCALE_CAMPAIGN recommendation');
  assert.equal(scale.supportingMetrics.targetingSnapshot.marketplaceSourceKey, 'JIJI');
  assert.equal(scale.status, 'PENDING');
});

test('poor conversion with zero revenue produces REDUCE_CAMPAIGN_VOLUME', () => {
  const worker = new GrowthLoopWorker();
  const result = worker.analyze({
    campaign: { id: 'campaign-1' },
    snapshot: baseSnapshot({ totalMembers: 10, attributedRevenue: 0, conversionRate: 0.0 }),
  });
  const reduce = result.recommendations.find((item) => item.type === 'REDUCE_CAMPAIGN_VOLUME');
  assert.ok(reduce, 'expected a REDUCE_CAMPAIGN_VOLUME recommendation');
  assert.equal(reduce.severity, 'ACTIONABLE');
});

test('provider revenue performance produces PAUSE_LOW_ROI_SOURCE and PRIORITIZE_PROVIDER', () => {
  const worker = new GrowthLoopWorker();
  const snapshot = baseSnapshot({ totalMembers: 10, attributedRevenue: 1000, conversionRate: 0.2 });
  const result = worker.analyze({
    campaign: { id: 'campaign-1' },
    snapshot: {
      ...snapshot,
      providerPerformance: [
        { key: 'JIJI', wonDealsCount: 2, attributedRevenue: 1000, memberCount: 5 },
        { key: 'TONATON', wonDealsCount: 0, attributedRevenue: 0, memberCount: 4 },
      ],
    },
  });
  assert.ok(result.recommendations.some((item) => item.type === 'PAUSE_LOW_ROI_SOURCE' && item.sourceRef.key === 'TONATON'));
  assert.ok(result.recommendations.some((item) => item.type === 'PRIORITIZE_PROVIDER' && item.sourceRef.key === 'JIJI'));
});

function baseSnapshot(overrides = {}) {
  return {
    campaignId: 'campaign-1',
    generatedAt: now,
    currency: 'GHS',
    attributedRevenue: 0,
    wonDealsCount: 0,
    openDealsCount: 0,
    totalDeals: 0,
    totalMembers: 0,
    qualifiedCount: 0,
    invitedCount: 0,
    claimedCount: 0,
    convertedCount: 0,
    conversionRate: null,
    qualifiedToClaimRate: null,
    claimToConversionRate: null,
    duplicateRate: null,
    qualificationYield: null,
    goalRevenue: null,
    goalSellerCount: null,
    targetingSnapshot: { marketplaceSourceKey: 'JIJI', keyword: 'bikes', executionLimit: 20 },
    scheduleSnapshot: { scheduleEnabled: false, scheduleCadence: null },
    providerPerformance: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// CampaignRuntimeService growth-loop governance
// ---------------------------------------------------------------------------

test('worker validates tenant isolation before evaluating growth for another tenant campaign', async () => {
  const { service } = buildService({ campaigns: [campaign({ tenantId: 'tenant-2' })] });
  await assert.rejects(
    service.evaluateGrowthLoop({ tenantId: 'tenant-1' }, { campaignId: 'campaign-1' }),
    /Seller acquisition campaign not found/,
  );
});

test('growth signals are derived from attributed revenue and conversion outcomes', async () => {
  const wonDeal = deal({ id: 'deal-1', value: 3000, closedAt: now });
  const members = Array.from({ length: 6 }, (_, index) => member({ id: `m${index}`, status: index < 3 ? 'CONVERTED' : 'CLAIMED', dealId: index === 0 ? 'deal-1' : null }));
  const { service } = buildService({ members, deals: [wonDeal] });

  const updated = await service.evaluateGrowthLoop({ tenantId: 'tenant-1' }, { campaignId: 'campaign-1', trigger: 'MANUAL' });

  assert.equal(updated.metadata.growthLoopStatus, 'COMPLETED');
  assert.equal(updated.metadata.growthSignalSnapshot.attributedRevenue, 3000);
  assert.equal(updated.metadata.growthSignalSnapshot.wonDealsCount, 1);
  assert.equal(updated.metadata.growthSignalSnapshot.totalMembers, 6);
  assert.ok(Array.isArray(updated.metadata.growthRecommendations));
  // Evaluation must never mutate campaign targeting/schedule directly.
  assert.deepEqual(updated.metadata.targeting, campaign().metadata.targeting);
  assert.equal(updated.scheduleCadence, null);
});

test('insufficient data yields a safe status rather than a failure loop', async () => {
  const members = [member({ status: 'ADDED' })];
  const { service } = buildService({ members });
  const updated = await service.evaluateGrowthLoop({ tenantId: 'tenant-1' }, { campaignId: 'campaign-1' });
  assert.equal(updated.metadata.growthLoopStatus, 'INSUFFICIENT_DATA');
  assert.equal(updated.metadata.growthFailureCode, null);
});

test('recomputation is idempotent: applied recommendations are preserved across recompute', async () => {
  const wonDeals = [deal({ id: 'deal-1', value: 2500, closedAt: now }), deal({ id: 'deal-2', value: 2500, closedAt: now })];
  const members = Array.from({ length: 8 }, (_, index) => member({ id: `m${index}`, status: index < 4 ? 'CONVERTED' : 'CLAIMED', dealId: index === 0 ? 'deal-1' : index === 1 ? 'deal-2' : null }));
  const { service, campaignsRepo } = buildService({ members, deals: wonDeals });

  const first = await service.evaluateGrowthLoop({ tenantId: 'tenant-1' }, { campaignId: 'campaign-1' });
  const scale = first.metadata.growthRecommendations.find((item) => item.type === 'SCALE_CAMPAIGN');
  assert.ok(scale);

  await service.applyGrowthRecommendation({ tenantId: 'tenant-1' }, { campaignId: 'campaign-1', recommendationId: scale.id, actorId: 'user-1' });

  const second = await service.evaluateGrowthLoop({ tenantId: 'tenant-1' }, { campaignId: 'campaign-1' });
  const scaleAfterRecompute = second.metadata.growthRecommendations.find((item) => item.id === scale.id);
  assert.equal(scaleAfterRecompute.status, 'APPLIED');
  assert.equal(scaleAfterRecompute.appliedBy, 'user-1');
  assert.equal(campaignsRepo.campaigns[0].metadata.growthRecomputeCount, 2);
});

test('dismissed recommendations do not reappear when signals are unchanged', async () => {
  const wonDeals = [deal({ id: 'deal-1', value: 2500, closedAt: now }), deal({ id: 'deal-2', value: 2500, closedAt: now })];
  const members = Array.from({ length: 8 }, (_, index) => member({ id: `m${index}`, status: index < 4 ? 'CONVERTED' : 'CLAIMED', dealId: index === 0 ? 'deal-1' : index === 1 ? 'deal-2' : null }));
  const { service } = buildService({ members, deals: wonDeals });

  const first = await service.evaluateGrowthLoop({ tenantId: 'tenant-1' }, { campaignId: 'campaign-1' });
  const scale = first.metadata.growthRecommendations.find((item) => item.type === 'SCALE_CAMPAIGN');

  await service.dismissGrowthRecommendation({ tenantId: 'tenant-1' }, { campaignId: 'campaign-1', recommendationId: scale.id, actorId: 'user-1', reason: 'not now' });
  const second = await service.evaluateGrowthLoop({ tenantId: 'tenant-1' }, { campaignId: 'campaign-1' });
  const afterDismiss = second.metadata.growthRecommendations.find((item) => item.id === scale.id);
  assert.equal(afterDismiss.status, 'DISMISSED');
  assert.equal(afterDismiss.dismissedBy, 'user-1');
});

test('apply growth recommendation delegates targeting change to existing campaign mutation ownership and is auditable', async () => {
  const wonDeals = [deal({ id: 'deal-1', value: 2500, closedAt: now }), deal({ id: 'deal-2', value: 2500, closedAt: now })];
  const members = Array.from({ length: 8 }, (_, index) => member({ id: `m${index}`, status: index < 4 ? 'CONVERTED' : 'CLAIMED', dealId: index === 0 ? 'deal-1' : index === 1 ? 'deal-2' : null }));
  const { service, campaignsRepo, auditLogs } = buildService({ members, deals: wonDeals });

  const evaluated = await service.evaluateGrowthLoop({ tenantId: 'tenant-1' }, { campaignId: 'campaign-1' });
  const scale = evaluated.metadata.growthRecommendations.find((item) => item.type === 'SCALE_CAMPAIGN');
  assert.ok(scale.targetingCandidate);

  const applied = await service.applyGrowthRecommendation({ tenantId: 'tenant-1' }, { campaignId: 'campaign-1', recommendationId: scale.id, actorId: 'user-1' });

  assert.equal(applied.metadata.targeting.executionLimit, scale.targetingCandidate.executionLimit);
  assert.notEqual(applied.metadata.targeting.executionLimit, campaign().metadata.targeting.executionLimit);
  assert.equal(campaignsRepo.campaigns[0].metadata.targeting.executionLimit, scale.targetingCandidate.executionLimit);
  assert.equal(auditLogs.rows.length, 1);
  assert.equal(auditLogs.rows[0].action, 'GROWTH_RECOMMENDATION_APPLIED');
});

test('applying a recommendation twice is rejected (recommendations are not reapplied silently)', async () => {
  const wonDeals = [deal({ id: 'deal-1', value: 2500, closedAt: now }), deal({ id: 'deal-2', value: 2500, closedAt: now })];
  const members = Array.from({ length: 8 }, (_, index) => member({ id: `m${index}`, status: index < 4 ? 'CONVERTED' : 'CLAIMED', dealId: index === 0 ? 'deal-1' : index === 1 ? 'deal-2' : null }));
  const { service } = buildService({ members, deals: wonDeals });
  const evaluated = await service.evaluateGrowthLoop({ tenantId: 'tenant-1' }, { campaignId: 'campaign-1' });
  const scale = evaluated.metadata.growthRecommendations.find((item) => item.type === 'SCALE_CAMPAIGN');
  await service.applyGrowthRecommendation({ tenantId: 'tenant-1' }, { campaignId: 'campaign-1', recommendationId: scale.id, actorId: 'user-1' });
  await assert.rejects(
    service.applyGrowthRecommendation({ tenantId: 'tenant-1' }, { campaignId: 'campaign-1', recommendationId: scale.id, actorId: 'user-2' }),
    /not pending/,
  );
});

test('evaluateGrowthLoop enqueues through a configured growth loop queue instead of computing inline', async () => {
  const calls = [];
  const growthLoopQueue = { async enqueueGrowthLoopEvaluation(input) { calls.push(input); } };
  const { service, campaignsRepo } = buildService({ growthLoopQueue });

  const updated = await service.evaluateGrowthLoop({ tenantId: 'tenant-1' }, { campaignId: 'campaign-1', trigger: 'REVENUE_ATTRIBUTION_COMPLETED' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].campaignId, 'campaign-1');
  assert.equal(calls[0].trigger, 'REVENUE_ATTRIBUTION_COMPLETED');
  assert.equal(updated.metadata.growthLoopStatus, 'QUEUED');
  // Queued path must not have computed a snapshot yet.
  assert.equal(updated.metadata.growthSignalSnapshot, undefined);
  assert.equal(campaignsRepo.campaigns[0].metadata.growthLoopStatus, 'QUEUED');
});

test('executeGrowthLoopEvaluation always computes, regardless of queue configuration', async () => {
  const growthLoopQueue = { async enqueueGrowthLoopEvaluation() { assert.fail('queue should not be used by executeGrowthLoopEvaluation'); } };
  const members = Array.from({ length: 5 }, (_, index) => member({ id: `m${index}`, status: 'CLAIMED' }));
  const { service } = buildService({ members, growthLoopQueue });

  const updated = await service.executeGrowthLoopEvaluation({ tenantId: 'tenant-1' }, { campaignId: 'campaign-1' });
  assert.equal(updated.metadata.growthLoopStatus, 'COMPLETED');
});
