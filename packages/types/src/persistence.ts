import { z } from "zod";

import { retryPolicySchema, workflowPayloadSchema, workflowStateSchema } from "./workflow.js";

export const persistenceCorrelationMetadataSchema = z.object({
  correlationId: z.string().min(1),
  requestId: z.string().min(1).optional(),
  causationId: z.string().min(1).optional(),
  traceId: z.string().min(1).optional(),
  spanId: z.string().min(1).optional()
}).strict();

export type PersistenceCorrelationMetadata = z.infer<typeof persistenceCorrelationMetadataSchema>;

export const tenantScopedSchema = z.object({
  tenantId: z.string().min(1)
}).strict();

export type TenantScoped = z.infer<typeof tenantScopedSchema>;

export const persistenceErrorCodeValues = [
  "PERSISTENCE_TENANT_CONTEXT_MISSING",
  "PERSISTENCE_TENANT_MISMATCH",
  "PERSISTENCE_CONFLICT",
  "PERSISTENCE_NOT_FOUND",
  "PERSISTENCE_LEASE_CONFLICT",
  "PERSISTENCE_LOCK_CONFLICT",
  "PERSISTENCE_IDEMPOTENCY_CONFLICT",
  "PERSISTENCE_TRANSIENT",
  "PERSISTENCE_VALIDATION_FAILED",
  "PERSISTENCE_PERMISSION_DENIED"
] as const;
export const persistenceErrorCodeSchema = z.enum(persistenceErrorCodeValues);
export type PersistenceErrorCode = z.infer<typeof persistenceErrorCodeSchema>;

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;
  readonly status: number;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(input: {
    code: PersistenceErrorCode;
    message: string;
    status: number;
    details?: Readonly<Record<string, unknown>>;
  }) {
    super(input.message);
    this.name = "PersistenceError";
    this.code = input.code;
    this.status = input.status;
    if (input.details !== undefined) {
      this.details = input.details;
    }
  }
}

export const assertTenantScope = (context: TenantScoped, resource: Partial<TenantScoped>): void => {
  if (context.tenantId.trim().length === 0 || resource.tenantId === undefined || resource.tenantId.trim().length === 0) {
    throw new PersistenceError({
      code: "PERSISTENCE_TENANT_CONTEXT_MISSING",
      message: "Tenant context is required for persistence access",
      status: 403
    });
  }

  if (context.tenantId !== resource.tenantId) {
    throw new PersistenceError({
      code: "PERSISTENCE_TENANT_MISMATCH",
      message: "Tenant context does not match persistence resource",
      status: 403,
      details: { contextTenantId: context.tenantId, resourceTenantId: resource.tenantId }
    });
  }
};

export const auditLogSchema = z.object({
  tenantId: z.string().min(1),
  actorId: z.string().min(1).optional(),
  action: z.string().min(1),
  targetType: z.string().min(1),
  targetId: z.string().min(1).optional(),
  occurredAt: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  correlation: persistenceCorrelationMetadataSchema
}).strict();
export type AuditLog = z.infer<typeof auditLogSchema>;

export const idempotencyKeyStateValues = ["IN_PROGRESS", "COMPLETED", "FAILED", "EXPIRED"] as const;
export const idempotencyKeyStateSchema = z.enum(idempotencyKeyStateValues);
export type IdempotencyKeyState = z.infer<typeof idempotencyKeyStateSchema>;

// expiresAt is stored and validated at parse time only for format correctness.
// Expiry enforcement (rejecting records where expiresAt < now) is the
// responsibility of the IdempotencyKey repository layer, not the schema.
// Schema-layer expiry checks would require injecting clock state into Zod,
// which violates the deterministic, stateless contract of these schemas.
export const idempotencyRecordSchema = z.object({
  tenantId: z.string().min(1),
  scope: z.string().min(1),
  key: z.string().min(1),
  requestHash: z.string().min(1),
  state: idempotencyKeyStateSchema,
  response: z.unknown().optional(),
  lockedUntil: z.string().datetime().optional(),
  expiresAt: z.string().datetime(),
  correlation: persistenceCorrelationMetadataSchema.optional()
}).strict();
export type IdempotencyRecord = z.infer<typeof idempotencyRecordSchema>;

