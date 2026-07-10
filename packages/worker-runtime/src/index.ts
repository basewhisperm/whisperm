import { z } from "zod";
import { correlationMetadataSchema } from "@whisperm/types";
import type { CorrelationMetadata } from "@whisperm/types";

const isoDurationPattern = /^P(?=\d|T\d)(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/u;
const namespacedNamePattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const safeAttributeKeyPattern = /^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$/u;

export const workerRuntimeMetadataSchema = z.record(z.string(), z.unknown());
export type WorkerRuntimeMetadata = z.infer<typeof workerRuntimeMetadataSchema>;

export const workerRuntimeTimestampSchema = z.string().datetime();
export type WorkerRuntimeTimestamp = z.infer<typeof workerRuntimeTimestampSchema>;

export const workerRuntimeErrorCodeValues = [
  "WORKER_RUNTIME_VALIDATION_FAILED",
  "WORKER_RUNTIME_TENANT_ISOLATION_VIOLATION",
  "WORKER_RUNTIME_INVALID_STATE_TRANSITION",
  "WORKER_RUNTIME_EXECUTION_TOKEN_INVALID",
  "WORKER_RUNTIME_IDEMPOTENCY_CONFLICT",
  "WORKER_RUNTIME_VISIBILITY_TIMEOUT_EXPIRED",
  "WORKER_RUNTIME_LEASE_EXPIRED",
  // ST1-013M: distinct from WORKER_RUNTIME_VALIDATION_FAILED, which is reserved for terminal
  // input/governance failures that must never be retried. This code is for failures that are
  // expected to succeed on a later attempt (an unconfigured/unreachable dependency, a provider
  // outage, an uncaught handler exception) -- retry classification (computeRetryDecision) only
  // ever inspects the error code, so conflating the two silently kills retries for one or the
  // other whenever a caller's retry policy denies/allows just one of them.
  "WORKER_RUNTIME_TRANSIENT_FAILURE"
] as const;
export const workerRuntimeErrorCodeSchema = z.enum(workerRuntimeErrorCodeValues);
export type WorkerRuntimeErrorCode = z.infer<typeof workerRuntimeErrorCodeSchema>;

export const workerRuntimeErrorModelSchema = z.object({
  code: workerRuntimeErrorCodeSchema,
  message: z.string().min(1),
  status: z.number().int().min(400).max(599),
  retryable: z.boolean().default(false),
  details: workerRuntimeMetadataSchema.optional(),
  correlation: correlationMetadataSchema.optional()
}).strict();
export type WorkerRuntimeErrorModel = z.output<typeof workerRuntimeErrorModelSchema>;

export interface WorkerRuntimeErrorInput {
  readonly code: WorkerRuntimeErrorCode;
  readonly message: string;
  readonly status: number;
  readonly retryable?: boolean | undefined;
  readonly details?: WorkerRuntimeMetadata | undefined;
  readonly correlation?: CorrelationMetadata | undefined;
}

export class WorkerRuntimeError extends Error {
  readonly code: WorkerRuntimeErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: WorkerRuntimeMetadata | undefined;
  readonly correlation?: CorrelationMetadata | undefined;

  constructor(input: WorkerRuntimeErrorInput) {
    super(input.message);
    this.name = "WorkerRuntimeError";
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable ?? false;
    this.details = input.details;
    this.correlation = input.correlation;
    Object.setPrototypeOf(this, WorkerRuntimeError.prototype);
  }

  toErrorModel(): WorkerRuntimeErrorModel {
    return workerRuntimeErrorModelSchema.parse({
      code: this.code,
      message: this.message,
      status: this.status,
      retryable: this.retryable,
      details: this.details,
      correlation: this.correlation
    });
  }
}

const validationIssues = (error: z.ZodError): readonly WorkerRuntimeMetadata[] => error.issues.map((issue) => ({
  path: issue.path.join("."),
  message: issue.message,
  code: issue.code
}));

export const parseWorkerRuntimeContract = <TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  input: unknown,
  correlation?: CorrelationMetadata,
): z.output<TSchema> => {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new WorkerRuntimeError({
      code: "WORKER_RUNTIME_VALIDATION_FAILED",
      message: "Worker runtime contract validation failed",
      status: 400,
      details: { issues: validationIssues(result.error) },
      correlation
    });
  }
  return result.data;
};

export const queueKindValues = ["STANDARD", "FIFO", "PRIORITY", "DELAYED", "RECURRING", "DEAD_LETTER"] as const;
export const queueKindSchema = z.enum(queueKindValues);
export type QueueKind = z.infer<typeof queueKindSchema>;

export const queueCapabilitiesSchema = z.object({
  supportsScheduling: z.boolean(),
  supportsDelayedJobs: z.boolean(),
  supportsRecurringJobs: z.boolean(),
  supportsPriority: z.boolean(),
  supportsFifoGroups: z.boolean(),
  supportsVisibilityTimeout: z.boolean(),
  supportsDeadLetterQueue: z.boolean(),
  supportsLeaseExtension: z.boolean(),
  supportsReplay: z.boolean().default(true)
}).strict();
export type QueueCapabilities = z.output<typeof queueCapabilitiesSchema>;

