import { z } from "zod";
import { correlationMetadataSchema } from "@whisperm/types";
import type { CorrelationMetadata } from "@whisperm/types";

const namespacedNamePattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const safeAttributeKeyPattern = /^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$/u;

export const multiAgentMetadataSchema = z.record(z.string(), z.unknown());
export type MultiAgentMetadata = z.infer<typeof multiAgentMetadataSchema>;

export const replayModeValues = ["LIVE", "REPLAY", "DRY_RUN"] as const;
export const replayModeSchema = z.enum(replayModeValues);
export type ReplayMode = z.infer<typeof replayModeSchema>;

export const coordinationTenantContextSchema = z.object({
  tenantId: z.string().min(1),
  actorId: z.string().min(1).optional(),
  correlation: correlationMetadataSchema,
  replay: z.object({
    mode: replayModeSchema.default("LIVE"),
    replayId: z.string().min(1).optional(),
    deterministic: z.literal(true).default(true)
  }).strict().default({ mode: "LIVE", deterministic: true })
}).strict().superRefine((context, ctx) => {
  if (context.replay.mode !== "LIVE" && context.replay.replayId === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "replay contexts require replayId", path: ["replay", "replayId"] });
  }
});
export type CoordinationTenantContext = z.output<typeof coordinationTenantContextSchema>;

export const multiAgentErrorCodeValues = [
  "MULTI_AGENT_VALIDATION_FAILED",
  "MULTI_AGENT_TENANT_ISOLATION_VIOLATION",
  "MULTI_AGENT_DUPLICATE_REGISTRY_ENTRY",
  "MULTI_AGENT_REGISTRY_ENTRY_NOT_FOUND",
  "MULTI_AGENT_CAPABILITY_NOT_ALLOWED",
  "MULTI_AGENT_ROLE_NOT_ALLOWED",
  "MULTI_AGENT_INVALID_GRAPH",
  "MULTI_AGENT_INVALID_STATE_TRANSITION",
  "MULTI_AGENT_CONSENSUS_NOT_REACHED",
  "MULTI_AGENT_CONFLICT_UNRESOLVED",
  "MULTI_AGENT_APPROVAL_REQUIRED",
  "MULTI_AGENT_IDEMPOTENCY_CONFLICT"
] as const;
export const multiAgentErrorCodeSchema = z.enum(multiAgentErrorCodeValues);
export type MultiAgentErrorCode = z.infer<typeof multiAgentErrorCodeSchema>;

export const multiAgentErrorModelSchema = z.object({
  code: multiAgentErrorCodeSchema,
  message: z.string().min(1),
  status: z.number().int().min(400).max(599),
  retryable: z.boolean().default(false),
  details: multiAgentMetadataSchema.optional(),
  correlation: correlationMetadataSchema.optional()
}).strict();
export type MultiAgentErrorModel = z.output<typeof multiAgentErrorModelSchema>;

export interface MultiAgentRuntimeErrorInput {
  readonly code: MultiAgentErrorCode;
  readonly message: string;
  readonly status: number;
  readonly retryable?: boolean | undefined;
  readonly details?: MultiAgentMetadata | undefined;
  readonly correlation?: CorrelationMetadata | undefined;
}

export class MultiAgentRuntimeError extends Error {
  readonly code: MultiAgentErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: MultiAgentMetadata | undefined;
  readonly correlation?: CorrelationMetadata | undefined;

  constructor(input: MultiAgentRuntimeErrorInput) {
    super(input.message);
    this.name = "MultiAgentRuntimeError";
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable ?? false;
    this.details = input.details;
    this.correlation = input.correlation;
    Object.setPrototypeOf(this, MultiAgentRuntimeError.prototype);
  }

  toErrorModel(): MultiAgentErrorModel {
    return multiAgentErrorModelSchema.parse({
      code: this.code,
      message: this.message,
      status: this.status,
      retryable: this.retryable,
      details: this.details,
      correlation: this.correlation
    });
  }
}

const validationIssues = (error: z.ZodError): readonly MultiAgentMetadata[] => error.issues.map((issue) => ({
  path: issue.path.join("."),
  message: issue.message,
  code: issue.code
}));

export const parseMultiAgentContract = <TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  input: unknown,
  correlation?: CorrelationMetadata,
): z.output<TSchema> => {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new MultiAgentRuntimeError({
      code: "MULTI_AGENT_VALIDATION_FAILED",
      message: "Multi-agent contract validation failed",
      status: 400,
      details: { issues: validationIssues(result.error) },
      correlation
    });
  }
  return result.data;
};

export const agentRoleKindValues = [
  "PLANNER",
  "WORKER",
  "REVIEWER",
  "SUPERVISOR",
  "RESEARCHER",
  "CONTENT",
  "COMPLIANCE",
  "PUBLISHING",
  "CAMPAIGN_STRATEGIST",
  "HUMAN_REVIEWER"
] as const;
export const agentRoleKindSchema = z.enum(agentRoleKindValues);
export type AgentRoleKind = z.infer<typeof agentRoleKindSchema>;

export const agentCapabilityKindValues = [
  "PLAN_CAMPAIGN",
  "DECOMPOSE_TASK",
  "EXECUTE_TASK",
  "REVIEW_OUTPUT",
  "RESEARCH_CONTEXT",
  "GENERATE_CONTENT",
  "CHECK_COMPLIANCE",
  "PUBLISH_CONTENT",
  "REQUEST_APPROVAL",
  "RESOLVE_CONFLICT",
  "SUPERVISE_TEAM",
  "EXCHANGE_MEMORY",
  "MESSAGE_AGENT"
] as const;
export const agentCapabilityKindSchema = z.enum(agentCapabilityKindValues);
export type AgentCapabilityKind = z.infer<typeof agentCapabilityKindSchema>;

export const agentRuntimeModeValues = ["DETERMINISTIC", "HUMAN_ASSISTED", "EXTERNAL_MODEL_BOUNDARY"] as const;
export const agentRuntimeModeSchema = z.enum(agentRuntimeModeValues);
export type AgentRuntimeMode = z.infer<typeof agentRuntimeModeSchema>;

