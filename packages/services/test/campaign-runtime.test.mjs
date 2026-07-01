import assert from 'node:assert/strict';
import test from 'node:test';
import { CampaignRuntimeService } from '@whisperm/services';

const now = '2026-06-30T00:00:00.000Z';
const campaign = (overrides = {}) => ({ id: 'campaign-1', tenantId: 'tenant-1', name: 'Growth', status: 'ACTIVE', metadata: { strategy: { category: 'bikes' } }, createdAt: now, updatedAt: now, ...overrides });

class MemoryCampaigns {
  constructor(campaigns) { this.campaigns = campaigns; }
  async findById(context, id) { return this.campaigns.find((row) => row.tenantId === context.tenantId && row.id === id) ?? null; }
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

test('successful no-op worker records COMPLETED', async () => {
  const { service } = makeService();
  const execution = await service.startCampaignExecution({ tenantId: 'tenant-1' }, { campaignId: 'campaign-1' });
  assert.equal(execution.status, 'COMPLETED');
  assert.deepEqual(execution.metrics, { noop: true });
  assert.ok(execution.completedAt);
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
  const source = campaign({ metadata: { strategy: { category: 'bikes' } } });
  const before = JSON.stringify(source);
  const { service } = makeService({ campaigns: [source] });
  await service.startCampaignExecution({ tenantId: 'tenant-1' }, { campaignId: 'campaign-1' });
  assert.equal(JSON.stringify(source), before);
});
