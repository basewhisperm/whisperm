import assert from 'node:assert/strict';
import test from 'node:test';
import { CampaignRuntimeService } from '@whisperm/services';

const now = '2026-06-30T00:00:00.000Z';
const campaign = (overrides = {}) => ({ id: 'campaign-1', tenantId: 'tenant-1', name: 'Growth', status: 'ACTIVE', metadata: { strategy: { category: 'bikes' }, targeting: { marketplaceSourceKey: 'JIJI', keyword: 'bikes', executionLimit: 25 } }, createdAt: now, updatedAt: now, ...overrides });

class MemoryCampaigns {
  constructor(campaigns) { this.campaigns = campaigns; }
  async findById(context, id) { return this.campaigns.find((row) => row.tenantId === context.tenantId && row.id === id) ?? null; }
  async listDueScheduled(context, dueNow) { return { items: this.campaigns.filter((row) => row.tenantId === context.tenantId && row.status === 'ACTIVE' && row.scheduleEnabled === true && row.nextRunAt && row.nextRunAt <= dueNow) }; }
  async update(context, id, input) {
    const row = await this.findById(context, id);
    assert.ok(row);
    Object.assign(row, input, { updatedAt: now });
    return row;
  }
}

class MemoryExecutions {
  rows = [];
  next = 1;
  async create(context, input) {
    assert.equal(input.tenantId, context.tenantId);
    const row = { id: `execution-${this.next++}`, tenantId: context.tenantId, status: 'QUEUED', metrics: {}, createdAt: now, updatedAt: now, ...input };
    this.rows.push(row);
    return row;
  }
  async findById(context, id) { return this.rows.find((row) => row.tenantId === context.tenantId && row.id === id) ?? null; }
  async findActiveByCampaignId(context, campaignId) { return this.rows.find((row) => row.tenantId === context.tenantId && row.campaignId === campaignId && ['QUEUED', 'RUNNING'].includes(row.status)) ?? null; }
  async listByCampaignId(context, campaignId) { return { items: this.rows.filter((row) => row.tenantId === context.tenantId && row.campaignId === campaignId) }; }
  async update(context, id, input) {
    const index = this.rows.findIndex((row) => row.tenantId === context.tenantId && row.id === id);
    assert.notEqual(index, -1);
    this.rows[index] = { ...this.rows[index], ...input, updatedAt: now };
    return this.rows[index];
  }
}

const makeService = ({ campaigns = [campaign()], executions = new MemoryExecutions(), worker } = {}) => ({
  service: new CampaignRuntimeService({ campaigns: new MemoryCampaigns(campaigns), executions, worker }),
  executions,
  campaigns,
});

test('tenant-owned Campaign can start execution', async () => {
  const { service } = makeService();
  const execution = await service.startCampaignExecution({ tenantId: 'tenant-1' }, { campaignId: 'campaign-1' });
  assert.equal(execution.campaignId, 'campaign-1');
  assert.equal(execution.tenantId, 'tenant-1');
  assert.equal(execution.trigger, 'MANUAL');
});

test('Campaign outside tenant is blocked', async () => {
  const { service } = makeService({ campaigns: [campaign({ tenantId: 'tenant-2' })] });
  await assert.rejects(
    service.startCampaignExecution({ tenantId: 'tenant-1' }, { campaignId: 'campaign-1' }),
    /Seller acquisition campaign not found/,
  );
});

test('ST1-012: startCampaignExecution fails safely when no discovery queue or worker is configured', async () => {
  const { service } = makeService();
  const execution = await service.startCampaignExecution({ tenantId: 'tenant-1' }, { campaignId: 'campaign-1' });
  assert.equal(execution.status, 'FAILED');
  assert.equal(execution.errorCode, 'CAMPAIGN_RUNTIME_DISCOVERY_NOT_CONFIGURED');
  assert.ok(execution.failedAt);
  assert.equal(execution.metrics.discoveryStatus, 'UNSUPPORTED');
});

test('failed worker records FAILED with sanitized error', async () => {
  const worker = { type: 'failing', async execute() { throw new Error('upstream failed token=super-secret password=hunter2'); } };
  const { service } = makeService({ worker });
  const execution = await service.startCampaignExecution({ tenantId: 'tenant-1' }, { campaignId: 'campaign-1' });
  assert.equal(execution.status, 'FAILED');
  assert.equal(execution.errorCode, 'CAMPAIGN_RUNTIME_WORKER_FAILED');
  assert.match(execution.errorMessage, /token=\[REDACTED\]/);
  assert.match(execution.errorMessage, /password=\[REDACTED\]/);
  assert.doesNotMatch(execution.errorMessage, /super-secret|hunter2/);
});

