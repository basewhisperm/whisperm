import assert from 'node:assert/strict';
import test from 'node:test';
import { AcquisitionGovernanceService } from '@whisperm/services';

const now = new Date('2026-07-03T12:00:00.000Z');

const tenantStatus = (overrides = {}) => ({
  featureEnabled: true,
  discoveryFeatureEnabled: true,
  planName: 'GROWTH',
  subscriptionStatus: 'ACTIVE',
  ...overrides,
});

class MemoryGovernanceRepository {
  constructor({ status = tenantStatus(), whatsappConfigured = true, discoveryConfigured = true, usage = { discoveryRuns: 0, invitationsSent: 0 } } = {}) {
    this.status = status;
    this.whatsappConfigured = whatsappConfigured;
    this.discoveryConfigured = discoveryConfigured;
    this.usage = usage;
  }
  async getTenantStatus() {
    return this.status;
  }
  async hasActiveProvider(_context, providerKey) {
    return providerKey === 'WHATSAPP' ? this.whatsappConfigured : false;
  }
  async hasActiveDiscoverySource() {
    return this.discoveryConfigured;
  }
  async countUsageSince() {
    return this.usage;
  }
}

class MemoryCampaigns {
  constructor(campaigns = []) {
    this.campaigns = campaigns;
  }
  async findById(context, id) {
    return this.campaigns.find((campaign) => campaign.tenantId === context.tenantId && campaign.id === id) ?? null;
  }
}

class MemoryAuditLogs {
  constructor() {
    this.entries = [];
  }
  async append(context, input) {
    const entry = { id: `audit-${this.entries.length + 1}`, tenantId: context.tenantId, occurredAt: now.toISOString(), ...input };
    this.entries.push(entry);
    return entry;
  }
}

const campaign = (overrides = {}) => ({
  id: 'campaign-1',
  tenantId: 'tenant-1',
  name: 'Lagos Sellers',
  status: 'ACTIVE',
  currency: 'USD',
  metadata: {},
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  ...overrides,
});

const buildService = ({ governanceOptions = {}, campaigns = [campaign()], auditLogs = new MemoryAuditLogs(), sharedInvitationProviderReady } = {}) => {
  const governance = new MemoryGovernanceRepository(governanceOptions);
  const service = new AcquisitionGovernanceService({
    governance,
    campaigns: new MemoryCampaigns(campaigns),
    auditLogs,
    sharedInvitationProviderReady,
    clock: () => now,
  });
  return { service, governance, auditLogs };
};

test('v1 shared WABA readiness supersedes legacy tenant provider rows', async () => {
  const { service } = buildService({
    governanceOptions: { whatsappConfigured: false },
    sharedInvitationProviderReady: (channel) => channel === 'WHATSAPP',
  });
  const snapshot = await service.getGovernanceSnapshot({ tenantId: 'tenant-1' });
  assert.equal(snapshot.capabilities.INVITATION.status, 'AVAILABLE');
  assert.equal(snapshot.warnings.some((warning) => warning.code === 'WHATSAPP_NOT_CONFIGURED'), false);
});

test('feature disabled denies runtime actions', async () => {
  const { service } = buildService({ governanceOptions: { status: tenantStatus({ featureEnabled: false }) } });
  const decision = await service.authorizeAcquisitionAction({ tenantId: 'tenant-1' }, { capability: 'INVITATION', campaignId: 'campaign-1' });
  assert.equal(decision.status, 'DENY');
  assert.equal(decision.reason, 'FEATURE_DISABLED');
});

test('inactive tenant denies runtime actions', async () => {
  const { service } = buildService({ governanceOptions: { status: tenantStatus({ subscriptionStatus: 'CANCELED' }) } });
  const decision = await service.authorizeAcquisitionAction({ tenantId: 'tenant-1' }, { capability: 'DISCOVERY' });
  assert.equal(decision.status, 'DENY');
  assert.equal(decision.reason, 'TENANT_INACTIVE');
});

