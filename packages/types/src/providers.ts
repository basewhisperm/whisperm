import { z } from "zod";

export const providerKindValues = [
  "OPENAI",
  "ANTHROPIC",
  "GEMINI",
  "META",
  "LINKEDIN",
  "GMAIL",
  "SENDGRID",
  "WEBHOOK",
  "CUSTOM"
] as const;
export const providerKindSchema = z.enum(providerKindValues);
export type ProviderKind = z.infer<typeof providerKindSchema>;

export const providerDomainValues = ["AI", "EMBEDDING", "SOCIAL", "EMAIL", "WEBHOOK"] as const;
export const providerDomainSchema = z.enum(providerDomainValues);
export type ProviderDomain = z.infer<typeof providerDomainSchema>;

export const providerCapabilityValues = [
  "CHAT_COMPLETIONS",
  "RESPONSES",
  "TEXT_GENERATION",
  "STRUCTURED_OUTPUT",
  "TOOL_CALLING",
  "VISION",
  "EMBEDDINGS",
  "SOCIAL_PUBLISH",
  "SOCIAL_READ",
  "EMAIL_SEND",
  "EMAIL_READ",
  "WEBHOOK_INGEST",
  "WEBHOOK_DELIVER"
] as const;
export const providerCapabilitySchema = z.enum(providerCapabilityValues);
export type ProviderCapability = z.infer<typeof providerCapabilitySchema>;

export const providerAuthSchemeValues = ["API_KEY", "BEARER_TOKEN", "OAUTH2", "WEBHOOK_SIGNATURE", "NONE"] as const;
export const providerAuthSchemeSchema = z.enum(providerAuthSchemeValues);
export type ProviderAuthScheme = z.infer<typeof providerAuthSchemeSchema>;

export const providerSecretRefSchema = z.object({
  secretRef: z.string().min(1),
  version: z.string().min(1).optional()
}).strict();
export type ProviderSecretRef = z.infer<typeof providerSecretRefSchema>;

export const providerAuthConfigSchema = z.object({
  scheme: providerAuthSchemeSchema,
  token: providerSecretRefSchema.optional(),
  apiKey: providerSecretRefSchema.optional(),
  clientId: z.string().min(1).optional(),
  clientSecret: providerSecretRefSchema.optional(),
  scopes: z.array(z.string().min(1)).default([]),
  signingSecret: providerSecretRefSchema.optional()
}).strict().superRefine((value, ctx) => {
  if (value.scheme === "API_KEY" && value.apiKey === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "API_KEY auth requires an apiKey secret reference", path: ["apiKey"] });
  }
  if (value.scheme === "BEARER_TOKEN" && value.token === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "BEARER_TOKEN auth requires a token secret reference", path: ["token"] });
  }
  if (value.scheme === "OAUTH2" && (value.clientId === undefined || value.clientSecret === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "OAUTH2 auth requires clientId and clientSecret reference", path: ["clientSecret"] });
  }
  if (value.scheme === "WEBHOOK_SIGNATURE" && value.signingSecret === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "WEBHOOK_SIGNATURE auth requires a signingSecret reference", path: ["signingSecret"] });
  }
});
export type ProviderAuthConfig = z.infer<typeof providerAuthConfigSchema>;

export const providerRateLimitWindowSchema = z.object({
  limit: z.number().int().positive(),
  intervalMs: z.number().int().positive()
}).strict();
export type ProviderRateLimitWindow = z.infer<typeof providerRateLimitWindowSchema>;

export const providerRateLimitConfigSchema = z.object({
  requests: providerRateLimitWindowSchema.optional(),
  tokens: providerRateLimitWindowSchema.optional(),
  concurrency: z.number().int().positive().optional(),
  retryAfterMs: z.number().int().nonnegative().optional()
}).strict().refine((value) => value.requests !== undefined || value.tokens !== undefined || value.concurrency !== undefined, {
  message: "At least one rate limit dimension is required"
});
export type ProviderRateLimitConfig = z.infer<typeof providerRateLimitConfigSchema>;

export const providerHealthStatusValues = ["HEALTHY", "DEGRADED", "UNHEALTHY", "UNKNOWN"] as const;
export const providerHealthStatusSchema = z.enum(providerHealthStatusValues);
export type ProviderHealthStatus = z.infer<typeof providerHealthStatusSchema>;

