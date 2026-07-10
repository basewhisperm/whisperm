import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createWorkerApplication,
  createBootstrapOnlyWorkerServices,
  InMemoryQueueRuntime,
  InMemoryIdempotencyStore,
} from '../dist/index.js';
import {
  PrismaQueueRuntime,
  claimAndProcessOneDurableQueueJob,
  runDurableQueuePollLoop,
} from '../dist/durable-queue-runtime.js';
import { WorkerRuntimeError } from '@whisperm/worker-runtime';

// ST1-013M: QueueJobRecord-shaped fake repository (post-parse, ISO-string dates) -- the
// Postgres-backed claim/lock semantics themselves are covered by
// packages/repositories/test/queue-job.test.mjs; this exercises the worker's own drain loop
// (claim -> dispatch via WorkerApplication.processJob -> persist outcome).
const createFakeQueueJobs = (seedRows) => {
  const rows = new Map(seedRows.map((row) => [row.id, { ...row }]));
  const deadLetters = [];
  let nextId = rows.size + 1;
  return {
    rows,
    deadLetters,
    // ST1-013N: mirrors PrismaQueueJobRepository.enqueue's real idempotency contract -- unique on
    // (tenantId, queueName, jobKey); a duplicate enqueue returns the existing row rather than
    // creating a second one, so the same logical job is never claimed/executed twice.
    async enqueue(context, input) {
      const existing = [...rows.values()].find((row) => row.tenantId === input.tenantId && row.queueName === input.queueName && row.jobKey === input.jobKey);
      if (existing !== undefined) return { ...existing };
      const row = {
        id: `enqueued-${nextId++}`,
        tenantId: input.tenantId,
        queueName: input.queueName,
        jobName: input.jobName,
        jobKey: input.jobKey,
        state: 'WAITING',
        payload: input.payload,
        attemptsMade: 0,
        maxAttempts: input.maxAttempts ?? 3,
        // Default to immediately-due (epoch), not real wall-clock "now": these tests drive the
        // fake with fixed 2026-01-02 `now` values, and a real Date.now() default would be later
        // than that, making a freshly-enqueued row spuriously unclaimable.
        availableAt: input.availableAt ?? new Date(0).toISOString(),
        lockedUntil: null,
        lastError: null,
        correlationId: input.correlationId ?? input.jobKey,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      };
      rows.set(row.id, row);
      return { ...row };
    },
    async claimNext({ tenantId, queueNames, now }) {
      const candidate = [...rows.values()].find((row) => row.tenantId === tenantId
        && queueNames.includes(row.queueName)
        && (row.state === 'WAITING' || row.state === 'RETRY_SCHEDULED')
        && new Date(row.availableAt).getTime() <= now.getTime());
      if (candidate === undefined) return null;
      candidate.state = 'ACTIVE';
      candidate.attemptsMade += 1;
      candidate.lockedUntil = new Date(now.getTime() + 300_000).toISOString();
      return { ...candidate };
    },
    async markCompleted(context, id) {
      const row = rows.get(id);
      row.state = 'COMPLETED';
      row.lockedUntil = null;
      return { ...row };
    },
    async markRetryScheduled(context, id, input) {
      const row = rows.get(id);
      row.state = 'RETRY_SCHEDULED';
      row.availableAt = input.availableAt;
      row.lockedUntil = null;
      row.lastError = input.lastError ?? null;
      return { ...row };
    },
    async markDeadLettered(context, id, input) {
      const row = rows.get(id);
      row.state = 'DEAD_LETTERED';
      row.lockedUntil = null;
      row.lastError = input.lastError ?? null;
      return { ...row };
    },
    async markCancelled(context, id) {
      const row = rows.get(id);
      row.state = 'CANCELLED';
      return { ...row };
    },
    async findById(context, id) {
      const row = rows.get(id);
      return row === undefined ? null : { ...row };
    },
    async recordDeadLetter(context, input) {
      deadLetters.push(input);
    },
  };
};

