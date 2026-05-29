import assert from "node:assert/strict";
import test from "node:test";
import {
  WorkerRuntimeError,
  assertJobExecutionTenantIsolation,
  buildDeadLetterContract,
  canTransitionJobLifecycleState,
  computeRetryDecision,
  createExecutionTokenContract,
  createWorkerHeartbeatContract,
  executeReplaySafeJob,
  extendVisibilityTimeout,
  isTerminalJobLifecycleState,
  jobContractSchema,
  queueContractSchema,
  shouldTreatAsPoisonMessage,
  transitionJobLifecycleState
} from "../dist/index.js";

const correlation = { correlationId: "corr-1", requestId: "req-1", traceId: "trace-1" };
const now = new Date("2026-01-01T00:00:00.000Z");

const retryPolicy = {
  tenantId: "tenant-1",
  maxAttempts: 3,
  backoff: { kind: "EXPONENTIAL", baseDelayMs: 1000, maxDelayMs: 10000, multiplier: 2, jitter: false },
  retryableErrorCodes: ["TRANSIENT"],
  nonRetryableErrorCodes: ["FATAL"],
  deadLetterAfterMaxAttempts: true,
  replaySafe: true
};

const poisonPolicy = {
  tenantId: "tenant-1",
  enabled: true,
  maxValidationFailures: 2,
  maxConsecutiveFailures: 5,
  quarantineQueueName: "tenant.poison",
  deadLetterOnPoison: true
};

const baseJob = {
  tenantId: "tenant-1",
  jobId: "job-1",
  queueName: "tenant.jobs",
  jobType: "email.send",
  version: 1,
  payload: { to: "customer@example.com" },
  correlation,
  idempotency: { tenantId: "tenant-1", scope: "JOB", key: "tenant-1:job-1", replaySafe: true, conflictPolicy: "SKIP_DUPLICATE" },
  scheduling: { tenantId: "tenant-1", queueName: "tenant.jobs", priority: "NORMAL" },
  workflow: { tenantId: "tenant-1", workflowId: "wf-1", runId: "run-1", replayMode: "LIVE", deterministic: true, correlation },
  approval: { tenantId: "tenant-1", approvalId: "approval-1", requiredState: "APPROVED", failClosed: true, correlation },
  retryPolicy,
  poisonPolicy,
  createdAt: now.toISOString(),
  metadata: {}
};

const baseLease = {
  tenantId: "tenant-1",
  leaseId: "lease-1",
  workerId: "worker-1",
  jobId: "job-1",
  queueName: "tenant.jobs",
  acquiredAt: now.toISOString(),
  expiresAt: new Date(now.getTime() + 60000).toISOString(),
  heartbeatIntervalMs: 10000,
  fencingToken: "fence-1",
  correlation
};

const baseToken = createExecutionTokenContract({
  tenantId: "tenant-1",
  jobId: "job-1",
  queueName: "tenant.jobs",
  leaseId: "lease-1",
  tokenId: "token-1",
  issuedAt: now,
  ttlMs: 60000,
  permissions: ["ACK", "NACK", "EMIT_TELEMETRY"],
  correlation
});

test("queue contracts validate adapter-neutral capabilities", () => {
  const queue = queueContractSchema.parse({
    tenantId: "tenant-1",
    queueName: "tenant.jobs",
    kind: "STANDARD",
    version: 1,
    capabilities: {
      supportsScheduling: true,
      supportsDelayedJobs: true,
      supportsRecurringJobs: true,
      supportsPriority: true,
      supportsFifoGroups: false,
      supportsVisibilityTimeout: true,
      supportsDeadLetterQueue: true,
      supportsLeaseExtension: true,
      supportsReplay: true
    },
    retention: { successfulJobRetentionMs: 3600000, failedJobRetentionMs: 86400000, deadLetterRetentionMs: 604800000 },
    maxPayloadBytes: 65536,
    visibilityTimeoutMs: 30000,
    deadLetterQueueName: "tenant.dead",
    metadata: {}
  });

  assert.equal(queue.tenantId, "tenant-1");
});