test('existing active execution prevents duplicate active execution', async () => {
  const executions = new MemoryExecutions();
  await executions.create({ tenantId: 'tenant-1' }, { tenantId: 'tenant-1', campaignId: 'campaign-1', trigger: 'MANUAL', status: 'RUNNING' });
  const { service } = makeService({ executions });
  await assert.rejects(
    service.startCampaignExecution({ tenantId: 'tenant-1' }, { campaignId: 'campaign-1' }),
    /already active/,
  );
});

test('Campaign strategy is not modified by runtime execution', async () => {
  const source = campaign({ metadata: { strategy: { category: 'bikes' }, targeting: { marketplaceSourceKey: 'JIJI', keyword: 'bikes', executionLimit: 25 } } });
  const before = JSON.stringify(source);
  const { service } = makeService({ campaigns: [source] });
  await service.startCampaignExecution({ tenantId: 'tenant-1' }, { campaignId: 'campaign-1' });
  assert.equal(JSON.stringify(source), before);
});

test('executeInvitation persists dispatch state and enqueues worker command', async () => {
  const calls = [];
  const runtime = new CampaignRuntimeService({
    campaigns: new MemoryCampaigns([campaign()]),
    executions: new MemoryExecutions(),
    invitationQueue: { async enqueueInvitation(input) { calls.push(input); } },
  });
  const execution = await runtime.executeInvitation(
    { tenantId: 'tenant-1' },
    { campaignId: 'campaign-1', opportunityId: 'capture-1', preferredChannel: 'WHATSAPP', initiatedBy: 'user-1', correlationId: 'corr-1' },
  );
  assert.equal(execution.status, 'RUNNING');
  assert.equal(execution.completedAt, undefined);
  assert.equal(execution.metrics.invitationExecutionState, 'DISPATCHED');
  assert.equal(execution.metrics.opportunityId, 'capture-1');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    tenantId: 'tenant-1',
    campaignId: 'campaign-1',
    opportunityId: 'capture-1',
    executionId: 'execution-1',
    invitationId: undefined,
    preferredChannel: 'WHATSAPP',
    correlationId: 'corr-1',
    replaySafe: true,
  });
});


test('recordInvitationResult completes runtime execution with safe delivery metrics', async () => {
  const executions = new MemoryExecutions();
  const service = new CampaignRuntimeService({ campaigns: new MemoryCampaigns([campaign()]), executions });
  const created = await executions.create({ tenantId: 'tenant-1' }, { tenantId: 'tenant-1', campaignId: 'campaign-1', trigger: 'MANUAL', status: 'RUNNING', metrics: { invitationExecutionState: 'DISPATCHED', opportunityId: 'capture-1' } });
  const result = await service.recordInvitationResult({ tenantId: 'tenant-1' }, { executionId: created.id, opportunityId: 'capture-1', invitationId: 'invite-1', status: 'SENT', channel: 'WHATSAPP', provider: 'WHATSAPP' });
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.metrics.invitationExecutionState, 'DELIVERED');
  assert.equal(result.metrics.invitationId, 'invite-1');
  assert.ok(result.metrics.deliveredAt);
});

test('recordInvitationResult schedules retry with sanitized retryable failure', async () => {
  const executions = new MemoryExecutions();
  const service = new CampaignRuntimeService({ campaigns: new MemoryCampaigns([campaign()]), executions });
  const created = await executions.create({ tenantId: 'tenant-1' }, { tenantId: 'tenant-1', campaignId: 'campaign-1', trigger: 'MANUAL', status: 'RUNNING', metrics: { invitationExecutionState: 'DISPATCHED', opportunityId: 'capture-1' } });
  const result = await service.recordInvitationResult({ tenantId: 'tenant-1' }, { executionId: created.id, opportunityId: 'capture-1', status: 'FAILED', channel: 'SMS', errorMessage: 'provider failed authorization=secret-token', retryable: true });
  assert.equal(result.status, 'RUNNING');
  assert.equal(result.metrics.invitationExecutionState, 'RETRY_SCHEDULED');
  assert.equal(result.metrics.retryable, true);
  assert.match(result.metrics.failureMessage, /authorization=\[REDACTED\]/);
  assert.doesNotMatch(result.metrics.failureMessage, /secret-token/);
});