const baseRow = (overrides = {}) => ({
  id: 'row-1',
  tenantId: 'tenant-1',
  queueName: 'event.ingestion',
  jobName: 'event.ingestion',
  jobKey: 'row-1-key',
  state: 'WAITING',
  payload: {
    event: {
      tenantId: 'tenant-1',
      source: { provider: 'WEB_FORM', providerEventId: 'provider-event-1', eventType: 'lead.created' },
      payload: { leadId: 'lead-1' },
    },
  },
  attemptsMade: 0,
  maxAttempts: 3,
  availableAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  lockedUntil: null,
  lastError: null,
  correlationId: 'corr-1',
  createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  ...overrides,
});

const createApp = (eventsIngest, queueJobs) => {
  const app = createWorkerApplication({
    config: { tenantId: 'tenant-1', workerId: 'worker-1', gracefulShutdownMs: 1000, heartbeatIntervalMs: 5000, runtimeVersion: 'test', correlation: { correlationId: 'boot' } },
    services: { ...createBootstrapOnlyWorkerServices(), events: { ingest: eventsIngest } },
    queues: queueJobs === undefined ? new InMemoryQueueRuntime() : new PrismaQueueRuntime({ queueJobs }),
    runtimePorts: { idempotency: new InMemoryIdempotencyStore() },
    logger: { info() {}, warn() {}, error() {} },
  });
  return app;
};

test('claimAndProcessOneDurableQueueJob returns claimed:false when nothing is claimable', async () => {
  const queueJobs = createFakeQueueJobs([]);
  const app = createApp(async () => ({ id: 'ingestion-1', tenantId: 'tenant-1' }), queueJobs);
  await app.start();

  const result = await claimAndProcessOneDurableQueueJob({ app, queueJobs, tenantId: 'tenant-1', queueNames: ['event.ingestion'], now: new Date('2026-01-02T00:00:00.000Z') });

  assert.equal(result.claimed, false);
});

test('a successful job is claimed, dispatched, and marked COMPLETED', async () => {
  const queueJobs = createFakeQueueJobs([baseRow()]);
  const calls = [];
  const app = createApp(async (context, input) => { calls.push(input); return { id: 'ingestion-1', tenantId: input.tenantId }; }, queueJobs);
  await app.start();

  const result = await claimAndProcessOneDurableQueueJob({ app, queueJobs, tenantId: 'tenant-1', queueNames: ['event.ingestion'], now: new Date('2026-01-02T00:00:00.000Z') });

  assert.equal(result.claimed, true);
  assert.equal(result.outcome, 'COMPLETED');
  assert.equal(calls.length, 1, 'handler must be dispatched exactly once');
  assert.equal(queueJobs.rows.get('row-1').state, 'COMPLETED');
});

const throwRetryableError = () => {
  // A code not in defaultDurableRetryPolicy's nonRetryableErrorCodes, so retry-vs-terminal is
  // governed purely by attempt count vs maxAttempts, not by the error code deny-list.
  throw new WorkerRuntimeError({ code: 'WORKER_RUNTIME_LEASE_EXPIRED', message: 'transient upstream failure', status: 503, retryable: true });
};

test('a retryable handler failure is scheduled for retry, not dead-lettered, before maxAttempts', async () => {
  const queueJobs = createFakeQueueJobs([baseRow({ maxAttempts: 5 })]);
  const app = createApp(async () => { throwRetryableError(); }, queueJobs);
  await app.start();

  const now = new Date('2026-01-02T00:00:00.000Z');
  const result = await claimAndProcessOneDurableQueueJob({ app, queueJobs, tenantId: 'tenant-1', queueNames: ['event.ingestion'], now });

  assert.equal(result.outcome, 'RETRY_SCHEDULED');
  const row = queueJobs.rows.get('row-1');
  assert.equal(row.state, 'RETRY_SCHEDULED');
  assert.ok(new Date(row.availableAt).getTime() > now.getTime(), 'retry must be scheduled in the future');
  assert.equal(queueJobs.deadLetters.length, 0);
});

