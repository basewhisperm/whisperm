import { z } from "zod";

export const executionCorrelationMetadataSchema = z.object({
  correlationId: z.string().min(1),
  requestId: z.string().min(1).optional(),
  causationId: z.string().min(1).optional(),
  traceId: z.string().min(1).optional(),
  spanId: z.string().min(1).optional()
}).strict();
export type ExecutionCorrelationMetadata = z.infer<typeof executionCorrelationMetadataSchema>;

export const executionPayloadSchema = z.record(z.string(), z.unknown());
export type ExecutionPayload = z.infer<typeof executionPayloadSchema>;

export const executionErrorCodeValues = [
  "EXECUTION_VALIDATION_FAILED",
  "EXECUTION_TENANT_CONTEXT_MISSING",
  "EXECUTION_TENANT_MISMATCH",
  "EXECUTION_POLICY_DENIED",
  "EXECUTION_STATE_TRANSITION_INVALID",
  "EXECUTION_STEP_NOT_FOUND",
  "EXECUTION_STEP_TYPE_UNSUPPORTED",
  "EXECUTION_STEP_DEPENDENCY_UNSATISFIED",
  "EXECUTION_STEP_FAILED",
  "EXECUTION_RETRY_EXHAUSTED",
  "EXECUTION_TIMEOUT",
  "EXECUTION_CANCELLED",
  "EXECUTION_APPROVAL_REQUIRED",
  "EXECUTION_APPROVAL_INVALID",
  "EXECUTION_CHECKPOINT_CONFLICT",
  "EXECUTION_RECOVERY_FAILED",
  "EXECUTION_DEAD_LETTERED"
] as const;
export const executionErrorCodeSchema = z.enum(executionErrorCodeValues);
export type ExecutionErrorCode = z.infer<typeof executionErrorCodeSchema>;

export const executionErrorModelSchema = z.object({
  code: executionErrorCodeSchema,
  message: z.string().min(1),
  status: z.number().int().min(400).max(599),
  retryable: z.boolean().default(false),
  details: executionPayloadSchema.optional(),
  correlation: executionCorrelationMetadataSchema.optional()
}).strict();
export type ExecutionErrorModel = z.infer<typeof executionErrorModelSchema>;

export interface ExecutionRuntimeErrorInput {
  readonly code: ExecutionErrorCode;
  readonly message: string;
  readonly status: number;
  readonly retryable?: boolean;
  readonly details?: ExecutionPayload | undefined;
  readonly correlation?: ExecutionCorrelationMetadata | undefined;
}

export class ExecutionRuntimeError extends Error {
  readonly code: ExecutionErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: ExecutionPayload | undefined;
  readonly correlation?: ExecutionCorrelationMetadata | undefined;

  constructor(input: ExecutionRuntimeErrorInput) {
    super(input.message);
    this.name = "ExecutionRuntimeError";
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable ?? false;
    this.details = input.details;
    this.correlation = input.correlation;
    Object.setPrototypeOf(this, ExecutionRuntimeError.prototype);
  }

  toErrorModel(): ExecutionErrorModel {
    return executionErrorModelSchema.parse({
      code: this.code,
      message: this.message,
      status: this.status,
      retryable: this.retryable,
      details: this.details,
      correlation: this.correlation
    });
  }
}

const validationIssues = (error: z.ZodError): readonly ExecutionPayload[] => error.issues.map((issue) => ({
  path: issue.path.join("."),
  message: issue.message,
  code: issue.code
}));

const parseExecutionSchema = <TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  input: unknown,
  correlation: ExecutionCorrelationMetadata | undefined,
  message = "Execution contract validation failed",
): z.output<TSchema> => {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ExecutionRuntimeError({
      code: "EXECUTION_VALIDATION_FAILED",
      message,
      status: 400,
      details: { issues: validationIssues(result.error) },
      correlation
    });
  }
  return result.data;
};

export const executionRetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(20),
  initialDelayMs: z.number().int().min(0).max(300_000),
  maxDelayMs: z.number().int().min(0).max(3_600_000),
  backoffMultiplier: z.number().min(1).max(10),
  jitter: z.literal(false).default(false)
}).strict();
export type ExecutionRetryPolicy = z.output<typeof executionRetryPolicySchema>;

export const defaultExecutionRetryPolicy: ExecutionRetryPolicy = {
  maxAttempts: 1,
  initialDelayMs: 0,
  maxDelayMs: 0,
  backoffMultiplier: 1,
  jitter: false
};