test("job contracts enforce tenant isolation for nested contracts", () => {
  assert.equal(jobContractSchema.parse(baseJob).tenantId, "tenant-1");

  assert.throws(() => jobContractSchema.parse({
    ...baseJob,
    idempotency: { ...baseJob.idempotency, tenantId: "tenant-2" }
  }), /Nested job contracts must use the job tenantId/u);
});

test("job lifecycle state machine allows deterministic transitions and rejects invalid ones", () => {
  assert.equal(canTransitionJobLifecycleState("READY", "LEASED"), true);
  assert.equal(canTransitionJobLifecycleState("SUCCEEDED", "READY"), false);
  assert.equal(isTerminalJobLifecycleState("DEAD_LETTERED"), true);

  const snapshot = {
    tenantId: "tenant-1",
    jobId: "job-1",
    queueName: "tenant.jobs",
    state: "READY",
    attempt: 0,
    maxAttempts: 3,
    updatedAt: now.toISOString(),
    correlation
  };

  const leased = transitionJobLifecycleState({ snapshot, to: "LEASED", now, leaseId: "lease-1", executionTokenId: "token-1" });
  assert.equal(leased.state, "LEASED");
  assert.equal(leased.leaseId, "lease-1");

  assert.throws(() => transitionJobLifecycleState({ snapshot: leased, to: "SUCCEEDED", now }), WorkerRuntimeError);
});

test("retry policies are deterministic and dead-letter terminal attempts", () => {
  const retry = computeRetryDecision({ policy: retryPolicy, attempt: 0, errorCode: "TRANSIENT", now, tenantId: "tenant-1", correlation });
  assert.deepEqual(retry, { action: "RETRY", nextAttempt: 1, delayMs: 1000, nextRunAt: "2026-01-01T00:00:01.000Z" });

  const dead = computeRetryDecision({ policy: retryPolicy, attempt: 2, errorCode: "TRANSIENT", now, tenantId: "tenant-1", correlation });
  assert.equal(dead.action, "DEAD_LETTER");
  assert.equal(dead.reason, "MAX_ATTEMPTS_EXCEEDED");

  const fatal = computeRetryDecision({ policy: retryPolicy, attempt: 0, errorCode: "FATAL", now, tenantId: "tenant-1", correlation });
  assert.equal(fatal.reason, "NON_RETRYABLE_ERROR");
});

test("leases, tokens, and visibility timeouts enforce execution boundaries", () => {
  assert.doesNotThrow(() => assertJobExecutionTenantIsolation(baseJob, baseLease, baseToken));
  assert.throws(() => assertJobExecutionTenantIsolation(baseJob, { ...baseLease, tenantId: "tenant-2" }, baseToken), WorkerRuntimeError);

  const extended = extendVisibilityTimeout({
    current: {
      tenantId: "tenant-1",
      jobId: "job-1",
      queueName: "tenant.jobs",
      leaseId: "lease-1",
      invisibleUntil: new Date(now.getTime() + 30000).toISOString(),
      maxExtensionMs: 30000,
      extensionCount: 0,
      correlation
    },
    now,
    extensionMs: 1000
  });
  assert.equal(extended.extensionCount, 1);
  assert.equal(extended.invisibleUntil, "2026-01-01T00:00:31.000Z");
});

test("dead-letter and poison message contracts are replay-aware", () => {
  assert.equal(shouldTreatAsPoisonMessage({ policy: poisonPolicy, tenantId: "tenant-1", validationFailures: 2, consecutiveFailures: 0, correlation }), true);

  const deadLetter = buildDeadLetterContract({
    job: jobContractSchema.parse(baseJob),
    sourceQueueName: "tenant.jobs",
    deadLetterQueueName: "tenant.dead",
    reason: "POISON_MESSAGE",
    failedAt: now,
    attempt: 2,
    quarantine: true
  });

  assert.equal(deadLetter.replayable, false);
  assert.equal(deadLetter.quarantine, true);
});

