import assert from 'node:assert/strict';
import test from 'node:test';
import { createClaimLifecycleScheduler, createGrowthLoopScheduler } from '../dist/index.js';
import { growthLoopQueueName, growthLoopJobType, marketplaceClaimLifecycleQueueName } from '@whisperm/services';

// ST1-013M regression: createGrowthLoopScheduler/createClaimLifecycleScheduler re-enqueue into a
// fixed-jobKey QueueJob row via atomic conditional updateMany writes (not a findFirst-then-upsert
// read/write pair, which raced the durable poller/an in-flight worker -- see reenqueueQueueJobRow
// in apps/worker/src/index.ts). This fake delegate mirrors the real Prisma queueJob delegate's
// updateMany/create contract closely enough to exercise that atomicity, including surfacing a
// P2002-style unique constraint violation from `create` when a row already exists.
const compositeKey = ({ tenantId, queueName, jobKey }) => `${tenantId}::${queueName}::${jobKey}`;

const matchesWhere = (row, where) => {
  for (const [key, value] of Object.entries(where)) {
    if (key === 'NOT') {
      if (matchesWhere(row, value)) return false;
      continue;
    }
    if (row[key] !== value) return false;
  }
  return true;
};

const createFakeQueueJobDelegate = () => {
  const rows = new Map();
  return {
    rows,
    async updateMany({ where, data }) {
      const { tenantId, queueName, jobKey, ...rest } = where;
      const key = compositeKey({ tenantId, queueName, jobKey });
      const existing = rows.get(key);
      if (existing === undefined || !matchesWhere(existing, rest)) {
        return { count: 0 };
      }
      rows.set(key, { ...existing, ...data });
      return { count: 1 };
    },
    async create({ data }) {
      const key = compositeKey(data);
      if (rows.has(key)) {
        throw { code: 'P2002', message: 'Unique constraint failed' };
      }
      rows.set(key, { ...data });
      return { ...data };
    },
  };
};