export const calculateExecutionBackoffMs = (policy: ExecutionRetryPolicy, nextAttempt: number): number => {
  const parsed = executionRetryPolicySchema.parse(policy);
  const exponent = Math.max(0, nextAttempt - 2);
  return Math.min(parsed.maxDelayMs, Math.floor(parsed.initialDelayMs * (parsed.backoffMultiplier ** exponent)));
};

export const executionStateValues = ["CREATED", "RUNNING", "PAUSED", "SUCCEEDED", "FAILED", "CANCELLED", "DEAD_LETTERED"] as const;
export const executionStateSchema = z.enum(executionStateValues);
export type ExecutionState = z.infer<typeof executionStateSchema>;

export const executionStepStateValues = ["PENDING", "RUNNING", "WAITING_FOR_APPROVAL", "SUCCEEDED", "FAILED", "SKIPPED", "CANCELLED"] as const;
export const executionStepStateSchema = z.enum(executionStepStateValues);
export type ExecutionStepState = z.infer<typeof executionStepStateSchema>;

const executionTransitions: Readonly<Record<ExecutionState, readonly ExecutionState[]>> = {
  CREATED: ["RUNNING", "CANCELLED"],
  RUNNING: ["PAUSED", "SUCCEEDED", "FAILED", "CANCELLED", "DEAD_LETTERED"],
  PAUSED: ["RUNNING", "CANCELLED", "DEAD_LETTERED"],
  SUCCEEDED: [],
  FAILED: ["DEAD_LETTERED"],
  CANCELLED: [],
  DEAD_LETTERED: []
};

export const canTransitionExecutionState = (from: ExecutionState, to: ExecutionState): boolean => executionTransitions[from].includes(to);

export const assertExecutionStateTransition = (from: ExecutionState, to: ExecutionState, correlation?: ExecutionCorrelationMetadata): void => {
  if (!canTransitionExecutionState(from, to)) {
    throw new ExecutionRuntimeError({
      code: "EXECUTION_STATE_TRANSITION_INVALID",
      message: "Execution state transition is not allowed",
      status: 409,
      details: { from, to },
      correlation
    });
  }
};

export const executionStepTypeValues = ["TASK", "TOOL", "PROVIDER", "APPROVAL"] as const;
export const executionStepTypeSchema = z.enum(executionStepTypeValues);
export type ExecutionStepType = z.infer<typeof executionStepTypeSchema>;

export const executionToolCallSchema = z.object({
  toolName: z.string().min(1),
  toolVersion: z.string().min(1),
  input: executionPayloadSchema.default({})
}).strict();
export type ExecutionToolCall = z.infer<typeof executionToolCallSchema>;

export const executionProviderCallSchema = z.object({
  providerId: z.string().min(1),
  capability: z.string().min(1),
  operation: z.string().min(1),
  input: executionPayloadSchema.default({})
}).strict();
export type ExecutionProviderCall = z.infer<typeof executionProviderCallSchema>;

export const executionApprovalPolicySchema = z.object({
  approvalId: z.string().min(1),
  reason: z.string().min(1),
  requiredRole: z.string().min(1).optional(),
  expiresAt: z.string().datetime().optional()
}).strict();
export type ExecutionApprovalPolicy = z.infer<typeof executionApprovalPolicySchema>;

export const executionStepDefinitionSchema = z.object({
  id: z.string().min(1),
  type: executionStepTypeSchema,
  name: z.string().min(1).optional(),
  input: executionPayloadSchema.default({}),
  dependsOn: z.array(z.string().min(1)).default([]),
  deterministic: z.literal(true).default(true),
  tenantScoped: z.literal(true).default(true),
  retryPolicy: executionRetryPolicySchema.default(defaultExecutionRetryPolicy),
  timeoutMs: z.number().int().positive().max(86_400_000).optional(),
  tool: executionToolCallSchema.optional(),
  provider: executionProviderCallSchema.optional(),
  approval: executionApprovalPolicySchema.optional(),
  metadata: executionPayloadSchema.optional()
}).strict().superRefine((step, ctx) => {
  if (step.type === "TOOL" && step.tool === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "TOOL steps require a tool call contract", path: ["tool"] });
  }
  if (step.type === "PROVIDER" && step.provider === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "PROVIDER steps require a provider call contract", path: ["provider"] });
  }
  if (step.type === "APPROVAL" && step.approval === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "APPROVAL steps require an approval policy", path: ["approval"] });
  }
});
export type ExecutionStepDefinition = z.output<typeof executionStepDefinitionSchema>;