test('retryable invitation failure schedules deterministic retry without terminal failure', async () => {
  const executions = new MemoryExecutions();
  const calls = [];
  const service = new CampaignRuntimeService({ campaigns: new MemoryCampaigns([campaign()]), executions, invitationQueue: { async enqueueInvitation(input) { calls.push(input); } } });
  const created = await executions.create({ tenantId: 'tenant-1' }, { tenantId: 'tenant-1', campaignId: 'campaign-1', trigger: 'MANUAL', status: 'RUNNING', metrics: { invitationExecutionState: 'DISPATCHED', opportunityId: 'capture-1', retryCount: 0, maxRetries: 3 } });
  const result = await service.recordInvitationResult({ tenantId: 'tenant-1', correlation: { correlationId: 'corr-1' } }, { executionId: created.id, opportunityId: 'capture-1', status: 'FAILED', channel: 'SMS', errorCode: 'PROVIDER_UNAVAILABLE', errorMessage: 'provider failed api_key=secret', retryable: true });
  assert.equal(result.status, 'RUNNING');
  assert.equal(result.metrics.invitationExecutionState, 'RETRY_SCHEDULED');
  assert.equal(result.metrics.retryCount, 1);
  assert.equal(new Date(result.metrics.nextRetryAt).getTime() - new Date(result.metrics.lastAttemptAt).getTime(), 300000);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].delayMs, 300000);
  assert.doesNotMatch(result.metrics.failureMessage, /secret/);
});

test('non-retryable invitation failure dead-letters without requeue', async () => {
  const executions = new MemoryExecutions();
  const calls = [];
  const service = new CampaignRuntimeService({ campaigns: new MemoryCampaigns([campaign()]), executions, invitationQueue: { async enqueueInvitation(input) { calls.push(input); } } });
  const created = await executions.create({ tenantId: 'tenant-1' }, { tenantId: 'tenant-1', campaignId: 'campaign-1', trigger: 'MANUAL', status: 'RUNNING', metrics: { invitationExecutionState: 'DISPATCHED', opportunityId: 'capture-1', retryCount: 0, maxRetries: 3 } });
  const result = await service.recordInvitationResult({ tenantId: 'tenant-1' }, { executionId: created.id, opportunityId: 'capture-1', status: 'FAILED', channel: 'EMAIL', errorCode: 'INVALID_RECIPIENT', retryable: false });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.metrics.invitationExecutionState, 'DEAD_LETTERED');
  assert.equal(calls.length, 0);
});

test('max retry exhaustion dead-letters invitation execution', async () => {
  const executions = new MemoryExecutions();
  const service = new CampaignRuntimeService({ campaigns: new MemoryCampaigns([campaign()]), executions, invitationQueue: { async enqueueInvitation() { throw new Error('should not enqueue'); } } });
  const created = await executions.create({ tenantId: 'tenant-1' }, { tenantId: 'tenant-1', campaignId: 'campaign-1', trigger: 'MANUAL', status: 'RUNNING', metrics: { invitationExecutionState: 'RETRY_SCHEDULED', opportunityId: 'capture-1', retryCount: 2, maxRetries: 3 } });
  const result = await service.recordInvitationResult({ tenantId: 'tenant-1' }, { executionId: created.id, opportunityId: 'capture-1', status: 'FAILED', channel: 'WHATSAPP', retryable: true });
  assert.equal(result.metrics.retryCount, 3);
  assert.equal(result.metrics.invitationExecutionState, 'DEAD_LETTERED');
});

test('executeInvitation with an invitationExecutor sends inline and returns COMPLETED, not a queued success', async () => {
  const sendCalls = [];
  const runtime = new CampaignRuntimeService({
    campaigns: new MemoryCampaigns([campaign()]),
    executions: new MemoryExecutions(),
    invitationExecutor: { async sendInvitation(context, input) { sendCalls.push({ context, input }); return { invitationId: 'invite-1', status: 'SENT', provider: 'WHATSAPP' }; } },
    invitationQueue: { async enqueueInvitation() { throw new Error('golden path must not depend on the queue when an executor is configured'); } },
  });
  const execution = await runtime.executeInvitation(
    { tenantId: 'tenant-1' },
    { campaignId: 'campaign-1', opportunityId: 'capture-1', preferredChannel: 'WHATSAPP', initiatedBy: 'user-1', correlationId: 'corr-1' },
  );
  assert.equal(execution.status, 'COMPLETED');
  assert.equal(execution.metrics.invitationExecutionState, 'DELIVERED');
  assert.equal(execution.metrics.invitationId, 'invite-1');
  assert.equal(sendCalls.length, 1);
  assert.equal(sendCalls[0].input.captureId, 'capture-1');
  assert.equal(sendCalls[0].input.channel, 'WHATSAPP');
});