test('attempt count from the QueueJob row is honored: a job at its last attempt is dead-lettered on failure, not retried again', async () => {
  // attemptsMade becomes 3 after claim (2 prior + this one); maxAttempts is 3, so this failure
  // must be terminal. Before ST1-013M's attempt-count fix, processJob always computed
  // attempt 0 internally, so this would have incorrectly kept retrying forever.
  const queueJobs = createFakeQueueJobs([baseRow({ attemptsMade: 2, maxAttempts: 3 })]);
  const app = createApp(async () => { throwRetryableError(); }, queueJobs);
  await app.start();

  const result = await claimAndProcessOneDurableQueueJob({ app, queueJobs, tenantId: 'tenant-1', queueNames: ['event.ingestion'], now: new Date('2026-01-02T00:00:00.000Z') });

  assert.equal(result.outcome, 'DEAD_LETTERED');
  assert.equal(queueJobs.rows.get('row-1').state, 'DEAD_LETTERED');
  assert.equal(queueJobs.deadLetters.length, 1);
  assert.equal(queueJobs.deadLetters[0].reason, 'MAX_ATTEMPTS_EXCEEDED');
});

test('an invalid payload eventually fails terminally once the queue-configured maxAttempts is exhausted', async () => {
  // ST1-013M: WORKER_RUNTIME_VALIDATION_FAILED is deliberately not in the default durable retry
  // policy's deny-list (it's also the code claim-reminder delivery uses for transient provider
  // failures), since RuntimeJobService.enqueueRuntimeJob already validates every payload before
  // it is ever persisted -- a bad payload reaching this consumer is the rare exception, not the
  // rule, and it still terminates once the producer's own maxAttempts is exhausted.
  const queueJobs = createFakeQueueJobs([baseRow({ payload: { event: { tenantId: 'tenant-1' } }, maxAttempts: 1 })]);
  const app = createApp(async () => ({ id: 'never-called', tenantId: 'tenant-1' }), queueJobs);
  await app.start();

  const result = await claimAndProcessOneDurableQueueJob({ app, queueJobs, tenantId: 'tenant-1', queueNames: ['event.ingestion'], now: new Date('2026-01-02T00:00:00.000Z') });

  assert.equal(result.outcome, 'DEAD_LETTERED');
  assert.equal(queueJobs.deadLetters.length, 1);
  assert.equal(queueJobs.deadLetters[0].reason, 'MAX_ATTEMPTS_EXCEEDED');
  assert.equal(queueJobs.deadLetters[0].jobKey, 'row-1-key', 'DeadLetterJob must record the QueueJob row\'s own stable jobKey, not the per-attempt idempotency key');
});

test('WORKER_RUNTIME_TENANT_ISOLATION_VIOLATION is always terminal, even on the first attempt', async () => {
  const queueJobs = createFakeQueueJobs([baseRow({ maxAttempts: 5 })]);
  const app = createApp(async () => { throw new WorkerRuntimeError({ code: 'WORKER_RUNTIME_TENANT_ISOLATION_VIOLATION', message: 'tenant mismatch', status: 403 }); }, queueJobs);
  await app.start();

  const result = await claimAndProcessOneDurableQueueJob({ app, queueJobs, tenantId: 'tenant-1', queueNames: ['event.ingestion'], now: new Date('2026-01-02T00:00:00.000Z') });

  assert.equal(result.outcome, 'DEAD_LETTERED');
  assert.equal(queueJobs.deadLetters[0].reason, 'NON_RETRYABLE_ERROR');
});