export const agentExecutionPlanSchema = z.object({
  planId: z.string().min(1),
  tenantId: z.string().min(1),
  agentId: z.string().min(1),
  plannerId: z.string().min(1),
  version: z.number().int().positive(),
  objective: z.string().min(1),
  steps: z.array(executionStepDefinitionSchema).min(1),
  metadata: executionPayloadSchema.default({})
}).strict().superRefine((plan, ctx) => {
  const ids = new Set<string>();
  for (const [index, step] of plan.steps.entries()) {
    if (ids.has(step.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Execution step IDs must be unique", path: ["steps", index, "id"] });
    }
    ids.add(step.id);
  }
  for (const [index, step] of plan.steps.entries()) {
    for (const [dependencyIndex, dependency] of step.dependsOn.entries()) {
      if (!ids.has(dependency)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Step dependencies must reference declared steps", path: ["steps", index, "dependsOn", dependencyIndex] });
      }
      if (dependency === step.id) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Execution steps cannot depend on themselves", path: ["steps", index, "dependsOn", dependencyIndex] });
      }
    }
  }
});
export type AgentExecutionPlan = z.output<typeof agentExecutionPlanSchema>;

export const executionContextSchema = z.object({
  tenantId: z.string().min(1),
  actorId: z.string().min(1).optional(),
  agentId: z.string().min(1),
  executionId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  replay: z.boolean().default(false),
  correlation: executionCorrelationMetadataSchema,
  deterministicSeed: z.string().min(1).optional(),
  cancellation: z.object({ requested: z.boolean().default(false), reason: z.string().min(1).optional() }).strict().optional()
}).strict();
export type ExecutionContext = z.output<typeof executionContextSchema>;

export interface ExecutionPlanner<TInput = ExecutionPayload> {
  createPlan(input: TInput, context: ExecutionContext): Promise<AgentExecutionPlan>;
}

export const executionStepResultStatusValues = ["SUCCEEDED", "PAUSED", "FAILED", "CANCELLED"] as const;
export const executionStepResultStatusSchema = z.enum(executionStepResultStatusValues);
export type ExecutionStepResultStatus = z.infer<typeof executionStepResultStatusSchema>;

export const executionStepResultSchema = z.object({
  tenantId: z.string().min(1),
  executionId: z.string().min(1),
  stepId: z.string().min(1),
  status: executionStepResultStatusSchema,
  attempt: z.number().int().min(1),
  output: executionPayloadSchema.default({}),
  error: executionErrorModelSchema.optional(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  correlation: executionCorrelationMetadataSchema
}).strict();
export type ExecutionStepResult = z.output<typeof executionStepResultSchema>;

export const executionStepSnapshotSchema = z.object({
  stepId: z.string().min(1),
  state: executionStepStateSchema,
  attempts: z.number().int().min(0),
  output: executionPayloadSchema.optional(),
  error: executionErrorModelSchema.optional(),
  updatedAt: z.string().datetime()
}).strict();
export type ExecutionStepSnapshot = z.output<typeof executionStepSnapshotSchema>;

export const executionSnapshotSchema = z.object({
  tenantId: z.string().min(1),
  executionId: z.string().min(1),
  planId: z.string().min(1),
  state: executionStateSchema,
  checkpointVersion: z.number().int().nonnegative(),
  stepSnapshots: z.array(executionStepSnapshotSchema).default([]),
  pendingApproval: executionApprovalPolicySchema.optional(),
  lastEventSequence: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
  correlation: executionCorrelationMetadataSchema
}).strict();
export type ExecutionSnapshot = z.output<typeof executionSnapshotSchema>;

export const executionCheckpointSchema = z.object({
  tenantId: z.string().min(1),
  executionId: z.string().min(1),
  version: z.number().int().nonnegative(),
  snapshot: executionSnapshotSchema,
  checksum: z.string().min(1).optional()
}).strict().refine((checkpoint) => checkpoint.tenantId === checkpoint.snapshot.tenantId && checkpoint.executionId === checkpoint.snapshot.executionId, {
  message: "Checkpoint tenant and execution boundaries must match snapshot",
  path: ["snapshot"]
});
export type ExecutionCheckpoint = z.output<typeof executionCheckpointSchema>;

export interface ExecutionCheckpointStore {
  load(tenantId: string, executionId: string): Promise<ExecutionCheckpoint | undefined>;
  save(checkpoint: ExecutionCheckpoint): Promise<void>;
}

export const executionApprovalDecisionSchema = z.object({
  tenantId: z.string().min(1),
  executionId: z.string().min(1),
  approvalId: z.string().min(1),
  approved: z.boolean(),
  decidedByActorId: z.string().min(1),
  decidedAt: z.string().datetime(),
  reason: z.string().min(1).optional(),
  correlation: executionCorrelationMetadataSchema
}).strict();
export type ExecutionApprovalDecision = z.infer<typeof executionApprovalDecisionSchema>;

export const executionRecoveryRequestSchema = z.object({
  tenantId: z.string().min(1),
  executionId: z.string().min(1),
  fromCheckpointVersion: z.number().int().nonnegative().optional(),
  correlation: executionCorrelationMetadataSchema
}).strict();
export type ExecutionRecoveryRequest = z.infer<typeof executionRecoveryRequestSchema>;

export const executionDeadLetterSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  executionId: z.string().min(1),
  planId: z.string().min(1),
  stepId: z.string().min(1).optional(),
  failedAt: z.string().datetime(),
  attempts: z.number().int().min(1),
  reason: executionErrorModelSchema,
  payload: executionPayloadSchema.default({}),
  nextAction: z.enum(["MANUAL_REVIEW", "REPLAY", "DISCARD"]),
  correlation: executionCorrelationMetadataSchema
}).strict();
export type ExecutionDeadLetter = z.output<typeof executionDeadLetterSchema>;

