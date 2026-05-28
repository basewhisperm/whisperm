import { z } from "zod";

import {
  AiRuntimeError,
  aiCorrelationMetadataSchema,
  aiRuntimePayloadSchema,
  aiTenantExecutionContextSchema,
  aiToolApprovalPolicySchema,
  assertAiTenantIsolation,
  type AiCorrelationMetadata,
  type AiRuntimePayload,
  type AiTenantExecutionContext,
} from "./ai.js";

export const agentRoleKindValues = ["PLANNER", "EXECUTOR", "REVIEWER", "RESEARCHER", "TOOL_OPERATOR"] as const;
export const agentRoleKindSchema = z.enum(agentRoleKindValues);
export type AgentRoleKind = z.infer<typeof agentRoleKindSchema>;

export const agentRoleContractSchema = z.object({
  roleId: z.string().min(1),
  kind: agentRoleKindSchema,
  name: z.string().min(1),
  tenantId: z.string().min(1).optional(),
  allowedToolNames: z.array(z.string().min(1)).default([]),
  allowedMemoryScopes: z.array(z.string().min(1)).default([]),
  deterministic: z.literal(true),
  canHandoff: z.boolean().default(false),
  requiresHumanApprovalForAutonomousActions: z.boolean().default(true)
}).strict();

export type AgentRoleContract = z.infer<typeof agentRoleContractSchema>;

export const memoryAttachmentSchema = z.object({
  tenantId: z.string().min(1),
  attachmentId: z.string().min(1),
  kind: z.enum(["RAG_CHUNK", "MEMORY_SUMMARY", "REFERENCE", "REPLAY_TRACE"]),
  sourceId: z.string().min(1),
  tokenEstimate: z.number().int().min(0),
  compressed: z.boolean().default(false),
  metadata: aiRuntimePayloadSchema.optional()
}).strict();

export type MemoryAttachment = z.infer<typeof memoryAttachmentSchema>;

export const toolInvocationPlanSchema = z.object({
  tenantId: z.string().min(1),
  invocationId: z.string().min(1),
  toolName: z.string().min(1),
  toolVersion: z.string().min(1),
  arguments: aiRuntimePayloadSchema,
  idempotencyKey: z.string().min(1),
  approvalPolicy: aiToolApprovalPolicySchema,
  dependsOnStepIds: z.array(z.string().min(1)).default([])
}).strict().refine((plan) => plan.idempotencyKey.startsWith(`${plan.tenantId}:`), {
  message: "Tool invocation idempotencyKey must be tenant-scoped",
  path: ["idempotencyKey"]
});

export type ToolInvocationPlan = z.infer<typeof toolInvocationPlanSchema>;

export const humanApprovalCheckpointSchema = z.object({
  tenantId: z.string().min(1),
  checkpointId: z.string().min(1),
  requiredRole: z.string().min(1),
  reason: z.string().min(1),
  expiresAt: z.string().datetime().optional(),
  approvalTokenRef: z.string().min(1).optional()
}).strict();

export type HumanApprovalCheckpoint = z.infer<typeof humanApprovalCheckpointSchema>;

export const planStepTypeValues = ["PROMPT", "TOOL", "APPROVAL", "MEMORY", "DECISION", "HANDOFF"] as const;
export const planStepTypeSchema = z.enum(planStepTypeValues);
export type PlanStepType = z.infer<typeof planStepTypeSchema>;

export const retryRecoveryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(10),
  backoff: z.enum(["NONE", "FIXED", "EXPONENTIAL"]),
  initialDelayMs: z.number().int().min(0).max(86_400_000),
  maxDelayMs: z.number().int().min(0).max(86_400_000),
  jitter: z.literal(false),
  recoveryAction: z.enum(["RETRY_STEP", "SKIP_WITH_APPROVAL", "FAIL_PLAN", "MANUAL_REVIEW"])
}).strict().refine((policy) => policy.maxDelayMs >= policy.initialDelayMs, {
  message: "maxDelayMs must be greater than or equal to initialDelayMs",
  path: ["maxDelayMs"]
});

export type RetryRecoveryPolicy = z.infer<typeof retryRecoveryPolicySchema>;