export const agentRoleContractSchema = z.object({
  roleId: z.string().regex(namespacedNamePattern),
  kind: agentRoleKindSchema,
  displayName: z.string().min(1).max(120),
  description: z.string().min(1).max(1000).optional(),
  allowedCapabilityKinds: z.array(agentCapabilityKindSchema).min(1),
  mayDelegate: z.boolean().default(false),
  mayApprove: z.boolean().default(false),
  maySupervise: z.boolean().default(false),
  replaySafe: z.literal(true).default(true),
  metadata: multiAgentMetadataSchema.default({})
}).strict().superRefine((role, ctx) => {
  if (role.kind === "SUPERVISOR" && !role.maySupervise) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "SUPERVISOR roles must be allowed to supervise", path: ["maySupervise"] });
  }
  if (role.kind === "HUMAN_REVIEWER" && !role.mayApprove) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "HUMAN_REVIEWER roles must be allowed to approve", path: ["mayApprove"] });
  }
});
export type AgentRoleContract = z.output<typeof agentRoleContractSchema>;

export const agentCapabilityContractSchema = z.object({
  capabilityId: z.string().regex(namespacedNamePattern),
  kind: agentCapabilityKindSchema,
  version: z.number().int().min(1),
  description: z.string().min(1).max(1000).optional(),
  inputSchemaRef: z.string().min(1).optional(),
  outputSchemaRef: z.string().min(1).optional(),
  requiresApproval: z.boolean().default(false),
  tenantScoped: z.literal(true).default(true),
  deterministic: z.literal(true).default(true),
  replaySafe: z.literal(true).default(true),
  runtimeMode: agentRuntimeModeSchema.default("DETERMINISTIC"),
  metadata: multiAgentMetadataSchema.default({})
}).strict().superRefine((capability, ctx) => {
  if (capability.runtimeMode === "EXTERNAL_MODEL_BOUNDARY") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "runtime foundations cannot bind live provider calls", path: ["runtimeMode"] });
  }
});
export type AgentCapabilityContract = z.output<typeof agentCapabilityContractSchema>;

export const agentRegistryEntrySchema = z.object({
  tenantId: z.string().min(1),
  agentId: z.string().regex(namespacedNamePattern),
  displayName: z.string().min(1).max(120),
  roleIds: z.array(z.string().regex(namespacedNamePattern)).min(1),
  capabilityIds: z.array(z.string().regex(namespacedNamePattern)).min(1),
  enabled: z.boolean().default(true),
  maxConcurrentDelegations: z.number().int().min(1).max(100).default(1),
  supervisionRequired: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  metadata: multiAgentMetadataSchema.default({})
}).strict().refine((entry) => Date.parse(entry.createdAt) <= Date.parse(entry.updatedAt), {
  message: "agent registry createdAt must be before or equal to updatedAt",
  path: ["updatedAt"]
});
export type AgentRegistryEntry = z.output<typeof agentRegistryEntrySchema>;

export const agentRegistryContractSchema = z.object({
  tenantId: z.string().min(1),
  registryId: z.string().min(1),
  version: z.number().int().min(1),
  roles: z.array(agentRoleContractSchema).min(1),
  capabilities: z.array(agentCapabilityContractSchema).min(1),
  agents: z.array(agentRegistryEntrySchema).min(1),
  correlation: correlationMetadataSchema,
  replaySafe: z.literal(true).default(true)
}).strict().superRefine((registry, ctx) => {
  const roleIds = new Set<string>();
  const capabilityIds = new Set<string>();
  const agentIds = new Set<string>();

  for (const [index, role] of registry.roles.entries()) {
    if (roleIds.has(role.roleId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate roleId", path: ["roles", index, "roleId"] });
    }
    roleIds.add(role.roleId);
  }

  for (const [index, capability] of registry.capabilities.entries()) {
    if (capabilityIds.has(capability.capabilityId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate capabilityId", path: ["capabilities", index, "capabilityId"] });
    }
    capabilityIds.add(capability.capabilityId);
  }

  for (const [index, agent] of registry.agents.entries()) {
    if (agent.tenantId !== registry.tenantId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "agent tenantId must match registry tenantId", path: ["agents", index, "tenantId"] });
    }
    if (agentIds.has(agent.agentId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate agentId", path: ["agents", index, "agentId"] });
    }
    agentIds.add(agent.agentId);
    for (const [roleIndex, roleId] of agent.roleIds.entries()) {
      if (!roleIds.has(roleId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "agent references unknown roleId", path: ["agents", index, "roleIds", roleIndex] });
      }
    }
    for (const [capabilityIndex, capabilityId] of agent.capabilityIds.entries()) {
      if (!capabilityIds.has(capabilityId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "agent references unknown capabilityId", path: ["agents", index, "capabilityIds", capabilityIndex] });
      }
    }
  }
});
export type AgentRegistryContract = z.output<typeof agentRegistryContractSchema>;

export const agentTeamContractSchema = z.object({
  tenantId: z.string().min(1),
  teamId: z.string().min(1),
  name: z.string().min(1).max(120),
  purpose: z.string().min(1).max(1000),
  plannerAgentId: z.string().regex(namespacedNamePattern),
  workerAgentIds: z.array(z.string().regex(namespacedNamePattern)).min(1),
  reviewerAgentIds: z.array(z.string().regex(namespacedNamePattern)).min(1),
  supervisorAgentId: z.string().regex(namespacedNamePattern).optional(),
  allowedCapabilityIds: z.array(z.string().regex(namespacedNamePattern)).min(1),
  approvalPolicyId: z.string().min(1).optional(),
  maxParallelDelegations: z.number().int().min(1).max(100).default(1),
  replaySafe: z.literal(true).default(true),
  metadata: multiAgentMetadataSchema.default({})
}).strict().superRefine((team, ctx) => {
  if (team.workerAgentIds.includes(team.plannerAgentId)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "planner cannot also be listed as worker", path: ["plannerAgentId"] });
  }
  if (team.reviewerAgentIds.includes(team.plannerAgentId)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "planner cannot also be listed as reviewer", path: ["plannerAgentId"] });
  }
});
export type AgentTeamContract = z.output<typeof agentTeamContractSchema>;

