import assert from "node:assert/strict";
import test from "node:test";

import { RuntimeJobService } from "@whisperm/services";

const tenant = { tenantId: "tenant-1" };

// ST1-013M: a fake QueueJobRepository is sufficient here -- RuntimeJobService is pure
// orchestration over that interface (payload validation + retry-decision math); the repository's
// own Postgres-backed claim/lock semantics are covered by packages/repositories/test/queue-job.test.mjs.
const createFakeQueueJobs = () => {
  const rows = new Map();
  const deadLetters = [];
  let nextId = 1;
  return {
    rows,
    deadLetters,
    async enqueue(context, input) {
      const key = `${input.tenantId}:${input.queueName}:${input.jobKey}`;
      const existing = rows.get(key);
      if (existing !== undefined) return existing;
      const row = { id: `job-${nextId++}`, state: "WAITING", attemptsMade: 0, maxAttempts: input.maxAttempts ?? 1, availableAt: input.availableAt ?? new Date().toISOString(), lockedUntil: null, lastError: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...input };
      rows.set(key, row);
      return row;
    },
    async claimNext() { return null; },
    async markCompleted(context, id) {
      const row = [...rows.values()].find((candidate) => candidate.id === id);
      row.state = "COMPLETED";
      return row;
    },
    async markRetryScheduled(context, id, input) {
      const row = [...rows.values()].find((candidate) => candidate.id === id);
      row.state = "RETRY_SCHEDULED";
      row.availableAt = input.availableAt;
      row.lastError = input.lastError ?? row.lastError;
      return row;
    },
    async markDeadLettered(context, id, input) {
      const row = [...rows.values()].find((candidate) => candidate.id === id);
      row.state = "DEAD_LETTERED";
      row.lastError = input.lastError ?? row.lastError;
      return row;
    },
    async markCancelled(context, id) {
      const row = [...rows.values()].find((candidate) => candidate.id === id);
      row.state = "CANCELLED";
      return row;
    },
    async findById(context, id) {
      return [...rows.values()].find((candidate) => candidate.id === id) ?? null;
    },
    async recordDeadLetter(context, input) {
      deadLetters.push(input);
    },
  };
};

test("enqueueRuntimeJob validates the payload against the registered contract and persists it", async () => {
  const queueJobs = createFakeQueueJobs();
  const service = new RuntimeJobService({ queueJobs });

  const row = await service.enqueueRuntimeJob(tenant, {
    queueName: "marketplace.invite",
    jobName: "marketplace.invite.send",
    jobKey: "invite-1",
    payload: { tenantId: "tenant-1", captureId: "capture-1", preferredChannel: "SMS" },
    correlationId: "corr-1",
  });

  assert.equal(row.state, "WAITING");
  assert.equal(row.payload.captureId, "capture-1");
  assert.equal(row.payload.channel, "SMS", "transform derives channel from preferredChannel");
});

test("enqueueRuntimeJob rejects a payload that fails the registered contract instead of persisting garbage", async () => {
  const queueJobs = createFakeQueueJobs();
  const service = new RuntimeJobService({ queueJobs });

  await assert.rejects(
    () => service.enqueueRuntimeJob(tenant, {
      queueName: "marketplace.invite",
      jobName: "marketplace.invite.send",
      jobKey: "invite-bad",
      // missing captureId/opportunityId -- the contract requires one of them
      payload: { tenantId: "tenant-1" },
      correlationId: "corr-1",
    }),
  );
  assert.equal(queueJobs.rows.size, 0, "an invalid payload must never reach the durable queue");
});

test("enqueueRuntimeJob rejects a queue/job type with no registered contract, with a clear error", async () => {
  const queueJobs = createFakeQueueJobs();
  const service = new RuntimeJobService({ queueJobs });

  await assert.rejects(
    () => service.enqueueRuntimeJob(tenant, {
      queueName: "not.a.real.queue",
      jobName: "not.a.real.job",
      jobKey: "k",
      payload: {},
      correlationId: "corr-1",
    }),
    /No runtime job payload contract is registered/,
  );
});

test("enqueueRuntimeJob is idempotent: a duplicate jobKey returns the existing row instead of creating a second one", async () => {
  const queueJobs = createFakeQueueJobs();
  const service = new RuntimeJobService({ queueJobs });
  const input = {
    queueName: "marketplace.invite",
    jobName: "marketplace.invite.send",
    jobKey: "dup",
    payload: { tenantId: "tenant-1", captureId: "capture-1" },
    correlationId: "corr-1",
  };

  const first = await service.enqueueRuntimeJob(tenant, input);
  const second = await service.enqueueRuntimeJob(tenant, input);

  assert.equal(first.id, second.id);
  assert.equal(queueJobs.rows.size, 1);
});