export const providerHealthSchema = z.object({
  status: providerHealthStatusSchema,
  checkedAt: z.string().datetime(),
  latencyMs: z.number().int().nonnegative().optional(),
  message: z.string().min(1).optional(),
  correlationId: z.string().min(1).optional()
}).strict();
export type ProviderHealth = z.infer<typeof providerHealthSchema>;

export const providerErrorCodeValues = [
  "PROVIDER_TENANT_CONTEXT_MISSING",
  "PROVIDER_TENANT_MISMATCH",
  "PROVIDER_CONFIG_INVALID",
  "PROVIDER_AUTH_INVALID",
  "PROVIDER_CAPABILITY_UNSUPPORTED",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_TIMEOUT",
  "PROVIDER_RESPONSE_INVALID",
  "PROVIDER_NORMALIZATION_FAILED"
] as const;
export const providerErrorCodeSchema = z.enum(providerErrorCodeValues);
export type ProviderErrorCode = z.infer<typeof providerErrorCodeSchema>;

export const providerErrorModelSchema = z.object({
  code: providerErrorCodeSchema,
  message: z.string().min(1),
  status: z.number().int().min(400).max(599),
  providerKind: providerKindSchema.optional(),
  providerId: z.string().min(1).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  correlationId: z.string().min(1).optional()
}).strict();
export type ProviderErrorModel = z.infer<typeof providerErrorModelSchema>;

export interface ProviderErrorInput {
  readonly code: ProviderErrorCode;
  readonly message: string;
  readonly status: number;
  readonly providerKind?: ProviderKind | undefined;
  readonly providerId?: string | undefined;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
  readonly correlationId?: string | undefined;
}

export class ProviderRuntimeError extends Error {
  readonly code: ProviderErrorCode;
  readonly status: number;
  readonly providerKind?: ProviderKind | undefined;
  readonly providerId?: string | undefined;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
  readonly correlationId?: string | undefined;

  constructor(input: ProviderErrorInput) {
    super(input.message);
    this.name = "ProviderRuntimeError";
    this.code = input.code;
    this.status = input.status;
    this.providerKind = input.providerKind;
    this.providerId = input.providerId;
    this.details = input.details;
    this.correlationId = input.correlationId;
    Object.setPrototypeOf(this, ProviderRuntimeError.prototype);
  }

  toErrorModel(): ProviderErrorModel {
    return providerErrorModelSchema.parse({
      code: this.code,
      message: this.message,
      status: this.status,
      providerKind: this.providerKind,
      providerId: this.providerId,
      details: this.details,
      correlationId: this.correlationId
    });
  }
}

export const providerDescriptorSchema = z.object({
  tenantId: z.string().min(1),
  providerId: z.string().min(1),
  kind: providerKindSchema,
  domain: providerDomainSchema,
  displayName: z.string().min(1),
  enabled: z.boolean(),
  capabilities: z.array(providerCapabilitySchema).min(1),
  auth: providerAuthConfigSchema,
  rateLimit: providerRateLimitConfigSchema.optional(),
  health: providerHealthSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
}).strict();
export type ProviderDescriptor = z.infer<typeof providerDescriptorSchema>;

export const providerExecutionContextSchema = z.object({
  tenantId: z.string().min(1),
  providerId: z.string().min(1),
  providerKind: providerKindSchema,
  operation: z.string().min(1),
  correlationId: z.string().min(1),
  actorId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional()
}).strict();
export type ProviderExecutionContext = z.infer<typeof providerExecutionContextSchema>;

export interface ProviderTenantScoped {
  readonly tenantId?: string | undefined;
  readonly providerId?: string | undefined;
}

const providerValidationIssues = (error: z.ZodError): Array<{ path: string; message: string; code: string }> => error.issues.map((issue) => ({
  path: issue.path.join("."),
  message: issue.message,
  code: issue.code
}));

export const parseProviderContract = <T>(schema: z.ZodType<T>, input: unknown, context?: Pick<ProviderExecutionContext, "correlationId" | "providerId" | "providerKind">): T => {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ProviderRuntimeError({
      code: "PROVIDER_CONFIG_INVALID",
      message: "Provider contract validation failed",
      status: 400,
      providerKind: context?.providerKind,
      providerId: context?.providerId,
      correlationId: context?.correlationId,
      details: { issues: providerValidationIssues(result.error) }
    });
  }

  return result.data;
};