test('read-only command center is allowed with warnings when a provider is missing', async () => {
  const { service } = buildService({ governanceOptions: { whatsappConfigured: false } });
  const decision = await service.authorizeAcquisitionAction({ tenantId: 'tenant-1' }, { capability: 'COMMAND_CENTER' });
  assert.equal(decision.status, 'ALLOW');
  assert.ok(decision.warnings.some((warning) => warning.code === 'WHATSAPP_NOT_CONFIGURED'));
});

test('runtime health is allowed even when feature-adjacent providers are missing', async () => {
  const { service } = buildService({ governanceOptions: { discoveryConfigured: false } });
  const decision = await service.authorizeAcquisitionAction({ tenantId: 'tenant-1' }, { capability: 'RUNTIME_HEALTH' });
  assert.equal(decision.status, 'ALLOW');
  assert.ok(decision.warnings.some((warning) => warning.code === 'DISCOVERY_SOURCE_NOT_CONFIGURED'));
});

test('missing WhatsApp denies a WhatsApp invitation', async () => {
  const { service } = buildService({ governanceOptions: { whatsappConfigured: false } });
  const decision = await service.authorizeAcquisitionAction({ tenantId: 'tenant-1' }, { capability: 'INVITATION', campaignId: 'campaign-1', provider: 'WHATSAPP' });
  assert.equal(decision.status, 'DENY');
  assert.equal(decision.reason, 'PROVIDER_REQUIRED');
});

test('missing discovery provider denies discovery', async () => {
  const { service } = buildService({ governanceOptions: { discoveryConfigured: false } });
  const decision = await service.authorizeAcquisitionAction({ tenantId: 'tenant-1' }, { capability: 'DISCOVERY', campaignId: 'campaign-1' });
  assert.equal(decision.status, 'DENY');
  assert.equal(decision.reason, 'PROVIDER_REQUIRED');
});

test('missing discovery provider still allows other capabilities with a warning', async () => {
  const { service } = buildService({ governanceOptions: { discoveryConfigured: false } });
  const decision = await service.authorizeAcquisitionAction({ tenantId: 'tenant-1' }, { capability: 'CLAIM', campaignId: 'campaign-1' });
  assert.equal(decision.status, 'ALLOW');
  assert.ok(decision.warnings.some((warning) => warning.code === 'DISCOVERY_SOURCE_NOT_CONFIGURED'));
});

test('monthly quota exceeded denies discovery and invitation', async () => {
  const { service } = buildService({ governanceOptions: { usage: { discoveryRuns: 5000, invitationsSent: 5000 } } });
  const discoveryDecision = await service.authorizeAcquisitionAction({ tenantId: 'tenant-1' }, { capability: 'DISCOVERY', campaignId: 'campaign-1' });
  assert.equal(discoveryDecision.status, 'DENY');
  assert.equal(discoveryDecision.reason, 'MONTHLY_QUOTA_EXCEEDED');
  const invitationDecision = await service.authorizeAcquisitionAction({ tenantId: 'tenant-1' }, { capability: 'INVITATION', campaignId: 'campaign-1' });
  assert.equal(invitationDecision.status, 'DENY');
  assert.equal(invitationDecision.reason, 'MONTHLY_QUOTA_EXCEEDED');
});

test('daily rate limit exceeded denies discovery and invitation', async () => {
  // GROWTH plan monthly limits (2000/3000) are not hit, but the daily limits (300/400) are.
  const { service } = buildService({ governanceOptions: { usage: { discoveryRuns: 350, invitationsSent: 450 } } });
  const discoveryDecision = await service.authorizeAcquisitionAction({ tenantId: 'tenant-1' }, { capability: 'DISCOVERY', campaignId: 'campaign-1' });
  assert.equal(discoveryDecision.status, 'DENY');
  assert.equal(discoveryDecision.reason, 'DAILY_RATE_LIMIT_EXCEEDED');
  const invitationDecision = await service.authorizeAcquisitionAction({ tenantId: 'tenant-1' }, { capability: 'INVITATION', campaignId: 'campaign-1' });
  assert.equal(invitationDecision.status, 'DENY');
  assert.equal(invitationDecision.reason, 'DAILY_RATE_LIMIT_EXCEEDED');
});

