import { z } from "zod";

export const aiCorrelationMetadataSchema = z.object({
  correlationId: z.string().min(1),
  requestId: z.string().min(1).optional(),
  causationId: z.string().min(1).optional(),
  traceId: z.string().min(1).optional(),
  spanId: z.string().min(1).optional()
}).strict();

export type AiCorrelationMetadata = z.infer<typeof aiCorrelationMetadataSchema>;

export const aiProviderKindValues = [
  "OPENAI",
  "ANTHROPIC",
  "GEMINI",
  "GROQ",
  "LOCAL_OSS"
] as const;
export const aiProviderKindSchema = z.enum(aiProviderKindValues);
export type AiProviderKind = z.infer<typeof aiProviderKindSchema>;

export const aiModelCapabilityValues = [
  "TEXT_GENERATION",
  "STRUCTURED_OUTPUT",
  "TOOL_CALLING",
  "VISION",
  "EMBEDDINGS",
  "REASONING"
] as const;
export const aiModelCapabilitySchema = z.enum(aiModelCapabilityValues);
export type AiModelCapability = z.infer<typeof aiModelCapabilitySchema>;

export const aiExecutionModeValues = ["RESPOND", "PLAN", "EXECUTE"] as const;
export const aiExecutionModeSchema = z.enum(aiExecutionModeValues);
export type AiExecutionMode = z.infer<typeof aiExecutionModeSchema>;

export const aiToolApprovalPolicyValues = ["NEVER", "REQUIRED", "CONDITIONAL"] as const;
export const aiToolApprovalPolicySchema = z.enum(aiToolApprovalPolicyValues);
export type AiToolApprovalPolicy = z.infer<typeof aiToolApprovalPolicySchema>;

export const aiRuntimePayloadSchema = z.record(z.string(), z.unknown());
export type AiRuntimePayload = z.infer<typeof aiRuntimePayloadSchema>;

export const aiErrorCodeValues = [
  "AI_TENANT_CONTEXT_MISSING",
  "AI_TENANT_MISMATCH",
  "AI_PROVIDER_UNAVAILABLE",
  "AI_MODEL_ROUTE_NOT_ALLOWED",
  "AI_MODEL_ROUTE_UNSUPPORTED",
  "AI_PROMPT_INVALID",
  "AI_TOOL_NOT_FOUND",
  "AI_TOOL_NOT_DETERMINISTIC",
  "AI_TOOL_TENANT_MISMATCH",
  "AI_TOOL_APPROVAL_REQUIRED",
  "AI_TOOL_EXECUTION_REJECTED",
  "AI_TOKEN_BUDGET_EXCEEDED",
  "AI_MEMORY_ACCESS_DENIED",
  "AI_RUNTIME_VALIDATION_FAILED"
] as const;
export const aiErrorCodeSchema = z.enum(aiErrorCodeValues);
export type AiErrorCode = z.infer<typeof aiErrorCodeSchema>;

export const aiErrorDetailsSchema = z.record(z.string(), z.unknown());

export const aiErrorModelSchema = z.object({
  code: aiErrorCodeSchema,
  message: z.string().min(1),
  status: z.number().int().min(400).max(599),
  details: aiErrorDetailsSchema.optional(),
  correlation: aiCorrelationMetadataSchema.optional()
}).strict();

export type AiErrorModel = z.infer<typeof aiErrorModelSchema>;

export interface AiRuntimeErrorInput {
  readonly code: AiErrorCode;
  readonly message: string;
  readonly status: number;
  readonly details?: AiRuntimePayload | undefined;
  readonly correlation?: AiCorrelationMetadata | undefined;
}

export class AiRuntimeError extends Error {
  readonly code: AiErrorCode;
  readonly status: number;
  readonly details?: AiRuntimePayload | undefined;
  readonly correlation?: AiCorrelationMetadata | undefined;

  constructor(input: AiRuntimeErrorInput) {
    super(input.message);
    this.name = "AiRuntimeError";
    this.code = input.code;
    this.status = input.status;
    this.details = input.details;
    this.correlation = input.correlation;
    Object.setPrototypeOf(this, AiRuntimeError.prototype);
  }

