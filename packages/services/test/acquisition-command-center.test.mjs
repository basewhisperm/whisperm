import assert from 'node:assert/strict';
import test from 'node:test';
import { AcquisitionCommandCenterService } from '@whisperm/services';

const now = '2026-07-03T00:00:00.000Z';

const campaign = (overrides = {}) => ({
  id: 'campaign-1',
  tenantId: 'tenant-1',
  name: 'Lagos Sellers',
  status: 'ACTIVE',
  currency: 'USD',
  metadata: {},
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const member = (overrides = {}) => ({
  id: `member-${Math.random()}`,
  tenantId: 'tenant-1',
  campaignId: 'campaign-1',
  marketplaceCaptureId: `capture-${Math.random()}`,
  status: 'ADDED',
  dealId: null,
  assignedAt: now,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const deal = (overrides = {}) => ({
  id: `deal-${Math.random()}`,
  tenantId: 'tenant-1',
  title: 'Deal',
  pipelineStageId: 'stage-1',
  currency: 'USD',
  value: null,
  closedAt: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

class MemoryCampaigns {
  constructor(campaigns, members = []) { this.campaigns = campaigns; this.members = members; }
  async list(context) { return { items: this.campaigns.filter((row) => row.tenantId === context.tenantId) }; }
  async findById(context, id) { return this.campaigns.find((row) => row.tenantId === context.tenantId && row.id === id) ?? null; }
  async listMembers(context, campaignId) {
    return { items: this.members.filter((row) => row.tenantId === context.tenantId && row.campaignId === campaignId) };
  }
}

class MemoryExecutions {
  constructor(executions = []) { this.executions = executions; }
  async listByCampaignId(context, campaignId) {
    return { items: this.executions.filter((row) => row.tenantId === context.tenantId && row.campaignId === campaignId) };
  }
}

class MemoryDeals {
  constructor(deals = []) { this.deals = deals; }
  async findById(tenantId, dealId) { return this.deals.find((row) => row.tenantId === tenantId && row.id === dealId) ?? null; }
}

class MemoryClaimTokens {
  constructor(tokensByCapture = {}) { this.tokensByCapture = tokensByCapture; }
  async listClaimTokensByMarketplaceCaptureId(_context, captureId) { return this.tokensByCapture[captureId] ?? []; }
}

const buildService = ({ campaigns = [campaign()], members = [], executions = [], deals = [], claimTokens = {} } = {}) => new AcquisitionCommandCenterService({
  campaigns: new MemoryCampaigns(campaigns, members),
  executions: new MemoryExecutions(executions),
  deals: new MemoryDeals(deals),
  claimTokens: new MemoryClaimTokens(claimTokens),
  clock: () => new Date(now),
});

test('empty campaign state returns a zeroed snapshot with a NO_ACTIVE_CAMPAIGN warning', async () => {
  const service = buildService({ campaigns: [] });
  const snapshot = await service.getSnapshot({ tenantId: 'tenant-1' });
  assert.equal(snapshot.campaignId, '');
  assert.equal(snapshot.status, 'NO_CAMPAIGN');
  assert.deepEqual(snapshot.funnel, { discovered: 0, qualified: 0, invited: 0, claimed: 0, crmConverted: 0, dealsCreated: 0, revenueAttributed: 0 });
  assert.equal(snapshot.readinessWarnings.length, 1);
  assert.equal(snapshot.readinessWarnings[0].code, 'NO_ACTIVE_CAMPAIGN');
});

test('active campaign with discovered sellers reflects member counts in the funnel', async () => {
  const members = [member({ status: 'ADDED' }), member({ status: 'ADDED' }), member({ status: 'ADDED' })];
  const service = buildService({ members });
  const snapshot = await service.getSnapshot({ tenantId: 'tenant-1' });
  assert.equal(snapshot.campaignId, 'campaign-1');
  assert.equal(snapshot.funnel.discovered, 3);
  assert.equal(snapshot.funnel.qualified, 0);
});

test('qualified sellers advance the qualified funnel stage', async () => {
  const members = [member({ status: 'QUALIFIED' }), member({ status: 'ADDED' })];
  const service = buildService({ members });
  const snapshot = await service.getSnapshot({ tenantId: 'tenant-1' });
  assert.equal(snapshot.funnel.discovered, 2);
  assert.equal(snapshot.funnel.qualified, 1);
  assert.equal(snapshot.funnel.invited, 0);
});

test('invited sellers advance the invited funnel stage', async () => {
  const members = [member({ status: 'INVITED' })];
  const service = buildService({ members });
  const snapshot = await service.getSnapshot({ tenantId: 'tenant-1' });
  assert.equal(snapshot.funnel.qualified, 1);
  assert.equal(snapshot.funnel.invited, 1);
  assert.equal(snapshot.funnel.claimed, 0);
});

test('claimed sellers advance the claimed funnel stage', async () => {
  const members = [member({ status: 'CLAIMED', marketplaceCaptureId: 'capture-1' })];
  const service = buildService({ members, claimTokens: { 'capture-1': [{ id: 'token-1' }] } });
  const snapshot = await service.getSnapshot({ tenantId: 'tenant-1' });
  assert.equal(snapshot.funnel.invited, 1);
  assert.equal(snapshot.funnel.claimed, 1);
  assert.equal(snapshot.funnel.crmConverted, 0);
});

test('CRM converted sellers advance the crmConverted funnel stage', async () => {
  const members = [member({ status: 'CONVERTED', contactId: 'contact-1', dealId: 'deal-1' })];
  const deals = [deal({ id: 'deal-1' })];
  const service = buildService({ members, deals });
  const snapshot = await service.getSnapshot({ tenantId: 'tenant-1' });
  assert.equal(snapshot.funnel.crmConverted, 1);
  assert.equal(snapshot.funnel.dealsCreated, 1);
});

test('crmConverted follows the canonical Contact+Deal signal, not the pipeline status label', async () => {
  const members = [
    member({ status: 'ADDED', contactId: 'contact-1', dealId: 'deal-1' }),
    member({ status: 'CONVERTED', dealId: null }),
  ];
  const deals = [deal({ id: 'deal-1' })];
  const service = buildService({ members, deals });
  const snapshot = await service.getSnapshot({ tenantId: 'tenant-1' });
  assert.equal(snapshot.funnel.crmConverted, 1, 'a Contact+Deal pair counts as converted even at status ADDED');
});

test('deals with revenue attribution feed revenue and the final funnel stage', async () => {
  const members = [
    member({ status: 'CONVERTED', dealId: 'deal-won' }),
    member({ status: 'CONVERTED', dealId: 'deal-open' }),
  ];
  const deals = [
    deal({ id: 'deal-won', value: '500.00', closedAt: now }),
    deal({ id: 'deal-open', value: '200.00', closedAt: null }),
  ];
  const service = buildService({ members, deals });
  const snapshot = await service.getSnapshot({ tenantId: 'tenant-1' });
  assert.equal(snapshot.funnel.dealsCreated, 2);
  assert.equal(snapshot.funnel.revenueAttributed, 1);
  assert.equal(snapshot.revenue.attributedRevenue, 500);
  assert.equal(snapshot.revenue.pipelineValue, 200);
  assert.equal(snapshot.revenue.currency, 'USD');
});

test('a pending growth recommendation surfaces in growthRecommendations and topActions', async () => {
  const members = [member({ status: 'QUALIFIED' }), member({ status: 'QUALIFIED' }), member({ status: 'QUALIFIED' })];
  const campaigns = [campaign({
    metadata: {
      growthRecommendations: [
        { id: 'campaign-1:SCALE_CAMPAIGN', type: 'SCALE_CAMPAIGN', reason: 'Revenue is strong', severity: 'ACTIONABLE', confidence: 'HIGH', supportingMetrics: {}, campaignId: 'campaign-1', createdAt: now, status: 'PENDING' },
      ],
    },
  })];
  const service = buildService({ campaigns, members });
  const snapshot = await service.getSnapshot({ tenantId: 'tenant-1' });
  assert.equal(snapshot.growthRecommendations.length, 1);
  const action = snapshot.topActions.find((item) => item.type === 'APPLY_GROWTH_RECOMMENDATION');
  assert.ok(action, 'expected an apply-recommendation top action');
  assert.equal(action.severity, 'ACTIONABLE');
});

test('a pending PAUSE_LOW_ROI_SOURCE recommendation becomes a PAUSE_POOR_SOURCE action', async () => {
  const campaigns = [campaign({
    metadata: {
      growthRecommendations: [
        { id: 'campaign-1:PAUSE_LOW_ROI_SOURCE', type: 'PAUSE_LOW_ROI_SOURCE', reason: 'No revenue from this source', severity: 'WARNING', confidence: 'MEDIUM', supportingMetrics: {}, campaignId: 'campaign-1', createdAt: now, status: 'PENDING' },
      ],
    },
  })];
  const service = buildService({ campaigns });
  const snapshot = await service.getSnapshot({ tenantId: 'tenant-1' });
  assert.ok(snapshot.topActions.some((item) => item.type === 'PAUSE_POOR_SOURCE'));
});

test('readiness warnings flag failed worker jobs, missing claim URLs, and stale growth loops', async () => {
  const members = [member({ status: 'INVITED', marketplaceCaptureId: 'capture-no-token' })];
  const executions = [{ id: 'execution-1', tenantId: 'tenant-1', campaignId: 'campaign-1', status: 'FAILED', metrics: {} }];
  const campaigns = [campaign({ metadata: { growthLoopStatus: 'COMPLETED', lastGrowthEvaluatedAt: '2026-06-01T00:00:00.000Z' } })];
  const service = buildService({ campaigns, members, executions, claimTokens: {} });
  const snapshot = await service.getSnapshot({ tenantId: 'tenant-1' });
  const codes = snapshot.readinessWarnings.map((warning) => warning.code);
  assert.ok(codes.includes('FAILED_WORKER_JOBS'));
  assert.ok(codes.includes('NO_CLAIM_URL_CONFIGURED'));
  assert.ok(codes.includes('STALE_GROWTH_LOOP'));
  assert.ok(codes.includes('MISSING_WHATSAPP_PROVIDER'));
});

test('a paused campaign is flagged with a NO_ACTIVE_CAMPAIGN warning even though it exists', async () => {
  const campaigns = [campaign({ status: 'PAUSED' })];
  const service = buildService({ campaigns });
  const snapshot = await service.getSnapshot({ tenantId: 'tenant-1' });
  assert.equal(snapshot.status, 'PAUSED');
  assert.ok(snapshot.readinessWarnings.some((warning) => warning.code === 'NO_ACTIVE_CAMPAIGN'));
});

test('tenant isolation: another tenant\'s campaigns and members never surface in the snapshot', async () => {
  const campaigns = [campaign({ id: 'campaign-1', tenantId: 'tenant-1' }), campaign({ id: 'campaign-2', tenantId: 'tenant-2', name: 'Other tenant campaign' })];
  const members = [member({ campaignId: 'campaign-2', tenantId: 'tenant-2', status: 'CONVERTED', contactId: 'contact-other', dealId: 'deal-other' })];
  const service = buildService({ campaigns, members });
  const snapshot = await service.getSnapshot({ tenantId: 'tenant-1' });
  assert.equal(snapshot.campaignId, 'campaign-1');
  assert.equal(snapshot.funnel.crmConverted, 0);
});

test('tenant isolation: requesting another tenant\'s campaignId explicitly is rejected', async () => {
  const campaigns = [campaign({ id: 'campaign-2', tenantId: 'tenant-2' })];
  const service = buildService({ campaigns });
  await assert.rejects(
    service.getSnapshot({ tenantId: 'tenant-1' }, { campaignId: 'campaign-2' }),
    /Seller acquisition campaign not found/,
  );
});

test('an explicit campaignId targets that campaign directly', async () => {
  const campaigns = [campaign({ id: 'campaign-1' }), campaign({ id: 'campaign-2', name: 'Second campaign' })];
  const members = [member({ campaignId: 'campaign-2', status: 'CLAIMED', marketplaceCaptureId: 'capture-9' })];
  const service = buildService({ campaigns, members, claimTokens: { 'capture-9': [{ id: 'token-1' }] } });
  const snapshot = await service.getSnapshot({ tenantId: 'tenant-1' }, { campaignId: 'campaign-2' });
  assert.equal(snapshot.campaignId, 'campaign-2');
  assert.equal(snapshot.funnel.claimed, 1);
});