export const executionLeaseStateValues = ["ACTIVE", "RELEASED", "EXPIRED", "STOLEN"] as const;
export const executionLeaseStateSchema = z.enum(executionLeaseStateValues);
export type ExecutionLeaseState = z.infer<typeof executionLeaseStateSchema>;

const executionLeaseBaseSchema = z.object({
  tenantId: z.string().min(1),
  leaseKey: z.string().min(1),
  holderId: z.string().min(1),
  state: executionLeaseStateSchema,
  fencingToken: z.number().int().nonnegative(),
  acquiredAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  correlation: persistenceCorrelationMetadataSchema
}).strict();

export const executionLeaseSchema = executionLeaseBaseSchema.refine((lease) => Date.parse(lease.expiresAt) > Date.parse(lease.acquiredAt), {
  message: "Lease expiresAt must be after acquiredAt",
  path: ["expiresAt"]
});
export type ExecutionLease = z.infer<typeof executionLeaseSchema>;

export interface ExecutionLeaseRepository {
  acquire(input: Omit<ExecutionLease, "state" | "fencingToken" | "acquiredAt">): Promise<ExecutionLease>;
  renew(input: TenantScoped & { leaseKey: string; holderId: string; fencingToken: number; expiresAt: string }): Promise<ExecutionLease>;
  release(input: TenantScoped & { leaseKey: string; holderId: string; fencingToken: number }): Promise<void>;
}

export const distributedLockSchema = executionLeaseBaseSchema.extend({
  lockKey: z.string().min(1)
}).omit({ leaseKey: true }).refine((lock) => Date.parse(lock.expiresAt) > Date.parse(lock.acquiredAt), {
  message: "Lock expiresAt must be after acquiredAt",
  path: ["expiresAt"]
});
export type DistributedLock = z.infer<typeof distributedLockSchema>;

export interface DistributedLockManager {
  acquire(input: TenantScoped & { lockKey: string; holderId: string; ttlMs: number; correlation: z.infer<typeof persistenceCorrelationMetadataSchema> }): Promise<DistributedLock>;
  release(input: TenantScoped & { lockKey: string; holderId: string; fencingToken: number }): Promise<void>;
}

export const outboxEventStateValues = ["PENDING", "PUBLISHED", "CONSUMED", "FAILED", "DEAD_LETTERED"] as const;
export const outboxEventStateSchema = z.enum(outboxEventStateValues);
export type OutboxEventState = z.infer<typeof outboxEventStateSchema>;

export const outboxEventSchema = z.object({
  tenantId: z.string().min(1),
  aggregateType: z.string().min(1),
  aggregateId: z.string().min(1),
  eventType: z.string().min(1),
  eventVersion: z.number().int().positive(),
  idempotencyKey: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  headers: z.record(z.string(), z.unknown()).default({}),
  state: outboxEventStateSchema.default("PENDING"),
  availableAt: z.string().datetime(),
  correlation: persistenceCorrelationMetadataSchema
}).strict();
export type OutboxEvent = z.infer<typeof outboxEventSchema>;

export const inboxEventSchema = z.object({
  tenantId: z.string().min(1),
  source: z.string().min(1),
  messageId: z.string().min(1),
  eventType: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  headers: z.record(z.string(), z.unknown()).default({}),
  state: outboxEventStateSchema.default("PENDING"),
  receivedAt: z.string().datetime(),
  processedAt: z.string().datetime().optional(),
  correlation: persistenceCorrelationMetadataSchema
}).strict();
export type InboxEvent = z.infer<typeof inboxEventSchema>;

export const vectorDocumentMetadataSchema = z.object({
  tenantId: z.string().min(1),
  sourceType: z.string().min(1),
  sourceId: z.string().min(1),
  chunkId: z.string().min(1),
  contentHash: z.string().min(1),
  embeddingModel: z.string().min(1).optional(),
  embeddingDimension: z.number().int().positive().max(16_384).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  indexedAt: z.string().datetime().optional()
}).strict();
export type VectorDocumentMetadata = z.infer<typeof vectorDocumentMetadataSchema>;