  toErrorModel(): AiErrorModel {
    return aiErrorModelSchema.parse({
      code: this.code,
      message: this.message,
      status: this.status,
      details: this.details,
      correlation: this.correlation
    });
  }
}


const parseAiRuntimeSchema = <T>(
  schema: z.ZodType<T>,
  input: unknown,
  correlation: AiCorrelationMetadata | undefined,
): T => {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AiRuntimeError({
      code: "AI_RUNTIME_VALIDATION_FAILED",
      message: "AI runtime contract validation failed",
      status: 400,
      details: { issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
        code: issue.code
      })) },
      correlation
    });
  }

  return result.data;
};

export const aiTenantExecutionContextSchema = z.object({
  tenantId: z.string().min(1),
  actorId: z.string().min(1).optional(),
  agentId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  conversationId: z.string().min(1).optional(),
  executionId: z.string().min(1),
  mode: aiExecutionModeSchema,
  correlation: aiCorrelationMetadataSchema
}).strict();

export type AiTenantExecutionContext = z.infer<typeof aiTenantExecutionContextSchema>;

export interface AiTenantScoped {
  readonly tenantId?: string | undefined;
}

export const assertAiTenantIsolation = (
  context: AiTenantExecutionContext,
  tenantScoped: AiTenantScoped,
): void => {
  const parsedContext = parseAiRuntimeSchema(aiTenantExecutionContextSchema, context, context.correlation);
  if (tenantScoped.tenantId === undefined || tenantScoped.tenantId.trim().length === 0) {
    throw new AiRuntimeError({
      code: "AI_TENANT_CONTEXT_MISSING",
      message: "AI runtime execution requires explicit tenant context",
      status: 403,
      correlation: parsedContext.correlation
    });
  }
  if (parsedContext.tenantId !== tenantScoped.tenantId) {
    throw new AiRuntimeError({
      code: "AI_TENANT_MISMATCH",
      message: "AI runtime tenant context mismatch",
      status: 403,
      details: { expectedTenantId: parsedContext.tenantId, actualTenantId: tenantScoped.tenantId },
      correlation: parsedContext.correlation
    });
  }
};

export const aiPromptRoleValues = ["SYSTEM", "DEVELOPER", "USER", "ASSISTANT", "TOOL"] as const;
export const aiPromptRoleSchema = z.enum(aiPromptRoleValues);
export type AiPromptRole = z.infer<typeof aiPromptRoleSchema>;

export const aiPromptMessageSchema = z.object({
  id: z.string().min(1).optional(),
  role: aiPromptRoleSchema,
  content: z.string().min(1),
  name: z.string().min(1).optional(),
  toolCallId: z.string().min(1).optional(),
  metadata: aiRuntimePayloadSchema.optional()
}).strict();

export type AiPromptMessage = z.infer<typeof aiPromptMessageSchema>;

export const aiProviderRequestOptionsSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxOutputTokens: z.number().int().min(1).max(1_000_000).optional(),
  stopSequences: z.array(z.string().min(1)).max(16).optional(),
  responseFormat: z.enum(["TEXT", "JSON_OBJECT"]).default("TEXT")
}).strict();

export type AiProviderRequestOptions = z.infer<typeof aiProviderRequestOptionsSchema>;

export const aiPromptRequestSchema = z.object({
  tenantId: z.string().min(1),
  agentId: z.string().min(1),
  promptVersion: z.string().min(1).optional(),
  messages: z.array(aiPromptMessageSchema).min(1),
  requiredCapabilities: z.array(aiModelCapabilitySchema).default(["TEXT_GENERATION"]),
  allowedProviderIds: z.array(z.string().min(1)).min(1).optional(),
  options: aiProviderRequestOptionsSchema.default({}),
  toolNames: z.array(z.string().min(1)).default([]),
  memoryRefs: z.array(z.string().min(1)).default([]),
  metadata: aiRuntimePayloadSchema.optional(),
  correlation: aiCorrelationMetadataSchema
}).strict();

export type AiPromptRequest = z.infer<typeof aiPromptRequestSchema>;

export const aiTokenUsageSchema = z.object({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  totalTokens: z.number().int().min(0)
}).strict().refine((usage) => usage.totalTokens === usage.inputTokens + usage.outputTokens, {
  message: "totalTokens must equal inputTokens plus outputTokens",
  path: ["totalTokens"]
});

