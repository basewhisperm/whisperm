import { z } from "zod";
import { correlationMetadataSchema } from "@whisperm/types";
import type { CorrelationMetadata } from "@whisperm/types";

const scheduleNamePattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const cronExpressionPattern = /^[\d*,/?#LW\-\sA-Z]+$/u;
const ianaTimeZonePattern = /^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)+$/u;
const utcTimeZone = "UTC";
const maxDelayMs = 366 * 24 * 60 * 60 * 1000;

export const schedulerMetadataSchema = z.record(z.string(), z.unknown());
export type SchedulerMetadata = z.output<typeof schedulerMetadataSchema>;

export const schedulerTimestampSchema = z.string().datetime();
export type SchedulerTimestamp = z.output<typeof schedulerTimestampSchema>;

export const schedulerTenantContextSchema = z.object({
  tenantId: z.string().min(1),
  actorId: z.string().min(1).optional(),
  correlation: correlationMetadataSchema
}).strict();
export type SchedulerTenantContext = z.output<typeof schedulerTenantContextSchema>;

export const schedulerErrorCodeValues = [
  "SCHEDULER_VALIDATION_FAILED",
  "SCHEDULER_TENANT_ISOLATION_VIOLATION",
  "SCHEDULER_INVALID_STATE_TRANSITION",
  "SCHEDULER_INVALID_TIMEZONE",
  "SCHEDULER_INVALID_SCHEDULE",
  "SCHEDULER_LEASE_EXPIRED",
  "SCHEDULER_REPLAY_BLOCKED",
  "SCHEDULER_IDEMPOTENCY_CONFLICT"
] as const;
export const schedulerErrorCodeSchema = z.enum(schedulerErrorCodeValues);
export type SchedulerErrorCode = z.output<typeof schedulerErrorCodeSchema>;

export const schedulerErrorModelSchema = z.object({
  code: schedulerErrorCodeSchema,
  message: z.string().min(1),
  status: z.number().int().min(400).max(599),
  retryable: z.boolean().default(false),
  details: schedulerMetadataSchema.optional(),
  correlation: correlationMetadataSchema.optional()
}).strict();
export type SchedulerErrorModel = z.output<typeof schedulerErrorModelSchema>;

export interface SchedulerRuntimeErrorInput {
  readonly code: SchedulerErrorCode;
  readonly message: string;
  readonly status: number;
  readonly retryable?: boolean | undefined;
  readonly details?: SchedulerMetadata | undefined;
  readonly correlation?: CorrelationMetadata | undefined;
}

export class SchedulerRuntimeError extends Error {
  readonly code: SchedulerErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: SchedulerMetadata | undefined;
  readonly correlation?: CorrelationMetadata | undefined;

  constructor(input: SchedulerRuntimeErrorInput) {
    super(input.message);
    this.name = "SchedulerRuntimeError";
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable ?? false;
    this.details = input.details;
    this.correlation = input.correlation;
    Object.setPrototypeOf(this, SchedulerRuntimeError.prototype);
  }

  toErrorModel(): SchedulerErrorModel {
    return schedulerErrorModelSchema.parse({
      code: this.code,
      message: this.message,
      status: this.status,
      retryable: this.retryable,
      details: this.details,
      correlation: this.correlation
    });
  }
}

const validationIssues = (error: z.ZodError): readonly SchedulerMetadata[] => error.issues.map((issue) => ({
  path: issue.path.join("."),
  message: issue.message,
  code: issue.code
}));

export const parseSchedulerContract = <TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  input: unknown,
  correlation?: CorrelationMetadata,
): z.output<TSchema> => {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new SchedulerRuntimeError({
      code: "SCHEDULER_VALIDATION_FAILED",
      message: "Scheduler contract validation failed",
      status: 400,
      details: { issues: validationIssues(result.error) },
      correlation
    });
  }
  return result.data;
};

export const scheduleKindValues = ["CRON", "INTERVAL", "ONE_TIME", "RECURRING"] as const;
export const scheduleKindSchema = z.enum(scheduleKindValues);
export type ScheduleKind = z.output<typeof scheduleKindSchema>;

export const schedulerIntegrationKindValues = [
  "WORKFLOW_RUNTIME",
  "WORKER_RUNTIME",
  "APPROVAL_EXPIRATION",
  "QUEUE_RUNTIME",
  "TELEMETRY",
  "OBSERVABILITY"
] as const;
export const schedulerIntegrationKindSchema = z.enum(schedulerIntegrationKindValues);
export type SchedulerIntegrationKind = z.output<typeof schedulerIntegrationKindSchema>;