export const executionTraceSpanStatusValues = ["OK", "ERROR", "UNSET"] as const;
export const executionTraceSpanStatusSchema = z.enum(executionTraceSpanStatusValues);
export type ExecutionTraceSpanStatus = z.infer<typeof executionTraceSpanStatusSchema>;

export const executionTraceSpanSchema = z.object({
  tenantId: z.string().min(1),
  traceId: z.string().min(1),
  spanId: z.string().min(1),
  parentSpanId: z.string().min(1).optional(),
  name: z.string().min(1),
  status: executionTraceSpanStatusSchema.default("UNSET"),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  attributes: z.record(z.string(), z.unknown()).default({})
}).strict().refine((span) => span.endedAt === undefined || Date.parse(span.endedAt) >= Date.parse(span.startedAt), {
  message: "Span endedAt must be greater than or equal to startedAt",
  path: ["endedAt"]
});
export type ExecutionTraceSpan = z.infer<typeof executionTraceSpanSchema>;

export const workflowExecutionRecordSchema = z.object({
  tenantId: z.string().min(1),
  workflowId: z.string().min(1),
  workflowVersion: z.number().int().positive(),
  runId: z.string().min(1),
  state: workflowStateSchema,
  idempotencyKey: z.string().min(1).optional(),
  input: workflowPayloadSchema.default({}),
  output: workflowPayloadSchema.optional(),
  correlation: persistenceCorrelationMetadataSchema
}).strict();
export type WorkflowExecutionRecord = z.infer<typeof workflowExecutionRecordSchema>;

export const aiExecutionStateValues = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"] as const;
export const aiExecutionStateSchema = z.enum(aiExecutionStateValues);
export type AiExecutionState = z.infer<typeof aiExecutionStateSchema>;

export const aiExecutionRecordSchema = z.object({
  tenantId: z.string().min(1),
  providerId: z.string().min(1),
  providerKind: z.string().min(1),
  model: z.string().min(1),
  state: aiExecutionStateSchema,
  idempotencyKey: z.string().min(1).optional(),
  promptHash: z.string().min(1),
  request: z.record(z.string(), z.unknown()),
  response: z.record(z.string(), z.unknown()).optional(),
  usage: z.record(z.string(), z.unknown()).optional(),
  correlation: persistenceCorrelationMetadataSchema
}).strict();
export type AiExecutionRecord = z.infer<typeof aiExecutionRecordSchema>;

export const eventIngestionRecordSchema = z.object({
  tenantId: z.string().min(1),
  provider: z.string().min(1),
  providerEventId: z.string().min(1),
  eventType: z.string().min(1),
  idempotencyKey: z.string().min(1),
  occurredAt: z.string().datetime(),
  receivedAt: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
  correlation: persistenceCorrelationMetadataSchema
}).strict();
export type EventIngestionRecord = z.infer<typeof eventIngestionRecordSchema>;

export interface TenantScopedRepository<TEntity extends TenantScoped, TCreate extends TenantScoped> {
  create(context: TenantScoped, input: TCreate): Promise<TEntity>;
  findById(context: TenantScoped, id: string): Promise<TEntity | null>;
}

export interface IdempotencyKeyRepository {
  reserve(input: IdempotencyRecord): Promise<IdempotencyRecord>;
  complete(input: TenantScoped & { scope: string; key: string; response: unknown }): Promise<IdempotencyRecord>;
  find(input: TenantScoped & { scope: string; key: string }): Promise<IdempotencyRecord | null>;
}

export interface OutboxRepository {
  append(input: OutboxEvent): Promise<OutboxEvent>;
  markPublished(input: TenantScoped & { id: string; publishedAt: string }): Promise<void>;
}

export interface InboxRepository {
  record(input: InboxEvent): Promise<InboxEvent>;
  markConsumed(input: TenantScoped & { id: string; processedAt: string }): Promise<void>;
}

export interface TransactionContext {
  readonly tenantId: string;
  readonly correlation: z.infer<typeof persistenceCorrelationMetadataSchema>;
}

export interface TransactionRunner {
  runInTransaction<TResult>(
    context: TransactionContext,
    work: (transaction: TransactionContext) => Promise<TResult>,
  ): Promise<TResult>;
}