export const queueContractSchema = z.object({
  tenantId: z.string().min(1),
  queueName: z.string().regex(namespacedNamePattern),
  kind: queueKindSchema,
  version: z.literal(1),
  capabilities: queueCapabilitiesSchema,
  retention: z.object({
    successfulJobRetentionMs: z.number().int().min(0),
    failedJobRetentionMs: z.number().int().min(0),
    deadLetterRetentionMs: z.number().int().min(1)
  }).strict(),
  maxPayloadBytes: z.number().int().min(1),
  visibilityTimeoutMs: z.number().int().min(1).optional(),
  deadLetterQueueName: z.string().regex(namespacedNamePattern).optional(),
  metadata: workerRuntimeMetadataSchema.default({})
}).strict().superRefine((queue, context) => {
  if (queue.capabilities.supportsVisibilityTimeout && queue.visibilityTimeoutMs === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "visibility timeout capability requires visibilityTimeoutMs", path: ["visibilityTimeoutMs"] });
  }
  if (queue.capabilities.supportsDeadLetterQueue && queue.deadLetterQueueName === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "dead letter capability requires deadLetterQueueName", path: ["deadLetterQueueName"] });
  }
});
export type QueueContract = z.output<typeof queueContractSchema>;

export const jobPriorityValues = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export const jobPrioritySchema = z.enum(jobPriorityValues);
export type JobPriority = z.infer<typeof jobPrioritySchema>;

export const jobPayloadSchema = z.record(z.string(), z.unknown());
export type JobPayload = z.infer<typeof jobPayloadSchema>;

export const replayModeValues = ["LIVE", "REPLAY", "DRY_RUN"] as const;
export const replayModeSchema = z.enum(replayModeValues);
export type ReplayMode = z.infer<typeof replayModeSchema>;

export const idempotencyContractSchema = z.object({
  tenantId: z.string().min(1),
  scope: z.enum(["JOB", "WORKFLOW", "APPROVAL", "EXTERNAL_EVENT"]),
  key: z.string().min(1),
  replaySafe: z.literal(true),
  conflictPolicy: z.enum(["RETURN_PREVIOUS_RESULT", "SKIP_DUPLICATE", "FAIL_CONFLICT"]),
  expiresAt: workerRuntimeTimestampSchema.optional()
}).strict();
export type IdempotencyContract = z.output<typeof idempotencyContractSchema>;

export const approvalRuntimeIntegrationSchema = z.object({
  approvalId: z.string().min(1),
  tenantId: z.string().min(1),
  requiredState: z.enum(["APPROVED", "REQUESTED", "PENDING"]),
  failClosed: z.literal(true),
  correlation: correlationMetadataSchema
}).strict();
export type ApprovalRuntimeIntegration = z.output<typeof approvalRuntimeIntegrationSchema>;

export const workflowRuntimeIntegrationSchema = z.object({
  workflowId: z.string().min(1),
  runId: z.string().min(1),
  tenantId: z.string().min(1),
  stepId: z.string().min(1).optional(),
  replayMode: replayModeSchema.default("LIVE"),
  deterministic: z.literal(true),
  correlation: correlationMetadataSchema
}).strict();
export type WorkflowRuntimeIntegration = z.output<typeof workflowRuntimeIntegrationSchema>;

export const executionTokenContractSchema = z.object({
  tenantId: z.string().min(1),
  jobId: z.string().min(1),
  queueName: z.string().regex(namespacedNamePattern),
  tokenId: z.string().min(1),
  leaseId: z.string().min(1),
  issuedAt: workerRuntimeTimestampSchema,
  expiresAt: workerRuntimeTimestampSchema,
  replayMode: replayModeSchema.default("LIVE"),
  permissions: z.array(z.enum(["ACK", "NACK", "EXTEND_VISIBILITY", "EMIT_TELEMETRY", "SCHEDULE_CHILD_JOB"])).min(1),
  correlation: correlationMetadataSchema
}).strict().refine((value) => Date.parse(value.expiresAt) > Date.parse(value.issuedAt), {
  message: "Execution token expiresAt must be after issuedAt",
  path: ["expiresAt"]
});
export type ExecutionTokenContract = z.output<typeof executionTokenContractSchema>;

export const jobSchedulingContractSchema = z.object({
  tenantId: z.string().min(1),
  queueName: z.string().regex(namespacedNamePattern),
  earliestRunAt: workerRuntimeTimestampSchema.optional(),
  notAfter: workerRuntimeTimestampSchema.optional(),
  priority: jobPrioritySchema.default("NORMAL"),
  fifoGroupKey: z.string().min(1).optional(),
  dedupeKey: z.string().min(1).optional()
}).strict().refine((value) => value.earliestRunAt === undefined || value.notAfter === undefined || Date.parse(value.notAfter) > Date.parse(value.earliestRunAt), {
  message: "notAfter must be after earliestRunAt",
  path: ["notAfter"]
});
export type JobSchedulingContract = z.output<typeof jobSchedulingContractSchema>;

export const delayedJobContractSchema = z.object({
  tenantId: z.string().min(1),
  delayUntil: workerRuntimeTimestampSchema,
  reason: z.string().min(1),
  replaySafe: z.literal(true)
}).strict();
export type DelayedJobContract = z.output<typeof delayedJobContractSchema>;