test('executeInvitation reports FAILED (not a false success) when the inline executor throws', async () => {
  const runtime = new CampaignRuntimeService({
    campaigns: new MemoryCampaigns([campaign()]),
    executions: new MemoryExecutions(),
    invitationExecutor: { async sendInvitation() { const error = new Error('provider rejected'); error.code = 'SERVICE_PROVIDER_UNAVAILABLE'; error.retryable = false; throw error; } },
  });
  const execution = await runtime.executeInvitation(
    { tenantId: 'tenant-1' },
    { campaignId: 'campaign-1', opportunityId: 'capture-1', preferredChannel: 'WHATSAPP' },
  );
  assert.equal(execution.status, 'FAILED');
  assert.equal(execution.errorCode, 'SERVICE_PROVIDER_UNAVAILABLE');
  assert.equal(execution.metrics.invitationExecutionState, 'DEAD_LETTERED');
});

test('executeInvitation with an executor does not double-send when a prior invitation was already delivered', async () => {
  const sendCalls = [];
  const sellerInvitations = { async listSellerInvitationsByMarketplaceCaptureId() { return [{ channel: 'WHATSAPP', status: 'SENT', metadata: {} }]; } };
  const runtime = new CampaignRuntimeService({
    campaigns: new MemoryCampaigns([campaign()]),
    executions: new MemoryExecutions(),
    sellerInvitations,
    invitationExecutor: { async sendInvitation(context, input) { sendCalls.push(input); return { invitationId: 'invite-2', status: 'SENT' }; } },
  });
  const execution = await runtime.executeInvitation(
    { tenantId: 'tenant-1' },
    { campaignId: 'campaign-1', opportunityId: 'capture-1', preferredChannel: 'WHATSAPP' },
  );
  assert.equal(execution.status, 'COMPLETED');
  assert.equal(execution.metrics.suppressionReason, 'DUPLICATE_INVITATION_PREVENTED');
  assert.equal(sendCalls.length, 0);
});

test('retryInvitationExecution with an invitationExecutor dispatches inline instead of only re-enqueueing', async () => {
  const executions = new MemoryExecutions();
  const sendCalls = [];
  const service = new CampaignRuntimeService({
    campaigns: new MemoryCampaigns([campaign()]),
    executions,
    invitationExecutor: { async sendInvitation(context, input) { sendCalls.push(input); return { invitationId: 'invite-1', status: 'SENT' }; } },
    invitationQueue: { async enqueueInvitation() { throw new Error('manual retry must not depend on the queue when an executor is configured'); } },
  });
  const created = await executions.create({ tenantId: 'tenant-1' }, { tenantId: 'tenant-1', campaignId: 'campaign-1', trigger: 'MANUAL', status: 'FAILED', metrics: { invitationExecutionState: 'DEAD_LETTERED', opportunityId: 'capture-1', invitationId: 'invite-1', channel: 'WHATSAPP', retryCount: 3, maxRetries: 3 } });
  const result = await service.retryInvitationExecution({ tenantId: 'tenant-1' }, created.id);
  assert.equal(result.status, 'COMPLETED');
  assert.equal(sendCalls.length, 1);
});

test('manual retry is tenant-scoped and dispatches through existing queue path', async () => {
  const executions = new MemoryExecutions();
  const calls = [];
  const service = new CampaignRuntimeService({ campaigns: new MemoryCampaigns([campaign()]), executions, invitationQueue: { async enqueueInvitation(input) { calls.push(input); } } });
  const created = await executions.create({ tenantId: 'tenant-1' }, { tenantId: 'tenant-1', campaignId: 'campaign-1', trigger: 'MANUAL', status: 'FAILED', metrics: { invitationExecutionState: 'DEAD_LETTERED', opportunityId: 'capture-1', invitationId: 'invite-1', channel: 'WHATSAPP', retryCount: 3, maxRetries: 3 } });
  await assert.rejects(service.retryInvitationExecution({ tenantId: 'tenant-2' }, created.id), /not found/);
  const result = await service.retryInvitationExecution({ tenantId: 'tenant-1' }, created.id);
  assert.equal(result.status, 'RUNNING');
  assert.equal(result.metrics.invitationExecutionState, 'DISPATCHED');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tenantId, 'tenant-1');
  assert.equal(calls[0].opportunityId, 'capture-1');
});