export type AiTokenUsage = z.infer<typeof aiTokenUsageSchema>;

export const aiToolCallSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  arguments: aiRuntimePayloadSchema,
  requiresApproval: z.boolean().default(false)
}).strict();

export type AiToolCall = z.infer<typeof aiToolCallSchema>;

export const aiPromptFinishReasonValues = ["STOP", "LENGTH", "TOOL_CALLS", "CONTENT_FILTER", "ERROR"] as const;
export const aiPromptFinishReasonSchema = z.enum(aiPromptFinishReasonValues);
export type AiPromptFinishReason = z.infer<typeof aiPromptFinishReasonSchema>;

export const aiPromptResponseSchema = z.object({
  tenantId: z.string().min(1),
  agentId: z.string().min(1),
  providerId: z.string().min(1),
  providerKind: aiProviderKindSchema,
  model: z.string().min(1),
  message: aiPromptMessageSchema,
  toolCalls: z.array(aiToolCallSchema).default([]),
  usage: aiTokenUsageSchema,
  finishReason: aiPromptFinishReasonSchema,
  rawResponseRef: z.string().min(1).optional(),
  correlation: aiCorrelationMetadataSchema
}).strict();

export type AiPromptResponse = z.infer<typeof aiPromptResponseSchema>;

export const aiModelDescriptorSchema = z.object({
  providerId: z.string().min(1),
  providerKind: aiProviderKindSchema,
  model: z.string().min(1),
  capabilities: z.array(aiModelCapabilitySchema).min(1),
  maxInputTokens: z.number().int().min(1),
  maxOutputTokens: z.number().int().min(1),
  enabled: z.boolean(),
  priority: z.number().int().min(0),
  costWeight: z.number().min(0)
}).strict();

export type AiModelDescriptor = z.infer<typeof aiModelDescriptorSchema>;

export const aiModelRouteRequestSchema = z.object({
  tenantId: z.string().min(1),
  requiredCapabilities: z.array(aiModelCapabilitySchema).min(1),
  estimatedInputTokens: z.number().int().min(0),
  maxOutputTokens: z.number().int().min(1),
  allowedProviderIds: z.array(z.string().min(1)).min(1).optional(),
  preferredProviderKind: aiProviderKindSchema.optional(),
  correlation: aiCorrelationMetadataSchema
}).strict();

export type AiModelRouteRequest = z.infer<typeof aiModelRouteRequestSchema>;

export const aiModelRouteSchema = z.object({
  tenantId: z.string().min(1),
  providerId: z.string().min(1),
  providerKind: aiProviderKindSchema,
  model: z.string().min(1),
  reason: z.string().min(1),
  capabilities: z.array(aiModelCapabilitySchema).min(1),
  maxInputTokens: z.number().int().min(1),
  maxOutputTokens: z.number().int().min(1)
}).strict();

export type AiModelRoute = z.infer<typeof aiModelRouteSchema>;

export interface AiModelRouter {
  route(request: AiModelRouteRequest): Promise<AiModelRoute>;
}

const hasCapabilities = (
  descriptor: AiModelDescriptor,
  capabilities: readonly AiModelCapability[],
): boolean => capabilities.every((capability) => descriptor.capabilities.includes(capability));

const providerAllowed = (
  descriptor: AiModelDescriptor,
  allowedProviderIds: readonly string[] | undefined,
): boolean => allowedProviderIds === undefined || allowedProviderIds.includes(descriptor.providerId);

const compareModelDescriptors = (left: AiModelDescriptor, right: AiModelDescriptor): number => {
  if (left.priority !== right.priority) {
    return left.priority - right.priority;
  }
  if (left.costWeight !== right.costWeight) {
    return left.costWeight - right.costWeight;
  }
  return `${left.providerId}:${left.model}`.localeCompare(`${right.providerId}:${right.model}`);
};