export const timezoneAwareScheduleSchema = z.object({
  timeZone: z.string().min(1).default(utcTimeZone),
  preserveWallClockTime: z.boolean().default(true),
  daylightSavingPolicy: z.enum(["SKIP_INVALID", "RUN_AT_NEXT_VALID_TIME", "RUN_TWICE_ON_FALLBACK"]).default("RUN_AT_NEXT_VALID_TIME")
}).strict().superRefine((timezone, ctx) => {
  if (timezone.timeZone !== utcTimeZone && !ianaTimeZonePattern.test(timezone.timeZone)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "timeZone must be UTC or an IANA timezone", path: ["timeZone"] });
  }
});
export type TimezoneAwareSchedule = z.output<typeof timezoneAwareScheduleSchema>;

export const cronScheduleContractSchema = z.object({
  kind: z.literal("CRON"),
  expression: z.string().min(9).max(120).regex(cronExpressionPattern),
  fieldCount: z.union([z.literal(5), z.literal(6)]).default(5),
  timezone: timezoneAwareScheduleSchema.default({ timeZone: utcTimeZone, preserveWallClockTime: true, daylightSavingPolicy: "RUN_AT_NEXT_VALID_TIME" })
}).strict().superRefine((schedule, ctx) => {
  const fieldCount = schedule.expression.trim().split(/\s+/u).length;
  if (fieldCount !== schedule.fieldCount) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "cron expression field count must match fieldCount", path: ["expression"] });
  }
});
export type CronScheduleContract = z.output<typeof cronScheduleContractSchema>;

export const intervalScheduleContractSchema = z.object({
  kind: z.literal("INTERVAL"),
  everyMs: z.number().int().min(1_000).max(maxDelayMs),
  anchorAt: schedulerTimestampSchema,
  timezone: timezoneAwareScheduleSchema.default({ timeZone: utcTimeZone, preserveWallClockTime: false, daylightSavingPolicy: "RUN_AT_NEXT_VALID_TIME" })
}).strict();
export type IntervalScheduleContract = z.output<typeof intervalScheduleContractSchema>;

export const oneTimeScheduleContractSchema = z.object({
  kind: z.literal("ONE_TIME"),
  runAt: schedulerTimestampSchema,
  timezone: timezoneAwareScheduleSchema.default({ timeZone: utcTimeZone, preserveWallClockTime: false, daylightSavingPolicy: "RUN_AT_NEXT_VALID_TIME" })
}).strict();
export type OneTimeScheduleContract = z.output<typeof oneTimeScheduleContractSchema>;

export const recurringScheduleContractSchema = z.object({
  kind: z.literal("RECURRING"),
  everyMs: z.number().int().min(1_000).max(maxDelayMs),
  startsAt: schedulerTimestampSchema,
  endsAt: schedulerTimestampSchema.optional(),
  maxOccurrences: z.number().int().min(1).max(1_000_000).optional(),
  timezone: timezoneAwareScheduleSchema.default({ timeZone: utcTimeZone, preserveWallClockTime: false, daylightSavingPolicy: "RUN_AT_NEXT_VALID_TIME" })
}).strict().superRefine((schedule, ctx) => {
  if (schedule.endsAt !== undefined && Date.parse(schedule.endsAt) <= Date.parse(schedule.startsAt)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "endsAt must be after startsAt", path: ["endsAt"] });
  }
});
export type RecurringScheduleContract = z.output<typeof recurringScheduleContractSchema>;

export const scheduleDefinitionSchema = z.union([
  cronScheduleContractSchema,
  intervalScheduleContractSchema,
  oneTimeScheduleContractSchema,
  recurringScheduleContractSchema
]);
export type ScheduleDefinition = z.output<typeof scheduleDefinitionSchema>;

export const scheduleFailurePolicySchema = z.object({
  action: z.enum(["RETRY", "PAUSE", "DISABLE", "DEAD_LETTER"]),
  maxConsecutiveFailures: z.number().int().min(1).max(1_000),
  notify: z.boolean().default(true)
}).strict();
export type ScheduleFailurePolicy = z.output<typeof scheduleFailurePolicySchema>;

export const scheduleRetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(100),
  initialDelayMs: z.number().int().min(0).max(maxDelayMs),
  maxDelayMs: z.number().int().min(0).max(maxDelayMs),
  backoffMultiplier: z.number().min(1).max(10),
  jitter: z.literal(false).default(false),
  retryableErrorCodes: z.array(z.string().min(1)).default([])
}).strict().superRefine((policy, ctx) => {
  if (policy.maxDelayMs < policy.initialDelayMs) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "maxDelayMs must be greater than or equal to initialDelayMs", path: ["maxDelayMs"] });
  }
});
export type ScheduleRetryPolicy = z.output<typeof scheduleRetryPolicySchema>;