export const recurringJobContractSchema = z.object({
  tenantId: z.string().min(1),
  scheduleId: z.string().min(1),
  interval: z.string().regex(isoDurationPattern).optional(),
  cron: z.string().min(1).optional(),
  timezone: z.literal("UTC"),
  startAt: workerRuntimeTimestampSchema.optional(),
  endAt: workerRuntimeTimestampSchema.optional(),
  maxOccurrences: z.number().int().min(1).optional(),
  replaySafe: z.literal(true)
}).strict().superRefine((value, context) => {
  if ((value.interval === undefined && value.cron === undefined) || (value.interval !== undefined && value.cron !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Recurring jobs require exactly one of interval or cron" });
  }
  if (value.startAt !== undefined && value.endAt !== undefined && Date.parse(value.endAt) <= Date.parse(value.startAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "endAt must be after startAt", path: ["endAt"] });
  }
});
export type RecurringJobContract = z.output<typeof recurringJobContractSchema>;

export const retryBackoffKindValues = ["NONE", "FIXED", "EXPONENTIAL"] as const;
export const retryBackoffKindSchema = z.enum(retryBackoffKindValues);
export type RetryBackoffKind = z.infer<typeof retryBackoffKindSchema>;

export const retryPolicySchema = z.object({
  tenantId: z.string().min(1),
  maxAttempts: z.number().int().min(1).max(100),
  backoff: z.object({
    kind: retryBackoffKindSchema,
    baseDelayMs: z.number().int().min(0).max(86_400_000),
    maxDelayMs: z.number().int().min(0).max(604_800_000),
    multiplier: z.number().min(1).max(10).default(2),
    jitter: z.literal(false).default(false)
  }).strict(),
  retryableErrorCodes: z.array(z.string().min(1)).default([]),
  nonRetryableErrorCodes: z.array(z.string().min(1)).default([]),
  deadLetterAfterMaxAttempts: z.literal(true),
  replaySafe: z.literal(true)
}).strict().refine((value) => value.backoff.maxDelayMs >= value.backoff.baseDelayMs, {
  message: "maxDelayMs must be greater than or equal to baseDelayMs",
  path: ["backoff", "maxDelayMs"]
});
export type RetryPolicy = z.output<typeof retryPolicySchema>;

export const poisonMessagePolicySchema = z.object({
  tenantId: z.string().min(1),
  enabled: z.boolean(),
  maxValidationFailures: z.number().int().min(1).max(25),
  maxConsecutiveFailures: z.number().int().min(1).max(100),
  quarantineQueueName: z.string().regex(namespacedNamePattern).optional(),
  deadLetterOnPoison: z.literal(true)
}).strict().superRefine((value, context) => {
  if (value.enabled && value.quarantineQueueName === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "enabled poison policy requires quarantineQueueName", path: ["quarantineQueueName"] });
  }
});
export type PoisonMessagePolicy = z.output<typeof poisonMessagePolicySchema>;

export const jobContractSchema = z.object({
  tenantId: z.string().min(1),
  jobId: z.string().min(1),
  queueName: z.string().regex(namespacedNamePattern),
  jobType: z.string().regex(namespacedNamePattern),
  version: z.literal(1),
  payload: jobPayloadSchema,
  correlation: correlationMetadataSchema,
  idempotency: idempotencyContractSchema,
  scheduling: jobSchedulingContractSchema,
  delayed: delayedJobContractSchema.optional(),
  recurring: recurringJobContractSchema.optional(),
  approval: approvalRuntimeIntegrationSchema.optional(),
  workflow: workflowRuntimeIntegrationSchema.optional(),
  retryPolicy: retryPolicySchema,
  poisonPolicy: poisonMessagePolicySchema,
  createdAt: workerRuntimeTimestampSchema,
  metadata: workerRuntimeMetadataSchema.default({})
}).strict().superRefine((job, context) => {
  const tenantFields: readonly { readonly tenantId: string }[] = [job.idempotency, job.scheduling, job.retryPolicy, job.poisonPolicy, job.delayed, job.recurring, job.approval, job.workflow]
    .filter((value) => value !== undefined)
    .map((value) => ({ tenantId: value.tenantId }));
  for (const field of tenantFields) {
    if (field.tenantId !== job.tenantId) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Nested job contracts must use the job tenantId", path: ["tenantId"] });
    }
  }
  if (job.scheduling.queueName !== job.queueName) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Scheduling queueName must match job queueName", path: ["scheduling", "queueName"] });
  }
});
export type JobContract = z.output<typeof jobContractSchema>;

export const jobLifecycleStateValues = [
  "CREATED",
  "SCHEDULED",
  "READY",
  "LEASED",
  "RUNNING",
  "SUCCEEDED",
  "RETRY_WAITING",
  "FAILED",
  "DEAD_LETTERED",
  "CANCELLED"
] as const;
export const jobLifecycleStateSchema = z.enum(jobLifecycleStateValues);
export type JobLifecycleState = z.infer<typeof jobLifecycleStateSchema>;
export const terminalJobLifecycleStateValues = ["SUCCEEDED", "FAILED", "DEAD_LETTERED", "CANCELLED"] as const satisfies readonly JobLifecycleState[];
export type TerminalJobLifecycleState = (typeof terminalJobLifecycleStateValues)[number];

const jobStateTransitions: Readonly<Record<JobLifecycleState, readonly JobLifecycleState[]>> = {
  CREATED: ["SCHEDULED", "READY", "CANCELLED"],
  SCHEDULED: ["READY", "CANCELLED"],
  READY: ["LEASED", "CANCELLED", "DEAD_LETTERED"],
  LEASED: ["RUNNING", "READY", "DEAD_LETTERED"],
  RUNNING: ["SUCCEEDED", "RETRY_WAITING", "FAILED", "DEAD_LETTERED", "CANCELLED"],
  SUCCEEDED: [],
  RETRY_WAITING: ["READY", "CANCELLED", "DEAD_LETTERED"],
  FAILED: ["RETRY_WAITING", "DEAD_LETTERED"],
  DEAD_LETTERED: [],
  CANCELLED: []
};

