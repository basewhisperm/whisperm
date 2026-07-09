import { jobContractSchema, type DeadLetterQueueContract, type JobContract } from "@whisperm/worker-runtime";
import type { QueueJobRecord, QueueJobRepository } from "@whisperm/repositories";
import type { CorrelationMetadata, TenantScoped } from "@whisperm/types";
import type { QueueRegistration, QueueRuntimePort, RegisteredWorkerDefinition, WorkerApplication, WorkerProcessJobResult } from "./index.js";

/**
 * ST1-013M: the canonical durable queue surface. Replaces the previous InMemoryQueueRuntime
 * bootstrap, which registered job handlers but never polled or consumed the durable QueueJob
 * table (see docs/runtime/runtime-surface.md for why QueueJob was chosen over introducing
 * BullMQ/Redis, and the decommissioned no-op behavior it replaces).
 *
 * PrismaQueueRuntime only implements the producer-registration bookkeeping port
 * (QueueRuntimePort) that WorkerApplication expects; its `deadLetter()` is the one callback
 * WorkerApplication invokes automatically when a job's retry policy is exhausted, so this class
 * persists that outcome to DeadLetterJob + marks the QueueJob row DEAD_LETTERED. Claiming,
 * dispatching, and persisting SUCCEEDED/RETRY_SCHEDULED outcomes is done by
 * `claimAndProcessOneDurableQueueJob` / `runDurableQueuePollLoop` below, which poll the QueueJob
 * table directly (there is nothing else to "register" a poller against).
 */
export class PrismaQueueRuntime implements QueueRuntimePort {
  constructor(private readonly deps: { readonly queueJobs: QueueJobRepository }) {}

  register(_input: QueueRegistration): void {
    // No-op: durable claimability is queried directly from QueueJob by (tenantId, queueName),
    // not tracked via an in-memory registration table.
  }

  startWorker(_worker: RegisteredWorkerDefinition): void {
    // No-op: see runDurableQueuePollLoop for the actual polling loop.
  }

  stopWorker(_workerName: string): void {
    // No-op: the poll loop owns its own stop signal (see runDurableQueuePollLoop's isStopped).
  }

  async deadLetter(contract: DeadLetterQueueContract): Promise<void> {
    const context: TenantScoped = { tenantId: contract.tenantId };
    const lastError = contract.error === undefined ? undefined : { code: contract.error.code, message: contract.error.message };
    await this.deps.queueJobs.recordDeadLetter(context, {
      tenantId: contract.tenantId,
      queueName: contract.sourceQueueName,
      jobName: contract.job.jobType,
      jobKey: contract.job.idempotency.key,
      payload: contract.job.payload,
      reason: contract.reason,
      attemptsMade: contract.attempt,
      correlationId: contract.correlation.correlationId,
      metadata: lastError,
    });
    await this.deps.queueJobs.markDeadLettered(context, contract.job.jobId, { lastError });
  }
}

const defaultDurableRetryPolicy = (tenantId: string, maxAttempts: number) => ({
  tenantId,
  maxAttempts: Math.max(1, maxAttempts),
  backoff: { kind: "EXPONENTIAL" as const, baseDelayMs: 60_000, maxDelayMs: 3_600_000, multiplier: 2, jitter: false as const },
  retryableErrorCodes: [],
  // Matches the convention already established for job fixtures elsewhere in this codebase
  // (see apps/worker/test/worker.test.js): a validation or tenant-isolation failure is a
  // configuration/data problem, not a transient one, and must not spin through retries.
  nonRetryableErrorCodes: ["WORKER_RUNTIME_VALIDATION_FAILED", "WORKER_RUNTIME_TENANT_ISOLATION_VIOLATION"],
  deadLetterAfterMaxAttempts: true as const,
  replaySafe: true as const,
});

/** Builds the JobContract WorkerApplication.processJob expects from a persisted QueueJob row. */
export const buildJobContractFromQueueJobRow = (row: QueueJobRecord): JobContract => {
  const correlation: CorrelationMetadata = { correlationId: row.correlationId };
  return jobContractSchema.parse({
    tenantId: row.tenantId,
    jobId: row.id,
    queueName: row.queueName,
    jobType: row.jobName,
    version: 1,
    payload: row.payload,
    correlation,
    idempotency: {
      tenantId: row.tenantId,
      scope: "JOB",
      key: row.jobKey,
      replaySafe: true,
      conflictPolicy: "SKIP_DUPLICATE",
    },
    scheduling: { tenantId: row.tenantId, queueName: row.queueName, priority: "NORMAL" },
    retryPolicy: defaultDurableRetryPolicy(row.tenantId, row.maxAttempts),
    poisonPolicy: { tenantId: row.tenantId, enabled: false, maxValidationFailures: 5, maxConsecutiveFailures: 5, deadLetterOnPoison: true },
    createdAt: row.createdAt,
    metadata: {},
  });
};

export interface ClaimAndProcessResult {
  readonly claimed: boolean;
  readonly jobId?: string | undefined;
  readonly outcome?: "COMPLETED" | "RETRY_SCHEDULED" | "DEAD_LETTERED" | undefined;
}

/**
 * One unit of durable work: claim -> validate -> dispatch -> record. Claiming atomically
 * transitions the row to ACTIVE (see PrismaQueueJobRepository.claimNext), so a worker restart or
 * a second worker process racing this call never double-executes the same job -- and a job whose
 * lock expired because a previous worker crashed mid-flight is reclaimed the same way.
 */
