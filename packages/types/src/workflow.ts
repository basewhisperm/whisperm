import { z } from "zod";

export const workflowCorrelationMetadataSchema = z.object({
  correlationId: z.string().min(1),
  requestId: z.string().min(1).optional(),
  causationId: z.string().min(1).optional(),
  traceId: z.string().min(1).optional(),
  spanId: z.string().min(1).optional()
}).strict();

export type WorkflowCorrelationMetadata = z.infer<typeof workflowCorrelationMetadataSchema>;

const workflowErrorDetailsSchema = z.record(z.string(), z.unknown());

const workflowBaseErrorModelSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  status: z.number().int().min(400).max(599),
  details: workflowErrorDetailsSchema.optional(),
  correlation: workflowCorrelationMetadataSchema.optional()
}).strict();

interface WorkflowTenantContext {
  readonly tenantId: string;
  readonly correlation: WorkflowCorrelationMetadata;
}

export const workflowPayloadSchema = z.record(z.string(), z.unknown());
export type WorkflowPayload = z.infer<typeof workflowPayloadSchema>;

export const workflowStepTypeValues = [
  "TASK",
  "AI_AGENT",
  "HUMAN_APPROVAL",
  "DELAY",
  "EVENT_WAIT"
] as const;
export const workflowStepTypeSchema = z.enum(workflowStepTypeValues);
export type WorkflowStepType = z.infer<typeof workflowStepTypeSchema>;

export const workflowStateValues = [
  "PENDING",
  "SCHEDULED",
  "RUNNING",
  "WAITING_FOR_APPROVAL",
  "WAITING_FOR_EVENT",
  "RETRY_SCHEDULED",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "DEAD_LETTERED"
] as const;
export const workflowStateSchema = z.enum(workflowStateValues);
export type WorkflowState = z.infer<typeof workflowStateSchema>;

export const terminalWorkflowStateValues = [
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "DEAD_LETTERED"
] as const satisfies readonly WorkflowState[];
export type TerminalWorkflowState = (typeof terminalWorkflowStateValues)[number];

const workflowStateTransitions: Readonly<Record<WorkflowState, readonly WorkflowState[]>> = {
  PENDING: ["SCHEDULED", "RUNNING", "CANCELLED"],
  SCHEDULED: ["RUNNING", "CANCELLED"],
  RUNNING: [
    "WAITING_FOR_APPROVAL",
    "WAITING_FOR_EVENT",
    "RETRY_SCHEDULED",
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
    "DEAD_LETTERED"
  ],
  WAITING_FOR_APPROVAL: ["RUNNING", "CANCELLED", "FAILED", "DEAD_LETTERED"],
  WAITING_FOR_EVENT: ["RUNNING", "CANCELLED", "FAILED", "DEAD_LETTERED"],
  RETRY_SCHEDULED: ["RUNNING", "CANCELLED", "DEAD_LETTERED"],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
  DEAD_LETTERED: []
};

export const isTerminalWorkflowState = (state: WorkflowState): state is TerminalWorkflowState =>
  terminalWorkflowStateValues.includes(state as TerminalWorkflowState);

export const canTransitionWorkflowState = (from: WorkflowState, to: WorkflowState): boolean =>
  workflowStateTransitions[from].includes(to);

export const retryPolicyKindValues = ["NONE", "FIXED", "EXPONENTIAL"] as const;
export const retryPolicyKindSchema = z.enum(retryPolicyKindValues);
export type RetryPolicyKind = z.infer<typeof retryPolicyKindSchema>;

export const retryPolicySchema = z.object({
  kind: retryPolicyKindSchema,
  maxAttempts: z.number().int().min(1).max(100),
  initialDelayMs: z.number().int().min(0).max(86_400_000),
  maxDelayMs: z.number().int().min(0).max(86_400_000),
  backoffMultiplier: z.number().min(1).max(10).default(2),
  jitter: z.literal(false).default(false)
}).strict().superRefine((policy, ctx) => {
  if (policy.kind === "NONE" && policy.maxAttempts !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "NONE retry policies must use exactly one attempt",
      path: ["maxAttempts"]
    });
  }
  if (policy.maxDelayMs < policy.initialDelayMs) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "maxDelayMs must be greater than or equal to initialDelayMs",
      path: ["maxDelayMs"]
    });
  }
});