test('growth loop re-enqueue resets a terminal row back to WAITING and clears lock/attempt state', async () => {
  const queueJob = createFakeQueueJobDelegate();
  const scheduler = createGrowthLoopScheduler(queueJob);

  await scheduler.enqueueGrowthLoopEvaluation({ tenantId: 'tenant-1', campaignId: 'campaign-1', trigger: 'MANUAL', replaySafe: true });
  const key = compositeKey({ tenantId: 'tenant-1', queueName: growthLoopQueueName, jobKey: 'tenant-1:campaign-1' });
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

test('growth loop re-enqueue does NOT reset a row that is currently ACTIVE (a worker is mid-evaluation)', async () => {
  // Regression: resetting state/lockedUntil/attemptsMade while the row is ACTIVE would let the
  // poller claim it a second time concurrently, and the in-flight worker's own completion
  // transition (which requires state=ACTIVE as its precondition) would then conflict.
  const queueJob = createFakeQueueJobDelegate();
  const scheduler = createGrowthLoopScheduler(queueJob);
  const key = compositeKey({ tenantId: 'tenant-1', queueName: growthLoopQueueName, jobKey: 'tenant-1:campaign-1' });

  await scheduler.enqueueGrowthLoopEvaluation({ tenantId: 'tenant-1', campaignId: 'campaign-1', trigger: 'MANUAL', replaySafe: true });
  const lockedUntil = '2026-01-01T00:05:00.000Z';
  const scheduledAt = queueJob.rows.get(key).scheduledAt;
  queueJob.rows.set(key, { ...queueJob.rows.get(key), state: 'ACTIVE', attemptsMade: 1, lockedUntil });

  await scheduler.enqueueGrowthLoopEvaluation({ tenantId: 'tenant-1', campaignId: 'campaign-1', trigger: 'SCHEDULED_REVIEW', replaySafe: true });
  const afterReenqueue = queueJob.rows.get(key);

  assert.equal(afterReenqueue.state, 'ACTIVE', 're-enqueuing while a worker is mid-evaluation must not touch state');
  assert.equal(afterReenqueue.attemptsMade, 1);
  assert.equal(afterReenqueue.lockedUntil, lockedUntil);
  // Regression (round 3 review of PR #362): a crash-recovery reclaim of this row must honor the
  // original lease/schedule, not one requested by a re-enqueue that arrived mid-evaluation.
  assert.equal(afterReenqueue.scheduledAt, scheduledAt, 're-enqueuing an ACTIVE row must not touch its schedule fields');
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
  const key = compositeKey({ tenantId: 'tenant-1', queueName: marketplaceClaimLifecycleQueueName, jobKey: job.dedupeKey });
  assert.equal(queueJob.rows.get(key).state, 'DELAYED');

  // Simulate a prior run that dead-lettered (e.g. transient provider outage exhausted retries).
  queueJob.rows.set(key, { ...queueJob.rows.get(key), state: 'DEAD_LETTERED', attemptsMade: 3, lockedUntil: null });

  await scheduler.schedule({ ...job, runAt: '2026-01-05T00:00:00.000Z' });
  const rescheduled = queueJob.rows.get(key);

  assert.equal(rescheduled.state, 'DELAYED', 're-scheduling a dead-lettered reminder must make the row claimable again');
  assert.equal(rescheduled.attemptsMade, 0);
  assert.equal(rescheduled.lockedUntil, null);
});

test('claim lifecycle re-schedule does NOT reset a row that is currently ACTIVE (a worker is mid-reminder-send)', async () => {
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
  const key = compositeKey({ tenantId: 'tenant-1', queueName: marketplaceClaimLifecycleQueueName, jobKey: job.dedupeKey });

  await scheduler.schedule(job);
  const lockedUntil = '2026-01-04T00:05:00.000Z';
  const availableAt = queueJob.rows.get(key).availableAt;
  queueJob.rows.set(key, { ...queueJob.rows.get(key), state: 'ACTIVE', attemptsMade: 1, lockedUntil });

  await scheduler.schedule({ ...job, runAt: '2026-01-05T00:00:00.000Z' });
  const afterReschedule = queueJob.rows.get(key);

  assert.equal(afterReschedule.state, 'ACTIVE', 're-scheduling while a worker is mid-send must not touch state');
  assert.equal(afterReschedule.attemptsMade, 1);
  assert.equal(afterReschedule.lockedUntil, lockedUntil);
  // Regression (round 3 review of PR #362): a crash of the in-flight worker must reclaim this row
  // based on its original runAt/lease, not the newly requested (but not-yet-honored) runAt.
  assert.equal(afterReschedule.availableAt, availableAt, 're-scheduling an ACTIVE row must not touch availableAt');
});

test('growth loop re-enqueue self-heals when create() races a concurrent creator (P2002)', async () => {
  // Regression: if two callers race to enqueue the same fixed jobKey and neither updateMany finds
  // an existing row, both fall through to create(). The loser must not throw -- it should retry
  // and resolve via the reset/preserve updateMany branches against the row the winner just made.
  const queueJob = createFakeQueueJobDelegate();
  const key = compositeKey({ tenantId: 'tenant-1', queueName: growthLoopQueueName, jobKey: 'tenant-1:campaign-1' });
  const realCreate = queueJob.create.bind(queueJob);
  let createCalls = 0;
  queueJob.create = async (args) => {
    createCalls += 1;
    if (createCalls === 1) {
      // Simulate a concurrent writer creating the row between this call's updateMany misses and
      // its own create().
      await realCreate({ data: { tenantId: 'tenant-1', queueName: growthLoopQueueName, jobKey: 'tenant-1:campaign-1', jobName: growthLoopJobType, state: 'WAITING', payload: {}, attemptsMade: 0, maxAttempts: 3, correlationId: 'concurrent-writer' } });
      throw { code: 'P2002', message: 'Unique constraint failed' };
    }
    return realCreate(args);
  };
  const scheduler = createGrowthLoopScheduler(queueJob);

  await scheduler.enqueueGrowthLoopEvaluation({ tenantId: 'tenant-1', campaignId: 'campaign-1', trigger: 'MANUAL', replaySafe: true });

  const row = queueJob.rows.get(key);
  assert.ok(row !== undefined, 'the row must exist after the retry resolves the P2002 conflict');
  assert.equal(row.state, 'WAITING');
});