export const createTransactionalOutboxOperation = <TResult>(input: {
  context: TransactionContext;
  runner: TransactionRunner;
  work: (transaction: TransactionContext) => Promise<TResult>;
  outbox: OutboxRepository;
  event: OutboxEvent;
}): Promise<TResult> => {
  assertTenantScope(input.context, input.event);
  return input.runner.runInTransaction(input.context, async (transaction) => {
    assertTenantScope(transaction, input.event);
    const result = await input.work(transaction);
    await input.outbox.append(input.event);
    return result;
  });
};

export const queueJobStateValues = [
  "WAITING",
  "DELAYED",
  "ACTIVE",
  "COMPLETED",
  "FAILED",
  "RETRY_SCHEDULED",
  "DEAD_LETTERED",
  "CANCELLED"
] as const;
export const queueJobStateSchema = z.enum(queueJobStateValues);
export type QueueJobState = z.infer<typeof queueJobStateSchema>;

export const queuePayloadSchema = z.object({
  tenantId: z.string().min(1),
  jobId: z.string().min(1),
  jobName: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().min(1),
  correlation: persistenceCorrelationMetadataSchema
}).strict();
export type QueuePayload = z.infer<typeof queuePayloadSchema>;

export const queueJobSchema = z.object({
  queueName: z.string().min(1),
  job: queuePayloadSchema,
  attempts: z.number().int().min(1).max(100).default(1),
  delayMs: z.number().int().min(0).max(31_536_000_000).default(0),
  retryPolicy: retryPolicySchema.optional()
}).strict();
export type QueueJob = z.infer<typeof queueJobSchema>;

export interface QueueProducer {
  enqueue(input: QueueJob): Promise<QueuePayload>;
}

export interface QueueConsumer {
  process(queueName: string, handler: (job: QueuePayload) => Promise<void>): Promise<void>;
}

export interface DeadLetterQueue {
  moveToDeadLetter(input: QueuePayload & { reason: string; attemptsMade: number }): Promise<void>;
  requeue(input: TenantScoped & { deadLetterId: string; correlation: z.infer<typeof persistenceCorrelationMetadataSchema> }): Promise<QueuePayload>;
}

export const bullMqCompatibleJobOptionsSchema = z.object({
  jobId: z.string().min(1),
  attempts: z.number().int().min(1).max(100),
  delay: z.number().int().min(0),
  removeOnComplete: z.boolean().default(false),
  removeOnFail: z.boolean().default(false),
  backoff: z.object({
    type: z.enum(["fixed", "exponential"]),
    delay: z.number().int().min(0)
  }).strict().optional()
}).strict();
export type BullMqCompatibleJobOptions = z.infer<typeof bullMqCompatibleJobOptionsSchema>;

export const toBullMqCompatibleJobOptions = (job: QueueJob): BullMqCompatibleJobOptions => {
  const parsed = queueJobSchema.parse(job);
  const policy = parsed.retryPolicy;
  const backoff = policy === undefined || policy.kind === "NONE"
    ? undefined
    : {
        type: policy.kind === "FIXED" ? "fixed" as const : "exponential" as const,
        delay: policy.initialDelayMs
      };

  return bullMqCompatibleJobOptionsSchema.parse({
    jobId: parsed.job.idempotencyKey,
    attempts: parsed.attempts,
    delay: parsed.delayMs,
    removeOnComplete: false,
    removeOnFail: false,
    ...(backoff === undefined ? {} : { backoff })
  });
};

export const scheduledJobSchema = z.object({
  tenantId: z.string().min(1),
  scheduleName: z.string().min(1),
  jobName: z.string().min(1),
  cron: z.string().min(1).optional(),
  runAt: z.string().datetime().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  correlation: persistenceCorrelationMetadataSchema.optional()
}).strict().refine((job) => (job.cron === undefined) !== (job.runAt === undefined), {
  message: "Scheduled job must declare exactly one of cron or runAt",
  path: ["cron"]
});
export type ScheduledJob = z.infer<typeof scheduledJobSchema>;

export interface ScheduledJobRepository {
  upsert(input: ScheduledJob): Promise<ScheduledJob>;
  cancel(input: TenantScoped & { scheduleName: string }): Promise<void>;
}