export const executionPlanStepSchema = z.object({
  stepId: z.string().min(1),
  type: planStepTypeSchema,
  description: z.string().min(1),
  roleId: z.string().min(1),
  dependsOn: z.array(z.string().min(1)).default([]),
  deterministic: z.literal(true),
  promptTemplateId: z.string().min(1).optional(),
  toolInvocation: toolInvocationPlanSchema.optional(),
  memoryAttachments: z.array(memoryAttachmentSchema).default([]),
  approval: humanApprovalCheckpointSchema.optional(),
  retry: retryRecoveryPolicySchema.optional(),
  outputSchema: aiRuntimePayloadSchema.optional()
}).strict().superRefine((step, ctx) => {
  if (step.type === "TOOL" && step.toolInvocation === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "TOOL steps require a toolInvocation", path: ["toolInvocation"] });
  }
  if (step.type === "APPROVAL" && step.approval === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "APPROVAL steps require an approval checkpoint", path: ["approval"] });
  }
  if (step.type === "PROMPT" && step.promptTemplateId === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "PROMPT steps require a promptTemplateId", path: ["promptTemplateId"] });
  }
});

export type ExecutionPlanStep = z.infer<typeof executionPlanStepSchema>;

export const executionPlanSchema = z.object({
  tenantId: z.string().min(1),
  planId: z.string().min(1),
  plannerId: z.string().min(1),
  objective: z.string().min(1),
  roles: z.array(agentRoleContractSchema).min(1),
  steps: z.array(executionPlanStepSchema).min(1),
  memoryAttachments: z.array(memoryAttachmentSchema).default([]),
  createdAt: z.string().datetime(),
  correlation: aiCorrelationMetadataSchema,
  metadata: aiRuntimePayloadSchema.optional()
}).strict().superRefine((plan, ctx) => {
  const stepIds = new Set<string>();
  const roleIds = new Set(plan.roles.map((role) => role.roleId));
  for (const step of plan.steps) {
    if (stepIds.has(step.stepId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Plan step ids must be unique", path: ["steps", step.stepId] });
    }
    stepIds.add(step.stepId);
    if (!roleIds.has(step.roleId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Plan step roleId must reference a declared role", path: ["steps", step.stepId, "roleId"] });
    }
    if (step.toolInvocation !== undefined && step.toolInvocation.tenantId !== plan.tenantId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Tool invocation tenantId must match plan tenantId", path: ["steps", step.stepId, "toolInvocation", "tenantId"] });
    }
    if (step.approval !== undefined && step.approval.tenantId !== plan.tenantId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Approval tenantId must match plan tenantId", path: ["steps", step.stepId, "approval", "tenantId"] });
    }
    for (const attachment of step.memoryAttachments) {
      if (attachment.tenantId !== plan.tenantId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Memory attachment tenantId must match plan tenantId", path: ["steps", step.stepId, "memoryAttachments"] });
      }
    }
  }
  for (const step of plan.steps) {
    for (const dependency of step.dependsOn) {
      if (!stepIds.has(dependency)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Plan step dependsOn must reference a declared step", path: ["steps", step.stepId, "dependsOn"] });
      }
      if (dependency === step.stepId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Plan step cannot depend on itself", path: ["steps", step.stepId, "dependsOn"] });
      }
    }
  }
  for (const role of plan.roles) {
    if (role.tenantId !== undefined && role.tenantId !== plan.tenantId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Agent role tenantId must match plan tenantId", path: ["roles", role.roleId, "tenantId"] });
    }
  }
  for (const attachment of plan.memoryAttachments) {
    if (attachment.tenantId !== plan.tenantId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Plan memory attachment tenantId must match plan tenantId", path: ["memoryAttachments"] });
    }
  }
});

export type ExecutionPlan = z.infer<typeof executionPlanSchema>;

export const executionGraphStateValues = ["PENDING", "READY", "RUNNING", "WAITING_FOR_APPROVAL", "SUCCEEDED", "FAILED", "RECOVERING", "CANCELLED"] as const;
export const executionGraphStateSchema = z.enum(executionGraphStateValues);
export type ExecutionGraphState = z.infer<typeof executionGraphStateSchema>;

export const executionGraphNodeSchema = z.object({
  tenantId: z.string().min(1),
  planId: z.string().min(1),
  stepId: z.string().min(1),
  state: executionGraphStateSchema,
  attempts: z.number().int().min(0),
  availableAfter: z.string().datetime().optional(),
  lastErrorCode: z.string().min(1).optional()
}).strict();

export type ExecutionGraphNode = z.infer<typeof executionGraphNodeSchema>;

export const executionGraphSchema = z.object({
  tenantId: z.string().min(1),
  planId: z.string().min(1),
  nodes: z.array(executionGraphNodeSchema).min(1),
  correlation: aiCorrelationMetadataSchema
}).strict().superRefine((graph, ctx) => {
  const nodeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (node.tenantId !== graph.tenantId || node.planId !== graph.planId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Execution graph nodes must match graph tenantId and planId", path: ["nodes", node.stepId] });
    }
    if (nodeIds.has(node.stepId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Execution graph step ids must be unique", path: ["nodes", node.stepId] });
    }
    nodeIds.add(node.stepId);
  }
});

export type ExecutionGraph = z.infer<typeof executionGraphSchema>;

export interface DeterministicPlanner {
  plan(context: AiTenantExecutionContext, input: AiRuntimePayload): Promise<ExecutionPlan>;
}

const planningContractError = (
  message: string,
  correlation: AiCorrelationMetadata | undefined,
  details: Record<string, unknown> = {},
): AiRuntimeError => new AiRuntimeError({
  code: "AI_RUNTIME_VALIDATION_FAILED",
  message,
  status: 422,
  details,
  correlation
});

export const assertExecutionPlanTenantIsolation = (
  context: AiTenantExecutionContext,
  plan: ExecutionPlan,
): void => {
  const parsedContext = aiTenantExecutionContextSchema.parse(context);
  const parsedPlan = executionPlanSchema.parse(plan);
  assertAiTenantIsolation(parsedContext, parsedPlan);
};

const visitStep = (
  stepId: string,
  byId: ReadonlyMap<string, ExecutionPlanStep>,
  visiting: Set<string>,
  visited: Set<string>,
  correlation: AiCorrelationMetadata,
): void => {
  if (visited.has(stepId)) {
    return;
  }
  if (visiting.has(stepId)) {
    throw planningContractError("Execution plan dependency graph must be acyclic", correlation, { stepId });
  }
  const step = byId.get(stepId);
  if (step === undefined) {
    throw planningContractError("Execution plan references an unknown step", correlation, { stepId });
  }
  visiting.add(stepId);
  for (const dependency of step.dependsOn) {
    visitStep(dependency, byId, visiting, visited, correlation);
  }
  visiting.delete(stepId);
  visited.add(stepId);
};

export const validateExecutionPlanGraph = (plan: ExecutionPlan): ExecutionPlan => {
  const parsedPlan = executionPlanSchema.parse(plan);
  const byId = new Map(parsedPlan.steps.map((step) => [step.stepId, step]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  for (const step of parsedPlan.steps) {
    visitStep(step.stepId, byId, visiting, visited, parsedPlan.correlation);
  }
  return parsedPlan;
};

export const buildInitialExecutionGraph = (plan: ExecutionPlan): ExecutionGraph => {
  const parsedPlan = validateExecutionPlanGraph(plan);
  return executionGraphSchema.parse({
    tenantId: parsedPlan.tenantId,
    planId: parsedPlan.planId,
    nodes: parsedPlan.steps.map((step) => ({
      tenantId: parsedPlan.tenantId,
      planId: parsedPlan.planId,
      stepId: step.stepId,
      state: step.dependsOn.length === 0 ? "READY" : "PENDING",
      attempts: 0
    })),
    correlation: parsedPlan.correlation
  });
};

export const getReadyExecutionStepIds = (plan: ExecutionPlan, graph: ExecutionGraph): readonly string[] => {
  const parsedPlan = validateExecutionPlanGraph(plan);
  const parsedGraph = executionGraphSchema.parse(graph);
  assertAiTenantIsolation({
    tenantId: parsedPlan.tenantId,
    agentId: parsedPlan.plannerId,
    executionId: parsedPlan.planId,
    mode: "PLAN",
    correlation: parsedPlan.correlation
  }, parsedGraph);
  const states = new Map(parsedGraph.nodes.map((node) => [node.stepId, node.state]));
  return parsedPlan.steps
    .filter((step) => states.get(step.stepId) === "READY")
    .filter((step) => step.dependsOn.every((dependency) => states.get(dependency) === "SUCCEEDED"))
    .map((step) => step.stepId)
    .sort();
};

export const calculateRecoveryDelayMs = (policy: RetryRecoveryPolicy, attempt: number): number => {
  const parsed = retryRecoveryPolicySchema.parse(policy);
  if (attempt < 1 || attempt > parsed.maxAttempts) {
    throw planningContractError("Retry attempt is outside policy bounds", undefined, { attempt, maxAttempts: parsed.maxAttempts });
  }
  if (parsed.backoff === "NONE") {
    return 0;
  }
  if (parsed.backoff === "FIXED") {
    return parsed.initialDelayMs;
  }
  return Math.min(parsed.maxDelayMs, parsed.initialDelayMs * (2 ** (attempt - 1)));
};

export const shouldRecoverPlanStep = (policy: RetryRecoveryPolicy, nextAttempt: number): boolean => {
  const parsed = retryRecoveryPolicySchema.parse(policy);
  return parsed.recoveryAction === "RETRY_STEP" && nextAttempt <= parsed.maxAttempts;
};