test('due scheduled campaigns start scheduled executions and advance schedule', async () => {
  const source = campaign({ scheduleEnabled: true, scheduleCadence: 'DAILY', scheduleTimezone: 'UTC', nextRunAt: '2026-06-29T00:00:00.000Z', lastRunAt: null });
  const campaigns = new MemoryCampaigns([source]);
  const executions = new MemoryExecutions();
  const service = new CampaignRuntimeService({ campaigns, executions });
  const result = await service.runDueScheduledCampaigns({ tenantId: 'tenant-1' }, { now: new Date(now) });
  assert.deepEqual(result, { started: 1, skipped: 0 });
  assert.equal(executions.rows[0].trigger, 'SCHEDULED');
  assert.equal(source.lastRunAt, now);
  assert.equal(source.nextRunAt, '2026-07-01T00:00:00.000Z');
});

test('disabled scheduled campaigns do not create executions', async () => {
  const source = campaign({ scheduleEnabled: false, scheduleCadence: 'DAILY', nextRunAt: '2026-06-29T00:00:00.000Z' });
  const executions = new MemoryExecutions();
  const service = new CampaignRuntimeService({ campaigns: new MemoryCampaigns([source]), executions });
  const result = await service.runDueScheduledCampaigns({ tenantId: 'tenant-1' }, { now: new Date(now) });
  assert.deepEqual(result, { started: 0, skipped: 0 });
  assert.equal(executions.rows.length, 0);
});

test('scheduled runner skips campaigns with duplicate active executions', async () => {
  const source = campaign({ scheduleEnabled: true, scheduleCadence: 'HOURLY', nextRunAt: '2026-06-29T00:00:00.000Z' });
  const executions = new MemoryExecutions();
  await executions.create({ tenantId: 'tenant-1' }, { tenantId: 'tenant-1', campaignId: 'campaign-1', trigger: 'MANUAL', status: 'RUNNING' });
  const service = new CampaignRuntimeService({ campaigns: new MemoryCampaigns([source]), executions });
  const result = await service.runDueScheduledCampaigns({ tenantId: 'tenant-1' }, { now: new Date(now) });
  assert.deepEqual(result, { started: 0, skipped: 1 });
  assert.equal(source.lastRunAt, undefined);
});

test('scheduled campaign runtime owns autonomous discovery enqueue decision', async () => {
  const source = campaign({ scheduleEnabled: true, scheduleCadence: 'DAILY', nextRunAt: '2026-06-29T00:00:00.000Z' });
  const calls = [];
  const executions = new MemoryExecutions();
  const service = new CampaignRuntimeService({
    campaigns: new MemoryCampaigns([source]),
    executions,
    discoveryQueue: { async enqueueDiscovery(input) { calls.push(input); } },
  });
  const result = await service.runDueScheduledCampaigns({ tenantId: 'tenant-1' }, { now: new Date(now) });
  assert.deepEqual(result, { started: 1, skipped: 0 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tenantId, 'tenant-1');
  assert.equal(calls[0].campaignId, 'campaign-1');
  assert.equal(calls[0].executionId, 'execution-1');
  assert.equal(calls[0].replaySafe, true);
  assert.deepEqual(calls[0].targeting, { marketplaceSourceKey: 'JIJI', keyword: 'bikes', executionLimit: 25, exclusionTerms: [] });
  assert.equal(executions.rows[0].status, 'RUNNING');
  assert.equal(executions.rows[0].metrics.discoveryStatus, 'RUNNING');
});


test('invalid campaign targeting fails before discovery enqueue', async () => {
  const source = campaign({ metadata: { targeting: { marketplaceSourceKey: 'JIJI', executionLimit: 10 } } });
  const calls = [];
  const executions = new MemoryExecutions();
  const service = new CampaignRuntimeService({
    campaigns: new MemoryCampaigns([source]),
    executions,
    discoveryQueue: { async enqueueDiscovery(input) { calls.push(input); } },
  });
  const execution = await service.startCampaignExecution({ tenantId: 'tenant-1' }, { campaignId: 'campaign-1' });
  assert.equal(execution.status, 'FAILED');
  assert.equal(execution.errorCode, 'CAMPAIGN_TARGETING_INVALID');
  assert.equal(calls.length, 0);
  assert.equal(execution.metrics.targetingStatus, 'INVALID');
});

test('recordDiscoveryResult completes runtime execution with discovery counts', async () => {
  const executions = new MemoryExecutions();
  const service = new CampaignRuntimeService({ campaigns: new MemoryCampaigns([campaign()]), executions });
  const created = await executions.create({ tenantId: 'tenant-1' }, { tenantId: 'tenant-1', campaignId: 'campaign-1', trigger: 'SCHEDULED', status: 'RUNNING', metrics: { discoveryStatus: 'RUNNING' } });
  const result = await service.recordDiscoveryResult({ tenantId: 'tenant-1' }, { executionId: created.id, status: 'COMPLETED', discoveredCount: 3, capturedCount: 2, skippedDuplicateCount: 1 });
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.metrics.discoveryStatus, 'COMPLETED');
  assert.equal(result.metrics.discoveredCount, 3);
  assert.equal(result.metrics.capturedCount, 2);
  assert.equal(result.metrics.skippedDuplicateCount, 1);
});