export const executionEventTypeValues = [
  "EXECUTION_STARTED",
  "EXECUTION_PAUSED",
  "EXECUTION_RESUMED",
  "EXECUTION_SUCCEEDED",
  "EXECUTION_FAILED",
  "EXECUTION_CANCELLED",
  "EXECUTION_DEAD_LETTERED",
  "STEP_STARTED",
  "STEP_RETRIED",
  "STEP_SUCCEEDED",
  "STEP_FAILED",
  "APPROVAL_REQUESTED"
] as const;
export const executionEventTypeSchema = z.enum(executionEventTypeValues);
export type ExecutionEventType = z.infer<typeof executionEventTypeSchema>;

export const executionEventSchema = z.object({
  sequence: z.number().int().nonnegative(),
  type: executionEventTypeSchema,
  tenantId: z.string().min(1),
  executionId: z.string().min(1),
  planId: z.string().min(1),
  stepId: z.string().min(1).optional(),
  occurredAt: z.string().datetime(),
  payload: executionPayloadSchema.default({}),
  correlation: executionCorrelationMetadataSchema
}).strict();
export type ExecutionEvent = z.output<typeof executionEventSchema>;

export interface ExecutionEventSink {
  emit(event: ExecutionEvent): Promise<void>;
}

export const executionTelemetrySchema = z.object({
  tenantId: z.string().min(1),
  executionId: z.string().min(1),
  stepId: z.string().min(1).optional(),
  name: z.string().min(1),
  attributes: executionPayloadSchema.default({}),
  correlation: executionCorrelationMetadataSchema
}).strict();
export type ExecutionTelemetry = z.output<typeof executionTelemetrySchema>;

export interface ExecutionTelemetrySink {
  record(telemetry: ExecutionTelemetry): Promise<void>;
}

export interface ExecutionMiddlewareNext {
  (): Promise<ExecutionStepResult>;
}

export interface ExecutionMiddleware {
  (input: ExecutionMiddlewareInput, next: ExecutionMiddlewareNext): Promise<ExecutionStepResult>;
}

export interface ExecutionMiddlewareInput {
  readonly context: ExecutionContext;
  readonly plan: AgentExecutionPlan;
  readonly step: ExecutionStepDefinition;
  readonly attempt: number;
}

export interface ExecutionPolicyEnforcer {
  enforce(input: ExecutionMiddlewareInput): Promise<void>;
}

export interface ExecutionToolOrchestrator {
  executeTool(input: ExecutionToolCall, context: ExecutionContext, step: ExecutionStepDefinition, attempt: number): Promise<ExecutionPayload>;
}

export interface ExecutionProviderOrchestrator {
  executeProvider(input: ExecutionProviderCall, context: ExecutionContext, step: ExecutionStepDefinition, attempt: number): Promise<ExecutionPayload>;
}

export interface ExecutionTaskHandler {
  readonly stepType: "TASK";
  execute(input: ExecutionPayload, context: ExecutionContext, step: ExecutionStepDefinition, attempt: number): Promise<ExecutionPayload>;
}

export interface ExecutionRuntimeOptions {
  readonly checkpointStore?: ExecutionCheckpointStore;
  readonly eventSink?: ExecutionEventSink;
  readonly telemetrySink?: ExecutionTelemetrySink;
  readonly policyEnforcer?: ExecutionPolicyEnforcer;
  readonly middleware?: readonly ExecutionMiddleware[];
  readonly taskHandler?: ExecutionTaskHandler;
  readonly toolOrchestrator?: ExecutionToolOrchestrator;
  readonly providerOrchestrator?: ExecutionProviderOrchestrator;
  readonly now?: () => Date;
  readonly sleep?: (delayMs: number) => Promise<void>;
  readonly deadLetterId?: (context: ExecutionContext, plan: AgentExecutionPlan, stepId: string | undefined) => string;
}

