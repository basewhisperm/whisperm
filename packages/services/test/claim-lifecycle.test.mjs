import assert from 'node:assert/strict';
import test from 'node:test';
import { MarketplaceClaimLifecycleService } from '../dist/claim-lifecycle.js';

const context = { tenantId: 'tenant-1', correlation: { correlationId: 'corr-1' } };
const now = new Date('2026-01-01T00:00:00.000Z');
const baseToken = { id: 'token-1', tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1', tokenHash: 'hash', status: 'SENT', sentAt: now.toISOString(), expiresAt: '2026-01-08T00:00:00.000Z', createdAt: now.toISOString(), updatedAt: now.toISOString(), metadata: { successfulChannel: 'WHATSAPP' } };
const baseCapture = { id: 'capture-1', tenantId: 'tenant-1', listingUrl: 'https://example.com/1', title: 'Phone', status: 'INVITED', capturedAt: now.toISOString(), createdAt: now.toISOString(), updatedAt: now.toISOString() };
const baseDraft = { id: 'draft-1', tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1', title: 'Phone', status: 'CLAIM_PENDING', createdAt: now.toISOString(), updatedAt: now.toISOString() };

const makeDeps = (overrides = {}) => {
  const state = { token: { ...baseToken, ...(overrides.token ?? {}) }, capture: { ...baseCapture, ...(overrides.capture ?? {}) }, draft: overrides.draft === null ? null : { ...baseDraft, ...(overrides.draft ?? {}) }, scheduled: [], notifications: [], audits: [], opportunities: [] };
  const deps = {
    clock: () => overrides.now ?? now,
    claimTokens: {
      async findById(scope, id) { return state.token.tenantId === scope.tenantId && state.token.id === id ? state.token : null; },
      async update(scope, id, input) { assert.equal(scope.tenantId, state.token.tenantId); assert.equal(id, state.token.id); state.token = { ...state.token, ...input, updatedAt: (overrides.now ?? now).toISOString() }; return state.token; },
    },
    marketplaceCaptures: {
      async findById(scope, id) { return state.capture.tenantId === scope.tenantId && state.capture.id === id ? state.capture : null; },
      async update(scope, id, input) { assert.equal(scope.tenantId, state.capture.tenantId); assert.equal(id, state.capture.id); state.capture = { ...state.capture, ...input }; return state.capture; },
    },
    draftInventories: {
      async findByMarketplaceCaptureId(scope, captureId) { return state.draft?.tenantId === scope.tenantId && state.draft.marketplaceCaptureId === captureId ? state.draft : null; },
      async update(scope, id, input) { assert.equal(scope.tenantId, state.draft.tenantId); assert.equal(id, state.draft.id); state.draft = { ...state.draft, ...input }; return state.draft; },
    },
    notifications: { async sendClaimReminder(input) { state.notifications.push(input); return { channel: overrides.channel ?? input.preferredChannel ?? 'SMS' }; } },
    businessGrowthOpportunities: { async createOrUpdateFromMarketplaceCapture(scope, capture) { state.opportunities.push({ scope, capture }); return capture; } },
    scheduler: { async schedule(job) { state.scheduled.push(job); } },
    auditLogs: { async append(scope, input) { assert.equal(scope.tenantId, input.tenantId); state.audits.push(input); return input; } },
  };
  return { state, service: new MarketplaceClaimLifecycleService(deps) };
};

test('sending invitation schedules Day 3, Day 6, and Day 7 lifecycle jobs', async () => {
  const { state, service } = makeDeps();
  const jobs = await service.scheduleClaimLifecycle(context, 'token-1');
  assert.deepEqual(jobs.map((job) => [job.jobType, job.reminderType, job.runAt]), [
    ['marketplace.claim.intelligence', undefined, '2026-01-03T00:00:00.000Z'],
    ['marketplace.claim.reminder', 'DAY_3', '2026-01-04T00:00:00.000Z'],
    ['marketplace.claim.reminder', 'DAY_6', '2026-01-07T00:00:00.000Z'],
    ['marketplace.claim.expire', undefined, '2026-01-08T00:00:00.000Z'],
  ]);
  assert.equal(state.scheduled.length, 4);
});

test('Day 3 and Day 6 reminders send once using cellphone-first original channel', async () => {
  const { state, service } = makeDeps();
  assert.deepEqual(await service.sendClaimReminder(context, 'token-1', 'DAY_3'), { sent: true, channel: 'WHATSAPP' });
  assert.deepEqual(await service.sendClaimReminder(context, 'token-1', 'DAY_3'), { sent: false });
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].preferredChannel, 'WHATSAPP');
  assert.deepEqual(await service.sendClaimReminder(context, 'token-1', 'DAY_6'), { sent: true, channel: 'WHATSAPP' });
  assert.deepEqual(await service.sendClaimReminder(context, 'token-1', 'DAY_6'), { sent: false });
  assert.equal(state.notifications.length, 2);
});

test('reminder records fallback channel returned by notification runtime', async () => {
  const { state, service } = makeDeps({ channel: 'SMS' });
  await service.sendClaimReminder(context, 'token-1', 'DAY_3');
  assert.equal(state.token.metadata.reminderDay3SentAtChannel, 'SMS');
});