export const defaultScheduleRetryPolicy = {
  maxAttempts: 1,
  initialDelayMs: 0,
  maxDelayMs: 0,
  backoffMultiplier: 1,
  jitter: false,
  retryableErrorCodes: []
} as const satisfies ScheduleRetryPolicy;

export const scheduleMisfirePolicySchema = z.object({
  action: z.enum(["SKIP", "RUN_ONCE", "RUN_ALL_DUE", "PAUSE"]),
  gracePeriodMs: z.number().int().min(0).max(maxDelayMs),
  maxCatchUpRuns: z.number().int().min(1).max(10_000).default(1)
}).strict();
export type ScheduleMisfirePolicy = z.output<typeof scheduleMisfirePolicySchema>;

export const scheduleDriftDetectionContractSchema = z.object({
  enabled: z.boolean(),
  maxDriftMs: z.number().int().min(0).max(maxDelayMs),
  action: z.enum(["OBSERVE", "AUDIT", "PAUSE"])
}).strict();
export type ScheduleDriftDetectionContract = z.output<typeof scheduleDriftDetectionContractSchema>;

export const scheduleTargetContractSchema = z.object({
  integration: schedulerIntegrationKindSchema,
  targetId: z.string().min(1),
  tenantId: z.string().min(1),
  payload: schedulerMetadataSchema.default({}),
  idempotencyKeyTemplate: z.string().min(1).optional()
}).strict();
export type ScheduleTargetContract = z.output<typeof scheduleTargetContractSchema>;

export const scheduleRegistrationContractSchema = z.object({
  scheduleId: z.string().min(1),
  tenantId: z.string().min(1),
  name: z.string().regex(scheduleNamePattern),
  version: z.literal(1),
  definition: scheduleDefinitionSchema,
  target: scheduleTargetContractSchema,
  state: z.enum(["DRAFT", "REGISTERED", "ENABLED"]).default("REGISTERED"),
  createdAt: schedulerTimestampSchema,
  updatedAt: schedulerTimestampSchema,
  createdBy: z.string().min(1),
  idempotencyKey: z.string().min(1),
  correlation: correlationMetadataSchema,
  metadata: schedulerMetadataSchema.default({}),
  failurePolicy: scheduleFailurePolicySchema.default({ action: "PAUSE", maxConsecutiveFailures: 3, notify: true }),
  retryPolicy: scheduleRetryPolicySchema.default(defaultScheduleRetryPolicy),
  misfirePolicy: scheduleMisfirePolicySchema.default({ action: "RUN_ONCE", gracePeriodMs: 60_000, maxCatchUpRuns: 1 }),
  driftDetection: scheduleDriftDetectionContractSchema.default({ enabled: true, maxDriftMs: 60_000, action: "AUDIT" })
}).strict().superRefine((registration, ctx) => {
  if (registration.target.tenantId !== registration.tenantId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "target tenantId must match schedule tenantId", path: ["target", "tenantId"] });
  }
});
export type ScheduleRegistrationContract = z.output<typeof scheduleRegistrationContractSchema>;

export const scheduleRuntimeStateValues = ["DRAFT", "REGISTERED", "ENABLED", "PAUSED", "DISABLED", "LEASED", "RUNNING", "SUCCEEDED", "FAILED", "MISFIRED", "EXHAUSTED", "DELETED"] as const;
export const scheduleRuntimeStateSchema = z.enum(scheduleRuntimeStateValues);
export type ScheduleRuntimeState = z.output<typeof scheduleRuntimeStateSchema>;

export const terminalScheduleStateValues = ["SUCCEEDED", "EXHAUSTED", "DELETED"] as const satisfies readonly ScheduleRuntimeState[];
export type TerminalScheduleState = (typeof terminalScheduleStateValues)[number];