export const sharedContextScopeValues = ["RUN", "TEAM", "DELEGATION", "HANDOFF", "APPROVAL"] as const;
export const sharedContextScopeSchema = z.enum(sharedContextScopeValues);
export type SharedContextScope = z.infer<typeof sharedContextScopeSchema>;

export const sharedContextContractSchema = z.object({
  tenantId: z.string().min(1),
  contextId: z.string().min(1),
  scope: sharedContextScopeSchema,
  ownerAgentId: z.string().regex(namespacedNamePattern),
  readableByAgentIds: z.array(z.string().regex(namespacedNamePattern)).min(1),
  writableByAgentIds: z.array(z.string().regex(namespacedNamePattern)).default([]),
  payload: multiAgentMetadataSchema.default({}),
  version: z.number().int().min(1),
  idempotencyKey: z.string().min(1),
  replaySafe: z.literal(true).default(true),
  correlation: correlationMetadataSchema
}).strict().superRefine((context, ctx) => {
  if (!context.readableByAgentIds.includes(context.ownerAgentId)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "owner must be able to read shared context", path: ["readableByAgentIds"] });
  }
  for (const [index, agentId] of context.writableByAgentIds.entries()) {
    if (!context.readableByAgentIds.includes(agentId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "writers must also be readers", path: ["writableByAgentIds", index] });
    }
  }
});
export type SharedContextContract = z.output<typeof sharedContextContractSchema>;

export const agentMemoryKindValues = ["FACT", "DECISION", "PREFERENCE", "SUMMARY", "EVIDENCE", "REVIEW_FINDING"] as const;
export const agentMemoryKindSchema = z.enum(agentMemoryKindValues);
export type AgentMemoryKind = z.infer<typeof agentMemoryKindSchema>;

export const agentMemoryExchangeContractSchema = z.object({
  tenantId: z.string().min(1),
  exchangeId: z.string().min(1),
  fromAgentId: z.string().regex(namespacedNamePattern),
  toAgentId: z.string().regex(namespacedNamePattern),
  kind: agentMemoryKindSchema,
  content: multiAgentMetadataSchema,
  contextId: z.string().min(1).optional(),
  occurredAt: z.string().datetime(),
  idempotencyKey: z.string().min(1),
  replaySafe: z.literal(true).default(true),
  correlation: correlationMetadataSchema
}).strict().refine((exchange) => exchange.fromAgentId !== exchange.toAgentId, {
  message: "memory exchange requires distinct agents",
  path: ["toAgentId"]
});
export type AgentMemoryExchangeContract = z.output<typeof agentMemoryExchangeContractSchema>;

export const agentMessageKindValues = ["COMMAND", "EVENT", "QUERY", "RESPONSE", "REVIEW", "ESCALATION"] as const;
export const agentMessageKindSchema = z.enum(agentMessageKindValues);
export type AgentMessageKind = z.infer<typeof agentMessageKindSchema>;

export const agentMessageContractSchema = z.object({
  tenantId: z.string().min(1),
  messageId: z.string().min(1),
  threadId: z.string().min(1),
  fromAgentId: z.string().regex(namespacedNamePattern),
  toAgentId: z.string().regex(namespacedNamePattern),
  kind: agentMessageKindSchema,
  subject: z.string().min(1).max(240),
  payload: multiAgentMetadataSchema.default({}),
  sentAt: z.string().datetime(),
  causationMessageId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1),
  replaySafe: z.literal(true).default(true),
  correlation: correlationMetadataSchema
}).strict().refine((message) => message.fromAgentId !== message.toAgentId, {
  message: "messages require distinct agents",
  path: ["toAgentId"]
});
export type AgentMessageContract = z.output<typeof agentMessageContractSchema>;

export const delegationStateValues = ["REQUESTED", "ACCEPTED", "RUNNING", "WAITING_FOR_APPROVAL", "COMPLETED", "FAILED", "CANCELLED", "HANDED_OFF"] as const;
export const delegationStateSchema = z.enum(delegationStateValues);
export type DelegationState = z.infer<typeof delegationStateSchema>;

export const terminalDelegationStateValues = ["COMPLETED", "FAILED", "CANCELLED", "HANDED_OFF"] as const satisfies readonly DelegationState[];
export type TerminalDelegationState = (typeof terminalDelegationStateValues)[number];

const delegationStateTransitions: Readonly<Record<DelegationState, readonly DelegationState[]>> = {
  REQUESTED: ["ACCEPTED", "CANCELLED"],
  ACCEPTED: ["RUNNING", "CANCELLED"],
  RUNNING: ["WAITING_FOR_APPROVAL", "COMPLETED", "FAILED", "CANCELLED", "HANDED_OFF"],
  WAITING_FOR_APPROVAL: ["RUNNING", "FAILED", "CANCELLED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
  HANDED_OFF: []
};

export const isTerminalDelegationState = (state: DelegationState): state is TerminalDelegationState =>
  terminalDelegationStateValues.includes(state as TerminalDelegationState);

export const canTransitionDelegationState = (from: DelegationState, to: DelegationState): boolean =>
  delegationStateTransitions[from].includes(to);

export const agentDelegationContractSchema = z.object({
  tenantId: z.string().min(1),
  delegationId: z.string().min(1),
  parentDelegationId: z.string().min(1).optional(),
  fromAgentId: z.string().regex(namespacedNamePattern),
  toAgentId: z.string().regex(namespacedNamePattern),
  capabilityId: z.string().regex(namespacedNamePattern),
  objective: z.string().min(1).max(2000),
  input: multiAgentMetadataSchema.default({}),
  expectedOutputSchemaRef: z.string().min(1).optional(),
  state: delegationStateSchema.default("REQUESTED"),
  attempt: z.number().int().min(1).max(100).default(1),
  requestedAt: z.string().datetime(),
  deadlineAt: z.string().datetime().optional(),
  idempotencyKey: z.string().min(1),
  replaySafe: z.literal(true).default(true),
  correlation: correlationMetadataSchema,
  metadata: multiAgentMetadataSchema.default({})
}).strict().superRefine((delegation, ctx) => {
  if (delegation.fromAgentId === delegation.toAgentId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "delegation requires distinct agents", path: ["toAgentId"] });
  }
  if (delegation.deadlineAt !== undefined && Date.parse(delegation.deadlineAt) <= Date.parse(delegation.requestedAt)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "deadlineAt must be after requestedAt", path: ["deadlineAt"] });
  }
});
export type AgentDelegationContract = z.output<typeof agentDelegationContractSchema>;