test('expiration marks token, capture, and safe draft inventory expired idempotently', async () => {
  const { state, service } = makeDeps({ now: new Date('2026-01-08T00:00:00.000Z') });
  assert.deepEqual(await service.expireClaimInvitation(context, 'token-1'), { expired: true });
  assert.equal(state.token.status, 'EXPIRED');
  assert.equal(state.capture.status, 'EXPIRED');
  assert.equal(state.draft.status, 'EXPIRED');
  assert.deepEqual(await service.expireClaimInvitation(context, 'token-1'), { expired: false });
  assert.equal(state.audits.filter((audit) => audit.action === 'MARKETPLACE_CLAIM_INVITATION_EXPIRED').length, 1);
});

test('expiration does not affect claimed or converted captures and preserves tenant isolation', async () => {
  for (const status of ['CLAIMED', 'CONVERTED']) {
    const { state, service } = makeDeps({ now: new Date('2026-01-08T00:00:00.000Z'), capture: { status } });
    assert.deepEqual(await service.expireClaimInvitation(context, 'token-1'), { expired: false });
    assert.equal(state.token.status, 'SENT');
    assert.equal(state.capture.status, status);
  }
  const { service } = makeDeps();
  await assert.rejects(service.sendClaimReminder({ ...context, tenantId: 'tenant-2' }, 'token-1', 'DAY_3'), /Claim invitation not found/);
});


test('claim intelligence stalls delivered invitations with no view after threshold', async () => {
  const { state, service } = makeDeps({ now: new Date('2026-01-03T00:00:01.000Z') });
  const result = await service.evaluateClaimIntelligence(context, 'token-1');
  assert.equal(result.status, 'STALLED');
  assert.equal(result.stalledReason, 'DELIVERED_NO_VIEW');
  assert.equal(result.recoveryAction, 'SEND_REMINDER');
  assert.equal(state.token.metadata.claimIntelligence, 'STALLED');
});

test('claim intelligence stalls viewed but incomplete claims and worker recovery is idempotent', async () => {
  const openedAt = '2026-01-02T00:00:00.000Z';
  const { state, service } = makeDeps({ now: new Date('2026-01-03T00:00:01.000Z'), token: { status: 'OPENED', metadata: { successfulChannel: 'SMS', openedAt } } });
  const result = await service.evaluateClaimIntelligence(context, 'token-1');
  assert.equal(result.stalledReason, 'VIEWED_NOT_STARTED');
  assert.deepEqual(await service.executeClaimRecovery(context, 'token-1'), { executed: true, action: 'SEND_REMINDER', status: 'EXECUTED' });
  assert.deepEqual(await service.executeClaimRecovery(context, 'token-1'), { executed: false, action: 'SEND_REMINDER', status: 'ALREADY_EXECUTED' });
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].purpose, 'Recovery reminder: VIEWED_NOT_STARTED');
  assert.equal(state.token.metadata.claimIntelligenceRecoveryAttemptCount, 1);
});

test('claim intelligence does not recover completed or already-converted sellers', async () => {
  for (const status of ['CLAIMED', 'CONVERTED']) {
    const { state, service } = makeDeps({ now: new Date('2026-01-05T00:00:00.000Z'), capture: { status }, token: { status: 'CLAIMED', claimedAt: '2026-01-02T00:00:00.000Z' } });
    const result = await service.evaluateClaimIntelligence(context, 'token-1');
    assert.equal(result.status, 'COMPLETED');
    assert.deepEqual(await service.executeClaimRecovery(context, 'token-1'), { executed: false, action: 'NONE', status: 'SKIPPED' });
    assert.equal(state.notifications.length, 0);
  }
});

test('expired claim token recovery marks abandoned through lifecycle and opportunity ownership', async () => {
  const { state, service } = makeDeps({ now: new Date('2026-01-09T00:00:00.000Z') });
  const result = await service.evaluateClaimIntelligence(context, 'token-1');
  assert.equal(result.stalledReason, 'EXPIRED_TOKEN');
  assert.deepEqual(await service.executeClaimRecovery(context, 'token-1'), { executed: true, action: 'MARK_ABANDONED', status: 'EXECUTED' });
  assert.equal(state.token.status, 'ABANDONED');
  assert.equal(state.capture.metadata.claimIntelligenceStatus, 'ABANDONED');
  assert.equal(state.opportunities.length, 1);
});

test('claim intelligence suppresses repeated abandoned recovery attempts', async () => {
  const { state, service } = makeDeps({ now: new Date('2026-01-05T00:00:00.000Z'), token: { metadata: { successfulChannel: 'SMS', claimIntelligenceRecoveryAttemptCount: 2 } } });
  const result = await service.evaluateClaimIntelligence(context, 'token-1');
  assert.equal(result.status, 'SUPPRESSED');
  assert.equal(result.recoveryAction, 'SUPPRESS_CONTACT');
  assert.deepEqual(await service.executeClaimRecovery(context, 'token-1'), { executed: false, action: 'SUPPRESS_CONTACT', status: 'SKIPPED' });
  assert.equal(state.notifications.length, 0);
});
