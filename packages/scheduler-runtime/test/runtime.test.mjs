import assert from "node:assert/strict";
import test from "node:test";
import {
  SchedulerRuntimeError,
  applyMisfirePolicy,
  assertScheduleTenantIsolation,
  buildSchedulerIdempotencyKey,
  calculateNextRunAt,
  calculateScheduleRetryDelayMs,
  canTransitionScheduleState,
  createScheduleExecutionContract,
  createSchedulerHeartbeatContract,
  detectScheduleDrift,
  dispatchScheduleExecution,
  distributedCoordinationContractSchema,
  isLeaseExpired,
  isTerminalScheduleState,
  scheduleExecutionContractSchema,
  scheduleRegistrationContractSchema,
  schedulerLeaseContractSchema,
  transitionScheduleState
} from "../dist/index.js";

const now = new Date("2026-01-01T00:00:00.000Z");
const correlation = { correlationId: "corr-1", requestId: "req-1" };

const baseRegistration = {
  scheduleId: "schedule-1",
  tenantId: "tenant-1",
  name: "billing.expiration",
  version: 1,
  definition: {
    kind: "INTERVAL",
    everyMs: 60000,
    anchorAt: now.toISOString(),
    timezone: { timeZone: "UTC", preserveWallClockTime: false, daylightSavingPolicy: "RUN_AT_NEXT_VALID_TIME" }
  },
  target: {
    integration: "APPROVAL_EXPIRATION",
    targetId: "approval-1",
    tenantId: "tenant-1",
    payload: { approvalId: "approval-1" }
  },
  state: "REGISTERED",
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  createdBy: "user-1",
  idempotencyKey: "register-1",
  correlation,
  metadata: { purpose: "approval-expiration" }
};

test("schedule registration validates typed schedule contracts and tenant isolation", () => {
  const registration = scheduleRegistrationContractSchema.parse(baseRegistration);
  assert.equal(registration.definition.kind, "INTERVAL");
  assert.equal(registration.target.tenantId, "tenant-1");

  assert.throws(() => scheduleRegistrationContractSchema.parse({
    ...baseRegistration,
    target: { ...baseRegistration.target, tenantId: "tenant-2" }
  }), /target tenantId/u);

  assert.throws(() => scheduleRegistrationContractSchema.parse({
    ...baseRegistration,
    definition: { kind: "CRON", expression: "0 0 * * *", fieldCount: 6, timezone: { timeZone: "America/New_York", preserveWallClockTime: true, daylightSavingPolicy: "RUN_AT_NEXT_VALID_TIME" } }
  }), /field count/u);
});

test("state machine allows only deterministic lifecycle transitions", () => {
  assert.equal(canTransitionScheduleState("REGISTERED", "ENABLED"), true);
  assert.equal(canTransitionScheduleState("ENABLED", "SUCCEEDED"), false);
  assert.equal(isTerminalScheduleState("EXHAUSTED"), true);

  const snapshot = {
    tenantId: "tenant-1",
    scheduleId: "schedule-1",
    state: "REGISTERED",
    updatedAt: now.toISOString(),
    occurrenceCount: 0,
    consecutiveFailures: 0,
    correlation
  };

  const enabled = transitionScheduleState({ snapshot, to: "ENABLED", now, nextRunAt: new Date("2026-01-01T00:01:00.000Z") });
  assert.equal(enabled.state, "ENABLED");
  assert.equal(enabled.nextRunAt, "2026-01-01T00:01:00.000Z");

  assert.throws(() => transitionScheduleState({ snapshot: enabled, to: "SUCCEEDED", now }), SchedulerRuntimeError);
});

test("deterministic schedule primitives compute next interval, recurring, and one-time runs", () => {
  assert.equal(calculateNextRunAt({
    definition: { kind: "INTERVAL", everyMs: 60000, anchorAt: now.toISOString() },
    after: new Date("2026-01-01T00:02:30.000Z")
  }), "2026-01-01T00:03:00.000Z");

  assert.equal(calculateNextRunAt({
    definition: { kind: "ONE_TIME", runAt: "2026-01-01T01:00:00.000Z" },
    after: now
  }), "2026-01-01T01:00:00.000Z");

  assert.equal(calculateNextRunAt({
    definition: { kind: "ONE_TIME", runAt: "2025-12-31T23:00:00.000Z" },
    after: now
  }), undefined);

  assert.equal(calculateNextRunAt({
    definition: { kind: "RECURRING", everyMs: 60000, startsAt: now.toISOString(), maxOccurrences: 1 },
    after: now,
    occurrenceCount: 1
  }), undefined);
});