export type RetryPolicy = z.infer<typeof retryPolicySchema>;

export const defaultRetryPolicy = {
  kind: "NONE",
  maxAttempts: 1,
  initialDelayMs: 0,
  maxDelayMs: 0,
  backoffMultiplier: 2,
  jitter: false
} as const satisfies RetryPolicy;

export const calculateRetryDelayMs = (policy: RetryPolicy, attempt: number): number => {
  const parsedPolicy = retryPolicySchema.parse(policy);
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new WorkflowError({
      code: "WORKFLOW_INVALID_RETRY_ATTEMPT",
      message: "Retry attempt must be a positive integer",
      status: 400,
      details: { attempt }
    });
  }
  if (parsedPolicy.kind === "NONE") {
    return 0;
  }
  if (parsedPolicy.kind === "FIXED") {
    return Math.min(parsedPolicy.initialDelayMs, parsedPolicy.maxDelayMs);
  }

  const exponent = Math.max(0, attempt - 1);
  const delay = parsedPolicy.initialDelayMs * (parsedPolicy.backoffMultiplier ** exponent);
  return Math.min(Math.trunc(delay), parsedPolicy.maxDelayMs);
};

export const shouldRetryWorkflowStep = (policy: RetryPolicy, completedAttempts: number): boolean => {
  const parsedPolicy = retryPolicySchema.parse(policy);
  if (!Number.isInteger(completedAttempts) || completedAttempts < 0) {
    throw new WorkflowError({
      code: "WORKFLOW_INVALID_RETRY_ATTEMPT",
      message: "Completed attempts must be a non-negative integer",
      status: 400,
      details: { completedAttempts }
    });
  }

  return parsedPolicy.kind !== "NONE" && completedAttempts < parsedPolicy.maxAttempts;
};

export const workflowApprovalCheckpointSchema = z.object({
  approvalId: z.string().min(1),
  requiredRole: z.string().min(1).optional(),
  expiresAt: z.string().datetime().optional()
}).strict();
export type WorkflowApprovalCheckpoint = z.infer<typeof workflowApprovalCheckpointSchema>;

export const workflowStepDefinitionSchema = z.object({
  id: z.string().min(1),
  type: workflowStepTypeSchema,
  name: z.string().min(1).optional(),
  input: workflowPayloadSchema.default({}),
  dependsOn: z.array(z.string().min(1)).default([]),
  retryPolicy: retryPolicySchema.default(defaultRetryPolicy),
  timeoutMs: z.number().int().positive().max(86_400_000).optional(),
  approval: workflowApprovalCheckpointSchema.optional(),
  deterministic: z.literal(true).default(true)
}).strict().superRefine((step, ctx) => {
  if (step.type === "HUMAN_APPROVAL" && step.approval === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "HUMAN_APPROVAL steps must declare an approval checkpoint",
      path: ["approval"]
    });
  }
});

export type WorkflowStepDefinition = z.infer<typeof workflowStepDefinitionSchema>;

export const workflowDefinitionSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  name: z.string().min(1),
  version: z.number().int().positive(),
  description: z.string().min(1).optional(),
  initialStepId: z.string().min(1),
  steps: z.array(workflowStepDefinitionSchema).min(1),
  enabled: z.boolean().default(true),
  metadata: workflowPayloadSchema.default({})
}).strict().superRefine((definition, ctx) => {
  const stepIds = new Set<string>();
  for (const [index, step] of definition.steps.entries()) {
    if (stepIds.has(step.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Workflow step IDs must be unique",
        path: ["steps", index, "id"]
      });
    }
    stepIds.add(step.id);
  }

  if (!stepIds.has(definition.initialStepId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "initialStepId must reference a declared step",
      path: ["initialStepId"]
    });
  }

  for (const [index, step] of definition.steps.entries()) {
    for (const [dependencyIndex, dependency] of step.dependsOn.entries()) {
      if (!stepIds.has(dependency)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Step dependencies must reference declared steps",
          path: ["steps", index, "dependsOn", dependencyIndex]
        });
      }
      if (dependency === step.id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Workflow steps cannot depend on themselves",
          path: ["steps", index, "dependsOn", dependencyIndex]
        });
      }
    }
  }
});