const scheduleStateTransitions: Readonly<Record<ScheduleRuntimeState, readonly ScheduleRuntimeState[]>> = {
  DRAFT: ["REGISTERED", "DELETED"],
  REGISTERED: ["ENABLED", "DISABLED", "DELETED"],
  ENABLED: ["PAUSED", "DISABLED", "LEASED", "MISFIRED", "DELETED"],
  PAUSED: ["ENABLED", "DISABLED", "DELETED"],
  DISABLED: ["ENABLED", "DELETED"],
  LEASED: ["RUNNING", "ENABLED", "PAUSED", "DISABLED"],
  RUNNING: ["ENABLED", "SUCCEEDED", "FAILED", "MISFIRED", "EXHAUSTED", "PAUSED", "DISABLED"],
  SUCCEEDED: [],
  FAILED: ["ENABLED", "PAUSED", "DISABLED", "EXHAUSTED"],
  MISFIRED: ["ENABLED", "PAUSED", "DISABLED", "EXHAUSTED"],
  EXHAUSTED: [],
  DELETED: []
};

export const isTerminalScheduleState = (state: ScheduleRuntimeState): state is TerminalScheduleState =>
  terminalScheduleStateValues.includes(state as TerminalScheduleState);

export const canTransitionScheduleState = (from: ScheduleRuntimeState, to: ScheduleRuntimeState): boolean =>
  scheduleStateTransitions[from].includes(to);

export const scheduleStateSnapshotSchema = z.object({
  tenantId: z.string().min(1),
  scheduleId: z.string().min(1),
  state: scheduleRuntimeStateSchema,
  updatedAt: schedulerTimestampSchema,
  nextRunAt: schedulerTimestampSchema.optional(),
  lastRunAt: schedulerTimestampSchema.optional(),
  occurrenceCount: z.number().int().min(0).default(0),
  consecutiveFailures: z.number().int().min(0).default(0),
  leaseId: z.string().min(1).optional(),
  correlation: correlationMetadataSchema
}).strict();
export type ScheduleStateSnapshot = z.output<typeof scheduleStateSnapshotSchema>;

export interface TransitionScheduleStateInput {
  readonly snapshot: ScheduleStateSnapshot;
  readonly to: ScheduleRuntimeState;
  readonly now: Date;
  readonly nextRunAt?: Date | undefined;
  readonly leaseId?: string | undefined;
  readonly correlation?: CorrelationMetadata | undefined;
}

export const transitionScheduleState = (input: TransitionScheduleStateInput): ScheduleStateSnapshot => {
  const snapshot = scheduleStateSnapshotSchema.parse(input.snapshot);
  if (!canTransitionScheduleState(snapshot.state, input.to)) {
    throw new SchedulerRuntimeError({
      code: "SCHEDULER_INVALID_STATE_TRANSITION",
      message: "Schedule state transition is not allowed",
      status: 409,
      details: { from: snapshot.state, to: input.to, scheduleId: snapshot.scheduleId, tenantId: snapshot.tenantId },
      correlation: input.correlation ?? snapshot.correlation
    });
  }

  const next = {
    ...snapshot,
    state: input.to,
    updatedAt: input.now.toISOString(),
    nextRunAt: input.nextRunAt?.toISOString() ?? snapshot.nextRunAt,
    leaseId: input.leaseId ?? snapshot.leaseId
  };
  return scheduleStateSnapshotSchema.parse(next);
};

export const schedulerLeaseContractSchema = z.object({
  tenantId: z.string().min(1),
  scheduleId: z.string().min(1),
  leaseId: z.string().min(1),
  ownerId: z.string().min(1),
  acquiredAt: schedulerTimestampSchema,
  expiresAt: schedulerTimestampSchema,
  heartbeatIntervalMs: z.number().int().min(1_000).max(maxDelayMs),
  fencingToken: z.string().min(1),
  correlation: correlationMetadataSchema
}).strict().superRefine((lease, ctx) => {
  if (Date.parse(lease.expiresAt) <= Date.parse(lease.acquiredAt)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "lease expiresAt must be after acquiredAt", path: ["expiresAt"] });
  }
});
export type SchedulerLeaseContract = z.output<typeof schedulerLeaseContractSchema>;

export const schedulerLeadershipContractSchema = z.object({
  tenantId: z.string().min(1),
  leaderId: z.string().min(1),
  leadershipId: z.string().min(1),
  electedAt: schedulerTimestampSchema,
  expiresAt: schedulerTimestampSchema,
  fencingToken: z.string().min(1),
  correlation: correlationMetadataSchema
}).strict();
export type SchedulerLeadershipContract = z.output<typeof schedulerLeadershipContractSchema>;