export const handoffReasonValues = ["CAPABILITY_MISMATCH", "LOAD_BALANCING", "ESCALATION", "HUMAN_REVIEW", "SPECIALIST_REQUIRED"] as const;
export const handoffReasonSchema = z.enum(handoffReasonValues);
export type HandoffReason = z.infer<typeof handoffReasonSchema>;

export const agentHandoffContractSchema = z.object({
  tenantId: z.string().min(1),
  handoffId: z.string().min(1),
  delegationId: z.string().min(1),
  fromAgentId: z.string().regex(namespacedNamePattern),
  toAgentId: z.string().regex(namespacedNamePattern),
  reason: handoffReasonSchema,
  summary: z.string().min(1).max(4000),
  transferredContextIds: z.array(z.string().min(1)).default([]),
  handedOffAt: z.string().datetime(),
  idempotencyKey: z.string().min(1),
  replaySafe: z.literal(true).default(true),
  correlation: correlationMetadataSchema
}).strict().refine((handoff) => handoff.fromAgentId !== handoff.toAgentId, {
  message: "handoff requires distinct agents",
  path: ["toAgentId"]
});
export type AgentHandoffContract = z.output<typeof agentHandoffContractSchema>;

export const supervisionActionValues = ["OBSERVE", "PAUSE", "RESUME", "CANCEL", "ESCALATE", "REASSIGN", "REQUIRE_APPROVAL"] as const;
export const supervisionActionSchema = z.enum(supervisionActionValues);
export type SupervisionAction = z.infer<typeof supervisionActionSchema>;

export const agentSupervisionContractSchema = z.object({
  tenantId: z.string().min(1),
  supervisionId: z.string().min(1),
  supervisorAgentId: z.string().regex(namespacedNamePattern),
  targetAgentId: z.string().regex(namespacedNamePattern),
  delegationId: z.string().min(1).optional(),
  action: supervisionActionSchema,
  reason: z.string().min(1).max(1000),
  requiresApproval: z.boolean().default(false),
  observedAt: z.string().datetime(),
  idempotencyKey: z.string().min(1),
  replaySafe: z.literal(true).default(true),
  correlation: correlationMetadataSchema
}).strict().refine((supervision) => supervision.supervisorAgentId !== supervision.targetAgentId, {
  message: "supervision requires distinct agents",
  path: ["targetAgentId"]
});
export type AgentSupervisionContract = z.output<typeof agentSupervisionContractSchema>;

export const graphNodeKindValues = ["PLAN", "DELEGATION", "APPROVAL_CHECKPOINT", "REVIEW", "HANDOFF", "CONSENSUS", "CONFLICT_RESOLUTION"] as const;
export const graphNodeKindSchema = z.enum(graphNodeKindValues);
export type GraphNodeKind = z.infer<typeof graphNodeKindSchema>;

export const executionGraphNodeSchema = z.object({
  nodeId: z.string().min(1),
  kind: graphNodeKindSchema,
  agentId: z.string().regex(namespacedNamePattern).optional(),
  capabilityId: z.string().regex(namespacedNamePattern).optional(),
  dependsOn: z.array(z.string().min(1)).default([]),
  tenantId: z.string().min(1),
  input: multiAgentMetadataSchema.default({}),
  replaySafe: z.literal(true).default(true)
}).strict();
export type ExecutionGraphNode = z.output<typeof executionGraphNodeSchema>;

export const executionGraphEdgeSchema = z.object({
  fromNodeId: z.string().min(1),
  toNodeId: z.string().min(1),
  condition: z.string().min(1).optional(),
  replaySafe: z.literal(true).default(true)
}).strict().refine((edge) => edge.fromNodeId !== edge.toNodeId, {
  message: "graph edges cannot point to the same node",
  path: ["toNodeId"]
});
export type ExecutionGraphEdge = z.output<typeof executionGraphEdgeSchema>;

export const multiAgentExecutionGraphContractSchema = z.object({
  tenantId: z.string().min(1),
  graphId: z.string().min(1),
  version: z.number().int().min(1),
  nodes: z.array(executionGraphNodeSchema).min(1),
  edges: z.array(executionGraphEdgeSchema).default([]),
  entryNodeIds: z.array(z.string().min(1)).min(1),
  terminalNodeIds: z.array(z.string().min(1)).min(1),
  deterministic: z.literal(true).default(true),
  replaySafe: z.literal(true).default(true),
  correlation: correlationMetadataSchema
}).strict().superRefine((graph, ctx) => {
  const nodeIds = new Set<string>();
  for (const [index, node] of graph.nodes.entries()) {
    if (node.tenantId !== graph.tenantId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "graph node tenantId must match graph tenantId", path: ["nodes", index, "tenantId"] });
    }
    if (nodeIds.has(node.nodeId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate graph nodeId", path: ["nodes", index, "nodeId"] });
    }
    nodeIds.add(node.nodeId);
  }
  for (const [nodeIndex, node] of graph.nodes.entries()) {
    for (const [dependencyIndex, dependencyNodeId] of node.dependsOn.entries()) {
      if (!nodeIds.has(dependencyNodeId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "node dependsOn references unknown nodeId", path: ["nodes", nodeIndex, "dependsOn", dependencyIndex] });
      }
    }
  }
  for (const [index, edge] of graph.edges.entries()) {
    if (!nodeIds.has(edge.fromNodeId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "edge references unknown fromNodeId", path: ["edges", index, "fromNodeId"] });
    }
    if (!nodeIds.has(edge.toNodeId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "edge references unknown toNodeId", path: ["edges", index, "toNodeId"] });
    }
  }
  for (const [index, nodeId] of graph.entryNodeIds.entries()) {
    if (!nodeIds.has(nodeId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "entry node does not exist", path: ["entryNodeIds", index] });
    }
  }
  for (const [index, nodeId] of graph.terminalNodeIds.entries()) {
    if (!nodeIds.has(nodeId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "terminal node does not exist", path: ["terminalNodeIds", index] });
    }
  }
});
export type MultiAgentExecutionGraphContract = z.output<typeof multiAgentExecutionGraphContractSchema>;