export const isTerminalJobLifecycleState = (state: JobLifecycleState): state is TerminalJobLifecycleState =>
  terminalJobLifecycleStateValues.includes(state as TerminalJobLifecycleState);

export const canTransitionJobLifecycleState = (from: JobLifecycleState, to: JobLifecycleState): boolean =>
  (jobStateTransitions[from] ?? []).includes(to);

export const jobLifecycleSnapshotSchema = z.object({
  tenantId: z.string().min(1),
  jobId: z.string().min(1),
  queueName: z.string().regex(namespacedNamePattern),
  state: jobLifecycleStateSchema,
  attempt: z.number().int().min(0),
  maxAttempts: z.number().int().min(1),
  updatedAt: workerRuntimeTimestampSchema,
  lastErrorCode: z.string().min(1).optional(),
  lastErrorMessage: z.string().min(1).optional(),
  nextRunAt: workerRuntimeTimestampSchema.optional(),
  leaseId: z.string().min(1).optional(),
  executionTokenId: z.string().min(1).optional(),
  correlation: correlationMetadataSchema
}).strict();
export type JobLifecycleSnapshot = z.output<typeof jobLifecycleSnapshotSchema>;

export interface JobTransitionInput {
  readonly snapshot: JobLifecycleSnapshot;
  readonly to: JobLifecycleState;
  readonly now: Date;
  readonly correlation?: CorrelationMetadata | undefined;
  readonly errorCode?: string | undefined;
  readonly errorMessage?: string | undefined;
  readonly nextRunAt?: Date | undefined;
  readonly leaseId?: string | undefined;
  readonly executionTokenId?: string | undefined;
}

export const transitionJobLifecycleState = (input: JobTransitionInput): JobLifecycleSnapshot => {
  if (!canTransitionJobLifecycleState(input.snapshot.state, input.to)) {
    throw new WorkerRuntimeError({
      code: "WORKER_RUNTIME_INVALID_STATE_TRANSITION",
      message: `Cannot transition job from ${input.snapshot.state} to ${input.to}`,
      status: 409,
      details: { from: input.snapshot.state, to: input.to, jobId: input.snapshot.jobId },
      correlation: input.correlation ?? input.snapshot.correlation
    });
  }

  const next = {
    ...input.snapshot,
    state: input.to,
    updatedAt: input.now.toISOString(),
    lastErrorCode: input.errorCode,
    lastErrorMessage: input.errorMessage,
    nextRunAt: input.nextRunAt?.toISOString(),
    leaseId: input.leaseId,
    executionTokenId: input.executionTokenId,
    correlation: input.correlation ?? input.snapshot.correlation
  };

  return jobLifecycleSnapshotSchema.parse(next);
};

export const deadLetterReasonValues = ["MAX_ATTEMPTS_EXCEEDED", "POISON_MESSAGE", "VALIDATION_FAILED", "EXPIRED", "MANUAL", "NON_RETRYABLE_ERROR"] as const;
export const deadLetterReasonSchema = z.enum(deadLetterReasonValues);
export type DeadLetterReason = z.infer<typeof deadLetterReasonSchema>;

export const deadLetterQueueContractSchema = z.object({
  tenantId: z.string().min(1),
  sourceQueueName: z.string().regex(namespacedNamePattern),
  deadLetterQueueName: z.string().regex(namespacedNamePattern),
  job: jobContractSchema,
  reason: deadLetterReasonSchema,
  failedAt: workerRuntimeTimestampSchema,
  attempt: z.number().int().min(0),
  error: workerRuntimeErrorModelSchema.optional(),
  replayable: z.boolean(),
  quarantine: z.boolean().default(false),
  correlation: correlationMetadataSchema
}).strict().refine((value) => value.job.tenantId === value.tenantId, {
  message: "Dead letter job tenantId must match envelope tenantId",
  path: ["job", "tenantId"]
});
export type DeadLetterQueueContract = z.output<typeof deadLetterQueueContractSchema>;

export const workerLeaseContractSchema = z.object({
  tenantId: z.string().min(1),
  leaseId: z.string().min(1),
  workerId: z.string().min(1),
  jobId: z.string().min(1),
  queueName: z.string().regex(namespacedNamePattern),
  acquiredAt: workerRuntimeTimestampSchema,
  expiresAt: workerRuntimeTimestampSchema,
  heartbeatIntervalMs: z.number().int().min(1),
  fencingToken: z.string().min(1),
  correlation: correlationMetadataSchema
}).strict().refine((value) => Date.parse(value.expiresAt) > Date.parse(value.acquiredAt), {
  message: "Lease expiresAt must be after acquiredAt",
  path: ["expiresAt"]
});
export type WorkerLeaseContract = z.output<typeof workerLeaseContractSchema>;

export const visibilityTimeoutContractSchema = z.object({
  tenantId: z.string().min(1),
  jobId: z.string().min(1),
  queueName: z.string().regex(namespacedNamePattern),
  leaseId: z.string().min(1),
  invisibleUntil: workerRuntimeTimestampSchema,
  maxExtensionMs: z.number().int().min(0),
  extensionCount: z.number().int().min(0),
  correlation: correlationMetadataSchema
}).strict();
export type VisibilityTimeoutContract = z.output<typeof visibilityTimeoutContractSchema>;