test('recordDiscoveryResult fails runtime execution with sanitized failure metadata', async () => {
  const executions = new MemoryExecutions();
  const service = new CampaignRuntimeService({ campaigns: new MemoryCampaigns([campaign()]), executions });
  const created = await executions.create({ tenantId: 'tenant-1' }, { tenantId: 'tenant-1', campaignId: 'campaign-1', trigger: 'SCHEDULED', status: 'RUNNING', metrics: { discoveryStatus: 'RUNNING' } });
  const result = await service.recordDiscoveryResult({ tenantId: 'tenant-1' }, { executionId: created.id, status: 'FAILED', errorMessage: 'provider failed api_key=secret' });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.metrics.discoveryStatus, 'FAILED');
  assert.match(result.errorMessage, /api_key=\[REDACTED\]/);
  assert.doesNotMatch(result.errorMessage, /secret/);
});

test('recordDiscoveryResult enqueues governed qualification before completing execution', async () => {
  const executions = new MemoryExecutions();
  const calls = [];
  const service = new CampaignRuntimeService({ campaigns: new MemoryCampaigns([campaign()]), executions, qualificationQueue: { async enqueueQualification(input) { calls.push(input); } } });
  const created = await executions.create({ tenantId: 'tenant-1' }, { tenantId: 'tenant-1', campaignId: 'campaign-1', trigger: 'MANUAL', status: 'RUNNING', metrics: { discoveryStatus: 'RUNNING' } });
  const result = await service.recordDiscoveryResult({ tenantId: 'tenant-1', correlation: { correlationId: 'corr-1' } }, { executionId: created.id, status: 'COMPLETED', discoveredCount: 2, capturedCount: 0, skippedDuplicateCount: 1 });
  assert.equal(result.status, 'RUNNING');
  assert.equal(result.metrics.discoveryStatus, 'COMPLETED');
  assert.equal(result.metrics.qualificationStatus, 'RUNNING');
  assert.deepEqual(calls[0], { tenantId: 'tenant-1', campaignId: 'campaign-1', executionId: created.id, correlationId: 'corr-1', replaySafe: true });
});

test('recordQualificationResult completes execution with observable counts', async () => {
  const executions = new MemoryExecutions();
  const service = new CampaignRuntimeService({ campaigns: new MemoryCampaigns([campaign()]), executions });
  const created = await executions.create({ tenantId: 'tenant-1' }, { tenantId: 'tenant-1', campaignId: 'campaign-1', trigger: 'MANUAL', status: 'RUNNING', metrics: { qualificationStatus: 'RUNNING' } });
  const result = await service.recordQualificationResult({ tenantId: 'tenant-1' }, { executionId: created.id, status: 'COMPLETED', qualifiedCount: 1, disqualifiedCount: 1, skippedDuplicateCount: 1, failedCount: 0 });
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.metrics.qualificationStatus, 'COMPLETED');
  assert.equal(result.metrics.qualifiedCount, 1);
  assert.equal(result.metrics.disqualifiedCount, 1);
});


test('runtime runs governed optimization after qualification completion without mutating campaign targeting', async () => {
  const executions = new MemoryExecutions();
  const source = campaign({ metadata: { discoveryExecution: { search: { category: 'bikes', location: 'Accra' }, limit: 20 } } });
  const service = new CampaignRuntimeService({ campaigns: new MemoryCampaigns([source]), executions });
  const before = JSON.stringify(source.metadata);
  const created = await executions.create({ tenantId: 'tenant-1' }, { tenantId: 'tenant-1', campaignId: 'campaign-1', trigger: 'MANUAL', status: 'RUNNING', metrics: { discoveryStatus: 'COMPLETED', discoveredCount: 10, capturedCount: 5, skippedDuplicateCount: 5, requestedLimit: 20, providerKey: 'JIJI' } });
  const result = await service.recordQualificationResult({ tenantId: 'tenant-1' }, { executionId: created.id, status: 'COMPLETED', qualifiedCount: 1, disqualifiedCount: 4, needsReviewCount: 0, skippedDuplicateCount: 5, failedCount: 0 });
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.metrics.optimizationStatus, 'COMPLETED');
  assert.ok(result.metrics.lastOptimizedAt);
  assert.ok(result.metrics.optimizationRecommendations.some((item) => item.type === 'NARROW_CATEGORY'));
  assert.ok(result.metrics.optimizationRecommendations.some((item) => item.type === 'EXCLUDE_DUPLICATE_HEAVY_TERMS'));
  assert.deepEqual(source.metadata, JSON.parse(before));
});