test("lease, leadership, heartbeat, and coordination contracts enforce safe distributed coordination", () => {
  const lease = schedulerLeaseContractSchema.parse({
    tenantId: "tenant-1",
    scheduleId: "schedule-1",
    leaseId: "lease-1",
    ownerId: "scheduler-1",
    acquiredAt: now.toISOString(),
    expiresAt: "2026-01-01T00:00:30.000Z",
    heartbeatIntervalMs: 10000,
    fencingToken: "fence-1",
    correlation
  });

  assert.equal(isLeaseExpired(lease, new Date("2026-01-01T00:00:29.000Z")), false);
  assert.equal(isLeaseExpired(lease, new Date("2026-01-01T00:00:30.000Z")), true);

  const heartbeat = createSchedulerHeartbeatContract({
    tenantId: "tenant-1",
    schedulerId: "scheduler-1",
    leaseIds: ["lease-1"],
    recordedAt: now,
    heartbeatIntervalMs: 5000,
    health: "HEALTHY",
    correlation,
    metrics: { dueSchedules: 1, runningSchedules: 0, completedExecutions: 2, failedExecutions: 0, misfires: 0 }
  });
  assert.equal(heartbeat.nextHeartbeatDueAt, "2026-01-01T00:00:05.000Z");

  assert.throws(() => distributedCoordinationContractSchema.parse({
    tenantId: "tenant-1",
    coordinatorId: "scheduler-1",
    backend: "POSTGRES",
    leaseTtlMs: 10000,
    heartbeatIntervalMs: 10000,
    fencingRequired: true,
    replayProtectionRequired: true,
    correlation
  }), /heartbeatIntervalMs/u);
});

test("execution contracts compose replay protection and idempotency", () => {
  const registration = scheduleRegistrationContractSchema.parse(baseRegistration);
  const execution = createScheduleExecutionContract({
    registration,
    executionId: "execution-1",
    dueAt: new Date("2026-01-01T00:01:00.000Z"),
    now,
    leaseId: "lease-1"
  });

  assert.equal(execution.idempotency.key, buildSchedulerIdempotencyKey({ tenantId: "tenant-1", scheduleId: "schedule-1", targetId: "approval-1", dueAt: "2026-01-01T00:01:00.000Z" }));
  assert.equal(execution.replay.replaySafe, true);

  assert.throws(() => scheduleExecutionContractSchema.parse({
    ...execution,
    replay: { ...execution.replay, tenantId: "tenant-2" }
  }), /nested execution contracts/u);
});

test("drift, misfire, and retry policies are deterministic", () => {
  assert.deepEqual(detectScheduleDrift({
    expectedRunAt: now,
    observedAt: new Date("2026-01-01T00:02:00.000Z"),
    policy: { enabled: true, maxDriftMs: 60000, action: "AUDIT" }
  }), { drifted: true, driftMs: 120000, action: "AUDIT" });

  assert.deepEqual(applyMisfirePolicy({
    dueAt: now,
    observedAt: new Date("2026-01-01T00:02:00.000Z"),
    policy: { action: "RUN_ONCE", gracePeriodMs: 60000, maxCatchUpRuns: 1 }
  }), { action: "RUN_ONCE", misfired: true });

  assert.equal(calculateScheduleRetryDelayMs({ maxAttempts: 3, initialDelayMs: 1000, maxDelayMs: 5000, backoffMultiplier: 2, jitter: false, retryableErrorCodes: ["TRANSIENT"] }, 3), 4000);
});

test("tenant isolation helper fails closed", () => {
  assert.doesNotThrow(() => assertScheduleTenantIsolation("tenant-1", [{ tenantId: "tenant-1", correlation }]));
  assert.throws(() => assertScheduleTenantIsolation("tenant-1", [{ tenantId: "tenant-2", correlation }]), SchedulerRuntimeError);
});

test("runtime dispatch integrates idempotency, workflow, worker, approval expiration, queue, telemetry, and observability ports", async () => {
  const registration = scheduleRegistrationContractSchema.parse(baseRegistration);
  const execution = createScheduleExecutionContract({ registration, executionId: "execution-1", dueAt: new Date("2026-01-01T00:01:00.000Z"), now });
  const calls = [];

  const result = await dispatchScheduleExecution(execution, {
    idempotency: {
      claim: (contract) => {
        calls.push(`claim:${contract.key}`);
        return "CLAIMED";
      },
      complete: (contract) => {
        calls.push(`complete:${contract.key}`);
      }
    },
    workflow: { recordScheduledExecution: (contract) => calls.push(`workflow:${contract.executionId}`) },
    worker: { enqueueScheduledWork: (contract) => calls.push(`worker:${contract.executionId}`) },
    queue: { publishScheduledJob: (contract) => calls.push(`queue:${contract.executionId}`) },
    approvalExpiration: { expireApproval: (input) => calls.push(`approval:${input.approvalId}`) },
    telemetry: { emit: (event) => calls.push(`telemetry:${event.name}`) },
    observability: {
      audit: (contract) => calls.push(`audit:${contract.auditId}`),
      history: (contract) => calls.push(`history:${contract.historyId}`)
    }
  });

  assert.equal(result, "DISPATCHED");
  assert.deepEqual(calls, [
    `claim:${execution.idempotency.key}`,
    "workflow:execution-1",
    "worker:execution-1",
    "queue:execution-1",
    "approval:approval-1",
    "telemetry:scheduler.execution.dispatched",
    `complete:${execution.idempotency.key}`
  ]);

  assert.equal(await dispatchScheduleExecution(execution, { idempotency: { claim: () => "DUPLICATE", complete: () => undefined } }), "DUPLICATE");
  await assert.rejects(() => dispatchScheduleExecution(execution, { idempotency: { claim: () => "CONFLICT", complete: () => undefined } }), SchedulerRuntimeError);
});