export const schedulerHeartbeatContractSchema = z.object({
  tenantId: z.string().min(1),
  schedulerId: z.string().min(1),
  leaderId: z.string().min(1).optional(),
  leaseIds: z.array(z.string().min(1)).default([]),
  recordedAt: schedulerTimestampSchema,
  nextHeartbeatDueAt: schedulerTimestampSchema,
  health: z.enum(["HEALTHY", "DEGRADED", "UNHEALTHY"]),
  correlation: correlationMetadataSchema,
  metrics: z.object({
    dueSchedules: z.number().int().min(0),
    runningSchedules: z.number().int().min(0),
    completedExecutions: z.number().int().min(0),
    failedExecutions: z.number().int().min(0),
    misfires: z.number().int().min(0)
  }).strict()
}).strict();
export type SchedulerHeartbeatContract = z.output<typeof schedulerHeartbeatContractSchema>;

export const distributedCoordinationContractSchema = z.object({
  tenantId: z.string().min(1),
  coordinatorId: z.string().min(1),
  backend: z.enum(["POSTGRES", "REDIS", "TEMPORAL", "KUBERNETES_CRONJOB", "AWS_EVENTBRIDGE", "GOOGLE_CLOUD_SCHEDULER", "AZURE_SCHEDULER", "IN_MEMORY_TEST"]),
  leaseTtlMs: z.number().int().min(1_000).max(maxDelayMs),
  heartbeatIntervalMs: z.number().int().min(1_000).max(maxDelayMs),
  fencingRequired: z.literal(true).default(true),
  replayProtectionRequired: z.literal(true).default(true),
  correlation: correlationMetadataSchema
}).strict().superRefine((coordination, ctx) => {
  if (coordination.heartbeatIntervalMs >= coordination.leaseTtlMs) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "heartbeatIntervalMs must be lower than leaseTtlMs", path: ["heartbeatIntervalMs"] });
  }
});
export type DistributedCoordinationContract = z.output<typeof distributedCoordinationContractSchema>;

export const schedulerCheckpointContractSchema = z.object({
  tenantId: z.string().min(1),
  scheduleId: z.string().min(1),
  checkpointId: z.string().min(1),
  executionId: z.string().min(1).optional(),
  state: scheduleRuntimeStateSchema,
  nextRunAt: schedulerTimestampSchema.optional(),
  lastRunAt: schedulerTimestampSchema.optional(),
  occurrenceCount: z.number().int().min(0),
  version: z.number().int().min(1),
  recordedAt: schedulerTimestampSchema,
  fencingToken: z.string().min(1),
  correlation: correlationMetadataSchema,
  metadata: schedulerMetadataSchema.default({})
}).strict();
export type SchedulerCheckpointContract = z.output<typeof schedulerCheckpointContractSchema>;

export const schedulerReplayProtectionContractSchema = z.object({
  tenantId: z.string().min(1),
  scheduleId: z.string().min(1),
  executionId: z.string().min(1),
  replayKey: z.string().min(1),
  firstSeenAt: schedulerTimestampSchema,
  expiresAt: schedulerTimestampSchema.optional(),
  replaySafe: z.literal(true).default(true),
  correlation: correlationMetadataSchema
}).strict();
export type SchedulerReplayProtectionContract = z.output<typeof schedulerReplayProtectionContractSchema>;

export const schedulerIdempotencyContractSchema = z.object({
  tenantId: z.string().min(1),
  scheduleId: z.string().min(1),
  executionId: z.string().min(1),
  key: z.string().min(1),
  scope: z.enum(["REGISTRATION", "EXECUTION", "CHECKPOINT", "AUDIT"]),
  correlation: correlationMetadataSchema
}).strict();
export type SchedulerIdempotencyContract = z.output<typeof schedulerIdempotencyContractSchema>;

export const scheduleExecutionContractSchema = z.object({
  tenantId: z.string().min(1),
  scheduleId: z.string().min(1),
  executionId: z.string().min(1),
  dueAt: schedulerTimestampSchema,
  startedAt: schedulerTimestampSchema.optional(),
  completedAt: schedulerTimestampSchema.optional(),
  attempt: z.number().int().min(0).max(100),
  state: z.enum(["PENDING", "CLAIMED", "RUNNING", "SUCCEEDED", "FAILED", "SKIPPED", "MISFIRED", "DEAD_LETTERED"]),
  target: scheduleTargetContractSchema,
  leaseId: z.string().min(1).optional(),
  idempotency: schedulerIdempotencyContractSchema,
  replay: schedulerReplayProtectionContractSchema,
  correlation: correlationMetadataSchema,
  metadata: schedulerMetadataSchema.default({})
}).strict().superRefine((execution, ctx) => {
  const mismatches = [execution.target.tenantId, execution.idempotency.tenantId, execution.replay.tenantId].filter((tenantId) => tenantId !== execution.tenantId);
  if (mismatches.length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "nested execution contracts must use execution tenantId" });
  }
  if (execution.idempotency.scheduleId !== execution.scheduleId || execution.replay.scheduleId !== execution.scheduleId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "nested execution contracts must use execution scheduleId" });
  }
  if (execution.idempotency.executionId !== execution.executionId || execution.replay.executionId !== execution.executionId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "nested execution contracts must use execution executionId" });
  }
});
export type ScheduleExecutionContract = z.output<typeof scheduleExecutionContractSchema>;