test('runtime can enqueue asynchronous optimization instead of calculating in API paths', async () => {
  const executions = new MemoryExecutions();
  const calls = [];
  const service = new CampaignRuntimeService({ campaigns: new MemoryCampaigns([campaign()]), executions, optimizationQueue: { async enqueueOptimization(input) { calls.push(input); } } });
  const created = await executions.create({ tenantId: 'tenant-1' }, { tenantId: 'tenant-1', campaignId: 'campaign-1', trigger: 'MANUAL', status: 'RUNNING', metrics: { discoveryStatus: 'COMPLETED' } });
  const result = await service.recordQualificationResult({ tenantId: 'tenant-1', correlation: { correlationId: 'corr-optimization' } }, { executionId: created.id, status: 'COMPLETED', qualifiedCount: 3, disqualifiedCount: 1 });
  assert.equal(result.metrics.optimizationStatus, 'QUEUED');
  assert.deepEqual(calls[0], { tenantId: 'tenant-1', campaignId: 'campaign-1', executionId: created.id, correlationId: 'corr-optimization', replaySafe: true });
});

test('optimization reruns safely replace recommendation state for an execution', async () => {
  const executions = new MemoryExecutions();
  const service = new CampaignRuntimeService({ campaigns: new MemoryCampaigns([campaign()]), executions });
  const created = await executions.create({ tenantId: 'tenant-1' }, { tenantId: 'tenant-1', campaignId: 'campaign-1', trigger: 'MANUAL', status: 'COMPLETED', metrics: { discoveredCount: 5, capturedCount: 1, skippedDuplicateCount: 4, qualifiedCount: 1, disqualifiedCount: 4, needsReviewCount: 0 } });
  const first = await service.recordOptimizationResult({ tenantId: 'tenant-1' }, created.id);
  const second = await service.recordOptimizationResult({ tenantId: 'tenant-1' }, created.id);
  assert.equal(second.metrics.optimizationStatus, 'COMPLETED');
  assert.deepEqual(second.metrics.optimizationRecommendations.map((item) => item.id), first.metrics.optimizationRecommendations.map((item) => item.id));
});

test('provider failure or rate-limit produces an optimization warning', async () => {
  const executions = new MemoryExecutions();
  const service = new CampaignRuntimeService({ campaigns: new MemoryCampaigns([campaign()]), executions });
  const created = await executions.create({ tenantId: 'tenant-1' }, { tenantId: 'tenant-1', campaignId: 'campaign-1', trigger: 'SCHEDULED', status: 'RUNNING', metrics: { discoveryStatus: 'RUNNING', providerKey: 'JIJI' } });
  const result = await service.recordDiscoveryResult({ tenantId: 'tenant-1' }, { executionId: created.id, status: 'FAILED', errorCode: 'PROVIDER_RATE_LIMITED', errorMessage: 'rate limited' });
  assert.equal(result.metrics.optimizationStatus, 'COMPLETED');
  assert.ok(result.metrics.optimizationRecommendations.some((item) => item.type === 'FLAG_PROVIDER_UNHEALTHY' && item.severity === 'WARNING'));
});