export const distributedLockContractSchema = z.object({
  tenantId: z.string().min(1),
  lockKey: z.string().min(1),
  ownerId: z.string().min(1),
  fencingToken: z.string().min(1),
  acquiredAt: workerRuntimeTimestampSchema,
  expiresAt: workerRuntimeTimestampSchema,
  purpose: z.enum(["QUEUE_DISPATCH", "JOB_EXECUTION", "SCHEDULE_MATERIALIZATION", "RECURRING_JOB_TICK", "WORKER_REGISTRATION"]),
  correlation: correlationMetadataSchema
}).strict().refine((value) => Date.parse(value.expiresAt) > Date.parse(value.acquiredAt), {
  message: "Lock expiresAt must be after acquiredAt",
  path: ["expiresAt"]
});
export type DistributedLockContract = z.output<typeof distributedLockContractSchema>;

export const workerCapabilityValues = ["EXECUTE_JOB", "EXTEND_VISIBILITY", "SCHEDULE_JOB", "HANDLE_DELAYED", "HANDLE_RECURRING", "REPLAY_JOB", "EMIT_TELEMETRY", "APPROVAL_AWARE", "WORKFLOW_AWARE"] as const;
export const workerCapabilitySchema = z.enum(workerCapabilityValues);
export type WorkerCapability = z.infer<typeof workerCapabilitySchema>;

export const workerRegistrationContractSchema = z.object({
  tenantId: z.string().min(1),
  workerId: z.string().min(1),
  runtimeVersion: z.string().min(1),
  queueNames: z.array(z.string().regex(namespacedNamePattern)).min(1),
  jobTypes: z.array(z.string().regex(namespacedNamePattern)).min(1),
  capabilities: z.array(workerCapabilitySchema).min(1),
  registeredAt: workerRuntimeTimestampSchema,
  correlation: correlationMetadataSchema,
  metadata: workerRuntimeMetadataSchema.default({})
}).strict();
export type WorkerRegistrationContract = z.output<typeof workerRegistrationContractSchema>;

export const workerHeartbeatContractSchema = z.object({
  tenantId: z.string().min(1),
  workerId: z.string().min(1),
  leaseIds: z.array(z.string().min(1)).default([]),
  recordedAt: workerRuntimeTimestampSchema,
  nextHeartbeatDueAt: workerRuntimeTimestampSchema,
  health: z.enum(["HEALTHY", "DEGRADED", "DRAINING", "UNHEALTHY"]),
  correlation: correlationMetadataSchema,
  metrics: z.object({
    runningJobs: z.number().int().min(0),
    completedJobs: z.number().int().min(0),
    failedJobs: z.number().int().min(0),
    deadLetteredJobs: z.number().int().min(0)
  }).strict()
}).strict().refine((value) => Date.parse(value.nextHeartbeatDueAt) > Date.parse(value.recordedAt), {
  message: "nextHeartbeatDueAt must be after recordedAt",
  path: ["nextHeartbeatDueAt"]
});
export type WorkerHeartbeatContract = z.output<typeof workerHeartbeatContractSchema>;

export const workerHealthContractSchema = z.object({
  tenantId: z.string().min(1),
  workerId: z.string().min(1),
  status: z.enum(["HEALTHY", "DEGRADED", "DRAINING", "UNHEALTHY", "STOPPED"]),
  checkedAt: workerRuntimeTimestampSchema,
  reasons: z.array(z.string().min(1)).default([]),
  correlation: correlationMetadataSchema
}).strict();
export type WorkerHealthContract = z.output<typeof workerHealthContractSchema>;

export const workerShutdownContractSchema = z.object({
  tenantId: z.string().min(1),
  workerId: z.string().min(1),
  requestedAt: workerRuntimeTimestampSchema,
  gracePeriodMs: z.number().int().min(0),
  mode: z.enum(["DRAIN", "CANCEL_IN_FLIGHT", "IMMEDIATE"]),
  reason: z.string().min(1),
  correlation: correlationMetadataSchema
}).strict();
export type WorkerShutdownContract = z.output<typeof workerShutdownContractSchema>;

export const telemetryAttributeValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export const telemetryAttributesSchema = z.record(z.string().regex(safeAttributeKeyPattern), telemetryAttributeValueSchema);
export type TelemetryAttributes = z.infer<typeof telemetryAttributesSchema>;

export const workerTelemetryEventTypeValues = ["JOB_CREATED", "JOB_LEASED", "JOB_STARTED", "JOB_SUCCEEDED", "JOB_FAILED", "JOB_RETRY_SCHEDULED", "JOB_DEAD_LETTERED", "WORKER_HEARTBEAT", "WORKER_SHUTDOWN"] as const;
export const workerTelemetryEventTypeSchema = z.enum(workerTelemetryEventTypeValues);
export type WorkerTelemetryEventType = z.infer<typeof workerTelemetryEventTypeSchema>;

export const workerTelemetryEventSchema = z.object({
  id: z.string().min(1),
  type: workerTelemetryEventTypeSchema,
  tenantId: z.string().min(1),
  jobId: z.string().min(1).optional(),
  workerId: z.string().min(1).optional(),
  occurredAt: workerRuntimeTimestampSchema,
  correlation: correlationMetadataSchema,
  attributes: telemetryAttributesSchema.default({}),
  replaySafe: z.literal(true)
}).strict();
export type WorkerTelemetryEvent = z.output<typeof workerTelemetryEventSchema>;