export interface ExecutePlanInput {
  readonly context: ExecutionContext;
  readonly plan: AgentExecutionPlan;
  readonly snapshot?: ExecutionSnapshot | undefined;
  readonly approvalDecision?: ExecutionApprovalDecision | undefined;
}

export interface ExecutePlanResult {
  readonly state: ExecutionState;
  readonly snapshot: ExecutionSnapshot;
  readonly stepResults: readonly ExecutionStepResult[];
  readonly deadLetter?: ExecutionDeadLetter | undefined;
}

export const assertExecutionTenantIsolation = (
  context: ExecutionContext,
  tenantScoped: { readonly tenantId?: string | undefined },
): void => {
  const parsedContext = parseExecutionSchema(executionContextSchema, context, context.correlation, "Execution context validation failed");
  if (tenantScoped.tenantId === undefined || tenantScoped.tenantId.trim().length === 0) {
    throw new ExecutionRuntimeError({
      code: "EXECUTION_TENANT_CONTEXT_MISSING",
      message: "Execution requires explicit tenant context",
      status: 403,
      correlation: parsedContext.correlation
    });
  }
  if (parsedContext.tenantId !== tenantScoped.tenantId) {
    throw new ExecutionRuntimeError({
      code: "EXECUTION_TENANT_MISMATCH",
      message: "Execution tenant boundary mismatch",
      status: 403,
      details: { expectedTenantId: parsedContext.tenantId, actualTenantId: tenantScoped.tenantId },
      correlation: parsedContext.correlation
    });
  }
};

const toRuntimeError = (error: unknown, correlation: ExecutionCorrelationMetadata): ExecutionRuntimeError => {
  if (error instanceof ExecutionRuntimeError) {
    return error;
  }
  return new ExecutionRuntimeError({
    code: "EXECUTION_STEP_FAILED",
    message: "Execution step failed with a non-runtime error",
    status: 500,
    correlation
  });
};

const stepSnapshotFor = (
  snapshot: ExecutionSnapshot,
  stepId: string,
): ExecutionStepSnapshot | undefined => snapshot.stepSnapshots.find((step) => step.stepId === stepId);

const upsertStepSnapshot = (
  snapshot: ExecutionSnapshot,
  update: ExecutionStepSnapshot,
): ExecutionSnapshot => ({
  ...snapshot,
  stepSnapshots: [
    ...snapshot.stepSnapshots.filter((step) => step.stepId !== update.stepId),
    update
  ]
});

const terminalStepStates: readonly ExecutionStepState[] = ["SUCCEEDED", "SKIPPED", "CANCELLED"];

const dependenciesSatisfied = (snapshot: ExecutionSnapshot, step: ExecutionStepDefinition): boolean => step.dependsOn.every((dependency) => {
  const dependencySnapshot = stepSnapshotFor(snapshot, dependency);
  return dependencySnapshot !== undefined && terminalStepStates.includes(dependencySnapshot.state);
});

const assertReplaySafeStep = (step: ExecutionStepDefinition, context: ExecutionContext): void => {
  if (step.deterministic !== true || step.tenantScoped !== true || step.retryPolicy.jitter !== false) {
    throw new ExecutionRuntimeError({
      code: "EXECUTION_POLICY_DENIED",
      message: "Execution steps must be deterministic, tenant scoped, and use replay-safe retry policies",
      status: 422,
      details: { stepId: step.id },
      correlation: context.correlation
    });
  }
};

const initialSnapshot = (context: ExecutionContext, plan: AgentExecutionPlan, now: () => Date): ExecutionSnapshot => executionSnapshotSchema.parse({
  tenantId: context.tenantId,
  executionId: context.executionId,
  planId: plan.planId,
  state: "CREATED",
  checkpointVersion: 0,
  stepSnapshots: [],
  lastEventSequence: 0,
  updatedAt: now().toISOString(),
  correlation: context.correlation
});