export const agentPatternKindValues = ["PLANNER_WORKER_REVIEWER", "SUPERVISOR_WORKER", "HUMAN_IN_THE_LOOP_REVIEW"] as const;
export const agentPatternKindSchema = z.enum(agentPatternKindValues);
export type AgentPatternKind = z.infer<typeof agentPatternKindSchema>;

export const plannerWorkerReviewerPatternSchema = z.object({
  tenantId: z.string().min(1),
  patternId: z.string().min(1),
  kind: z.literal("PLANNER_WORKER_REVIEWER"),
  plannerRoleId: z.string().regex(namespacedNamePattern),
  workerRoleIds: z.array(z.string().regex(namespacedNamePattern)).min(1),
  reviewerRoleIds: z.array(z.string().regex(namespacedNamePattern)).min(1),
  requiresReviewerApproval: z.boolean().default(true),
  maxRevisionCycles: z.number().int().min(0).max(25).default(3),
  replaySafe: z.literal(true).default(true)
}).strict();
export type PlannerWorkerReviewerPattern = z.output<typeof plannerWorkerReviewerPatternSchema>;

export const quorumStrategyValues = ["MAJORITY", "UNANIMOUS", "THRESHOLD", "WEIGHTED_THRESHOLD"] as const;
export const quorumStrategySchema = z.enum(quorumStrategyValues);
export type QuorumStrategy = z.infer<typeof quorumStrategySchema>;

export const consensusVoteValues = ["APPROVE", "REJECT", "ABSTAIN"] as const;
export const consensusVoteSchema = z.enum(consensusVoteValues);
export type ConsensusVote = z.infer<typeof consensusVoteSchema>;

export const consensusVoterSchema = z.object({
  agentId: z.string().regex(namespacedNamePattern),
  weight: z.number().int().min(1).max(100).default(1),
  required: z.boolean().default(false)
}).strict();
export type ConsensusVoter = z.output<typeof consensusVoterSchema>;

export const agentQuorumContractSchema = z.object({
  tenantId: z.string().min(1),
  quorumId: z.string().min(1),
  strategy: quorumStrategySchema,
  voters: z.array(consensusVoterSchema).min(1),
  threshold: z.number().int().min(1).optional(),
  approvalCheckpointRequired: z.boolean().default(false),
  replaySafe: z.literal(true).default(true),
  correlation: correlationMetadataSchema
}).strict().superRefine((quorum, ctx) => {
  const voterIds = new Set<string>();
  for (const [index, voter] of quorum.voters.entries()) {
    if (voterIds.has(voter.agentId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate consensus voter", path: ["voters", index, "agentId"] });
    }
    voterIds.add(voter.agentId);
  }
  if ((quorum.strategy === "THRESHOLD" || quorum.strategy === "WEIGHTED_THRESHOLD") && quorum.threshold === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "threshold strategies require threshold", path: ["threshold"] });
  }
});
export type AgentQuorumContract = z.output<typeof agentQuorumContractSchema>;

export const agentConsensusVoteSchema = z.object({
  tenantId: z.string().min(1),
  quorumId: z.string().min(1),
  agentId: z.string().regex(namespacedNamePattern),
  vote: consensusVoteSchema,
  rationale: z.string().min(1).max(2000).optional(),
  votedAt: z.string().datetime(),
  idempotencyKey: z.string().min(1),
  replaySafe: z.literal(true).default(true),
  correlation: correlationMetadataSchema
}).strict();
export type AgentConsensusVote = z.output<typeof agentConsensusVoteSchema>;

export const consensusOutcomeValues = ["APPROVED", "REJECTED", "PENDING"] as const;
export const consensusOutcomeSchema = z.enum(consensusOutcomeValues);
export type ConsensusOutcome = z.infer<typeof consensusOutcomeSchema>;

export const agentConsensusResultSchema = z.object({
  tenantId: z.string().min(1),
  quorumId: z.string().min(1),
  outcome: consensusOutcomeSchema,
  approvals: z.number().int().min(0),
  rejections: z.number().int().min(0),
  abstentions: z.number().int().min(0),
  reachedAt: z.string().datetime().optional(),
  replaySafe: z.literal(true).default(true),
  correlation: correlationMetadataSchema
}).strict();
export type AgentConsensusResult = z.output<typeof agentConsensusResultSchema>;

export const conflictResolutionStrategyValues = ["SUPERVISOR_DECIDES", "QUORUM_VOTE", "HUMAN_APPROVAL", "DETERMINISTIC_PRIORITY"] as const;
export const conflictResolutionStrategySchema = z.enum(conflictResolutionStrategyValues);
export type ConflictResolutionStrategy = z.infer<typeof conflictResolutionStrategySchema>;

export const conflictResolutionContractSchema = z.object({
  tenantId: z.string().min(1),
  conflictId: z.string().min(1),
  sourceAgentIds: z.array(z.string().regex(namespacedNamePattern)).min(2),
  description: z.string().min(1).max(4000),
  candidateResolutionIds: z.array(z.string().min(1)).min(2),
  strategy: conflictResolutionStrategySchema,
  supervisorAgentId: z.string().regex(namespacedNamePattern).optional(),
  quorumId: z.string().min(1).optional(),
  approvalCheckpointId: z.string().min(1).optional(),
  deterministicPriority: z.array(z.string().min(1)).default([]),
  replaySafe: z.literal(true).default(true),
  correlation: correlationMetadataSchema
}).strict().superRefine((conflict, ctx) => {
  if (conflict.strategy === "SUPERVISOR_DECIDES" && conflict.supervisorAgentId === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "supervisor strategy requires supervisorAgentId", path: ["supervisorAgentId"] });
  }
  if (conflict.strategy === "QUORUM_VOTE" && conflict.quorumId === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "quorum strategy requires quorumId", path: ["quorumId"] });
  }
  if (conflict.strategy === "HUMAN_APPROVAL" && conflict.approvalCheckpointId === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "human approval strategy requires approvalCheckpointId", path: ["approvalCheckpointId"] });
  }
  if (conflict.strategy === "DETERMINISTIC_PRIORITY" && conflict.deterministicPriority.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "deterministic priority strategy requires priority list", path: ["deterministicPriority"] });
  }
});
export type ConflictResolutionContract = z.output<typeof conflictResolutionContractSchema>;