export interface WorkerTelemetrySpan {
  readonly name: string;
  readonly attributes: TelemetryAttributes;
  end(status: "OK" | "ERROR"): void;
}

export interface WorkerTelemetryHooks {
  startSpan?(name: string, attributes: TelemetryAttributes): WorkerTelemetrySpan;
  recordEvent?(event: WorkerTelemetryEvent): void | Promise<void>;
  recordError?(input: { readonly error: WorkerRuntimeError; readonly tenantId: string; readonly correlation: CorrelationMetadata; readonly jobId?: string | undefined }): void | Promise<void>;
}

export interface WorkerClock {
  now(): Date;
}

export interface WorkerIdFactory {
  createId(input: { readonly tenantId: string; readonly scope: string; readonly correlation: CorrelationMetadata; readonly sequence: number }): string;
}

export interface IdempotencyDecision {
  readonly status: "CLAIMED" | "DUPLICATE" | "CONFLICT";
  readonly previousResult?: WorkerRuntimeMetadata | undefined;
}

export interface IdempotencyStore {
  claim(contract: IdempotencyContract): Promise<IdempotencyDecision> | IdempotencyDecision;
  complete(input: { readonly tenantId: string; readonly key: string; readonly result: WorkerRuntimeMetadata; readonly correlation: CorrelationMetadata }): Promise<void> | void;
}

export interface ApprovalRuntimePort {
  assertApproved(input: ApprovalRuntimeIntegration): Promise<void> | void;
}

export interface WorkflowRuntimePort {
  recordJobEvent(input: { readonly tenantId: string; readonly workflow: WorkflowRuntimeIntegration; readonly event: WorkerTelemetryEvent }): Promise<void> | void;
}

export interface WorkerExecutionContext {
  readonly tenantId: string;
  readonly job: JobContract;
  readonly token: ExecutionTokenContract;
  readonly lease: WorkerLeaseContract;
  readonly correlation: CorrelationMetadata;
  readonly replayMode: ReplayMode;
  readonly telemetry: WorkerTelemetryHooks;
}

export interface WorkerJobHandler<TResult extends WorkerRuntimeMetadata = WorkerRuntimeMetadata> {
  execute(context: WorkerExecutionContext): Promise<TResult> | TResult;
}

export interface WorkerRuntimePorts {
  readonly idempotency: IdempotencyStore;
  readonly approval?: ApprovalRuntimePort | undefined;
  readonly workflow?: WorkflowRuntimePort | undefined;
  readonly telemetry?: WorkerTelemetryHooks | undefined;
  readonly clock?: WorkerClock | undefined;
}

export interface WorkerRuntimeExecuteInput<TResult extends WorkerRuntimeMetadata = WorkerRuntimeMetadata> {
  readonly job: JobContract;
  readonly lease: WorkerLeaseContract;
  readonly token: ExecutionTokenContract;
  readonly handler: WorkerJobHandler<TResult>;
  readonly ports: WorkerRuntimePorts;
}

export interface WorkerRuntimeExecuteResult<TResult extends WorkerRuntimeMetadata = WorkerRuntimeMetadata> {
  readonly status: "SUCCEEDED" | "DUPLICATE_SKIPPED";
  readonly result: TResult | WorkerRuntimeMetadata;
}

export const assertTenantIsolation = (expectedTenantId: string, value: { readonly tenantId: string }, correlation?: CorrelationMetadata): void => {
  if (value.tenantId !== expectedTenantId) {
    throw new WorkerRuntimeError({
      code: "WORKER_RUNTIME_TENANT_ISOLATION_VIOLATION",
      message: "Tenant isolation violation in worker runtime contract",
      status: 403,
      details: { expectedTenantId, actualTenantId: value.tenantId },
      correlation
    });
  }
};

export const assertJobExecutionTenantIsolation = (job: JobContract, lease: WorkerLeaseContract, token: ExecutionTokenContract): void => {
  assertTenantIsolation(job.tenantId, lease, job.correlation);
  assertTenantIsolation(job.tenantId, token, job.correlation);
  if (job.jobId !== lease.jobId || job.jobId !== token.jobId) {
    throw new WorkerRuntimeError({ code: "WORKER_RUNTIME_TENANT_ISOLATION_VIOLATION", message: "Job, lease, and token must reference the same jobId", status: 403, correlation: job.correlation });
  }
  if (job.queueName !== lease.queueName || job.queueName !== token.queueName) {
    throw new WorkerRuntimeError({ code: "WORKER_RUNTIME_TENANT_ISOLATION_VIOLATION", message: "Job, lease, and token must reference the same queueName", status: 403, correlation: job.correlation });
  }
};

export const assertExecutionTokenValid = (input: { readonly token: ExecutionTokenContract; readonly lease: WorkerLeaseContract; readonly now: Date; readonly permission: ExecutionTokenContract["permissions"][number] }): void => {
  assertTenantIsolation(input.lease.tenantId, input.token, input.token.correlation);
  if (input.token.leaseId !== input.lease.leaseId) {
    throw new WorkerRuntimeError({ code: "WORKER_RUNTIME_EXECUTION_TOKEN_INVALID", message: "Execution token leaseId does not match active lease", status: 403, correlation: input.token.correlation });
  }
  if (!input.token.permissions.includes(input.permission)) {
    throw new WorkerRuntimeError({ code: "WORKER_RUNTIME_EXECUTION_TOKEN_INVALID", message: "Execution token lacks required permission", status: 403, correlation: input.token.correlation });
  }
  if (Date.parse(input.token.expiresAt) <= input.now.getTime()) {
    throw new WorkerRuntimeError({ code: "WORKER_RUNTIME_EXECUTION_TOKEN_INVALID", message: "Execution token has expired", status: 403, retryable: true, correlation: input.token.correlation });
  }
};