export const scheduleAuditActionSchema = z.enum(["REGISTER", "ENABLE", "DISABLE", "PAUSE", "RESUME", "LEASE", "EXECUTE", "MISFIRE", "FAIL", "RETRY", "CHECKPOINT", "DELETE"]);
export type ScheduleAuditAction = z.output<typeof scheduleAuditActionSchema>;

export const scheduleAuditContractSchema = z.object({
  tenantId: z.string().min(1),
  scheduleId: z.string().min(1),
  auditId: z.string().min(1),
  action: scheduleAuditActionSchema,
  actorId: z.string().min(1),
  occurredAt: schedulerTimestampSchema,
  targetState: scheduleRuntimeStateSchema.optional(),
  correlation: correlationMetadataSchema,
  metadata: schedulerMetadataSchema.default({})
}).strict();
export type ScheduleAuditContract = z.output<typeof scheduleAuditContractSchema>;

export const scheduleHistoryContractSchema = z.object({
  tenantId: z.string().min(1),
  scheduleId: z.string().min(1),
  historyId: z.string().min(1),
  executionId: z.string().min(1).optional(),
  state: scheduleRuntimeStateSchema,
  recordedAt: schedulerTimestampSchema,
  reason: z.string().min(1).optional(),
  correlation: correlationMetadataSchema,
  metadata: schedulerMetadataSchema.default({})
}).strict();
export type ScheduleHistoryContract = z.output<typeof scheduleHistoryContractSchema>;

const scheduleControlBaseSchema = z.object({
  tenantId: z.string().min(1),
  scheduleId: z.string().min(1),
  requestedBy: z.string().min(1),
  requestedAt: schedulerTimestampSchema,
  reason: z.string().min(1).max(2_000).optional(),
  idempotencyKey: z.string().min(1),
  correlation: correlationMetadataSchema
}).strict();

export const schedulePauseContractSchema = scheduleControlBaseSchema.extend({ operation: z.literal("PAUSE") }).strict();
export type SchedulePauseContract = z.output<typeof schedulePauseContractSchema>;
export const scheduleResumeContractSchema = scheduleControlBaseSchema.extend({ operation: z.literal("RESUME") }).strict();
export type ScheduleResumeContract = z.output<typeof scheduleResumeContractSchema>;
export const scheduleDisableContractSchema = scheduleControlBaseSchema.extend({ operation: z.literal("DISABLE") }).strict();
export type ScheduleDisableContract = z.output<typeof scheduleDisableContractSchema>;
export const scheduleEnableContractSchema = scheduleControlBaseSchema.extend({ operation: z.literal("ENABLE") }).strict();
export type ScheduleEnableContract = z.output<typeof scheduleEnableContractSchema>;

export interface SchedulerWorkflowRuntimePort {
  recordScheduledExecution(execution: ScheduleExecutionContract): Promise<void> | void;
}

export interface SchedulerWorkerRuntimePort {
  enqueueScheduledWork(execution: ScheduleExecutionContract): Promise<void> | void;
}

export interface SchedulerApprovalExpirationPort {
  expireApproval(input: { readonly tenantId: string; readonly approvalId: string; readonly execution: ScheduleExecutionContract; readonly correlation: CorrelationMetadata }): Promise<void> | void;
}

export interface SchedulerQueueRuntimePort {
  publishScheduledJob(execution: ScheduleExecutionContract): Promise<void> | void;
}

export interface SchedulerTelemetryPort {
  emit(event: { readonly tenantId: string; readonly name: string; readonly attributes: SchedulerMetadata; readonly correlation: CorrelationMetadata }): Promise<void> | void;
}

export interface SchedulerObservabilityPort {
  audit(contract: ScheduleAuditContract): Promise<void> | void;
  history(contract: ScheduleHistoryContract): Promise<void> | void;
}