/**
 * Selects a provider-neutral AI model route deterministically.
 *
 * Algorithm, in order:
 * 1. Validate the request and descriptor contracts.
 * 2. Keep only enabled descriptors permitted by allowedProviderIds.
 * 3. Apply preferredProviderKind when supplied.
 * 4. Require every requested capability and enough input/output token capacity.
 * 5. Sort compatible candidates by priority, then costWeight, then providerId:model.
 *
 * The final lexicographic tie-breaker is intentional so tenants receive a stable
 * route when multiple providers have the same priority and cost. Provider SDK
 * execution and live availability probing stay outside this pure contract helper.
 */
export const routeAiModel = (
  request: AiModelRouteRequest,
  descriptors: readonly AiModelDescriptor[],
): AiModelRoute => {
  const parsedRequest = parseAiRuntimeSchema(aiModelRouteRequestSchema, request, request.correlation);
  const parsedDescriptors = parseAiRuntimeSchema(z.array(aiModelDescriptorSchema), descriptors, parsedRequest.correlation);
  const requiredTotalTokens = parsedRequest.estimatedInputTokens + parsedRequest.maxOutputTokens;
  const candidates = parsedDescriptors
    .filter((descriptor) => descriptor.enabled)
    .filter((descriptor) => providerAllowed(descriptor, parsedRequest.allowedProviderIds))
    .filter((descriptor) => parsedRequest.preferredProviderKind === undefined || descriptor.providerKind === parsedRequest.preferredProviderKind)
    .filter((descriptor) => hasCapabilities(descriptor, parsedRequest.requiredCapabilities))
    .filter((descriptor) => descriptor.maxInputTokens >= parsedRequest.estimatedInputTokens)
    .filter((descriptor) => descriptor.maxOutputTokens >= parsedRequest.maxOutputTokens)
    .sort(compareModelDescriptors);

  const selected = candidates[0];
  if (selected === undefined) {
    throw new AiRuntimeError({
      code: "AI_MODEL_ROUTE_UNSUPPORTED",
      message: "No enabled AI model route satisfies the request",
      status: 422,
      details: {
        requiredCapabilities: parsedRequest.requiredCapabilities,
        requiredTotalTokens,
        allowedProviderIds: parsedRequest.allowedProviderIds,
        preferredProviderKind: parsedRequest.preferredProviderKind
      },
      correlation: parsedRequest.correlation
    });
  }

  return parseAiRuntimeSchema(aiModelRouteSchema, {
    tenantId: parsedRequest.tenantId,
    providerId: selected.providerId,
    providerKind: selected.providerKind,
    model: selected.model,
    reason: "selected-lowest-priority-cost-compatible-model",
    capabilities: selected.capabilities,
    maxInputTokens: selected.maxInputTokens,
    maxOutputTokens: selected.maxOutputTokens
  }, parsedRequest.correlation);
};

export const assertAiModelRouteAllowed = (
  request: AiModelRouteRequest,
  route: AiModelRoute,
): void => {
  const parsedRequest = parseAiRuntimeSchema(aiModelRouteRequestSchema, request, request.correlation);
  const parsedRoute = parseAiRuntimeSchema(aiModelRouteSchema, route, parsedRequest.correlation);
  assertAiTenantIsolation(
    {
      tenantId: parsedRequest.tenantId,
      agentId: "model-router",
      executionId: "model-route-validation",
      mode: "RESPOND",
      correlation: parsedRequest.correlation
    },
    parsedRoute,
  );
  if (!providerAllowed({ ...parsedRoute, enabled: true, priority: 0, costWeight: 0 }, parsedRequest.allowedProviderIds)) {
    throw new AiRuntimeError({
      code: "AI_MODEL_ROUTE_NOT_ALLOWED",
      message: "AI model route uses a provider outside the allowlist",
      status: 403,
      details: { providerId: parsedRoute.providerId, allowedProviderIds: parsedRequest.allowedProviderIds },
      correlation: parsedRequest.correlation
    });
  }
  if (!hasCapabilities({ ...parsedRoute, enabled: true, priority: 0, costWeight: 0 }, parsedRequest.requiredCapabilities)) {
    throw new AiRuntimeError({
      code: "AI_MODEL_ROUTE_UNSUPPORTED",
      message: "AI model route does not support required capabilities",
      status: 422,
      details: { requiredCapabilities: parsedRequest.requiredCapabilities, routeCapabilities: parsedRoute.capabilities },
      correlation: parsedRequest.correlation
    });
  }
};