export const createExecutionTokenContract = (input: {
  readonly tenantId: string;
  readonly jobId: string;
  readonly queueName: string;
  readonly leaseId: string;
  readonly tokenId: string;
  readonly issuedAt: Date;
  readonly ttlMs: number;
  readonly replayMode?: ReplayMode | undefined;
  readonly permissions: readonly ExecutionTokenContract["permissions"][number][];
  readonly correlation: CorrelationMetadata;
}): ExecutionTokenContract => executionTokenContractSchema.parse({
  tenantId: input.tenantId,
  jobId: input.jobId,
  queueName: input.queueName,
  tokenId: input.tokenId,
  leaseId: input.leaseId,
  issuedAt: input.issuedAt.toISOString(),
  expiresAt: new Date(input.issuedAt.getTime() + input.ttlMs).toISOString(),
  replayMode: input.replayMode ?? "LIVE",
  permissions: input.permissions,
  correlation: input.correlation
});

export interface RetryDecisionInput {
  readonly policy: RetryPolicy;
  readonly attempt: number;
  readonly errorCode: string;
  readonly now: Date;
  readonly tenantId: string;
  readonly correlation: CorrelationMetadata;
}

export interface RetryDecision {
  readonly action: "RETRY" | "DEAD_LETTER";
  readonly nextAttempt: number;
  readonly delayMs: number;
  readonly nextRunAt?: string | undefined;
  readonly reason?: DeadLetterReason | undefined;
}

export const computeRetryDecision = (input: RetryDecisionInput): RetryDecision => {
  assertTenantIsolation(input.tenantId, input.policy, input.correlation);
  const nextAttempt = input.attempt + 1;
  const nonRetryable = input.policy.nonRetryableErrorCodes.includes(input.errorCode);
  const allowListActive = input.policy.retryableErrorCodes.length > 0;
  const retryable = !nonRetryable && (!allowListActive || input.policy.retryableErrorCodes.includes(input.errorCode));
  if (!retryable) {
    return { action: "DEAD_LETTER", nextAttempt, delayMs: 0, reason: "NON_RETRYABLE_ERROR" };
  }
  if (nextAttempt >= input.policy.maxAttempts) {
    return { action: "DEAD_LETTER", nextAttempt, delayMs: 0, reason: "MAX_ATTEMPTS_EXCEEDED" };
  }

  const delayMs = computeBackoffDelay(input.policy, nextAttempt);
  return { action: "RETRY", nextAttempt, delayMs, nextRunAt: new Date(input.now.getTime() + delayMs).toISOString() };
};

export const computeBackoffDelay = (policy: RetryPolicy, nextAttempt: number): number => {
  if (policy.backoff.kind === "NONE") {
    return 0;
  }
  if (policy.backoff.kind === "FIXED") {
    return policy.backoff.baseDelayMs;
  }
  const exponent = Math.max(0, nextAttempt - 1);
  return Math.min(policy.backoff.maxDelayMs, Math.round(policy.backoff.baseDelayMs * (policy.backoff.multiplier ** exponent)));
};

export const shouldTreatAsPoisonMessage = (input: { readonly policy: PoisonMessagePolicy; readonly tenantId: string; readonly validationFailures: number; readonly consecutiveFailures: number; readonly correlation: CorrelationMetadata }): boolean => {
  assertTenantIsolation(input.tenantId, input.policy, input.correlation);
  return input.policy.enabled && (input.validationFailures >= input.policy.maxValidationFailures || input.consecutiveFailures >= input.policy.maxConsecutiveFailures);
};

export const extendVisibilityTimeout = (input: { readonly current: VisibilityTimeoutContract; readonly now: Date; readonly extensionMs: number; readonly correlation?: CorrelationMetadata | undefined }): VisibilityTimeoutContract => {
  if (Date.parse(input.current.invisibleUntil) <= input.now.getTime()) {
    throw new WorkerRuntimeError({ code: "WORKER_RUNTIME_VISIBILITY_TIMEOUT_EXPIRED", message: "Cannot extend an expired visibility timeout", status: 409, retryable: true, correlation: input.correlation ?? input.current.correlation });
  }
  if (input.extensionMs > input.current.maxExtensionMs) {
    throw new WorkerRuntimeError({ code: "WORKER_RUNTIME_VALIDATION_FAILED", message: "Visibility timeout extension exceeds maxExtensionMs", status: 400, correlation: input.correlation ?? input.current.correlation });
  }
  return visibilityTimeoutContractSchema.parse({
    ...input.current,
    invisibleUntil: new Date(Date.parse(input.current.invisibleUntil) + input.extensionMs).toISOString(),
    extensionCount: input.current.extensionCount + 1,
    correlation: input.correlation ?? input.current.correlation
  });
};