test('qualification degrades when rate limited but captured data already exists', async () => {
  const { service } = buildService({ governanceOptions: { usage: { discoveryRuns: 350, invitationsSent: 0 } } });
  const degraded = await service.authorizeAcquisitionAction({ tenantId: 'tenant-1' }, { capability: 'QUALIFICATION', campaignId: 'campaign-1', hasCapturedData: true });
  assert.equal(degraded.status, 'DEGRADE');
  assert.equal(degraded.reason, 'DAILY_RATE_LIMIT_EXCEEDED');

  const denied = await service.authorizeAcquisitionAction({ tenantId: 'tenant-1' }, { capability: 'QUALIFICATION', campaignId: 'campaign-1', hasCapturedData: false });
  assert.equal(denied.status, 'DENY');
  assert.equal(denied.reason, 'DAILY_RATE_LIMIT_EXCEEDED');
});

test('tenant mismatch denies', async () => {
  const { service } = buildService({ campaigns: [campaign({ id: 'campaign-2', tenantId: 'tenant-2' })] });
  const decision = await service.authorizeAcquisitionAction({ tenantId: 'tenant-1' }, { capability: 'INVITATION', campaignId: 'campaign-2' });
  assert.equal(decision.status, 'DENY');
  assert.equal(decision.reason, 'TENANT_MISMATCH');
});

test('campaign not active denies mutation capabilities but does not affect read-only ones', async () => {
  const { service } = buildService({ campaigns: [campaign({ status: 'PAUSED' })] });
  const mutation = await service.authorizeAcquisitionAction({ tenantId: 'tenant-1' }, { capability: 'CRM_CONVERSION', campaignId: 'campaign-1' });
  assert.equal(mutation.status, 'DENY');
  assert.equal(mutation.reason, 'CAMPAIGN_NOT_ACTIVE');

  const readOnly = await service.authorizeAcquisitionAction({ tenantId: 'tenant-1' }, { capability: 'COMMAND_CENTER' });
  assert.equal(readOnly.status, 'ALLOW');
});

test('active tenant within limits allows', async () => {
  const { service } = buildService();
  const decision = await service.authorizeAcquisitionAction({ tenantId: 'tenant-1' }, { capability: 'INVITATION', campaignId: 'campaign-1' });
  assert.equal(decision.status, 'ALLOW');
  assert.equal(decision.reason, null);
});

test('governance snapshot includes capabilities, limits, and warnings', async () => {
  const { service } = buildService({ governanceOptions: { whatsappConfigured: false } });
  const snapshot = await service.getGovernanceSnapshot({ tenantId: 'tenant-1' });
  assert.equal(snapshot.tenantId, 'tenant-1');
  assert.equal(snapshot.featureEnabled, true);
  assert.equal(snapshot.planName, 'GROWTH');
  assert.ok(snapshot.capabilities.DISCOVERY);
  assert.ok(snapshot.capabilities.INVITATION);
  assert.ok(snapshot.capabilities.COMMAND_CENTER);
  assert.equal(snapshot.capabilities.INVITATION.status, 'BLOCKED');
  assert.equal(snapshot.limits.length, 4);
  assert.ok(snapshot.warnings.some((warning) => warning.code === 'WHATSAPP_NOT_CONFIGURED'));
});

test('governance snapshot reports DISABLED overall status when the feature flag is off', async () => {
  const { service } = buildService({ governanceOptions: { status: tenantStatus({ featureEnabled: false }) } });
  const snapshot = await service.getGovernanceSnapshot({ tenantId: 'tenant-1' });
  assert.equal(snapshot.overallStatus, 'DISABLED');
  assert.ok(Object.values(snapshot.capabilities).every((capability) => capability.status === 'BLOCKED'));
});

