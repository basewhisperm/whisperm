import { computeRetryDecision, retryPolicySchema, type RetryPolicy } from "@whisperm/worker-runtime";
import type { QueueJobRecord, QueueJobRepository } from "@whisperm/repositories";
import type { CorrelationMetadata, TenantScoped } from "@whisperm/types";
import { runtimeJobPayloadSchemas } from "./runtime-job-contracts.js";

/**
 * ST1-013M: canonical runtime job lifecycle orchestration -- the single place production code
 * should enqueue, claim, complete, fail, or retry durable QueueJob rows. Route handlers and
 * services must not call `prisma.queueJob.*` directly; go through this service (or the durable
 * worker consumer in apps/worker, which uses the same QueueJobRepository underneath).
 * See docs/runtime/runtime-surface.md for the full lifecycle diagram and ownership map.
 */
export interface EnqueueRuntimeJobInput {
  readonly queueName: string;
  readonly jobName: string;
  readonly jobKey: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly correlationId?: string | undefined;
  readonly maxAttempts?: number | undefined;
  readonly availableAt?: string | undefined;
}

export interface ClaimNextRuntimeJobInput {
  readonly tenantId: string;
  readonly queueNames: readonly string[];
  readonly now: Date;
  readonly lockDurationMs: number;
  readonly limit?: number | undefined;
}

export interface RuntimeJobRetryPolicyInput {
  readonly maxAttempts: number;
  readonly backoffKind?: "NONE" | "FIXED" | "EXPONENTIAL" | undefined;
  readonly baseDelayMs?: number | undefined;
  readonly maxDelayMs?: number | undefined;
  readonly retryableErrorCodes?: readonly string[] | undefined;
  readonly nonRetryableErrorCodes?: readonly string[] | undefined;
}

export interface FailRuntimeJobInput {
  readonly id: string;
  readonly attempt: number;
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly retryPolicy: RuntimeJobRetryPolicyInput;
  readonly queueName: string;
  readonly jobName: string;
  readonly jobKey: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly correlationId: string;
  readonly now?: Date | undefined;
}

export interface RuntimeJobServiceDependencies {
  readonly queueJobs: QueueJobRepository;
}

export class RuntimeJobService {
  constructor(private readonly deps: RuntimeJobServiceDependencies) {}

  /**
   * Validates the payload against the canonical contract for (queueName, jobName) --
   * see runtime-job-contracts.ts -- before persisting. Idempotent on (tenantId, queueName,
   * jobKey): a duplicate enqueue call returns the existing row instead of duplicating it.
   */
  async enqueueRuntimeJob(context: TenantScoped, input: EnqueueRuntimeJobInput): Promise<QueueJobRecord> {
    const contractKey = `${input.queueName}:${input.jobName}`;
    const schema = runtimeJobPayloadSchemas[contractKey];
    if (schema === undefined) {
      throw new Error(`No runtime job payload contract is registered for "${contractKey}"; add one to runtime-job-contracts.ts before enqueueing this job type`);
    }
    const payload = schema.parse(input.payload) as Readonly<Record<string, unknown>>;
    return this.deps.queueJobs.enqueue(context, {
      tenantId: context.tenantId,
      queueName: input.queueName,
      jobName: input.jobName,
      jobKey: input.jobKey,
      payload,
      maxAttempts: input.maxAttempts,
      availableAt: input.availableAt,
      correlationId: input.correlationId ?? input.jobKey,
    });
  }

  claimNextRuntimeJob(input: ClaimNextRuntimeJobInput): Promise<QueueJobRecord | null> {
    return this.deps.queueJobs.claimNext(input);
  }

  completeRuntimeJob(context: TenantScoped, id: string): Promise<QueueJobRecord> {
    return this.deps.queueJobs.markCompleted(context, id);
  }

  /**
   * Applies the canonical retry-vs-terminal decision (worker-runtime's computeRetryDecision,
   * the same primitive WorkerApplication.processJob uses) and persists the outcome: either
   * RETRY_SCHEDULED with the computed backoff, or DEAD_LETTERED with a durable DeadLetterJob
   * row recording why. For callers operating directly on QueueJob rows outside the full
   * WorkerApplication/JobContract path (which already makes this decision internally -- see
   * apps/worker's durable consumer).
   */
  async failRuntimeJob(context: TenantScoped, input: FailRuntimeJobInput): Promise<QueueJobRecord> {
    const now = input.now ?? new Date();
    const correlation: CorrelationMetadata = { correlationId: input.correlationId };
    const policy: RetryPolicy = retryPolicySchema.parse({
      tenantId: context.tenantId,
      maxAttempts: input.retryPolicy.maxAttempts,
      backoff: {
        kind: input.retryPolicy.backoffKind ?? "EXPONENTIAL",
        baseDelayMs: input.retryPolicy.baseDelayMs ?? 60_000,
        maxDelayMs: input.retryPolicy.maxDelayMs ?? 3_600_000,
        multiplier: 2,
        jitter: false,
      },
      retryableErrorCodes: input.retryPolicy.retryableErrorCodes ?? [],
      nonRetryableErrorCodes: input.retryPolicy.nonRetryableErrorCodes ?? [],
      deadLetterAfterMaxAttempts: true,
      replaySafe: true,
    });
    const decision = computeRetryDecision({
      policy,
      attempt: input.attempt,
      errorCode: input.errorCode,
      now,
      tenantId: context.tenantId,
      correlation,
    });
    const lastError = { code: input.errorCode, message: input.errorMessage };

    if (decision.action === "RETRY") {
      return this.deps.queueJobs.markRetryScheduled(context, input.id, {
        availableAt: decision.nextRunAt ?? now.toISOString(),
        lastError,
      });
    }

    await this.deps.queueJobs.recordDeadLetter(context, {
      tenantId: context.tenantId,
      queueName: input.queueName,
      jobName: input.jobName,
      jobKey: input.jobKey,
      payload: input.payload,
      reason: decision.reason ?? "NON_RETRYABLE_ERROR",
      attemptsMade: decision.nextAttempt,
      correlationId: input.correlationId,
      metadata: lastError,
    });
    return this.deps.queueJobs.markDeadLettered(context, input.id, { lastError });
  }

  retryRuntimeJob(context: TenantScoped, id: string, input?: { readonly availableAt?: string | undefined }): Promise<QueueJobRecord> {
    return this.deps.queueJobs.markRetryScheduled(context, id, { availableAt: input?.availableAt ?? new Date().toISOString() });
  }

  cancelRuntimeJob(context: TenantScoped, id: string): Promise<QueueJobRecord> {
    return this.deps.queueJobs.markCancelled(context, id);
  }

  findRuntimeJobById(context: TenantScoped, id: string): Promise<QueueJobRecord | null> {
    return this.deps.queueJobs.findById(context, id);
  }
}