export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

export const workflowTriggerTypeValues = ["API", "EVENT", "SCHEDULE", "MANUAL"] as const;
export const workflowTriggerTypeSchema = z.enum(workflowTriggerTypeValues);
export type WorkflowTriggerType = z.infer<typeof workflowTriggerTypeSchema>;

export const workflowExecutionContextSchema = z.object({
  tenantId: z.string().min(1),
  workflowId: z.string().min(1),
  workflowVersion: z.number().int().positive(),
  runId: z.string().min(1),
  state: workflowStateSchema,
  actorId: z.string().min(1).optional(),
  correlation: workflowCorrelationMetadataSchema,
  trigger: z.object({
    type: workflowTriggerTypeSchema,
    triggeredAt: z.string().datetime(),
    sourceId: z.string().min(1).optional()
  }).strict(),
  metadata: workflowPayloadSchema.default({})
}).strict();

export type WorkflowExecutionContext = z.infer<typeof workflowExecutionContextSchema>;

export const workflowExecutionTokenStatusValues = ["RESERVED", "SUCCEEDED", "FAILED", "EXPIRED"] as const;
export const workflowExecutionTokenStatusSchema = z.enum(workflowExecutionTokenStatusValues);
export type WorkflowExecutionTokenStatus = z.infer<typeof workflowExecutionTokenStatusSchema>;

export const workflowExecutionTokenSchema = z.object({
  token: z.string().min(1),
  tenantId: z.string().min(1),
  workflowId: z.string().min(1),
  runId: z.string().min(1),
  stepId: z.string().min(1),
  attempt: z.number().int().positive(),
  status: workflowExecutionTokenStatusSchema,
  expiresAt: z.string().datetime().optional()
}).strict();

export type WorkflowExecutionToken = z.infer<typeof workflowExecutionTokenSchema>;

export interface CreateWorkflowExecutionTokenInput {
  readonly tenantId: string;
  readonly workflowId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly attempt: number;
  readonly expiresAt?: string;
}

export const createWorkflowExecutionToken = (input: CreateWorkflowExecutionTokenInput): WorkflowExecutionToken =>
  workflowExecutionTokenSchema.parse({
    ...input,
    token: [input.tenantId, input.workflowId, input.runId, input.stepId, String(input.attempt)].join(":"),
    status: "RESERVED"
  });

export const workflowErrorCodeValues = [
  "WORKFLOW_DEFINITION_INVALID",
  "WORKFLOW_STEP_NOT_FOUND",
  "WORKFLOW_STEP_TYPE_MISMATCH",
  "WORKFLOW_TENANT_CONTEXT_MISSING",
  "WORKFLOW_TENANT_MISMATCH",
  "WORKFLOW_STATE_INVALID",
  "WORKFLOW_TRANSITION_INVALID",
  "WORKFLOW_EXECUTION_TOKEN_INVALID",
  "WORKFLOW_INVALID_RETRY_ATTEMPT",
  "WORKFLOW_STEP_FAILED",
  "WORKFLOW_DEAD_LETTERED"
] as const;
export const workflowErrorCodeSchema = z.enum(workflowErrorCodeValues);
export type WorkflowErrorCode = z.infer<typeof workflowErrorCodeSchema>;

export const workflowErrorSchema = workflowBaseErrorModelSchema.extend({
  code: workflowErrorCodeSchema
}).strict();
export type WorkflowErrorModel = z.infer<typeof workflowErrorSchema>;