test('a retryable provider failure using the same code as payload validation still retries (e.g. claim reminder delivery)', async () => {
  // Regression: a blanket deny-list on WORKER_RUNTIME_VALIDATION_FAILED would dead-letter a
  // transient claim-reminder provider failure (which also uses this code) on the first attempt.
  const queueJobs = createFakeQueueJobs([baseRow({ maxAttempts: 3 })]);
  const app = createApp(async () => { throw new WorkerRuntimeError({ code: 'WORKER_RUNTIME_VALIDATION_FAILED', message: 'provider timeout', status: 502, retryable: true }); }, queueJobs);
  await app.start();

  const now = new Date('2026-01-02T00:00:00.000Z');
  const result = await claimAndProcessOneDurableQueueJob({ app, queueJobs, tenantId: 'tenant-1', queueNames: ['event.ingestion'], now });

  assert.equal(result.outcome, 'RETRY_SCHEDULED');
  assert.ok(new Date(queueJobs.rows.get('row-1').availableAt).getTime() > now.getTime());
});

test('a retry attempt actually re-executes the handler instead of being skipped as a duplicate', async () => {
  // Regression: buildJobContractFromQueueJobRow must scope idempotency.key to the attempt
  // (attemptsMade), not just the row's stable jobKey -- InMemoryIdempotencyStore never releases
  // a claim on failure, so a stable key would make every retry come back DUPLICATE_SKIPPED and
  // the handler would never run a second time.
  const queueJobs = createFakeQueueJobs([baseRow({ maxAttempts: 5 })]);
  let callCount = 0;
  const app = createApp(async () => {
    callCount += 1;
    if (callCount === 1) throwRetryableError();
    return { id: 'ingestion-1', tenantId: 'tenant-1' };
  }, queueJobs);
  await app.start();

  const firstAttemptAt = new Date('2026-01-02T00:00:00.000Z');
  const first = await claimAndProcessOneDurableQueueJob({ app, queueJobs, tenantId: 'tenant-1', queueNames: ['event.ingestion'], now: firstAttemptAt });
  assert.equal(first.outcome, 'RETRY_SCHEDULED');
  assert.equal(callCount, 1);

  const retryAt = new Date(queueJobs.rows.get('row-1').availableAt);
  const second = await claimAndProcessOneDurableQueueJob({ app, queueJobs, tenantId: 'tenant-1', queueNames: ['event.ingestion'], now: retryAt });

  assert.equal(callCount, 2, 'the handler must actually run again on retry, not be skipped as a duplicate');
  assert.equal(second.outcome, 'COMPLETED');
  assert.equal(queueJobs.rows.get('row-1').state, 'COMPLETED');
});

test('runDurableQueuePollLoop drains every claimable job then stops', async () => {
  const queueJobs = createFakeQueueJobs([baseRow({ id: 'row-1', jobKey: 'k1' }), baseRow({ id: 'row-2', jobKey: 'k2' })]);
  const calls = [];
  const app = createApp(async (context, input) => { calls.push(input); return { id: `ingestion-${calls.length}`, tenantId: input.tenantId }; }, queueJobs);
  await app.start();

  const allTerminal = () => [...queueJobs.rows.values()].every((row) => row.state === 'COMPLETED' || row.state === 'DEAD_LETTERED');
  await runDurableQueuePollLoop({
    app,
    queueJobs,
    tenantId: 'tenant-1',
    queueNames: ['event.ingestion'],
    pollIntervalMs: 5,
    isStopped: allTerminal,
    logger: { info() {}, warn() {}, error() {} },
  });

  assert.equal(calls.length, 2, 'both seeded jobs must be drained');
  assert.equal(queueJobs.rows.get('row-1').state, 'COMPLETED');
  assert.equal(queueJobs.rows.get('row-2').state, 'COMPLETED');
});