const parseProviderResponseContract = <T>(schema: z.ZodType<T>, input: unknown, context: Pick<ProviderExecutionContext, "correlationId" | "providerId" | "providerKind">): T => {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ProviderRuntimeError({
      code: "PROVIDER_NORMALIZATION_FAILED",
      message: "Provider response normalization failed",
      status: 502,
      providerKind: context.providerKind,
      providerId: context.providerId,
      correlationId: context.correlationId,
      details: { issues: providerValidationIssues(result.error) }
    });
  }

  return result.data;
};

export const assertProviderTenantIsolation = (context: ProviderExecutionContext, tenantScoped: ProviderTenantScoped): void => {
  const parsedContext = parseProviderContract(providerExecutionContextSchema, context, context);
  if (tenantScoped.tenantId === undefined || tenantScoped.tenantId.trim().length === 0) {
    throw new ProviderRuntimeError({
      code: "PROVIDER_TENANT_CONTEXT_MISSING",
      message: "Provider execution requires explicit tenant context",
      status: 403,
      providerKind: parsedContext.providerKind,
      providerId: parsedContext.providerId,
      correlationId: parsedContext.correlationId
    });
  }
  if (parsedContext.tenantId !== tenantScoped.tenantId) {
    throw new ProviderRuntimeError({
      code: "PROVIDER_TENANT_MISMATCH",
      message: "Provider execution tenant context mismatch",
      status: 403,
      providerKind: parsedContext.providerKind,
      providerId: parsedContext.providerId,
      correlationId: parsedContext.correlationId,
      details: { expectedTenantId: parsedContext.tenantId, actualTenantId: tenantScoped.tenantId }
    });
  }
  if (tenantScoped.providerId !== undefined && parsedContext.providerId !== tenantScoped.providerId) {
    throw new ProviderRuntimeError({
      code: "PROVIDER_TENANT_MISMATCH",
      message: "Provider execution provider context mismatch",
      status: 403,
      providerKind: parsedContext.providerKind,
      providerId: parsedContext.providerId,
      correlationId: parsedContext.correlationId,
      details: { expectedProviderId: parsedContext.providerId, actualProviderId: tenantScoped.providerId }
    });
  }
};

export const assertProviderCapability = (descriptor: ProviderDescriptor, capability: ProviderCapability, context: ProviderExecutionContext): void => {
  assertProviderTenantIsolation(context, descriptor);
  if (!descriptor.enabled || !descriptor.capabilities.includes(capability)) {
    throw new ProviderRuntimeError({
      code: "PROVIDER_CAPABILITY_UNSUPPORTED",
      message: "Provider capability is not enabled for this tenant provider",
      status: 422,
      providerKind: descriptor.kind,
      providerId: descriptor.providerId,
      correlationId: context.correlationId,
      details: { capability }
    });
  }
};

export const providerMessageRoleValues = ["SYSTEM", "USER", "ASSISTANT", "TOOL"] as const;
export const providerMessageRoleSchema = z.enum(providerMessageRoleValues);
export type ProviderMessageRole = z.infer<typeof providerMessageRoleSchema>;

export const providerMessageSchema = z.object({
  role: providerMessageRoleSchema,
  content: z.string().min(1),
  name: z.string().min(1).optional()
}).strict();
export type ProviderMessage = z.infer<typeof providerMessageSchema>;

export const aiProviderRequestSchema = z.object({
  tenantId: z.string().min(1),
  providerId: z.string().min(1),
  model: z.string().min(1),
  messages: z.array(providerMessageSchema).min(1),
  responseFormat: z.enum(["TEXT", "JSON_OBJECT"]).default("TEXT"),
  maxOutputTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
}).strict();
export type AiProviderRequest = z.infer<typeof aiProviderRequestSchema>;

export const aiProviderResponseSchema = z.object({
  tenantId: z.string().min(1),
  providerId: z.string().min(1),
  providerKind: providerKindSchema,
  model: z.string().min(1),
  content: z.string(),
  finishReason: z.enum(["STOP", "LENGTH", "TOOL_CALL", "CONTENT_FILTER", "UNKNOWN"]),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative()
  }).strict().refine((value) => value.totalTokens === value.inputTokens + value.outputTokens, {
    message: "totalTokens must equal inputTokens plus outputTokens",
    path: ["totalTokens"]
  }),
  rawResponseId: z.string().min(1).optional(),
  correlationId: z.string().min(1)
}).strict();
export type AiProviderResponse = z.infer<typeof aiProviderResponseSchema>;