export const createWorkerHeartbeatContract = (input: {
  readonly tenantId: string;
  readonly workerId: string;
  readonly leaseIds?: readonly string[] | undefined;
  readonly recordedAt: Date;
  readonly heartbeatIntervalMs: number;
  readonly health: WorkerHeartbeatContract["health"];
  readonly correlation: CorrelationMetadata;
  readonly metrics: WorkerHeartbeatContract["metrics"];
}): WorkerHeartbeatContract => workerHeartbeatContractSchema.parse({
  tenantId: input.tenantId,
  workerId: input.workerId,
  leaseIds: input.leaseIds ?? [],
  recordedAt: input.recordedAt.toISOString(),
  nextHeartbeatDueAt: new Date(input.recordedAt.getTime() + input.heartbeatIntervalMs).toISOString(),
  health: input.health,
  correlation: input.correlation,
  metrics: input.metrics
});

export const buildDeadLetterContract = (input: {
  readonly job: JobContract;
  readonly sourceQueueName: string;
  readonly deadLetterQueueName: string;
  readonly reason: DeadLetterReason;
  readonly failedAt: Date;
  readonly attempt: number;
  readonly error?: WorkerRuntimeError | undefined;
  readonly quarantine?: boolean | undefined;
  readonly correlation?: CorrelationMetadata | undefined;
}): DeadLetterQueueContract => deadLetterQueueContractSchema.parse({
  tenantId: input.job.tenantId,
  sourceQueueName: input.sourceQueueName,
  deadLetterQueueName: input.deadLetterQueueName,
  job: input.job,
  reason: input.reason,
  failedAt: input.failedAt.toISOString(),
  attempt: input.attempt,
  error: input.error?.toErrorModel(),
  replayable: input.reason !== "POISON_MESSAGE",
  quarantine: input.quarantine ?? false,
  correlation: input.correlation ?? input.job.correlation
});

export const executeReplaySafeJob = async <TResult extends WorkerRuntimeMetadata = WorkerRuntimeMetadata>(input: WorkerRuntimeExecuteInput<TResult>): Promise<WorkerRuntimeExecuteResult<TResult>> => {
  const job = parseWorkerRuntimeContract(jobContractSchema, input.job, input.job.correlation);
  const lease = parseWorkerRuntimeContract(workerLeaseContractSchema, input.lease, input.job.correlation);
  const token = parseWorkerRuntimeContract(executionTokenContractSchema, input.token, input.job.correlation);
  assertJobExecutionTenantIsolation(job, lease, token);
  const clock = input.ports.clock ?? { now: () => new Date() };
  assertExecutionTokenValid({ token, lease, now: clock.now(), permission: "ACK" });

  const telemetry = input.ports.telemetry ?? {};
  const idempotency = await input.ports.idempotency.claim(job.idempotency);
  if (idempotency.status === "CONFLICT") {
    throw new WorkerRuntimeError({ code: "WORKER_RUNTIME_IDEMPOTENCY_CONFLICT", message: "Idempotency key is already claimed for a conflicting operation", status: 409, correlation: job.correlation });
  }
  if (idempotency.status === "DUPLICATE") {
    return { status: "DUPLICATE_SKIPPED", result: idempotency.previousResult ?? {} };
  }

  if (job.approval !== undefined) {
    await input.ports.approval?.assertApproved(job.approval);
  }

  const span = telemetry.startSpan?.("worker.job.execute", {
    "tenant.id": job.tenantId,
    "job.id": job.jobId,
    "queue.name": job.queueName,
    "job.type": job.jobType,
    "replay.mode": token.replayMode
  });

  try {
    const result = await input.handler.execute({ tenantId: job.tenantId, job, lease, token, correlation: job.correlation, replayMode: token.replayMode, telemetry });
    await input.ports.idempotency.complete({ tenantId: job.tenantId, key: job.idempotency.key, result, correlation: job.correlation });
    const event = workerTelemetryEventSchema.parse({
      id: `${job.jobId}:succeeded`,
      type: "JOB_SUCCEEDED",
      tenantId: job.tenantId,
      jobId: job.jobId,
      occurredAt: clock.now().toISOString(),
      correlation: job.correlation,
      attributes: { "queue.name": job.queueName, "job.type": job.jobType },
      replaySafe: true
    });
    await telemetry.recordEvent?.(event);
    if (job.workflow !== undefined) {
      await input.ports.workflow?.recordJobEvent({ tenantId: job.tenantId, workflow: job.workflow, event });
    }
    span?.end("OK");
    return { status: "SUCCEEDED", result };
  } catch (error) {
    // ST1-013M: a ZodError means the handler rejected the job's own payload (e.g.
    // `somePayloadSchema.parse(context.job.payload)`) -- that failure is deterministic and will
    // recur identically on every retry, so it must dead-letter immediately like any other
    // WORKER_RUNTIME_VALIDATION_FAILED, not spin through the transient-failure retry policy. Any
    // other uncaught exception is treated as WORKER_RUNTIME_TRANSIENT_FAILURE -- unexpected, but
    // plausibly transient (a dependency hiccup), so it gets a chance to succeed on a later attempt.
    const runtimeError = error instanceof WorkerRuntimeError
      ? error
      : error instanceof z.ZodError
        ? new WorkerRuntimeError({ code: "WORKER_RUNTIME_VALIDATION_FAILED", message: error.message, status: 400, retryable: false, correlation: job.correlation })
        : new WorkerRuntimeError({ code: "WORKER_RUNTIME_TRANSIENT_FAILURE", message: error instanceof Error ? error.message : "Worker job execution failed", status: 500, retryable: true, correlation: job.correlation });
    await telemetry.recordError?.({ error: runtimeError, tenantId: job.tenantId, correlation: job.correlation, jobId: job.jobId });
    span?.end("ERROR");
    throw runtimeError;
  }
};