test("worker heartbeat contracts compute next due time without nondeterminism", () => {
  const heartbeat = createWorkerHeartbeatContract({
    tenantId: "tenant-1",
    workerId: "worker-1",
    leaseIds: ["lease-1"],
    recordedAt: now,
    heartbeatIntervalMs: 5000,
    health: "HEALTHY",
    correlation,
    metrics: { runningJobs: 1, completedJobs: 2, failedJobs: 0, deadLetteredJobs: 0 }
  });

  assert.equal(heartbeat.nextHeartbeatDueAt, "2026-01-01T00:00:05.000Z");
});

test("replay-safe execution integrates idempotency, approval, workflow, and telemetry ports", async () => {
  const events = [];
  const workflowEvents = [];
  const claims = [];
  const completions = [];

  const result = await executeReplaySafeJob({
    job: baseJob,
    lease: baseLease,
    token: baseToken,
    handler: { execute: (context) => ({ handledTenantId: context.tenantId, replayMode: context.replayMode }) },
    ports: {
      idempotency: {
        claim: (contract) => {
          claims.push(contract.key);
          return { status: "CLAIMED" };
        },
        complete: (completion) => {
          completions.push(completion);
        }
      },
      approval: {
        assertApproved: (approval) => {
          assert.equal(approval.failClosed, true);
        }
      },
      workflow: {
        recordJobEvent: (event) => {
          workflowEvents.push(event);
        }
      },
      clock: { now: () => now },
      telemetry: {
        startSpan: (name, attributes) => ({ name, attributes, end: (status) => events.push({ type: "span", status }) }),
        recordEvent: (event) => events.push(event)
      }
    }
  });

  assert.equal(result.status, "SUCCEEDED");
  assert.deepEqual(claims, ["tenant-1:job-1"]);
  assert.equal(completions.length, 1);
  assert.equal(workflowEvents.length, 1);
  assert.equal(events.some((event) => event.type === "JOB_SUCCEEDED"), true);
});



test("replay-safe execution fails closed when approval assertion throws", async () => {
  const calls = [];

  await assert.rejects(
    async () => executeReplaySafeJob({
      job: baseJob,
      lease: baseLease,
      token: baseToken,
      handler: { execute: () => { throw new Error("handler should not run without approval"); } },
      ports: {
        clock: { now: () => now },
        idempotency: {
          claim: (contract) => {
            calls.push(["claim", contract.key]);
            return { status: "CLAIMED" };
          },
          complete: () => {
            calls.push(["complete"]);
          }
        },
        approval: {
          assertApproved: () => {
            calls.push(["assertApproved"]);
            throw new WorkerRuntimeError({
              code: "WORKER_RUNTIME_APPROVAL_REQUIRED",
              message: "Approval is required before job execution",
              status: 409,
              correlation
            });
          }
        }
      }
    }),
    (error) => error instanceof WorkerRuntimeError && error.code === "WORKER_RUNTIME_APPROVAL_REQUIRED"
  );

  assert.deepEqual(calls, [["claim", "tenant-1:job-1"], ["assertApproved"]]);
});

test("replay-safe execution skips duplicate idempotency claims", async () => {
  const result = await executeReplaySafeJob({
    job: { ...baseJob, approval: undefined, workflow: undefined },
    lease: baseLease,
    token: baseToken,
    handler: { execute: () => { throw new Error("handler should not run"); } },
    ports: {
      clock: { now: () => now },
      idempotency: {
        claim: () => ({ status: "DUPLICATE", previousResult: { cached: true } }),
        complete: () => { throw new Error("complete should not run"); }
      }
    }
  });

  assert.deepEqual(result, { status: "DUPLICATE_SKIPPED", result: { cached: true } });
});