export interface AiProvider {
  readonly id: string;
  readonly kind: AiProviderKind;
  readonly models: readonly AiModelDescriptor[];
  complete(request: AiPromptRequest, route: AiModelRoute): Promise<AiPromptResponse>;
}

export interface AiTokenAccountingRecord {
  readonly tenantId: string;
  readonly agentId: string;
  readonly providerId: string;
  readonly model: string;
  readonly usage: AiTokenUsage;
  readonly occurredAt: string;
  readonly correlation: AiCorrelationMetadata;
}

export interface AiTokenAccountant {
  estimate(request: AiPromptRequest): Promise<AiTokenUsage>;
  record(record: AiTokenAccountingRecord): Promise<void>;
}

export const aiConversationMemoryItemSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  conversationId: z.string().min(1),
  role: aiPromptRoleSchema,
  content: z.string().min(1),
  createdAt: z.string().datetime(),
  tokenCount: z.number().int().min(0).optional(),
  compressedFromIds: z.array(z.string().min(1)).optional(),
  metadata: aiRuntimePayloadSchema.optional()
}).strict();

export type AiConversationMemoryItem = z.infer<typeof aiConversationMemoryItemSchema>;

export interface AiConversationMemoryReadRequest {
  readonly tenantId: string;
  readonly conversationId: string;
  readonly limit: number;
  readonly correlation: AiCorrelationMetadata;
}

export interface AiConversationMemoryWriteRequest {
  readonly item: AiConversationMemoryItem;
  readonly correlation: AiCorrelationMetadata;
}

export interface AiConversationMemory {
  read(request: AiConversationMemoryReadRequest): Promise<readonly AiConversationMemoryItem[]>;
  append(request: AiConversationMemoryWriteRequest): Promise<AiConversationMemoryItem>;
}

export const aiToolSafetySchema = z.object({
  deterministic: z.literal(true),
  idempotent: z.boolean(),
  networkAccess: z.literal(false),
  approvalPolicy: aiToolApprovalPolicySchema,
  tenantScoped: z.literal(true)
}).strict();

export type AiToolSafety = z.infer<typeof aiToolSafetySchema>;

export const aiToolDefinitionSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  tenantId: z.string().min(1).optional(),
  inputSchema: aiRuntimePayloadSchema,
  outputSchema: aiRuntimePayloadSchema,
  safety: aiToolSafetySchema
}).strict();

export type AiToolDefinition = z.infer<typeof aiToolDefinitionSchema>;

export const aiToolInvocationRequestSchema = z.object({
  tenantId: z.string().min(1),
  toolName: z.string().min(1),
  toolVersion: z.string().min(1),
  invocationId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  arguments: aiRuntimePayloadSchema,
  approvedByActorId: z.string().min(1).optional(),
  correlation: aiCorrelationMetadataSchema
}).strict();

export type AiToolInvocationRequest = z.infer<typeof aiToolInvocationRequestSchema>;

export const aiToolInvocationResultSchema = z.object({
  tenantId: z.string().min(1),
  toolName: z.string().min(1),
  invocationId: z.string().min(1),
  status: z.enum(["SUCCEEDED", "REJECTED"]),
  output: aiRuntimePayloadSchema,
  correlation: aiCorrelationMetadataSchema
}).strict();

export type AiToolInvocationResult = z.infer<typeof aiToolInvocationResultSchema>;

export interface AiToolHandler {
  readonly definition: AiToolDefinition;
  execute(request: AiToolInvocationRequest, context: AiTenantExecutionContext): Promise<AiToolInvocationResult>;
}