test('executeInvitation blocks records with non-qualified opportunity state', async () => {
  const runtime = new CampaignRuntimeService({
    campaigns: new MemoryCampaigns([campaign()]),
    executions: new MemoryExecutions(),
    opportunities: {
      async findByMarketplaceCaptureId() { return { id: 'opp-1', tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1', status: 'REJECTED', qualificationStatus: 'REJECTED', createdAt: now, updatedAt: now }; },
      async findByDiscoveredSellerId() { return null; },
    },
  });
  await assert.rejects(
    runtime.executeInvitation({ tenantId: 'tenant-1' }, { campaignId: 'campaign-1', opportunityId: 'capture-1' }),
    /not qualified for invitation/,
  );
});

test('seller relationship history influences invitation channel selection', async () => {
  const calls = [];
  const runtime = new CampaignRuntimeService({
    campaigns: new MemoryCampaigns([campaign()]),
    executions: new MemoryExecutions(),
    invitationQueue: { async enqueueInvitation(input) { calls.push(input); } },
    sellerInvitations: {
      async listSellerInvitationsByMarketplaceCaptureId() { return [
        { id: 'invite-1', tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1', channel: 'WHATSAPP', status: 'FAILED', metadata: { providerOutcome: 'PROVIDER_FAILED' }, createdAt: now, updatedAt: now },
        { id: 'invite-2', tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1', channel: 'SMS', status: 'FAILED', metadata: { providerOutcome: 'PROVIDER_FAILED' }, createdAt: now, updatedAt: now },
        { id: 'invite-3', tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1', channel: 'EMAIL', status: 'FAILED', metadata: { providerOutcome: 'PROVIDER_FAILED' }, createdAt: now, updatedAt: now },
      ]; },
    },
  });
  const execution = await runtime.executeInvitation({ tenantId: 'tenant-1' }, { campaignId: 'campaign-1', opportunityId: 'capture-1' });
  assert.equal(calls[0].preferredChannel, 'WHATSAPP');
  assert.equal(execution.metrics.selectedChannel, 'WHATSAPP');
  assert.match(execution.metrics.optimizationReason, /relationship delivery history/i);
});

test('successful historical channels are preferred and failed channels are deprioritized', async () => {
  const calls = [];
  const runtime = new CampaignRuntimeService({
    campaigns: new MemoryCampaigns([campaign()]),
    executions: new MemoryExecutions(),
    invitationQueue: { async enqueueInvitation(input) { calls.push(input); } },
    sellerInvitations: {
      async listSellerInvitationsByMarketplaceCaptureId() { return [
        { id: 'invite-1', tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1', channel: 'WHATSAPP', status: 'FAILED', metadata: { providerOutcome: 'PROVIDER_FAILED' }, createdAt: now, updatedAt: now },
        { id: 'invite-2', tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1', channel: 'SMS', status: 'EXPIRED', metadata: { providerOutcome: 'DELIVERED' }, createdAt: now, updatedAt: now },
      ]; },
    },
  });
  const execution = await runtime.executeInvitation({ tenantId: 'tenant-1' }, { campaignId: 'campaign-1', opportunityId: 'capture-1' });
  assert.equal(calls[0].preferredChannel, 'SMS');
  assert.equal(execution.metrics.selectedChannel, 'SMS');
});

test('provider health affects provider selection and retry optimization integrates with reliable delivery', async () => {
  const calls = [];
  const executions = new MemoryExecutions();
  const runtime = new CampaignRuntimeService({
    campaigns: new MemoryCampaigns([campaign({ metadata: { providerHealth: { WHATSAPP: 'UNHEALTHY' }, invitationProviders: { SMS: 'twilio' } } })]),
    executions,
    invitationQueue: { async enqueueInvitation(input) { calls.push(input); } },
    sellerInvitations: { async listSellerInvitationsByMarketplaceCaptureId() { return []; } },
  });
  const execution = await runtime.executeInvitation({ tenantId: 'tenant-1' }, { campaignId: 'campaign-1', opportunityId: 'capture-1' });
  assert.equal(calls[0].preferredChannel, 'SMS');
  assert.equal(execution.metrics.selectedProvider, 'twilio');
  assert.equal(execution.metrics.retryStrategy.maxRetries, 3);
  const failed = await runtime.recordInvitationResult({ tenantId: 'tenant-1' }, { executionId: execution.id, opportunityId: 'capture-1', status: 'FAILED', channel: 'SMS', retryable: true });
  assert.equal(failed.metrics.invitationExecutionState, 'RETRY_SCHEDULED');
  assert.equal(new Date(failed.metrics.nextRetryAt).getTime() - new Date(failed.metrics.lastAttemptAt).getTime(), 300000);
});

test('runtime prevents duplicate optimized invitations before worker execution', async () => {
  const calls = [];
  const runtime = new CampaignRuntimeService({
    campaigns: new MemoryCampaigns([campaign()]),
    executions: new MemoryExecutions(),
    invitationQueue: { async enqueueInvitation(input) { calls.push(input); } },
    sellerInvitations: {
      async listSellerInvitationsByMarketplaceCaptureId() { return [{ id: 'invite-1', tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1', channel: 'WHATSAPP', status: 'SENT', metadata: {}, createdAt: now, updatedAt: now }]; },
    },
  });
  const execution = await runtime.executeInvitation({ tenantId: 'tenant-1' }, { campaignId: 'campaign-1', opportunityId: 'capture-1' });
  assert.equal(execution.status, 'COMPLETED');
  assert.equal(execution.metrics.invitationExecutionState, 'SUPPRESSED');
  assert.equal(execution.metrics.suppressionReason, 'DUPLICATE_INVITATION_PREVENTED');
  assert.equal(calls.length, 0);
});