export const recoverExecutionSnapshot = async (
  request: ExecutionRecoveryRequest,
  store: ExecutionCheckpointStore,
): Promise<ExecutionSnapshot> => {
  const parsed = parseExecutionSchema(executionRecoveryRequestSchema, request, request.correlation, "Execution recovery request validation failed");
  const checkpoint = await store.load(parsed.tenantId, parsed.executionId);
  if (checkpoint === undefined) {
    throw new ExecutionRuntimeError({
      code: "EXECUTION_RECOVERY_FAILED",
      message: "Execution checkpoint was not found for recovery",
      status: 404,
      correlation: parsed.correlation
    });
  }
  const parsedCheckpoint = parseExecutionSchema(executionCheckpointSchema, checkpoint, parsed.correlation, "Execution checkpoint validation failed");
  if (parsed.fromCheckpointVersion !== undefined && parsedCheckpoint.version !== parsed.fromCheckpointVersion) {
    throw new ExecutionRuntimeError({
      code: "EXECUTION_CHECKPOINT_CONFLICT",
      message: "Execution checkpoint version does not match recovery request",
      status: 409,
      details: { expectedVersion: parsed.fromCheckpointVersion, actualVersion: parsedCheckpoint.version },
      correlation: parsed.correlation
    });
  }
  return parsedCheckpoint.snapshot;
};

