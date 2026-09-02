import assert from 'node:assert/strict';
import test from 'node:test';
import { AcquisitionRuntimeHealthService } from '@whisperm/services';

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

const execution = (overrides = {}) => ({
  id: `execution-${Math.random()}`,
  tenantId: 'tenant-1',
  campaignId: 'campaign-1',
  status: 'COMPLETED',
  trigger: 'MANUAL',
  startedAt: now,
  completedAt: now,
  failedAt: null,
  errorCode: null,
  errorMessage: null,
  metrics: {},
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
  metadata: {},
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const claimToken = (overrides = {}) => ({
  id: `token-${Math.random()}`,
  tenantId: 'tenant-1',
  marketplaceCaptureId: 'capture-1',
  tokenHash: 'hash-1',
  status: 'SENT',
  expiresAt: now,
  claimedAt: null,
  expiredAt: null,
  metadata: {},
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const capture = (overrides = {}) => ({
  id: `capture-${Math.random()}`,
  tenantId: 'tenant-1',
  listingUrl: 'https://marketplace.test/listing',
  title: 'Listing',
  status: 'CLAIMED',
  capturedAt: now,
  metadata: {},
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

class MemoryCampaigns {
  constructor(campaigns = [], members = []) {
    this.campaigns = campaigns;
    this.members = members;
  }
  async list(context) {
    return { items: this.campaigns.filter((row) => row.tenantId === context.tenantId) };
  }
  async listMembers(context, campaignId) {
    return { items: this.members.filter((row) => row.tenantId === context.tenantId && row.campaignId === campaignId) };
  }
}

class MemoryExecutions {
  constructor(executions = []) {
    this.executions = executions;
  }
  async listByCampaignId(context, campaignId) {
    return { items: this.executions.filter((row) => row.tenantId === context.tenantId && row.campaignId === campaignId) };
  }
}

class MemoryDeals {
  constructor(deals = []) {
    this.deals = deals;
  }
  async findById(tenantId, dealId) {
    return this.deals.find((row) => row.tenantId === tenantId && row.id === dealId) ?? null;
  }
}

class MemoryClaimTokens {
  constructor(tokens = []) {
    this.tokens = tokens;
  }
  async listClaimTokensByMarketplaceCaptureIds(context, ids) {
    return this.tokens.filter((row) => row.tenantId === context.tenantId && ids.includes(row.marketplaceCaptureId));
  }
}

class MemoryCaptures {
  constructor(captures = []) {
    this.captures = captures;
  }
  async findByIds(context, ids) {
    return this.captures.filter((row) => row.tenantId === context.tenantId && ids.includes(row.id));
  }
}

const buildService = ({ campaigns = [campaign()], members = [], executions = [], deals = [], claimTokens = [], captures = [], sharedInvitationProviderReady } = {}) => new AcquisitionRuntimeHealthService({
  campaigns: new MemoryCampaigns(campaigns, members),
  executions: new MemoryExecutions(executions),
  deals: new MemoryDeals(deals),
  claimTokens: new MemoryClaimTokens(claimTokens),
  marketplaceCaptures: new MemoryCaptures(captures),
  sharedInvitationProviderReady,
  clock: () => new Date(now),
});

test('v1 shared provider readiness supersedes missing campaign provider metadata', async () => {
  const service = buildService({
    campaigns: [campaign({ metadata: { invitationChannels: ['WHATSAPP'] } })],
    sharedInvitationProviderReady: (channel) => channel === 'WHATSAPP',
  });
  const snapshot = await service.getRuntimeHealth({ tenantId: 'tenant-1' });
  const whatsapp = snapshot.providers.find((provider) => provider.provider === 'WHATSAPP');
  assert.equal(whatsapp.configured, true);
  assert.equal(whatsapp.status, 'HEALTHY');
});

test('no campaigns/no runtime data returns UNKNOWN with a useful NO_ACTION recommendation', async () => {
  const service = buildService({ campaigns: [] });
  const snapshot = await service.getRuntimeHealth({ tenantId: 'tenant-1' });
  assert.equal(snapshot.overallStatus, 'UNKNOWN');
  assert.ok(snapshot.units.every((unit) => unit.status === 'UNKNOWN'));
  assert.ok(snapshot.providers.every((provider) => provider.status === 'UNKNOWN'));
  assert.equal(snapshot.recommendedOperationsActions.length, 1);
  assert.equal(snapshot.recommendedOperationsActions[0].actionType, 'NO_ACTION');
  assert.match(snapshot.recommendedOperationsActions[0].description, /No seller acquisition campaign exists yet/u);
});

test('healthy recent executions across the funnel return HEALTHY', async () => {
  const campaigns = [campaign({ metadata: { invitationProviders: { WHATSAPP: 'provider-key' } } })];
  const executions = [
    execution({ metrics: { discoveryStatus: 'COMPLETED', discoveryCompletedAt: now } }),
    execution({ metrics: { qualificationStatus: 'COMPLETED', qualificationCompletedAt: now } }),
    execution({ metrics: { invitationExecutionState: 'DELIVERED', deliveredAt: now, channel: 'WHATSAPP' } }),
  ];
  const service = buildService({ campaigns, executions });
  const snapshot = await service.getRuntimeHealth({ tenantId: 'tenant-1' });
  assert.equal(snapshot.overallStatus, 'HEALTHY');
  const discovery = snapshot.units.find((unit) => unit.unit === 'DISCOVERY');
  assert.equal(discovery.status, 'HEALTHY');
  assert.equal(discovery.lastSuccessfulRunAt, now);
  const whatsapp = snapshot.providers.find((provider) => provider.provider === 'WHATSAPP');
  assert.equal(whatsapp.status, 'HEALTHY');
  assert.equal(whatsapp.configured, true);
});

test('a retryable failed invitation returns DEGRADED with a retry backlog', async () => {
  const executions = [
    execution({ metrics: { invitationExecutionState: 'RETRY_SCHEDULED', lastAttemptAt: now, channel: 'WHATSAPP' } }),
  ];
  const campaigns = [campaign({ metadata: { invitationProviders: { WHATSAPP: 'provider-key' } } })];
  const service = buildService({ campaigns, executions });
  const snapshot = await service.getRuntimeHealth({ tenantId: 'tenant-1' });
  const invitation = snapshot.units.find((unit) => unit.unit === 'INVITATION');
  assert.equal(invitation.status, 'DEGRADED');
  assert.equal(invitation.retryBacklog, 1);
  assert.equal(invitation.deadLetterCount, 0);
  assert.equal(snapshot.overallStatus, 'DEGRADED');
  assert.equal(snapshot.retryBacklog, 1);
});

test('a dead-lettered invitation failure returns ACTION_REQUIRED', async () => {
  const executions = [
    execution({ metrics: { invitationExecutionState: 'DEAD_LETTERED', deadLetteredAt: now, channel: 'WHATSAPP' } }),
  ];
  const campaigns = [campaign({ metadata: { invitationProviders: { WHATSAPP: 'provider-key' } } })];
  const service = buildService({ campaigns, executions });
  const snapshot = await service.getRuntimeHealth({ tenantId: 'tenant-1' });
  const invitation = snapshot.units.find((unit) => unit.unit === 'INVITATION');
  assert.equal(invitation.status, 'ACTION_REQUIRED');
  assert.equal(invitation.deadLetterCount, 1);
  assert.equal(snapshot.overallStatus, 'ACTION_REQUIRED');
  assert.equal(snapshot.deadLetterCount, 1);
  assert.ok(snapshot.recommendedOperationsActions.some((action) => action.actionType === 'REVIEW_DEAD_LETTER'));
  assert.ok(snapshot.failures.some((failure) => failure.unit === 'INVITATION' && failure.severity === 'CRITICAL'));
});

test('missing WhatsApp config for an active campaign that depends on it returns ACTION_REQUIRED', async () => {
  const campaigns = [campaign({ metadata: {} })];
  const service = buildService({ campaigns });
  const snapshot = await service.getRuntimeHealth({ tenantId: 'tenant-1' });
  const whatsapp = snapshot.providers.find((provider) => provider.provider === 'WHATSAPP');
  assert.equal(whatsapp.status, 'ACTION_REQUIRED');
  assert.equal(whatsapp.configured, false);
  assert.equal(snapshot.overallStatus, 'ACTION_REQUIRED');
  assert.ok(snapshot.recommendedOperationsActions.some((action) => action.actionType === 'CONFIGURE_PROVIDER'));
});

test('a stale successful run returns DEGRADED', async () => {
  const staleTimestamp = '2026-06-01T00:00:00.000Z';
  const executions = [
    execution({ metrics: { discoveryStatus: 'COMPLETED', discoveryCompletedAt: staleTimestamp } }),
  ];
  const campaigns = [campaign({ metadata: { invitationProviders: { WHATSAPP: 'provider-key' } } })];
  const service = buildService({ campaigns, executions });
  const snapshot = await service.getRuntimeHealth({ tenantId: 'tenant-1' });
  const discovery = snapshot.units.find((unit) => unit.unit === 'DISCOVERY');
  assert.equal(discovery.status, 'DEGRADED');
  assert.equal(discovery.lastSuccessfulRunAt, staleTimestamp);
  assert.equal(snapshot.overallStatus, 'DEGRADED');
});

test('a critically failed revenue attribution returns ACTION_REQUIRED', async () => {
  const members = [member({ dealId: 'deal-1', status: 'CONVERTED' })];
  const deals = [deal({ id: 'deal-1', metadata: { revenueAttribution: { attributionStatus: 'ATTRIBUTION_FAILED', evaluatedAt: now } } })];
  const campaigns = [campaign({ metadata: { invitationProviders: { WHATSAPP: 'provider-key' } } })];
  const service = buildService({ campaigns, members, deals });
  const snapshot = await service.getRuntimeHealth({ tenantId: 'tenant-1' });
  const revenueAttribution = snapshot.units.find((unit) => unit.unit === 'REVENUE_ATTRIBUTION');
  assert.equal(revenueAttribution.status, 'ACTION_REQUIRED');
  assert.equal(revenueAttribution.failureCount, 1);
  assert.equal(snapshot.overallStatus, 'ACTION_REQUIRED');
});

test('a critically failed growth loop returns ACTION_REQUIRED', async () => {
  const campaigns = [campaign({
    metadata: {
      invitationProviders: { WHATSAPP: 'provider-key' },
      growthLoopStatus: 'FAILED',
      growthLoopFailedAt: now,
    },
  })];
  const service = buildService({ campaigns });
  const snapshot = await service.getRuntimeHealth({ tenantId: 'tenant-1' });
  const growthLoop = snapshot.units.find((unit) => unit.unit === 'GROWTH_LOOP');
  assert.equal(growthLoop.status, 'ACTION_REQUIRED');
  assert.equal(snapshot.overallStatus, 'ACTION_REQUIRED');
});

test('tenant isolation: another tenant\'s campaigns, executions, and deals never surface in the snapshot', async () => {
  const campaigns = [
    campaign({ id: 'campaign-1', tenantId: 'tenant-1', metadata: { invitationProviders: { WHATSAPP: 'key' } } }),
    campaign({ id: 'campaign-2', tenantId: 'tenant-2', metadata: { growthLoopStatus: 'FAILED', growthLoopFailedAt: now } }),
  ];
  const executions = [
    execution({ id: 'exec-2', tenantId: 'tenant-2', campaignId: 'campaign-2', metrics: { invitationExecutionState: 'DEAD_LETTERED', deadLetteredAt: now } }),
  ];
  const members = [member({ tenantId: 'tenant-2', campaignId: 'campaign-2', dealId: 'deal-2' })];
  const deals = [deal({ id: 'deal-2', tenantId: 'tenant-2', metadata: { revenueAttribution: { attributionStatus: 'ATTRIBUTION_FAILED', evaluatedAt: now } } })];
  const service = buildService({ campaigns, executions, members, deals });
  const snapshot = await service.getRuntimeHealth({ tenantId: 'tenant-1' });
  assert.equal(snapshot.overallStatus, 'HEALTHY');
  assert.equal(snapshot.deadLetterCount, 0);
  const growthLoop = snapshot.units.find((unit) => unit.unit === 'GROWTH_LOOP');
  assert.equal(growthLoop.status, 'HEALTHY');
  const invitation = snapshot.units.find((unit) => unit.unit === 'INVITATION');
  assert.equal(invitation.deadLetterCount, 0);
  const revenueAttribution = snapshot.units.find((unit) => unit.unit === 'REVENUE_ATTRIBUTION');
  assert.equal(revenueAttribution.failureCount, 0);
});

test('claim token expiry without config-level provider failure only affects the CLAIM unit', async () => {
  const members = [member({ status: 'INVITED', marketplaceCaptureId: 'capture-1' })];
  const claimTokens = [claimToken({ marketplaceCaptureId: 'capture-1', status: 'EXPIRED', expiredAt: now })];
  const campaigns = [campaign({ metadata: { invitationProviders: { WHATSAPP: 'provider-key' } } })];
  const service = buildService({ campaigns, members, claimTokens });
  const snapshot = await service.getRuntimeHealth({ tenantId: 'tenant-1' });
  const claim = snapshot.units.find((unit) => unit.unit === 'CLAIM');
  assert.equal(claim.failureCount, 1);
  assert.equal(claim.deadLetterCount, 0);
});

test('a CRM conversion needing manual review is a dead letter and returns ACTION_REQUIRED', async () => {
  const members = [member({ status: 'CLAIMED', marketplaceCaptureId: 'capture-1' })];
  const captures = [capture({ id: 'capture-1', metadata: { crmConversionStatus: 'NEEDS_MANUAL_REVIEW', crmConversionFailedAt: now } })];
  const campaigns = [campaign({ metadata: { invitationProviders: { WHATSAPP: 'provider-key' } } })];
  const service = buildService({ campaigns, members, captures });
  const snapshot = await service.getRuntimeHealth({ tenantId: 'tenant-1' });
  const crmConversion = snapshot.units.find((unit) => unit.unit === 'CRM_CONVERSION');
  assert.equal(crmConversion.status, 'ACTION_REQUIRED');
  assert.equal(crmConversion.deadLetterCount, 1);
  assert.equal(snapshot.overallStatus, 'ACTION_REQUIRED');
});