export interface AiProviderAdapter {
  readonly descriptor: ProviderDescriptor;
  generate(request: AiProviderRequest, context: ProviderExecutionContext): Promise<AiProviderResponse>;
  health(context: ProviderExecutionContext): Promise<ProviderHealth>;
}

export const openAiCompatibleRequestSchema = aiProviderRequestSchema.extend({
  compatibility: z.literal("OPENAI_COMPATIBLE"),
  endpointPath: z.enum(["/v1/chat/completions", "/v1/responses"]).default("/v1/chat/completions")
}).strict();
export type OpenAiCompatibleRequest = z.infer<typeof openAiCompatibleRequestSchema>;

export const openAiCompatibleResponseSchema = aiProviderResponseSchema.extend({
  providerKind: z.enum(["OPENAI", "GEMINI", "CUSTOM"]),
  compatibility: z.literal("OPENAI_COMPATIBLE")
}).strict();
export type OpenAiCompatibleResponse = z.infer<typeof openAiCompatibleResponseSchema>;

export interface OpenAiCompatibleAdapterContract extends AiProviderAdapter {
  generate(request: OpenAiCompatibleRequest, context: ProviderExecutionContext): Promise<OpenAiCompatibleResponse>;
}

export const anthropicCompatibleRequestSchema = aiProviderRequestSchema.extend({
  compatibility: z.literal("ANTHROPIC_COMPATIBLE"),
  anthropicVersion: z.string().min(1)
}).strict();
export type AnthropicCompatibleRequest = z.infer<typeof anthropicCompatibleRequestSchema>;

export const anthropicCompatibleResponseSchema = aiProviderResponseSchema.extend({
  providerKind: z.enum(["ANTHROPIC", "CUSTOM"]),
  compatibility: z.literal("ANTHROPIC_COMPATIBLE")
}).strict();
export type AnthropicCompatibleResponse = z.infer<typeof anthropicCompatibleResponseSchema>;

export interface AnthropicCompatibleAdapterContract extends AiProviderAdapter {
  generate(request: AnthropicCompatibleRequest, context: ProviderExecutionContext): Promise<AnthropicCompatibleResponse>;
}

export const embeddingProviderRequestSchema = z.object({
  tenantId: z.string().min(1),
  providerId: z.string().min(1),
  model: z.string().min(1),
  input: z.array(z.string().min(1)).min(1),
  dimensions: z.number().int().positive().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
}).strict();
export type EmbeddingProviderRequest = z.infer<typeof embeddingProviderRequestSchema>;

export const providerEmbeddingVectorSchema = z.array(z.number().finite()).min(1);
export const embeddingProviderResponseSchema = z.object({
  tenantId: z.string().min(1),
  providerId: z.string().min(1),
  model: z.string().min(1),
  embeddings: z.array(providerEmbeddingVectorSchema).min(1),
  usage: z.object({ inputTokens: z.number().int().nonnegative() }).strict(),
  correlationId: z.string().min(1)
}).strict();
export type EmbeddingProviderResponse = z.infer<typeof embeddingProviderResponseSchema>;

export interface EmbeddingProviderAdapter {
  readonly descriptor: ProviderDescriptor;
  embed(request: EmbeddingProviderRequest, context: ProviderExecutionContext): Promise<EmbeddingProviderResponse>;
  health(context: ProviderExecutionContext): Promise<ProviderHealth>;
}

export const socialProviderActionValues = ["PUBLISH_POST", "READ_PROFILE", "READ_MESSAGES"] as const;
export const socialProviderActionSchema = z.enum(socialProviderActionValues);
export type SocialProviderAction = z.infer<typeof socialProviderActionSchema>;

export const socialProviderRequestSchema = z.object({
  tenantId: z.string().min(1),
  providerId: z.string().min(1),
  action: socialProviderActionSchema,
  accountRef: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({})
}).strict();
export type SocialProviderRequest = z.infer<typeof socialProviderRequestSchema>;

export const socialProviderResponseSchema = z.object({
  tenantId: z.string().min(1),
  providerId: z.string().min(1),
  providerKind: z.enum(["META", "LINKEDIN", "CUSTOM"]),
  externalId: z.string().min(1).optional(),
  status: z.enum(["ACCEPTED", "SUCCEEDED", "FAILED"]),
  normalized: z.record(z.string(), z.unknown()).default({}),
  correlationId: z.string().min(1)
}).strict();
export type SocialProviderResponse = z.infer<typeof socialProviderResponseSchema>;