export const approvalCheckpointIntegrationSchema = z.object({
  tenantId: z.string().min(1),
  checkpointId: z.string().min(1),
  source: z.enum(["DELEGATION", "CONSENSUS", "CONFLICT", "SUPERVISION"]),
  sourceId: z.string().min(1),
  requiredRoleIds: z.array(z.string().regex(namespacedNamePattern)).default([]),
  requiredApproverAgentIds: z.array(z.string().regex(namespacedNamePattern)).default([]),
  reason: z.string().min(1).max(1000),
  failClosed: z.literal(true).default(true),
  idempotencyKey: z.string().min(1),
  replaySafe: z.literal(true).default(true),
  correlation: correlationMetadataSchema
}).strict().superRefine((checkpoint, ctx) => {
  if (checkpoint.requiredRoleIds.length === 0 && checkpoint.requiredApproverAgentIds.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "approval checkpoint requires role or approver" });
  }
});
export type ApprovalCheckpointIntegration = z.output<typeof approvalCheckpointIntegrationSchema>;

export const workflowRuntimeIntegrationSchema = z.object({
  tenantId: z.string().min(1),
  workflowId: z.string().min(1),
  workflowVersion: z.number().int().min(1),
  runId: z.string().min(1),
  graphId: z.string().min(1),
  checkpointIds: z.array(z.string().min(1)).default([]),
  deterministic: z.literal(true).default(true),
  replaySafe: z.literal(true).default(true),
  correlation: correlationMetadataSchema
}).strict();
export type WorkflowRuntimeIntegration = z.output<typeof workflowRuntimeIntegrationSchema>;

export const executionRuntimeIntegrationSchema = z.object({
  tenantId: z.string().min(1),
  executionId: z.string().min(1),
  runId: z.string().min(1),
  graphNodeId: z.string().min(1),
  delegationId: z.string().min(1).optional(),
  stateIdempotencyKey: z.string().min(1),
  attempt: z.number().int().min(1),
  replayMode: replayModeSchema.default("LIVE"),
  deterministic: z.literal(true).default(true),
  replaySafe: z.literal(true).default(true),
  correlation: correlationMetadataSchema
}).strict();
export type ExecutionRuntimeIntegration = z.output<typeof executionRuntimeIntegrationSchema>;

export const billingMeteringIntegrationSchema = z.object({
  tenantId: z.string().min(1),
  eventId: z.string().min(1),
  metric: z.enum(["AGENT_DELEGATION", "AGENT_MESSAGE", "AGENT_MEMORY_EXCHANGE", "AGENT_CONSENSUS_VOTE", "AGENT_APPROVAL_CHECKPOINT"]),
  quantity: z.number().int().positive(),
  occurredAt: z.string().datetime(),
  sourceId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  replaySafe: z.literal(true).default(true),
  correlation: correlationMetadataSchema,
  metadata: multiAgentMetadataSchema.default({})
}).strict();
export type BillingMeteringIntegration = z.output<typeof billingMeteringIntegrationSchema>;

export const telemetryIntegrationSchema = z.object({
  tenantId: z.string().min(1),
  spanName: z.string().min(1),
  operation: z.enum(["REGISTRY_VALIDATE", "DELEGATE", "HANDOFF", "SUPERVISE", "CONSENSUS", "CONFLICT_RESOLUTION", "APPROVAL_CHECKPOINT"]),
  attributes: z.record(z.string().regex(safeAttributeKeyPattern), z.union([z.string(), z.number(), z.boolean()])).default({}),
  occurredAt: z.string().datetime(),
  replayMode: replayModeSchema.default("LIVE"),
  correlation: correlationMetadataSchema
}).strict();
export type TelemetryIntegration = z.output<typeof telemetryIntegrationSchema>;