export const createExecutionRuntime = (options: ExecutionRuntimeOptions = {}) => {
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? (async () => undefined);
  const deadLetterId = options.deadLetterId ?? ((context, plan, stepId) => [context.tenantId, context.executionId, plan.planId, stepId ?? "execution"].join(":"));

  const emit = async (snapshot: ExecutionSnapshot, type: ExecutionEventType, plan: AgentExecutionPlan, payload: ExecutionPayload = {}, stepId?: string): Promise<ExecutionSnapshot> => {
    const event = executionEventSchema.parse({
      sequence: snapshot.lastEventSequence + 1,
      type,
      tenantId: snapshot.tenantId,
      executionId: snapshot.executionId,
      planId: plan.planId,
      stepId,
      occurredAt: now().toISOString(),
      payload,
      correlation: snapshot.correlation
    });
    await options.eventSink?.emit(event);
    return { ...snapshot, lastEventSequence: event.sequence, updatedAt: event.occurredAt };
  };

  const checkpoint = async (snapshot: ExecutionSnapshot): Promise<void> => {
    await options.checkpointStore?.save(executionCheckpointSchema.parse({
      tenantId: snapshot.tenantId,
      executionId: snapshot.executionId,
      version: snapshot.checkpointVersion,
      snapshot
    }));
  };

  const runHandler = async (input: ExecutionMiddlewareInput): Promise<ExecutionStepResult> => {
    const startedAt = now().toISOString();
    let output: ExecutionPayload;
    switch (input.step.type) {
      case "TASK":
        if (options.taskHandler === undefined) {
          throw new ExecutionRuntimeError({ code: "EXECUTION_STEP_TYPE_UNSUPPORTED", message: "TASK step requires a task handler", status: 422, correlation: input.context.correlation });
        }
        output = await options.taskHandler.execute(input.step.input, input.context, input.step, input.attempt);
        break;
      case "TOOL":
        if (options.toolOrchestrator === undefined || input.step.tool === undefined) {
          throw new ExecutionRuntimeError({ code: "EXECUTION_STEP_TYPE_UNSUPPORTED", message: "TOOL step requires a tool orchestrator", status: 422, correlation: input.context.correlation });
        }
        output = await options.toolOrchestrator.executeTool(input.step.tool, input.context, input.step, input.attempt);
        break;
      case "PROVIDER":
        if (options.providerOrchestrator === undefined || input.step.provider === undefined) {
          throw new ExecutionRuntimeError({ code: "EXECUTION_STEP_TYPE_UNSUPPORTED", message: "PROVIDER step requires a provider orchestrator", status: 422, correlation: input.context.correlation });
        }
        output = await options.providerOrchestrator.executeProvider(input.step.provider, input.context, input.step, input.attempt);
        break;
      case "APPROVAL":
        throw new ExecutionRuntimeError({ code: "EXECUTION_APPROVAL_REQUIRED", message: "Approval step requires an approval decision", status: 409, correlation: input.context.correlation });
      default:
        throw new ExecutionRuntimeError({ code: "EXECUTION_STEP_TYPE_UNSUPPORTED", message: "Execution step type is unsupported", status: 422, correlation: input.context.correlation });
    }
    return executionStepResultSchema.parse({
      tenantId: input.context.tenantId,
      executionId: input.context.executionId,
      stepId: input.step.id,
      status: "SUCCEEDED",
      attempt: input.attempt,
      output,
      startedAt,
      completedAt: now().toISOString(),
      correlation: input.context.correlation
    });
  };

  const runMiddleware = async (input: ExecutionMiddlewareInput): Promise<ExecutionStepResult> => {
    await options.policyEnforcer?.enforce(input);
    let index = -1;
    const dispatch = async (position: number): Promise<ExecutionStepResult> => {
      if (position <= index) {
        throw new ExecutionRuntimeError({ code: "EXECUTION_POLICY_DENIED", message: "Execution middleware cannot call next more than once", status: 500, correlation: input.context.correlation });
      }
      index = position;
      const middleware = options.middleware?.[position];
      if (middleware === undefined) {
        return runHandler(input);
      }
      return middleware(input, async () => dispatch(position + 1));
    };
    return dispatch(0);
  };

  const executeStep = async (context: ExecutionContext, plan: AgentExecutionPlan, step: ExecutionStepDefinition, snapshot: ExecutionSnapshot): Promise<{ snapshot: ExecutionSnapshot; result?: ExecutionStepResult; deadLetter?: ExecutionDeadLetter }> => {
    if (context.cancellation?.requested === true) {
      const cancelledAt = now().toISOString();
      const cancelled = new ExecutionRuntimeError({ code: "EXECUTION_CANCELLED", message: "Execution cancellation requested", status: 409, details: { reason: context.cancellation.reason }, correlation: context.correlation });
      return { snapshot: upsertStepSnapshot(snapshot, { stepId: step.id, state: "CANCELLED", attempts: 0, error: cancelled.toErrorModel(), updatedAt: cancelledAt }) };
    }

    const existing = stepSnapshotFor(snapshot, step.id);
    if (existing?.state === "SUCCEEDED") {
      return { snapshot };
    }
    if (!dependenciesSatisfied(snapshot, step)) {
      throw new ExecutionRuntimeError({ code: "EXECUTION_STEP_DEPENDENCY_UNSATISFIED", message: "Execution step dependencies are not satisfied", status: 409, details: { stepId: step.id, dependsOn: step.dependsOn }, correlation: context.correlation });
    }
    assertReplaySafeStep(step, context);

    if (step.type === "APPROVAL") {
      return {
        snapshot: upsertStepSnapshot({ ...snapshot, state: "PAUSED", pendingApproval: step.approval }, {
          stepId: step.id,
          state: "WAITING_FOR_APPROVAL",
          attempts: existing?.attempts ?? 0,
          updatedAt: now().toISOString()
        })
      };
    }

    for (let attempt = (existing?.attempts ?? 0) + 1; attempt <= step.retryPolicy.maxAttempts; attempt += 1) {
      let working = upsertStepSnapshot(snapshot, { stepId: step.id, state: "RUNNING", attempts: attempt, updatedAt: now().toISOString() });
      working = await emit(working, attempt === 1 ? "STEP_STARTED" : "STEP_RETRIED", plan, { attempt }, step.id);
      await checkpoint(working);
      try {
        await options.telemetrySink?.record({ tenantId: context.tenantId, executionId: context.executionId, stepId: step.id, name: "execution.step.attempt", attributes: { attempt, type: step.type }, correlation: context.correlation });
        const result = await runMiddleware({ context, plan, step, attempt });
        const completed = upsertStepSnapshot(working, { stepId: step.id, state: "SUCCEEDED", attempts: attempt, output: result.output, updatedAt: result.completedAt ?? now().toISOString() });
        return { snapshot: await emit(completed, "STEP_SUCCEEDED", plan, { attempt }, step.id), result };
      } catch (error) {
        const runtimeError = toRuntimeError(error, context.correlation);
        const shouldRetry = runtimeError.retryable && attempt < step.retryPolicy.maxAttempts;
        if (shouldRetry) {
          snapshot = await emit(working, "STEP_RETRIED", plan, { attempt, code: runtimeError.code }, step.id);
          await sleep(calculateExecutionBackoffMs(step.retryPolicy, attempt + 1));
          continue;
        }
        const finalError = runtimeError.retryable && attempt >= step.retryPolicy.maxAttempts
          ? new ExecutionRuntimeError({ code: "EXECUTION_RETRY_EXHAUSTED", message: "Execution retry policy exhausted", status: runtimeError.status, details: { attempts: attempt, causeCode: runtimeError.code }, correlation: context.correlation })
          : runtimeError;
        const failedResult = executionStepResultSchema.parse({
          tenantId: context.tenantId,
          executionId: context.executionId,
          stepId: step.id,
          status: "FAILED",
          attempt,
          output: {},
          error: finalError.toErrorModel(),
          startedAt: now().toISOString(),
          completedAt: now().toISOString(),
          correlation: context.correlation
        });
        const failed = await emit(upsertStepSnapshot(working, { stepId: step.id, state: "FAILED", attempts: attempt, error: finalError.toErrorModel(), updatedAt: now().toISOString() }), "STEP_FAILED", plan, { attempt, code: finalError.code }, step.id);
        const deadLetter = executionDeadLetterSchema.parse({
          id: deadLetterId(context, plan, step.id),
          tenantId: context.tenantId,
          executionId: context.executionId,
          planId: plan.planId,
          stepId: step.id,
          failedAt: now().toISOString(),
          attempts: attempt,
          reason: finalError.toErrorModel(),
          payload: { stepId: step.id },
          nextAction: "MANUAL_REVIEW",
          correlation: context.correlation
        });
        return { snapshot: failed, result: failedResult, deadLetter };
      }
    }
    return { snapshot };
  };

  const executePlan = async (input: ExecutePlanInput): Promise<ExecutePlanResult> => {
    const context = parseExecutionSchema(executionContextSchema, input.context, input.context.correlation, "Execution context validation failed");
    const plan = parseExecutionSchema(agentExecutionPlanSchema, input.plan, context.correlation, "Execution plan validation failed");
    assertExecutionTenantIsolation(context, plan);
    if (plan.agentId !== context.agentId) {
      throw new ExecutionRuntimeError({ code: "EXECUTION_TENANT_MISMATCH", message: "Execution agent boundary mismatch", status: 403, details: { planAgentId: plan.agentId, contextAgentId: context.agentId }, correlation: context.correlation });
    }

    let snapshot = input.snapshot === undefined
      ? initialSnapshot(context, plan, now)
      : parseExecutionSchema(executionSnapshotSchema, input.snapshot, context.correlation, "Execution snapshot validation failed");
    assertExecutionTenantIsolation(context, snapshot);
    if (snapshot.planId !== plan.planId) {
      throw new ExecutionRuntimeError({ code: "EXECUTION_CHECKPOINT_CONFLICT", message: "Execution snapshot plan boundary mismatch", status: 409, correlation: context.correlation });
    }

    if (input.approvalDecision !== undefined) {
      const decision = parseExecutionSchema(executionApprovalDecisionSchema, input.approvalDecision, context.correlation, "Execution approval decision validation failed");
      assertExecutionTenantIsolation(context, decision);
      if (snapshot.pendingApproval?.approvalId !== decision.approvalId || !decision.approved) {
        throw new ExecutionRuntimeError({ code: "EXECUTION_APPROVAL_INVALID", message: "Execution approval decision is invalid for the paused snapshot", status: 409, details: { approvalId: decision.approvalId }, correlation: context.correlation });
      }
      const approvalStep = snapshot.stepSnapshots.find((step) => step.state === "WAITING_FOR_APPROVAL");
      snapshot = approvalStep === undefined ? snapshot : upsertStepSnapshot({ ...snapshot, state: "RUNNING", pendingApproval: undefined }, { ...approvalStep, state: "SUCCEEDED", output: { approvedByActorId: decision.decidedByActorId }, updatedAt: decision.decidedAt });
      snapshot = await emit(snapshot, "EXECUTION_RESUMED", plan, { approvalId: decision.approvalId });
    }

    if (snapshot.state === "CREATED") {
      assertExecutionStateTransition("CREATED", "RUNNING", context.correlation);
      snapshot = await emit({ ...snapshot, state: "RUNNING", updatedAt: now().toISOString() }, "EXECUTION_STARTED", plan);
    }
    if (snapshot.state !== "RUNNING") {
      return { state: snapshot.state, snapshot, stepResults: [] };
    }

    const results: ExecutionStepResult[] = [];
    for (const step of plan.steps) {
      const outcome = await executeStep(context, plan, step, snapshot);
      snapshot = outcome.snapshot;
      if (outcome.result !== undefined) {
        results.push(outcome.result);
      }
      if (snapshot.state === "PAUSED") {
        snapshot = await emit(snapshot, "APPROVAL_REQUESTED", plan, { approvalId: snapshot.pendingApproval?.approvalId ?? "unknown" }, step.id);
        await checkpoint(snapshot);
        return { state: "PAUSED", snapshot, stepResults: results };
      }
      if (outcome.deadLetter !== undefined) {
        snapshot = await emit({ ...snapshot, state: "DEAD_LETTERED" }, "EXECUTION_DEAD_LETTERED", plan, { deadLetterId: outcome.deadLetter.id }, step.id);
        await checkpoint(snapshot);
        return { state: "DEAD_LETTERED", snapshot, stepResults: results, deadLetter: outcome.deadLetter };
      }
      await checkpoint({ ...snapshot, checkpointVersion: snapshot.checkpointVersion + 1 });
    }

    snapshot = await emit({ ...snapshot, state: "SUCCEEDED" }, "EXECUTION_SUCCEEDED", plan);
    snapshot = { ...snapshot, checkpointVersion: snapshot.checkpointVersion + 1 };
    await checkpoint(snapshot);
    return { state: "SUCCEEDED", snapshot, stepResults: results };
  };

  return { executePlan };
};