export interface WorkflowErrorInput {
  readonly code: WorkflowErrorCode;
  readonly message: string;
  readonly status: number;
  readonly details?: z.infer<typeof workflowErrorDetailsSchema>;
  readonly correlation?: WorkflowCorrelationMetadata;
}

export class WorkflowError extends Error {
  public readonly code: WorkflowErrorCode;
  public readonly status: number;
  public readonly details: z.infer<typeof workflowErrorDetailsSchema> | undefined;
  public readonly correlation: WorkflowCorrelationMetadata | undefined;

  public constructor(input: WorkflowErrorInput) {
    super(input.message);
    this.name = "WorkflowError";
    this.code = input.code;
    this.status = input.status;
    this.details = input.details;
    this.correlation = input.correlation;
  }

  public toErrorModel(): WorkflowErrorModel {
    return workflowErrorSchema.parse({
      code: this.code,
      message: this.message,
      status: this.status,
      details: this.details,
      correlation: this.correlation
    });
  }
}

export const workflowDeadLetterActionValues = ["MANUAL_REVIEW", "RETRY_LATER", "DISCARD"] as const;
export const workflowDeadLetterActionSchema = z.enum(workflowDeadLetterActionValues);
export type WorkflowDeadLetterAction = z.infer<typeof workflowDeadLetterActionSchema>;

export const workflowDeadLetterSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  workflowId: z.string().min(1),
  workflowVersion: z.number().int().positive(),
  runId: z.string().min(1),
  stepId: z.string().min(1).optional(),
  attempts: z.number().int().min(1),
  failedAt: z.string().datetime(),
  reason: workflowErrorSchema,
  nextAction: workflowDeadLetterActionSchema,
  payload: workflowPayloadSchema.default({}),
  correlation: workflowCorrelationMetadataSchema
}).strict();

export type WorkflowDeadLetter = z.infer<typeof workflowDeadLetterSchema>;

export const workflowEventTypeValues = [
  "WORKFLOW_SCHEDULED",
  "WORKFLOW_STARTED",
  "WORKFLOW_STEP_STARTED",
  "WORKFLOW_STEP_COMPLETED",
  "WORKFLOW_WAITING_FOR_APPROVAL",
  "WORKFLOW_WAITING_FOR_EVENT",
  "WORKFLOW_RETRY_SCHEDULED",
  "WORKFLOW_COMPLETED",
  "WORKFLOW_FAILED",
  "WORKFLOW_DEAD_LETTERED"
] as const;
export const workflowEventTypeSchema = z.enum(workflowEventTypeValues);
export type WorkflowEventType = z.infer<typeof workflowEventTypeSchema>;

export const workflowEventSchema = z.object({
  id: z.string().min(1),
  type: workflowEventTypeSchema,
  occurredAt: z.string().datetime(),
  tenantId: z.string().min(1),
  workflowId: z.string().min(1),
  workflowVersion: z.number().int().positive(),
  runId: z.string().min(1),
  stepId: z.string().min(1).optional(),
  payload: workflowPayloadSchema.default({}),
  correlation: workflowCorrelationMetadataSchema,
  idempotencyKey: z.string().min(1)
}).strict();

export type WorkflowEvent = z.infer<typeof workflowEventSchema>;

export interface WorkflowEventBus {
  publish(event: WorkflowEvent): Promise<void>;
  subscribe(handler: WorkflowEventHandler): Promise<WorkflowEventSubscription>;
}

export type WorkflowEventHandler = (event: WorkflowEvent) => Promise<void>;

export interface WorkflowEventSubscription {
  close(): Promise<void>;
}

export const workflowScheduleSchema = z.object({
  tenantId: z.string().min(1),
  workflowId: z.string().min(1),
  workflowVersion: z.number().int().positive(),
  scheduleId: z.string().min(1),
  runAt: z.string().datetime(),
  timezone: z.string().min(1).default("UTC"),
  input: workflowPayloadSchema.default({}),
  correlation: workflowCorrelationMetadataSchema,
  idempotencyKey: z.string().min(1)
}).strict();