export interface SocialProviderAdapter {
  readonly descriptor: ProviderDescriptor;
  execute(request: SocialProviderRequest, context: ProviderExecutionContext): Promise<SocialProviderResponse>;
  health(context: ProviderExecutionContext): Promise<ProviderHealth>;
}

export const metaProviderContractSchema = providerDescriptorSchema.extend({
  kind: z.literal("META"),
  domain: z.literal("SOCIAL"),
  capabilities: z.array(z.enum(["SOCIAL_PUBLISH", "SOCIAL_READ", "WEBHOOK_INGEST"])).min(1)
}).strict();
export type MetaProviderContract = z.infer<typeof metaProviderContractSchema>;

export const linkedInProviderContractSchema = providerDescriptorSchema.extend({
  kind: z.literal("LINKEDIN"),
  domain: z.literal("SOCIAL"),
  capabilities: z.array(z.enum(["SOCIAL_PUBLISH", "SOCIAL_READ", "WEBHOOK_INGEST"])).min(1)
}).strict();
export type LinkedInProviderContract = z.infer<typeof linkedInProviderContractSchema>;

export const emailProviderContractSchema = providerDescriptorSchema.extend({
  kind: z.enum(["GMAIL", "SENDGRID", "CUSTOM"]),
  domain: z.literal("EMAIL"),
  capabilities: z.array(z.enum(["EMAIL_SEND", "EMAIL_READ", "WEBHOOK_INGEST"])).min(1)
}).strict();
export type EmailProviderContract = z.infer<typeof emailProviderContractSchema>;

export const webhookProviderContractSchema = providerDescriptorSchema.extend({
  kind: z.enum(["WEBHOOK", "CUSTOM"]),
  domain: z.literal("WEBHOOK"),
  capabilities: z.array(z.enum(["WEBHOOK_INGEST", "WEBHOOK_DELIVER"])).min(1)
}).strict();
export type WebhookProviderContract = z.infer<typeof webhookProviderContractSchema>;

export const normalizeProviderTextResponse = (input: {
  readonly tenantId: string;
  readonly providerId: string;
  readonly providerKind: ProviderKind;
  readonly model: string;
  readonly content?: string | null | undefined;
  readonly finishReason?: string | null | undefined;
  readonly inputTokens?: number | null | undefined;
  readonly outputTokens?: number | null | undefined;
  readonly rawResponseId?: string | null | undefined;
  readonly correlationId: string;
}): AiProviderResponse => {
  const inputTokens = input.inputTokens ?? 0;
  const outputTokens = input.outputTokens ?? 0;
  const finishReasonMap: Record<string, AiProviderResponse["finishReason"]> = {
    stop: "STOP",
    end_turn: "STOP",
    length: "LENGTH",
    max_tokens: "LENGTH",
    tool_calls: "TOOL_CALL",
    tool_use: "TOOL_CALL",
    content_filter: "CONTENT_FILTER"
  };
  const normalizedFinishReason = finishReasonMap[(input.finishReason ?? "unknown").toLowerCase()] ?? "UNKNOWN";

  return parseProviderResponseContract(aiProviderResponseSchema, {
    tenantId: input.tenantId,
    providerId: input.providerId,
    providerKind: input.providerKind,
    model: input.model,
    content: input.content ?? "",
    finishReason: normalizedFinishReason,
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
    rawResponseId: input.rawResponseId ?? undefined,
    correlationId: input.correlationId
  }, {
    providerKind: input.providerKind,
    providerId: input.providerId,
    correlationId: input.correlationId
  });
};

export const normalizeEmbeddingResponse = (input: {
  readonly tenantId: string;
  readonly providerId: string;
  readonly providerKind?: ProviderKind | undefined;
  readonly model: string;
  readonly embeddings: ReadonlyArray<ReadonlyArray<number>>;
  readonly inputTokens?: number | null | undefined;
  readonly correlationId: string;
}): EmbeddingProviderResponse => parseProviderResponseContract(embeddingProviderResponseSchema, {
  tenantId: input.tenantId,
  providerId: input.providerId,
  model: input.model,
  embeddings: input.embeddings.map((embedding) => [...embedding]),
  usage: { inputTokens: input.inputTokens ?? 0 },
  correlationId: input.correlationId
}, {
  providerKind: input.providerKind ?? "CUSTOM",
  providerId: input.providerId,
  correlationId: input.correlationId
});