test('governance snapshot reports ACTION_REQUIRED when a provider is missing', async () => {
  const { service } = buildService({ governanceOptions: { whatsappConfigured: false } });
  const snapshot = await service.getGovernanceSnapshot({ tenantId: 'tenant-1' });
  assert.equal(snapshot.overallStatus, 'ACTION_REQUIRED');
});

test('governance snapshot reports DEGRADED when only the daily limit is reached', async () => {
  const { service } = buildService({ governanceOptions: { usage: { discoveryRuns: 350, invitationsSent: 0 } } });
  const snapshot = await service.getGovernanceSnapshot({ tenantId: 'tenant-1' });
  assert.equal(snapshot.overallStatus, 'DEGRADED');
});

test('governance snapshot reports ACTIVE when everything is healthy', async () => {
  const { service } = buildService();
  const snapshot = await service.getGovernanceSnapshot({ tenantId: 'tenant-1' });
  assert.equal(snapshot.overallStatus, 'ACTIVE');
  assert.equal(snapshot.warnings.length, 0);
});

test('no secrets appear in the snapshot', async () => {
  const { service } = buildService({ governanceOptions: { whatsappConfigured: false, usage: { discoveryRuns: 350, invitationsSent: 450 } } });
  const snapshot = await service.getGovernanceSnapshot({ tenantId: 'tenant-1' });
  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /(secret|password|apiKey|api_key|token|stripeCustomerId|stripeSubscriptionId|providerKey)/iu);
});

test('DENY decisions produce an auditable event and are written to the audit log', async () => {
  const { service, auditLogs } = buildService({ governanceOptions: { whatsappConfigured: false } });
  const decision = await service.authorizeAcquisitionAction({ tenantId: 'tenant-1' }, { capability: 'INVITATION', campaignId: 'campaign-1', actorId: 'user-1' });
  assert.equal(decision.status, 'DENY');
  assert.equal(decision.auditEvent.status, 'DENY');
  assert.equal(decision.auditEvent.reason, 'PROVIDER_REQUIRED');
  assert.equal(decision.auditEvent.persisted, true);
  assert.equal(auditLogs.entries.length, 1);
  assert.equal(auditLogs.entries[0].tenantId, 'tenant-1');
  assert.equal(auditLogs.entries[0].targetType, 'ACQUISITION_GOVERNANCE');
  assert.equal(auditLogs.entries[0].metadata.capability, 'INVITATION');
});

test('DEGRADE decisions are also written to the audit log', async () => {
  const { service, auditLogs } = buildService({ governanceOptions: { usage: { discoveryRuns: 350, invitationsSent: 0 } } });
  const decision = await service.authorizeAcquisitionAction({ tenantId: 'tenant-1' }, { capability: 'QUALIFICATION', campaignId: 'campaign-1', hasCapturedData: true });
  assert.equal(decision.status, 'DEGRADE');
  assert.equal(auditLogs.entries.length, 1);
  assert.equal(auditLogs.entries[0].metadata.status, 'DEGRADE');
});

test('ALLOW decisions do not write to the audit log', async () => {
  const { service, auditLogs } = buildService();
  await service.authorizeAcquisitionAction({ tenantId: 'tenant-1' }, { capability: 'INVITATION', campaignId: 'campaign-1' });
  assert.equal(auditLogs.entries.length, 0);
});

test('tenant isolation: a campaign from another tenant never authorizes an action', async () => {
  const { service } = buildService({ campaigns: [campaign({ id: 'campaign-1', tenantId: 'tenant-2' })] });
  const decision = await service.authorizeAcquisitionAction({ tenantId: 'tenant-1' }, { capability: 'DISCOVERY', campaignId: 'campaign-1' });
  assert.equal(decision.status, 'DENY');
  assert.equal(decision.reason, 'TENANT_MISMATCH');
});