export type WorkflowSchedule = z.infer<typeof workflowScheduleSchema>;

export interface WorkflowScheduler {
  schedule(schedule: WorkflowSchedule): Promise<void>;
  cancel(input: WorkflowScheduleCancelInput): Promise<void>;
}

export interface WorkflowScheduleCancelInput {
  readonly tenantId: string;
  readonly scheduleId: string;
  readonly correlation: WorkflowCorrelationMetadata;
}

export const workflowStepResultStatusValues = [
  "COMPLETED",
  "WAITING_FOR_APPROVAL",
  "WAITING_FOR_EVENT",
  "FAILED"
] as const;
export const workflowStepResultStatusSchema = z.enum(workflowStepResultStatusValues);
export type WorkflowStepResultStatus = z.infer<typeof workflowStepResultStatusSchema>;

export const workflowStepResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("COMPLETED"),
    output: workflowPayloadSchema.default({}),
    nextStepIds: z.array(z.string().min(1)).default([])
  }).strict(),
  z.object({
    status: z.literal("WAITING_FOR_APPROVAL"),
    approval: workflowApprovalCheckpointSchema,
    output: workflowPayloadSchema.default({})
  }).strict(),
  z.object({
    status: z.literal("WAITING_FOR_EVENT"),
    eventType: z.string().min(1),
    output: workflowPayloadSchema.default({})
  }).strict(),
  z.object({
    status: z.literal("FAILED"),
    error: workflowErrorSchema,
    output: workflowPayloadSchema.default({})
  }).strict()
]);

export type WorkflowStepResult = z.infer<typeof workflowStepResultSchema>;

export interface WorkflowStepExecutionInput {
  readonly context: WorkflowExecutionContext;
  readonly definition: WorkflowDefinition;
  readonly step: WorkflowStepDefinition;
  readonly input: WorkflowPayload;
  readonly token: WorkflowExecutionToken;
}

export interface DeterministicWorkflowStepHandler {
  readonly stepType: WorkflowStepType;
  execute(input: WorkflowStepExecutionInput): Promise<WorkflowStepResult>;
}

export interface ExecuteWorkflowStepInput {
  readonly context: WorkflowExecutionContext;
  readonly definition: WorkflowDefinition;
  readonly stepId: string;
  readonly input: WorkflowPayload;
  readonly token: WorkflowExecutionToken;
  readonly handler: DeterministicWorkflowStepHandler;
}

export const assertWorkflowTenantIsolation = (
  context: WorkflowTenantContext | WorkflowExecutionContext,
  tenantScoped: { readonly tenantId?: string },
): void => {
  if (context.tenantId.length === 0 || tenantScoped.tenantId === undefined || tenantScoped.tenantId.length === 0) {
    throw new WorkflowError({
      code: "WORKFLOW_TENANT_CONTEXT_MISSING",
      message: "Workflow execution requires explicit tenant context",
      status: 403,
      correlation: context.correlation
    });
  }
  if (context.tenantId !== tenantScoped.tenantId) {
    throw new WorkflowError({
      code: "WORKFLOW_TENANT_MISMATCH",
      message: "Workflow tenant context mismatch",
      status: 403,
      details: { expectedTenantId: context.tenantId, actualTenantId: tenantScoped.tenantId },
      correlation: context.correlation
    });
  }
};

export const assertWorkflowStateTransition = (from: WorkflowState, to: WorkflowState): void => {
  if (!canTransitionWorkflowState(from, to)) {
    throw new WorkflowError({
      code: "WORKFLOW_TRANSITION_INVALID",
      message: "Workflow state transition is not allowed",
      status: 409,
      details: { from, to }
    });
  }
};