export interface SchedulerIdempotencyPort {
  claim(contract: SchedulerIdempotencyContract): Promise<"CLAIMED" | "DUPLICATE" | "CONFLICT"> | "CLAIMED" | "DUPLICATE" | "CONFLICT";
  complete(contract: SchedulerIdempotencyContract): Promise<void> | void;
}

export interface SchedulerRuntimePorts {
  readonly workflow?: SchedulerWorkflowRuntimePort | undefined;
  readonly worker?: SchedulerWorkerRuntimePort | undefined;
  readonly approvalExpiration?: SchedulerApprovalExpirationPort | undefined;
  readonly queue?: SchedulerQueueRuntimePort | undefined;
  readonly telemetry?: SchedulerTelemetryPort | undefined;
  readonly observability?: SchedulerObservabilityPort | undefined;
  readonly idempotency?: SchedulerIdempotencyPort | undefined;
}

export const assertScheduleTenantIsolation = (
  tenantId: string,
  contracts: readonly { readonly tenantId: string; readonly correlation?: CorrelationMetadata }[],
  correlation?: CorrelationMetadata,
): void => {
  const violation = contracts.find((contract) => contract.tenantId !== tenantId);
  if (violation !== undefined) {
    throw new SchedulerRuntimeError({
      code: "SCHEDULER_TENANT_ISOLATION_VIOLATION",
      message: "Scheduler contract tenant isolation violation",
      status: 403,
      details: { expectedTenantId: tenantId, actualTenantId: violation.tenantId },
      correlation: correlation ?? violation.correlation
    });
  }
};

export const isLeaseExpired = (lease: SchedulerLeaseContract, now: Date): boolean =>
  Date.parse(lease.expiresAt) <= now.getTime();

export const createSchedulerHeartbeatContract = (input: {
  readonly tenantId: string;
  readonly schedulerId: string;
  readonly leaderId?: string | undefined;
  readonly leaseIds?: readonly string[] | undefined;
  readonly recordedAt: Date;
  readonly heartbeatIntervalMs: number;
  readonly health: SchedulerHeartbeatContract["health"];
  readonly correlation: CorrelationMetadata;
  readonly metrics: SchedulerHeartbeatContract["metrics"];
}): SchedulerHeartbeatContract => schedulerHeartbeatContractSchema.parse({
  tenantId: input.tenantId,
  schedulerId: input.schedulerId,
  leaderId: input.leaderId,
  leaseIds: input.leaseIds ?? [],
  recordedAt: input.recordedAt.toISOString(),
  nextHeartbeatDueAt: new Date(input.recordedAt.getTime() + input.heartbeatIntervalMs).toISOString(),
  health: input.health,
  correlation: input.correlation,
  metrics: input.metrics
});

export const calculateScheduleRetryDelayMs = (policy: ScheduleRetryPolicy, attempt: number): number => {
  const parsed = scheduleRetryPolicySchema.parse(policy);
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new SchedulerRuntimeError({ code: "SCHEDULER_INVALID_SCHEDULE", message: "Retry attempt must be a positive integer", status: 400, details: { attempt } });
  }
  const exponent = Math.max(0, attempt - 1);
  return Math.min(parsed.maxDelayMs, Math.trunc(parsed.initialDelayMs * (parsed.backoffMultiplier ** exponent)));
};

export interface NextRunInput {
  readonly definition: ScheduleDefinition;
  readonly after: Date;
  readonly occurrenceCount?: number | undefined;
}

const nextIntervalDate = (anchor: Date, everyMs: number, after: Date): Date => {
  if (after.getTime() < anchor.getTime()) {
    return anchor;
  }
  const elapsed = after.getTime() - anchor.getTime();
  const intervals = Math.floor(elapsed / everyMs) + 1;
  return new Date(anchor.getTime() + (intervals * everyMs));
};

export const calculateNextRunAt = (input: NextRunInput): string | undefined => {
  const definition = scheduleDefinitionSchema.parse(input.definition);
  if (definition.kind === "ONE_TIME") {
    return Date.parse(definition.runAt) > input.after.getTime() ? definition.runAt : undefined;
  }
  if (definition.kind === "INTERVAL") {
    return nextIntervalDate(new Date(definition.anchorAt), definition.everyMs, input.after).toISOString();
  }
  if (definition.kind === "RECURRING") {
    const occurrenceCount = input.occurrenceCount ?? 0;
    if (definition.maxOccurrences !== undefined && occurrenceCount >= definition.maxOccurrences) {
      return undefined;
    }
    const next = nextIntervalDate(new Date(definition.startsAt), definition.everyMs, input.after);
    if (definition.endsAt !== undefined && next.getTime() > Date.parse(definition.endsAt)) {
      return undefined;
    }
    return next.toISOString();
  }

  return undefined;
};