export const multiAgentCoordinationRuntimeSchema = z.object({
  tenant: coordinationTenantContextSchema,
  registry: agentRegistryContractSchema,
  team: agentTeamContractSchema,
  graph: multiAgentExecutionGraphContractSchema,
  pattern: plannerWorkerReviewerPatternSchema.optional(),
  workflow: workflowRuntimeIntegrationSchema.optional(),
  approvalCheckpoints: z.array(approvalCheckpointIntegrationSchema).default([]),
  replaySafe: z.literal(true).default(true)
}).strict().superRefine((runtime, ctx) => {
  const tenantId = runtime.tenant.tenantId;
  const tenantChecks: readonly [string, string | undefined][] = [
    ["registry", runtime.registry.tenantId],
    ["team", runtime.team.tenantId],
    ["graph", runtime.graph.tenantId],
    ["pattern", runtime.pattern?.tenantId],
    ["workflow", runtime.workflow?.tenantId]
  ];
  for (const [path, value] of tenantChecks) {
    if (value !== undefined && value !== tenantId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${path} tenantId must match runtime tenantId`, path: [path, "tenantId"] });
    }
  }
  for (const [index, checkpoint] of runtime.approvalCheckpoints.entries()) {
    if (checkpoint.tenantId !== tenantId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "approval checkpoint tenantId must match runtime tenantId", path: ["approvalCheckpoints", index, "tenantId"] });
    }
  }

  const agentIds = new Set(runtime.registry.agents.map((agent) => agent.agentId));
  const capabilityIds = new Set(runtime.registry.capabilities.map((capability) => capability.capabilityId));
  const teamAgentReferences = [
    runtime.team.plannerAgentId,
    ...runtime.team.workerAgentIds,
    ...runtime.team.reviewerAgentIds,
    ...(runtime.team.supervisorAgentId === undefined ? [] : [runtime.team.supervisorAgentId])
  ];
  for (const agentId of teamAgentReferences) {
    if (!agentIds.has(agentId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "team references unknown registry agent", path: ["team"] });
    }
  }
  for (const capabilityId of runtime.team.allowedCapabilityIds) {
    if (!capabilityIds.has(capabilityId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "team references unknown registry capability", path: ["team", "allowedCapabilityIds"] });
    }
  }
});
export type MultiAgentCoordinationRuntime = z.output<typeof multiAgentCoordinationRuntimeSchema>;

const findAgent = (registry: AgentRegistryContract, agentId: string): AgentRegistryEntry | undefined =>
  registry.agents.find((agent) => agent.agentId === agentId);

const findRole = (registry: AgentRegistryContract, roleId: string): AgentRoleContract | undefined =>
  registry.roles.find((role) => role.roleId === roleId);

const findCapability = (registry: AgentRegistryContract, capabilityId: string): AgentCapabilityContract | undefined =>
  registry.capabilities.find((capability) => capability.capabilityId === capabilityId);

export const assertSameTenant = (
  context: CoordinationTenantContext,
  candidate: { readonly tenantId: string },
  resource: string,
): void => {
  if (context.tenantId !== candidate.tenantId) {
    throw new MultiAgentRuntimeError({
      code: "MULTI_AGENT_TENANT_ISOLATION_VIOLATION",
      message: `${resource} tenantId must match coordination tenantId`,
      status: 403,
      details: { expectedTenantId: context.tenantId, actualTenantId: candidate.tenantId, resource },
      correlation: context.correlation
    });
  }
};

export const validateRegistry = (registry: AgentRegistryContract): AgentRegistryContract =>
  parseMultiAgentContract(agentRegistryContractSchema, registry, registry.correlation);

export const validateCoordinationRuntime = (runtime: MultiAgentCoordinationRuntime): MultiAgentCoordinationRuntime => {
  const parsed = parseMultiAgentContract(multiAgentCoordinationRuntimeSchema, runtime, runtime.tenant.correlation);
  validateExecutionGraph(parsed.graph);
  return parsed;
};

export const assertAgentCanUseCapability = (
  registry: AgentRegistryContract,
  agentId: string,
  capabilityId: string,
): void => {
  const agent = findAgent(registry, agentId);
  if (agent === undefined || !agent.enabled) {
    throw new MultiAgentRuntimeError({
      code: "MULTI_AGENT_REGISTRY_ENTRY_NOT_FOUND",
      message: "Enabled agent registry entry was not found",
      status: 404,
      details: { agentId },
      correlation: registry.correlation
    });
  }
  const capability = findCapability(registry, capabilityId);
  if (capability === undefined) {
    throw new MultiAgentRuntimeError({
      code: "MULTI_AGENT_REGISTRY_ENTRY_NOT_FOUND",
      message: "Capability registry entry was not found",
      status: 404,
      details: { capabilityId },
      correlation: registry.correlation
    });
  }
  if (!agent.capabilityIds.includes(capabilityId)) {
    throw new MultiAgentRuntimeError({
      code: "MULTI_AGENT_CAPABILITY_NOT_ALLOWED",
      message: "Agent is not allowed to use requested capability",
      status: 403,
      details: { agentId, capabilityId },
      correlation: registry.correlation
    });
  }

  const allowedByRole = agent.roleIds.some((roleId) => {
    const role = findRole(registry, roleId);
    return role?.allowedCapabilityKinds.includes(capability.kind) ?? false;
  });
  if (!allowedByRole) {
    throw new MultiAgentRuntimeError({
      code: "MULTI_AGENT_ROLE_NOT_ALLOWED",
      message: "Agent roles do not allow requested capability kind",
      status: 403,
      details: { agentId, capabilityId, capabilityKind: capability.kind },
      correlation: registry.correlation
    });
  }
};

export const createDelegation = (input: {
  readonly context: CoordinationTenantContext;
  readonly registry: AgentRegistryContract;
  readonly delegation: AgentDelegationContract;
}): AgentDelegationContract => {
  assertSameTenant(input.context, input.registry, "registry");
  assertSameTenant(input.context, input.delegation, "delegation");
  assertAgentCanUseCapability(input.registry, input.delegation.toAgentId, input.delegation.capabilityId);
  return parseMultiAgentContract(agentDelegationContractSchema, input.delegation, input.context.correlation);
};

export const transitionDelegation = (
  delegation: AgentDelegationContract,
  nextState: DelegationState,
): AgentDelegationContract => {
  if (!canTransitionDelegationState(delegation.state, nextState)) {
    throw new MultiAgentRuntimeError({
      code: "MULTI_AGENT_INVALID_STATE_TRANSITION",
      message: "Invalid delegation state transition",
      status: 409,
      details: { from: delegation.state, to: nextState, delegationId: delegation.delegationId },
      correlation: delegation.correlation
    });
  }
  return agentDelegationContractSchema.parse({ ...delegation, state: nextState });
};

export const validateExecutionGraph = (graph: MultiAgentExecutionGraphContract): MultiAgentExecutionGraphContract => {
  const parsed = parseMultiAgentContract(multiAgentExecutionGraphContractSchema, graph, graph.correlation);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const adjacency = new Map<string, readonly string[]>();
  for (const node of parsed.nodes) {
    adjacency.set(node.nodeId, parsed.edges.filter((edge) => edge.fromNodeId === node.nodeId).map((edge) => edge.toNodeId));
  }

  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) {
      return false;
    }
    if (visited.has(nodeId)) {
      return true;
    }
    visiting.add(nodeId);
    for (const nextNodeId of adjacency.get(nodeId) ?? []) {
      if (!visit(nextNodeId)) {
        return false;
      }
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return true;
  };

  for (const node of parsed.nodes) {
    if (!visit(node.nodeId)) {
      throw new MultiAgentRuntimeError({
        code: "MULTI_AGENT_INVALID_GRAPH",
        message: "Execution graph must be acyclic for replay-safe coordination",
        status: 400,
        details: { graphId: parsed.graphId, nodeId: node.nodeId },
        correlation: parsed.correlation
      });
    }
  }
  return parsed;
};

export const evaluateConsensus = (input: {
  readonly quorum: AgentQuorumContract;
  readonly votes: readonly AgentConsensusVote[];
  readonly evaluatedAt: string;
}): AgentConsensusResult => {
  const quorum = parseMultiAgentContract(agentQuorumContractSchema, input.quorum, input.quorum.correlation);
  const voterById = new Map(quorum.voters.map((voter) => [voter.agentId, voter]));
  const latestVotes = new Map<string, AgentConsensusVote>();

  for (const vote of input.votes) {
    const parsedVote = parseMultiAgentContract(agentConsensusVoteSchema, vote, quorum.correlation);
    if (parsedVote.tenantId !== quorum.tenantId || parsedVote.quorumId !== quorum.quorumId || !voterById.has(parsedVote.agentId)) {
      continue;
    }
    latestVotes.set(parsedVote.agentId, parsedVote);
  }

  const requiredVoters = quorum.voters.filter((voter) => voter.required);
  const missingRequiredVote = requiredVoters.some((voter) => latestVotes.get(voter.agentId)?.vote !== "APPROVE");
  const approvals = [...latestVotes.values()].filter((vote) => vote.vote === "APPROVE");
  const rejections = [...latestVotes.values()].filter((vote) => vote.vote === "REJECT");
  const abstentions = [...latestVotes.values()].filter((vote) => vote.vote === "ABSTAIN");
  const approvalWeight = approvals.reduce((sum, vote) => sum + (voterById.get(vote.agentId)?.weight ?? 0), 0);
  const totalWeight = quorum.voters.reduce((sum, voter) => sum + voter.weight, 0);
  const threshold = quorum.threshold ?? Math.floor(quorum.voters.length / 2) + 1;

  let approved = false;
  if (!missingRequiredVote) {
    if (quorum.strategy === "UNANIMOUS") {
      approved = approvals.length === quorum.voters.length;
    } else if (quorum.strategy === "MAJORITY") {
      approved = approvals.length > quorum.voters.length / 2;
    } else if (quorum.strategy === "THRESHOLD") {
      approved = approvals.length >= threshold;
    } else {
      approved = approvalWeight >= threshold && approvalWeight <= totalWeight;
    }
  }

  const outcome: ConsensusOutcome = approved ? "APPROVED" : rejections.length >= threshold ? "REJECTED" : "PENDING";
  return agentConsensusResultSchema.parse({
    tenantId: quorum.tenantId,
    quorumId: quorum.quorumId,
    outcome,
    approvals: approvals.length,
    rejections: rejections.length,
    abstentions: abstentions.length,
    reachedAt: outcome === "PENDING" ? undefined : input.evaluatedAt,
    replaySafe: true,
    correlation: quorum.correlation
  });
};

export const resolveConflictByPriority = (conflict: ConflictResolutionContract): string => {
  const parsed = parseMultiAgentContract(conflictResolutionContractSchema, conflict, conflict.correlation);
  if (parsed.strategy !== "DETERMINISTIC_PRIORITY") {
    throw new MultiAgentRuntimeError({
      code: "MULTI_AGENT_CONFLICT_UNRESOLVED",
      message: "Conflict does not use deterministic priority resolution",
      status: 409,
      details: { conflictId: parsed.conflictId, strategy: parsed.strategy },
      correlation: parsed.correlation
    });
  }
  const selected = parsed.deterministicPriority.find((resolutionId) => parsed.candidateResolutionIds.includes(resolutionId));
  if (selected === undefined) {
    throw new MultiAgentRuntimeError({
      code: "MULTI_AGENT_CONFLICT_UNRESOLVED",
      message: "Deterministic priority list does not reference a candidate resolution",
      status: 409,
      details: { conflictId: parsed.conflictId },
      correlation: parsed.correlation
    });
  }
  return selected;
};

export const createApprovalCheckpointForDelegation = (input: {
  readonly delegation: AgentDelegationContract;
  readonly checkpointId: string;
  readonly requiredRoleIds?: readonly string[] | undefined;
  readonly requiredApproverAgentIds?: readonly string[] | undefined;
  readonly reason: string;
}): ApprovalCheckpointIntegration => approvalCheckpointIntegrationSchema.parse({
  tenantId: input.delegation.tenantId,
  checkpointId: input.checkpointId,
  source: "DELEGATION",
  sourceId: input.delegation.delegationId,
  requiredRoleIds: input.requiredRoleIds ?? [],
  requiredApproverAgentIds: input.requiredApproverAgentIds ?? [],
  reason: input.reason,
  failClosed: true,
  idempotencyKey: `${input.delegation.idempotencyKey}:approval:${input.checkpointId}`,
  replaySafe: true,
  correlation: input.delegation.correlation
});

export const createBillingMeteringEvent = (input: {
  readonly tenantId: string;
  readonly eventId: string;
  readonly metric: BillingMeteringIntegration["metric"];
  readonly quantity: number;
  readonly occurredAt: string;
  readonly sourceId: string;
  readonly idempotencyKey: string;
  readonly correlation: CorrelationMetadata;
  readonly metadata?: MultiAgentMetadata | undefined;
}): BillingMeteringIntegration => billingMeteringIntegrationSchema.parse({
  tenantId: input.tenantId,
  eventId: input.eventId,
  metric: input.metric,
  quantity: input.quantity,
  occurredAt: input.occurredAt,
  sourceId: input.sourceId,
  idempotencyKey: input.idempotencyKey,
  replaySafe: true,
  correlation: input.correlation,
  metadata: input.metadata ?? {}
});

export const createTelemetryEvent = (input: {
  readonly tenantId: string;
  readonly spanName: string;
  readonly operation: TelemetryIntegration["operation"];
  readonly occurredAt: string;
  readonly correlation: CorrelationMetadata;
  readonly replayMode?: ReplayMode | undefined;
  readonly attributes?: Record<string, string | number | boolean> | undefined;
}): TelemetryIntegration => telemetryIntegrationSchema.parse({
  tenantId: input.tenantId,
  spanName: input.spanName,
  operation: input.operation,
  attributes: input.attributes ?? {},
  occurredAt: input.occurredAt,
  replayMode: input.replayMode ?? "LIVE",
  correlation: input.correlation
});