test("failRuntimeJob schedules a retry with backoff for a retryable error under maxAttempts", async () => {
  const queueJobs = createFakeQueueJobs();
  const service = new RuntimeJobService({ queueJobs });
  const enqueued = await service.enqueueRuntimeJob(tenant, {
    queueName: "marketplace.invite",
    jobName: "marketplace.invite.send",
    jobKey: "retry-me",
    payload: { tenantId: "tenant-1", captureId: "capture-1" },
    correlationId: "corr-1",
  });

  const now = new Date("2026-07-09T00:00:00.000Z");
  const updated = await service.failRuntimeJob(tenant, {
    id: enqueued.id,
    attempt: 0,
    errorCode: "PROVIDER_UNAVAILABLE",
    errorMessage: "provider timed out",
    retryPolicy: { maxAttempts: 3 },
    queueName: "marketplace.invite",
    jobName: "marketplace.invite.send",
    jobKey: "retry-me",
    payload: {},
    correlationId: "corr-1",
    now,
  });

  assert.equal(updated.state, "RETRY_SCHEDULED");
  assert.ok(new Date(updated.availableAt).getTime() > now.getTime(), "retry must be scheduled in the future");
  assert.equal(queueJobs.deadLetters.length, 0);
});

test("failRuntimeJob dead-letters once maxAttempts is exhausted, recording a DeadLetterJob row", async () => {
  const queueJobs = createFakeQueueJobs();
  const service = new RuntimeJobService({ queueJobs });
  const enqueued = await service.enqueueRuntimeJob(tenant, {
    queueName: "marketplace.invite",
    jobName: "marketplace.invite.send",
    jobKey: "exhausted",
    payload: { tenantId: "tenant-1", captureId: "capture-1" },
    correlationId: "corr-1",
  });

  const updated = await service.failRuntimeJob(tenant, {
    id: enqueued.id,
    attempt: 2, // already made 2 attempts; this would be the 3rd
    errorCode: "PROVIDER_UNAVAILABLE",
    errorMessage: "provider timed out",
    retryPolicy: { maxAttempts: 3 },
    queueName: "marketplace.invite",
    jobName: "marketplace.invite.send",
    jobKey: "exhausted",
    payload: { tenantId: "tenant-1" },
    correlationId: "corr-1",
  });

  assert.equal(updated.state, "DEAD_LETTERED");
  assert.equal(queueJobs.deadLetters.length, 1);
  assert.equal(queueJobs.deadLetters[0].reason, "MAX_ATTEMPTS_EXCEEDED");
});

test("failRuntimeJob dead-letters immediately for a non-retryable error code, regardless of attempt count", async () => {
  const queueJobs = createFakeQueueJobs();
  const service = new RuntimeJobService({ queueJobs });
  const enqueued = await service.enqueueRuntimeJob(tenant, {
    queueName: "marketplace.invite",
    jobName: "marketplace.invite.send",
    jobKey: "non-retryable",
    payload: { tenantId: "tenant-1", captureId: "capture-1" },
    correlationId: "corr-1",
  });

  const updated = await service.failRuntimeJob(tenant, {
    id: enqueued.id,
    attempt: 0,
    errorCode: "WORKER_RUNTIME_VALIDATION_FAILED",
    errorMessage: "invalid payload",
    retryPolicy: { maxAttempts: 5, nonRetryableErrorCodes: ["WORKER_RUNTIME_VALIDATION_FAILED"] },
    queueName: "marketplace.invite",
    jobName: "marketplace.invite.send",
    jobKey: "non-retryable",
    payload: { tenantId: "tenant-1" },
    correlationId: "corr-1",
  });

  assert.equal(updated.state, "DEAD_LETTERED");
  assert.equal(queueJobs.deadLetters[0].reason, "NON_RETRYABLE_ERROR");
});

test("completeRuntimeJob/retryRuntimeJob/cancelRuntimeJob delegate to the repository", async () => {
  const queueJobs = createFakeQueueJobs();
  const service = new RuntimeJobService({ queueJobs });
  const a = await service.enqueueRuntimeJob(tenant, { queueName: "marketplace.invite", jobName: "marketplace.invite.send", jobKey: "a", payload: { tenantId: "tenant-1", captureId: "c" }, correlationId: "corr" });
  const b = await service.enqueueRuntimeJob(tenant, { queueName: "marketplace.invite", jobName: "marketplace.invite.send", jobKey: "b", payload: { tenantId: "tenant-1", captureId: "c" }, correlationId: "corr" });

  const completed = await service.completeRuntimeJob(tenant, a.id);
  const cancelled = await service.cancelRuntimeJob(tenant, b.id);

  assert.equal(completed.state, "COMPLETED");
  assert.equal(cancelled.state, "CANCELLED");
});
