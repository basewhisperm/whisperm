import assert from 'node:assert/strict';
import test from 'node:test';
import { createClaimLifecycleScheduler, createGrowthLoopScheduler } from '../dist/index.js';
import { growthLoopQueueName, growthLoopJobType, marketplaceClaimLifecycleQueueName } from '@whisperm/services';

// ST1-013M regression: createGrowthLoopScheduler/createClaimLifecycleScheduler upsert into a
// fixed-jobKey QueueJob row. If a prior evaluation/reminder already reached a terminal state
// (COMPLETED/DEAD_LETTERED), re-enqueuing for the same key must reset it back to a claimable
// state -- otherwise the durable poller (which only looks at WAITING/DELAYED/RETRY_SCHEDULED/
// stale-ACTIVE) never picks the reused row back up, and later evaluations/reminders silently
// never run even though callers see success.
const createFakeQueueJobDelegate = () => {
  const rows = new Map();
  return {
    rows,
    async upsert({ where, create, update }) {
      const key = JSON.stringify(where.tenantId_queueName_jobKey);
      const existing = rows.get(key);
      const row = existing === undefined ? { ...create } : { ...existing, ...update };
      rows.set(key, row);
      return row;
    },
  };
};

test('growth loop re-enqueue resets a terminal row back to WAITING and clears lock/attempt state', async () => {
  const queueJob = createFakeQueueJobDelegate();
  const scheduler = createGrowthLoopScheduler(queueJob);

  await scheduler.enqueueGrowthLoopEvaluation({ tenantId: 'tenant-1', campaignId: 'campaign-1', trigger: 'MANUAL', replaySafe: true });
  const key = JSON.stringify({ tenantId: 'tenant-1', queueName: growthLoopQueueName, jobKey: 'tenant-1:campaign-1' });
  const created = queueJob.rows.get(key);
  assert.equal(created.state, 'WAITING');
  assert.equal(created.jobName, growthLoopJobType);

  // Simulate the row having been claimed, executed, and terminally completed by the poller.
  queueJob.rows.set(key, { ...created, state: 'COMPLETED', attemptsMade: 1, lockedUntil: null });

  await scheduler.enqueueGrowthLoopEvaluation({ tenantId: 'tenant-1', campaignId: 'campaign-1', trigger: 'SCHEDULED_REVIEW', replaySafe: true });
  const reEnqueued = queueJob.rows.get(key);

  assert.equal(reEnqueued.state, 'WAITING', 're-enqueuing a completed evaluation must make the row claimable again');
  assert.equal(reEnqueued.attemptsMade, 0);
  assert.equal(reEnqueued.lockedUntil, null);
});

test('claim lifecycle re-schedule resets a terminal row back to DELAYED and clears lock/attempt state', async () => {
  const queueJob = createFakeQueueJobDelegate();
  const scheduler = createClaimLifecycleScheduler(queueJob);
  const job = {
    tenantId: 'tenant-1',
    invitationId: 'invitation-1',
    jobType: 'marketplace.claim.reminder',
    reminderType: 'DAY_3',
    runAt: '2026-01-04T00:00:00.000Z',
    dedupeKey: 'marketplace.claim.reminder:tenant-1:invitation-1:DAY_3',
    correlation: { correlationId: 'corr-1' },
  };

  await scheduler.schedule(job);
  const key = JSON.stringify({ tenantId: 'tenant-1', queueName: marketplaceClaimLifecycleQueueName, jobKey: job.dedupeKey });
  assert.equal(queueJob.rows.get(key).state, 'DELAYED');

  // Simulate a prior run that dead-lettered (e.g. transient provider outage exhausted retries).
  queueJob.rows.set(key, { ...queueJob.rows.get(key), state: 'DEAD_LETTERED', attemptsMade: 3, lockedUntil: null });

  await scheduler.schedule({ ...job, runAt: '2026-01-05T00:00:00.000Z' });
  const rescheduled = queueJob.rows.get(key);

  assert.equal(rescheduled.state, 'DELAYED', 're-scheduling a dead-lettered reminder must make the row claimable again');
  assert.equal(rescheduled.attemptsMade, 0);
  assert.equal(rescheduled.lockedUntil, null);
});