const assertToolCanExecute = (
  context: AiTenantExecutionContext,
  definition: AiToolDefinition,
  request: AiToolInvocationRequest,
): void => {
  assertAiTenantIsolation(context, request);
  if (definition.tenantId !== undefined) {
    assertAiTenantIsolation(context, definition);
  }
  if (definition.name !== request.toolName || definition.version !== request.toolVersion) {
    throw new AiRuntimeError({
      code: "AI_TOOL_NOT_FOUND",
      message: "AI tool invocation does not match the registered tool definition",
      status: 404,
      details: {
        toolName: request.toolName,
        toolVersion: request.toolVersion,
        definitionName: definition.name,
        definitionVersion: definition.version
      },
      correlation: context.correlation
    });
  }
  if (definition.safety.deterministic !== true || definition.safety.networkAccess !== false || definition.safety.tenantScoped !== true) {
    throw new AiRuntimeError({
      code: "AI_TOOL_NOT_DETERMINISTIC",
      message: "AI tools must declare deterministic, tenant-scoped, no-network execution boundaries",
      status: 422,
      details: { toolName: definition.name, toolVersion: definition.version },
      correlation: context.correlation
    });
  }
  if (definition.safety.approvalPolicy === "REQUIRED" && request.approvedByActorId === undefined) {
    throw new AiRuntimeError({
      code: "AI_TOOL_APPROVAL_REQUIRED",
      message: "AI tool invocation requires a human approval checkpoint",
      status: 409,
      details: { toolName: definition.name, toolVersion: definition.version },
      correlation: context.correlation
    });
  }
};

export const executeDeterministicAiTool = async (
  handler: AiToolHandler,
  request: AiToolInvocationRequest,
  context: AiTenantExecutionContext,
): Promise<AiToolInvocationResult> => {
  const parsedContext = parseAiRuntimeSchema(aiTenantExecutionContextSchema, context, context.correlation);
  const parsedDefinition = parseAiRuntimeSchema(aiToolDefinitionSchema, handler.definition, parsedContext.correlation);
  const parsedRequest = parseAiRuntimeSchema(aiToolInvocationRequestSchema, request, parsedContext.correlation);
  assertToolCanExecute(parsedContext, parsedDefinition, parsedRequest);
  const result = parseAiRuntimeSchema(aiToolInvocationResultSchema, await handler.execute(parsedRequest, parsedContext), parsedContext.correlation);
  assertAiTenantIsolation(parsedContext, result);
  if (result.toolName !== parsedDefinition.name || result.invocationId !== parsedRequest.invocationId) {
    throw new AiRuntimeError({
      code: "AI_TOOL_EXECUTION_REJECTED",
      message: "AI tool result does not match invocation boundaries",
      status: 409,
      details: {
        toolName: result.toolName,
        expectedToolName: parsedDefinition.name,
        invocationId: result.invocationId,
        expectedInvocationId: parsedRequest.invocationId
      },
      correlation: parsedContext.correlation
    });
  }

  return result;
};

export const aiEventTypeValues = [
  "AI_PROMPT_REQUESTED",
  "AI_MODEL_ROUTED",
  "AI_PROVIDER_COMPLETED",
  "AI_TOOL_REQUESTED",
  "AI_TOOL_COMPLETED",
  "AI_RUNTIME_REJECTED"
] as const;
export const aiEventTypeSchema = z.enum(aiEventTypeValues);
export type AiEventType = z.infer<typeof aiEventTypeSchema>;

export const aiRuntimeEventSchema = z.object({
  type: aiEventTypeSchema,
  tenantId: z.string().min(1),
  agentId: z.string().min(1),
  executionId: z.string().min(1),
  occurredAt: z.string().datetime(),
  payload: aiRuntimePayloadSchema,
  correlation: aiCorrelationMetadataSchema
}).strict();

export type AiRuntimeEvent = z.infer<typeof aiRuntimeEventSchema>;

export interface AiEventLogger {
  emit(event: AiRuntimeEvent): Promise<void>;
}

export const buildAiRuntimeEvent = (
  context: AiTenantExecutionContext,
  type: AiEventType,
  occurredAt: Date,
  payload: AiRuntimePayload = {},
): AiRuntimeEvent => parseAiRuntimeSchema(aiRuntimeEventSchema, {
  type,
  tenantId: context.tenantId,
  agentId: context.agentId,
  executionId: context.executionId,
  occurredAt: occurredAt.toISOString(),
  payload,
  correlation: context.correlation
}, context.correlation);

export const emitAiRuntimeEvent = async (
  logger: AiEventLogger,
  event: AiRuntimeEvent,
): Promise<void> => {
  await logger.emit(parseAiRuntimeSchema(aiRuntimeEventSchema, event, event.correlation));
};