// ST1-013N: end-to-end durable lifecycle proof -- enqueue (real repository dedup semantics,
// not the pre-seeded fixture rows the tests above use) -> poll loop claims it -> handler
// executes and persists a side effect in an external store -> QueueJob becomes COMPLETED, and
// the side effect exists exactly once, not zero or two times.
test('enqueue -> durable poll loop -> handler executes and the side effect is persisted exactly once', async () => {
  const queueJobs = createFakeQueueJobs([]);
  const ingestedEvents = [];
  const app = createApp(async (context, input) => {
    const record = { id: `ingestion-${ingestedEvents.length + 1}`, tenantId: input.tenantId, providerEventId: input.providerEventId };
    ingestedEvents.push(record);
    return record;
  }, queueJobs);
  await app.start();

  const enqueued = await queueJobs.enqueue({ tenantId: 'tenant-1' }, {
    tenantId: 'tenant-1',
    queueName: 'event.ingestion',
    jobName: 'event.ingestion',
    jobKey: 'durable-e2e-key',
    payload: { event: { tenantId: 'tenant-1', source: { provider: 'WEB_FORM', providerEventId: 'provider-event-e2e', eventType: 'lead.created' }, payload: { leadId: 'lead-e2e' } } },
    maxAttempts: 3,
    correlationId: 'corr-e2e',
  });
  assert.equal(enqueued.state, 'WAITING');
  assert.equal(queueJobs.rows.size, 1);

  const result = await claimAndProcessOneDurableQueueJob({ app, queueJobs, tenantId: 'tenant-1', queueNames: ['event.ingestion'], now: new Date('2026-01-02T00:00:00.000Z') });

  assert.equal(result.claimed, true);
  assert.equal(result.outcome, 'COMPLETED');
  assert.equal(queueJobs.rows.get(enqueued.id).state, 'COMPLETED');
  assert.equal(ingestedEvents.length, 1, 'the handler side effect must be persisted exactly once');
  assert.equal(ingestedEvents[0].providerEventId, 'provider-event-e2e');
});

test('a duplicate enqueue under the same jobKey does not create a second QueueJob row or duplicate the side effect', async () => {
  const queueJobs = createFakeQueueJobs([]);
  const ingestedEvents = [];
  const app = createApp(async (context, input) => {
    ingestedEvents.push({ id: `ingestion-${ingestedEvents.length + 1}`, providerEventId: input.providerEventId });
    return { id: 'ingestion-x', tenantId: input.tenantId };
  }, queueJobs);
  await app.start();

  const enqueueInput = {
    tenantId: 'tenant-1',
    queueName: 'event.ingestion',
    jobName: 'event.ingestion',
    jobKey: 'durable-dedup-key',
    payload: { event: { tenantId: 'tenant-1', source: { provider: 'WEB_FORM', providerEventId: 'provider-event-dedup', eventType: 'lead.created' }, payload: { leadId: 'lead-dedup' } } },
    maxAttempts: 3,
    correlationId: 'corr-dedup',
  };

  const first = await queueJobs.enqueue({ tenantId: 'tenant-1' }, enqueueInput);
  const second = await queueJobs.enqueue({ tenantId: 'tenant-1' }, enqueueInput);

  assert.equal(second.id, first.id, 'a duplicate enqueue under the same (tenantId, queueName, jobKey) must return the existing row, not create a new one');
  assert.equal(queueJobs.rows.size, 1, 'only one QueueJob row must exist for the duplicate enqueue');

  const result = await claimAndProcessOneDurableQueueJob({ app, queueJobs, tenantId: 'tenant-1', queueNames: ['event.ingestion'], now: new Date('2026-01-02T00:00:00.000Z') });
  assert.equal(result.outcome, 'COMPLETED');

  // A third enqueue attempt after the job has already completed must still be a no-op: it
  // resolves to the same (now COMPLETED) row rather than re-queuing or re-running the handler.
  const third = await queueJobs.enqueue({ tenantId: 'tenant-1' }, enqueueInput);
  assert.equal(third.id, first.id);
  assert.equal(queueJobs.rows.size, 1);
  assert.equal(ingestedEvents.length, 1, 'the side effect must never be duplicated regardless of how many times the same jobKey is enqueued');
});