export const claimAndProcessOneDurableQueueJob = async (input: {
  readonly app: Pick<WorkerApplication, "processJob">;
  readonly queueJobs: QueueJobRepository;
  readonly tenantId: string;
  readonly queueNames: readonly string[];
  readonly now?: Date | undefined;
  readonly lockDurationMs?: number | undefined;
}): Promise<ClaimAndProcessResult> => {
  const now = input.now ?? new Date();
  const claimed = await input.queueJobs.claimNext({
    tenantId: input.tenantId,
    queueNames: input.queueNames,
    now,
    lockDurationMs: input.lockDurationMs ?? 300_000,
  });
  if (claimed === null) return { claimed: false };

  const context: TenantScoped = { tenantId: claimed.tenantId };
  // Claiming already incremented attemptsMade for the attempt in progress, so the number of
  // attempts made *before* this one is one less.
  const attempt = Math.max(0, claimed.attemptsMade - 1);

  let result: WorkerProcessJobResult;
  try {
    const job = buildJobContractFromQueueJobRow(claimed);
    result = await input.app.processJob({ job, attempt });
  } catch (error) {
    // processJob only throws for a shape/registration problem (e.g. no handler registered for
    // this queueName/jobType) rather than a handler execution failure -- those are already
    // turned into RETRY_SCHEDULED/DEAD_LETTERED results by processJob itself. Treat this as
    // terminal: retrying won't fix a missing handler registration.
    const message = error instanceof Error ? error.message : "Durable queue job dispatch failed";
    await input.queueJobs.recordDeadLetter(context, {
      tenantId: claimed.tenantId,
      queueName: claimed.queueName,
      jobName: claimed.jobName,
      jobKey: claimed.jobKey,
      payload: claimed.payload,
      reason: "VALIDATION_FAILED",
      attemptsMade: claimed.attemptsMade,
      correlationId: claimed.correlationId,
      metadata: { message },
    });
    await input.queueJobs.markDeadLettered(context, claimed.id, { lastError: { message } });
    return { claimed: true, jobId: claimed.id, outcome: "DEAD_LETTERED" };
  }

  if (result.status === "SUCCEEDED" || result.status === "DUPLICATE_SKIPPED") {
    await input.queueJobs.markCompleted(context, claimed.id);
    return { claimed: true, jobId: claimed.id, outcome: "COMPLETED" };
  }
  if (result.status === "RETRY_SCHEDULED") {
    const nextRunAt = typeof result.result.nextRunAt === "string" && result.result.nextRunAt.length > 0
      ? result.result.nextRunAt
      : new Date(now.getTime() + 60_000).toISOString();
    await input.queueJobs.markRetryScheduled(context, claimed.id, { availableAt: nextRunAt });
    return { claimed: true, jobId: claimed.id, outcome: "RETRY_SCHEDULED" };
  }
  // DEAD_LETTERED: already persisted by PrismaQueueRuntime.deadLetter, invoked internally by
  // WorkerApplication.handleJobFailure as part of processJob's own retry-decision logic.
  return { claimed: true, jobId: claimed.id, outcome: "DEAD_LETTERED" };
};

export interface DurablePollLoopLogger {
  info(message: string, attributes: Readonly<Record<string, unknown>>): void;
  warn(message: string, attributes: Readonly<Record<string, unknown>>): void;
  error(message: string, attributes: Readonly<Record<string, unknown>>): void;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Drives claimAndProcessOneDurableQueueJob in a loop until `isStopped()` returns true. Drains up
 * to `batchSizePerTick` jobs back-to-back before sleeping `pollIntervalMs`, so a burst of enqueued
 * work is processed promptly instead of one job per poll interval.
 */
export const runDurableQueuePollLoop = async (input: {
  readonly app: Pick<WorkerApplication, "processJob">;
  readonly queueJobs: QueueJobRepository;
  readonly tenantId: string;
  readonly queueNames: readonly string[];
  readonly isStopped: () => boolean;
  readonly pollIntervalMs?: number | undefined;
  readonly lockDurationMs?: number | undefined;
  readonly batchSizePerTick?: number | undefined;
  readonly logger?: DurablePollLoopLogger | undefined;
}): Promise<void> => {
  const pollIntervalMs = input.pollIntervalMs ?? 2_000;
  const batchSizePerTick = input.batchSizePerTick ?? 10;

  while (!input.isStopped()) {
    let claimedAnyThisTick = false;
    for (let iteration = 0; iteration < batchSizePerTick && !input.isStopped(); iteration += 1) {
      let outcome: ClaimAndProcessResult;
      try {
        outcome = await claimAndProcessOneDurableQueueJob({
          app: input.app,
          queueJobs: input.queueJobs,
          tenantId: input.tenantId,
          queueNames: input.queueNames,
          lockDurationMs: input.lockDurationMs,
        });
      } catch (error) {
        input.logger?.error("durable queue poll iteration failed", { errorMessage: error instanceof Error ? error.message : "unknown error" });
        break;
      }
      if (!outcome.claimed) break;
      claimedAnyThisTick = true;
      input.logger?.info("durable queue job processed", { jobId: outcome.jobId, outcome: outcome.outcome });
    }
    if (!claimedAnyThisTick && !input.isStopped()) {
      await sleep(pollIntervalMs);
    }
  }
};