const getWorkflowStep = (definition: WorkflowDefinition, stepId: string): WorkflowStepDefinition => {
  const step = definition.steps.find((candidate) => candidate.id === stepId);
  if (step === undefined) {
    throw new WorkflowError({
      code: "WORKFLOW_STEP_NOT_FOUND",
      message: "Workflow step was not found in the definition",
      status: 404,
      details: { workflowId: definition.id, stepId }
    });
  }

  return step;
};

const assertExecutionTokenMatchesStep = (
  context: WorkflowExecutionContext,
  token: WorkflowExecutionToken,
  stepId: string,
): void => {
  assertWorkflowTenantIsolation(context, token);
  if (token.workflowId !== context.workflowId || token.runId !== context.runId || token.stepId !== stepId) {
    throw new WorkflowError({
      code: "WORKFLOW_EXECUTION_TOKEN_INVALID",
      message: "Workflow execution token does not match the requested step",
      status: 409,
      details: {
        workflowId: token.workflowId,
        runId: token.runId,
        stepId: token.stepId,
        requestedStepId: stepId
      },
      correlation: context.correlation
    });
  }
  if (token.status !== "RESERVED") {
    throw new WorkflowError({
      code: "WORKFLOW_EXECUTION_TOKEN_INVALID",
      message: "Workflow execution token is not reserved for execution",
      status: 409,
      details: { tokenStatus: token.status },
      correlation: context.correlation
    });
  }
};

export const executeDeterministicWorkflowStep = async (
  input: ExecuteWorkflowStepInput,
): Promise<WorkflowStepResult> => {
  const context = workflowExecutionContextSchema.parse(input.context);
  const definition = workflowDefinitionSchema.parse(input.definition);
  const token = workflowExecutionTokenSchema.parse(input.token);
  assertWorkflowTenantIsolation(context, definition);
  if (context.workflowId !== definition.id || context.workflowVersion !== definition.version) {
    throw new WorkflowError({
      code: "WORKFLOW_DEFINITION_INVALID",
      message: "Workflow definition does not match execution context",
      status: 409,
      details: {
        contextWorkflowId: context.workflowId,
        definitionWorkflowId: definition.id,
        contextWorkflowVersion: context.workflowVersion,
        definitionWorkflowVersion: definition.version
      },
      correlation: context.correlation
    });
  }
  if (context.state !== "RUNNING") {
    throw new WorkflowError({
      code: "WORKFLOW_STATE_INVALID",
      message: "Workflow steps can only execute while the run is in RUNNING state",
      status: 409,
      details: { state: context.state },
      correlation: context.correlation
    });
  }

  const step = getWorkflowStep(definition, input.stepId);
  assertExecutionTokenMatchesStep(context, token, step.id);
  if (input.handler.stepType !== step.type) {
    throw new WorkflowError({
      code: "WORKFLOW_STEP_TYPE_MISMATCH",
      message: "Workflow step handler type does not match the workflow step definition",
      status: 409,
      details: { stepType: step.type, handlerStepType: input.handler.stepType },
      correlation: context.correlation
    });
  }

  const result = await input.handler.execute({
    context,
    definition,
    step,
    input: workflowPayloadSchema.parse(input.input),
    token
  });

  return workflowStepResultSchema.parse(result);
};

export const buildWorkflowEventIdempotencyKey = (event: Pick<WorkflowEvent, "tenantId" | "workflowId" | "runId" | "type" | "stepId">): string =>
  [event.tenantId, event.workflowId, event.runId, event.type, event.stepId ?? "workflow"].join(":");

export const createWorkflowEvent = (input: Omit<WorkflowEvent, "idempotencyKey"> & { readonly idempotencyKey?: string }): WorkflowEvent =>
  workflowEventSchema.parse({
    ...input,
    idempotencyKey: input.idempotencyKey ?? buildWorkflowEventIdempotencyKey(input)
  });

export const createWorkflowDeadLetter = (input: WorkflowDeadLetter): WorkflowDeadLetter =>
  workflowDeadLetterSchema.parse(input);