export const detectScheduleDrift = (input: {
  readonly expectedRunAt: Date;
  readonly observedAt: Date;
  readonly policy: ScheduleDriftDetectionContract;
}): { readonly drifted: boolean; readonly driftMs: number; readonly action: ScheduleDriftDetectionContract["action"] } => {
  const policy = scheduleDriftDetectionContractSchema.parse(input.policy);
  const driftMs = Math.max(0, input.observedAt.getTime() - input.expectedRunAt.getTime());
  return { drifted: policy.enabled && driftMs > policy.maxDriftMs, driftMs, action: policy.action };
};

export const applyMisfirePolicy = (input: {
  readonly dueAt: Date;
  readonly observedAt: Date;
  readonly policy: ScheduleMisfirePolicy;
}): { readonly action: ScheduleMisfirePolicy["action"]; readonly misfired: boolean } => {
  const policy = scheduleMisfirePolicySchema.parse(input.policy);
  const lateByMs = input.observedAt.getTime() - input.dueAt.getTime();
  return { action: policy.action, misfired: lateByMs > policy.gracePeriodMs };
};

export const buildSchedulerIdempotencyKey = (input: {
  readonly tenantId: string;
  readonly scheduleId: string;
  readonly dueAt: string;
  readonly targetId: string;
}): string => ["scheduler", input.tenantId, input.scheduleId, input.targetId, input.dueAt].join(":");

export const createScheduleExecutionContract = (input: {
  readonly registration: ScheduleRegistrationContract;
  readonly executionId: string;
  readonly dueAt: Date;
  readonly now: Date;
  readonly attempt?: number | undefined;
  readonly leaseId?: string | undefined;
}): ScheduleExecutionContract => {
  const registration = scheduleRegistrationContractSchema.parse(input.registration);
  const dueAt = input.dueAt.toISOString();
  const key = buildSchedulerIdempotencyKey({ tenantId: registration.tenantId, scheduleId: registration.scheduleId, targetId: registration.target.targetId, dueAt });
  return scheduleExecutionContractSchema.parse({
    tenantId: registration.tenantId,
    scheduleId: registration.scheduleId,
    executionId: input.executionId,
    dueAt,
    attempt: input.attempt ?? 0,
    state: "PENDING",
    target: registration.target,
    leaseId: input.leaseId,
    idempotency: { tenantId: registration.tenantId, scheduleId: registration.scheduleId, executionId: input.executionId, key, scope: "EXECUTION", correlation: registration.correlation },
    replay: { tenantId: registration.tenantId, scheduleId: registration.scheduleId, executionId: input.executionId, replayKey: key, firstSeenAt: input.now.toISOString(), replaySafe: true, correlation: registration.correlation },
    correlation: registration.correlation,
    metadata: registration.metadata
  });
};

export const dispatchScheduleExecution = async (execution: ScheduleExecutionContract, ports: SchedulerRuntimePorts): Promise<"DISPATCHED" | "DUPLICATE"> => {
  const parsed = scheduleExecutionContractSchema.parse(execution);
  const claim = await ports.idempotency?.claim(parsed.idempotency) ?? "CLAIMED";
  if (claim === "DUPLICATE") {
    return "DUPLICATE";
  }
  if (claim === "CONFLICT") {
    throw new SchedulerRuntimeError({
      code: "SCHEDULER_IDEMPOTENCY_CONFLICT",
      message: "Scheduler execution idempotency claim conflicted",
      status: 409,
      details: { tenantId: parsed.tenantId, scheduleId: parsed.scheduleId, executionId: parsed.executionId },
      correlation: parsed.correlation
    });
  }

  await ports.workflow?.recordScheduledExecution(parsed);
  await ports.worker?.enqueueScheduledWork(parsed);
  await ports.queue?.publishScheduledJob(parsed);
  if (parsed.target.integration === "APPROVAL_EXPIRATION") {
    await ports.approvalExpiration?.expireApproval({ tenantId: parsed.tenantId, approvalId: parsed.target.targetId, execution: parsed, correlation: parsed.correlation });
  }
  await ports.telemetry?.emit({ tenantId: parsed.tenantId, name: "scheduler.execution.dispatched", attributes: { scheduleId: parsed.scheduleId, executionId: parsed.executionId, targetIntegration: parsed.target.integration }, correlation: parsed.correlation });
  await ports.idempotency?.complete(parsed.idempotency);
  return "DISPATCHED";
};
