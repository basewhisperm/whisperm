import {
  AiModelRoute,
  AiModelRouteRequest,
  AiModelRouter,
  AiPromptRequest,
  AiPromptResponse,
  AiRuntimeError,
  AiTokenAccountant,
  AiTokenUsage,
  EmbeddingProviderRequest,
  EmbeddingProviderResponse,
  ProviderDescriptor,
  ProviderExecutionContext,
  ProviderHealth,
  ProviderKind,
  ProviderRuntimeError,
  assertAiModelRouteAllowed,
  assertProviderCapability,
  assertProviderTenantIsolation,
  normalizeEmbeddingResponse,
  normalizeProviderTextResponse,
  providerDescriptorSchema,
} from "@whisperm/types";

export interface ProviderConfigurationLoadRequest {
  readonly tenantId: string;
  readonly providerId: string;
  readonly correlationId: string;
}

export interface ProviderConfigurationLoader {
  loadProviderConfiguration(request: ProviderConfigurationLoadRequest): Promise<ProviderDescriptor>;
}

export interface SecretReferenceResolveRequest {
  readonly tenantId: string;
  readonly providerId: string;
  readonly providerKind: ProviderKind;
  readonly secretRef: string;
  readonly version?: string | undefined;
  readonly correlationId: string;
}

export interface ResolvedSecret {
  readonly value: string;
  readonly expiresAt?: string | undefined;
}

export interface SecretReferenceResolver {
  resolveSecretReference(request: SecretReferenceResolveRequest): Promise<ResolvedSecret>;
}

export interface ProviderTelemetryStartEvent {
  readonly tenantId: string;
  readonly providerId: string;
  readonly providerKind: ProviderKind;
  readonly model: string;
  readonly operation: string;
  readonly correlationId: string;
}

export interface ProviderTelemetryCompleteEvent extends ProviderTelemetryStartEvent {
  readonly usage: AiTokenUsage;
  readonly durationMs: number;
}

export interface ProviderTelemetryErrorEvent extends ProviderTelemetryStartEvent {
  readonly code: string;
  readonly status: number;
  readonly durationMs: number;
}

export interface ProviderTelemetryHook {
  onProviderStart(event: ProviderTelemetryStartEvent): void | Promise<void>;
  onProviderComplete(event: ProviderTelemetryCompleteEvent): void | Promise<void>;
  onProviderError(event: ProviderTelemetryErrorEvent): void | Promise<void>;
}

export interface ProviderRetryPolicy {
  readonly maxAttempts: number;
  shouldRetry(error: ProviderRuntimeError, attempt: number): boolean;
  nextDelayMs(error: ProviderRuntimeError, attempt: number): number;
}

export interface ProviderTimeoutPolicy {
  readonly timeoutMs: number;
}

export interface ProviderCircuitBreaker {
  canExecute(context: ProviderExecutionContext): Promise<boolean>;
  recordSuccess(context: ProviderExecutionContext): Promise<void>;
  recordFailure(context: ProviderExecutionContext, error: ProviderRuntimeError): Promise<void>;
}

export interface ProviderReliabilityContracts {
  readonly retryPolicy?: ProviderRetryPolicy | undefined;
  readonly timeoutPolicy?: ProviderTimeoutPolicy | undefined;
  readonly circuitBreaker?: ProviderCircuitBreaker | undefined;
}

export interface ProviderSdkMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
  readonly name?: string | undefined;
}

export interface ProviderSdkBaseRequest {
  readonly tenantId: string;
  readonly providerId: string;
  readonly providerKind: ProviderKind;
  readonly model: string;
  readonly apiKey: string;
  readonly correlationId: string;
}

export interface ProviderSdkTextRequest extends ProviderSdkBaseRequest {
  readonly messages: readonly ProviderSdkMessage[];
  readonly responseFormat: "TEXT" | "JSON_OBJECT";
  readonly maxOutputTokens?: number | undefined;
  readonly temperature?: number | undefined;
  readonly anthropicVersion?: string | undefined;
}

export interface ProviderSdkTextResponse {
  readonly id?: string | undefined;
  readonly content?: string | null | undefined;
  readonly finishReason?: string | null | undefined;
  readonly inputTokens?: number | null | undefined;
  readonly outputTokens?: number | null | undefined;
}

export interface ProviderSdkEmbeddingRequest extends ProviderSdkBaseRequest {
  readonly inputs: readonly string[];
  readonly dimensions?: number | undefined;
}

export interface ProviderSdkEmbeddingResponse {
  readonly embeddings: ReadonlyArray<ReadonlyArray<number>>;
  readonly inputTokens?: number | null | undefined;
}

export interface ProviderSdkHealthRequest extends ProviderSdkBaseRequest {
  readonly timeoutMs?: number | undefined;
}

export interface ProviderSdkHealthResponse {
  readonly status: ProviderHealth["status"];
  readonly latencyMs?: number | undefined;
  readonly message?: string | undefined;
}

export interface ProviderTextTransport {
  sendText(request: ProviderSdkTextRequest): Promise<ProviderSdkTextResponse>;
  sendEmbedding?(request: ProviderSdkEmbeddingRequest): Promise<ProviderSdkEmbeddingResponse>;
  checkHealth?(request: ProviderSdkHealthRequest): Promise<ProviderSdkHealthResponse>;
}

export interface ProviderAdapterDependencies {
  readonly secretResolver: SecretReferenceResolver;
  readonly transport: ProviderTextTransport;
  readonly telemetry?: ProviderTelemetryHook | undefined;
  readonly reliability?: ProviderReliabilityContracts | undefined;
  readonly now?: (() => Date) | undefined;
  readonly sleep?: ((durationMs: number) => Promise<void>) | undefined;
}

export interface ProviderAdapterRegistry {
  getAdapter(providerId: string): ProviderTextGenerationAdapter | undefined;
}

export interface ProviderExecutionRuntimeDependencies {
  readonly router: AiModelRouter;
  readonly accountant: AiTokenAccountant;
  readonly configLoader: ProviderConfigurationLoader;
  readonly registry: ProviderAdapterRegistry;
  readonly now?: (() => Date) | undefined;
}

type ProviderAdapterCompatibility = "openai" | "anthropic" | "gemini";

const providerKindCompatibility: Record<ProviderAdapterCompatibility, ProviderKind> = {
  openai: "OPENAI",
  anthropic: "ANTHROPIC",
  gemini: "GEMINI",
};

const textGenerationCapabilities = ["TEXT_GENERATION"] as const;
const structuredOutputCapabilities = ["TEXT_GENERATION", "STRUCTURED_OUTPUT"] as const;
const embeddingCapabilities = ["EMBEDDINGS"] as const;

const failClosed = (input: {
  readonly code: "PROVIDER_AUTH_INVALID" | "PROVIDER_CAPABILITY_UNSUPPORTED" | "PROVIDER_UNAVAILABLE" | "PROVIDER_TIMEOUT" | "PROVIDER_RESPONSE_INVALID";
  readonly message: string;
  readonly status: number;
  readonly context: ProviderExecutionContext;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
}): ProviderRuntimeError => new ProviderRuntimeError({
  code: input.code,
  message: input.message,
  status: input.status,
  providerKind: input.context.providerKind,
  providerId: input.context.providerId,
  correlationId: input.context.correlationId,
  details: input.details,
});

const parseDescriptor = (descriptor: ProviderDescriptor): ProviderDescriptor => providerDescriptorSchema.parse(descriptor);

const requireTenantContext = (context: ProviderExecutionContext): void => {
  if (context.tenantId.trim().length === 0) {
    throw failClosed({
      code: "PROVIDER_AUTH_INVALID",
      message: "Provider execution requires tenant context before resolving secrets",
      status: 403,
      context,
    });
  }
};

const requireSecretRef = (descriptor: ProviderDescriptor, context: ProviderExecutionContext): string => {
  const secretRef = descriptor.auth.apiKey?.secretRef ?? descriptor.auth.token?.secretRef;
  if (secretRef === undefined || secretRef.trim().length === 0) {
    throw failClosed({
      code: "PROVIDER_AUTH_INVALID",
      message: "Provider execution requires a secret reference",
      status: 403,
      context,
    });
  }
  return secretRef;
};

const mapMessages = (request: AiPromptRequest): readonly ProviderSdkMessage[] => request.messages.map((message) => ({
  role: message.role.toLowerCase() === "developer" ? "system" : message.role.toLowerCase() as ProviderSdkMessage["role"],
  content: message.content,
  name: message.name,
}));

const anthropicVersionFor = (descriptor: ProviderDescriptor): string | undefined => {
  const configuredVersion = descriptor.metadata?.["anthropicVersion"];
  return descriptor.kind === "ANTHROPIC" && typeof configuredVersion === "string" && configuredVersion.trim().length > 0
    ? configuredVersion
    : undefined;
};

export const normalizeProviderAdapterError = (error: unknown, context: ProviderExecutionContext): ProviderRuntimeError => {
  if (error instanceof ProviderRuntimeError) {
    return error;
  }
  if (error instanceof AiRuntimeError) {
    return failClosed({
      code: error.code === "AI_MODEL_ROUTE_UNSUPPORTED" || error.code === "AI_MODEL_ROUTE_NOT_ALLOWED" ? "PROVIDER_CAPABILITY_UNSUPPORTED" : "PROVIDER_RESPONSE_INVALID",
      message: error.message,
      status: error.status,
      context,
      details: error.details,
    });
  }
  if (error instanceof Error && error.name === "AbortError") {
    return failClosed({ code: "PROVIDER_TIMEOUT", message: "Provider request timed out", status: 504, context });
  }
  return failClosed({
    code: "PROVIDER_UNAVAILABLE",
    message: "Provider transport failed",
    status: 502,
    context,
  });
};

const withTimeout = async <T>(promise: Promise<T>, policy: ProviderTimeoutPolicy | undefined, context: ProviderExecutionContext): Promise<T> => {
  if (policy === undefined) {
    return promise;
  }
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(failClosed({ code: "PROVIDER_TIMEOUT", message: "Provider request timed out", status: 504, context }));
    }, policy.timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
};

export class ProviderTextGenerationAdapter {
  readonly descriptor: ProviderDescriptor;
  private readonly dependencies: ProviderAdapterDependencies;
  private readonly compatibility: ProviderAdapterCompatibility;

  constructor(descriptor: ProviderDescriptor, compatibility: ProviderAdapterCompatibility, dependencies: ProviderAdapterDependencies) {
    this.descriptor = parseDescriptor(descriptor);
    this.dependencies = dependencies;
    this.compatibility = compatibility;
  }

  async generate(request: AiPromptRequest, route: AiModelRoute): Promise<AiPromptResponse> {
    const context = this.buildContext(request, route);
    const startedAt = this.dependencies.now?.() ?? new Date();
    await this.dependencies.telemetry?.onProviderStart({
      tenantId: request.tenantId,
      providerId: route.providerId,
      providerKind: this.descriptor.kind,
      model: route.model,
      operation: context.operation,
      correlationId: context.correlationId,
    });

    try {
      const response = await this.executeWithReliability(request, route, context);
      await this.dependencies.telemetry?.onProviderComplete({
        tenantId: response.tenantId,
        providerId: response.providerId,
        providerKind: this.descriptor.kind,
        model: response.model,
        operation: context.operation,
        correlationId: context.correlationId,
        usage: response.usage,
        durationMs: this.durationMs(startedAt),
      });
      await this.dependencies.reliability?.circuitBreaker?.recordSuccess(context);
      return response;
    } catch (error) {
      const normalized = normalizeProviderAdapterError(error, context);
      await this.dependencies.reliability?.circuitBreaker?.recordFailure(context, normalized);
      await this.dependencies.telemetry?.onProviderError({
        tenantId: context.tenantId,
        providerId: context.providerId,
        providerKind: context.providerKind,
        model: route.model,
        operation: context.operation,
        correlationId: context.correlationId,
        code: normalized.code,
        status: normalized.status,
        durationMs: this.durationMs(startedAt),
      });
      throw normalized;
    }
  }

  async embed(request: EmbeddingProviderRequest, context: ProviderExecutionContext): Promise<EmbeddingProviderResponse> {
    const operationContext = this.withOperation(context, `${this.compatibility}.embed`);
    const response = await this.executeEmbeddingWithReliability(request, operationContext);
    return response;
  }

  async health(context: ProviderExecutionContext): Promise<ProviderHealth> {
    const operationContext = this.withOperation(context, `${this.compatibility}.health`);
    this.assertCompatibleContext(operationContext);
    assertProviderTenantIsolation(operationContext, this.descriptor);
    if (!this.descriptor.enabled) {
      return {
        status: "UNHEALTHY",
        checkedAt: (this.dependencies.now?.() ?? new Date()).toISOString(),
        message: "Provider is disabled",
        correlationId: operationContext.correlationId,
      };
    }

    if (this.dependencies.transport.checkHealth === undefined) {
      return {
        status: "UNKNOWN",
        checkedAt: (this.dependencies.now?.() ?? new Date()).toISOString(),
        correlationId: operationContext.correlationId,
      };
    }

    try {
      const secret = await this.resolveCredential(operationContext);
      const startedAt = this.dependencies.now?.() ?? new Date();
      const health = await withTimeout(this.dependencies.transport.checkHealth({
        tenantId: operationContext.tenantId,
        providerId: operationContext.providerId,
        providerKind: operationContext.providerKind,
        model: this.healthCheckModel(),
        apiKey: secret,
        correlationId: operationContext.correlationId,
        timeoutMs: this.dependencies.reliability?.timeoutPolicy?.timeoutMs,
      }), this.dependencies.reliability?.timeoutPolicy, operationContext);
      return {
        status: health.status,
        checkedAt: (this.dependencies.now?.() ?? new Date()).toISOString(),
        latencyMs: health.latencyMs ?? this.durationMs(startedAt),
        message: health.message,
        correlationId: operationContext.correlationId,
      };
    } catch (error) {
      const normalized = normalizeProviderAdapterError(error, operationContext);
      return {
        status: normalized.code === "PROVIDER_TIMEOUT" ? "DEGRADED" : "UNHEALTHY",
        checkedAt: (this.dependencies.now?.() ?? new Date()).toISOString(),
        message: normalized.message,
        correlationId: operationContext.correlationId,
      };
    }
  }

  private buildContext(request: AiPromptRequest, route: AiModelRoute): ProviderExecutionContext {
    return {
      tenantId: request.tenantId,
      providerId: route.providerId,
      providerKind: this.descriptor.kind,
      operation: `${this.compatibility}.generate`,
      correlationId: request.correlation.correlationId,
      actorId: request.agentId,
    };
  }

  private withOperation(context: ProviderExecutionContext, operation: string): ProviderExecutionContext {
    return { ...context, operation };
  }

  private assertCompatibleContext(context: ProviderExecutionContext): void {
    if (this.descriptor.kind !== providerKindCompatibility[this.compatibility] || context.providerKind !== this.descriptor.kind || context.providerId !== this.descriptor.providerId) {
      throw failClosed({
        code: "PROVIDER_AUTH_INVALID",
        message: "Provider adapter context does not match descriptor",
        status: 403,
        context,
      });
    }
  }

  private requiredTextCapabilities(request: AiPromptRequest): typeof structuredOutputCapabilities | typeof textGenerationCapabilities {
    return request.options.responseFormat === "JSON_OBJECT" ? structuredOutputCapabilities : textGenerationCapabilities;
  }

  private healthCheckModel(): string {
    const configuredModel = this.descriptor.metadata?.["healthCheckModel"];
    return typeof configuredModel === "string" && configuredModel.trim().length > 0 ? configuredModel : "provider-health-check";
  }

  private async resolveCredential(context: ProviderExecutionContext): Promise<string> {
    requireTenantContext(context);
    assertProviderTenantIsolation(context, this.descriptor);
    const secretRef = requireSecretRef(this.descriptor, context);
    const resolvedSecret = await this.dependencies.secretResolver.resolveSecretReference({
      tenantId: context.tenantId,
      providerId: context.providerId,
      providerKind: context.providerKind,
      secretRef,
      version: this.descriptor.auth.apiKey?.version ?? this.descriptor.auth.token?.version,
      correlationId: context.correlationId,
    });
    if (resolvedSecret.value.trim().length === 0) {
      throw failClosed({ code: "PROVIDER_AUTH_INVALID", message: "Provider secret resolution returned an empty credential", status: 403, context });
    }
    return resolvedSecret.value;
  }

  private async executeWithReliability(request: AiPromptRequest, route: AiModelRoute, context: ProviderExecutionContext): Promise<AiPromptResponse> {
    const breaker = this.dependencies.reliability?.circuitBreaker;
    if (breaker !== undefined && !(await breaker.canExecute(context))) {
      throw failClosed({ code: "PROVIDER_UNAVAILABLE", message: "Provider circuit is open", status: 503, context });
    }

    const retryPolicy = this.dependencies.reliability?.retryPolicy;
    const maxAttempts = retryPolicy?.maxAttempts ?? 1;
    let attempt = 1;
    while (attempt <= maxAttempts) {
      try {
        return await withTimeout(this.executeOnce(request, route, context), this.dependencies.reliability?.timeoutPolicy, context);
      } catch (error) {
        const normalized = normalizeProviderAdapterError(error, context);
        if (retryPolicy === undefined || attempt >= maxAttempts || !retryPolicy.shouldRetry(normalized, attempt)) {
          throw normalized;
        }
        const sleep = this.dependencies.sleep ?? ((durationMs: number) => new Promise<void>((resolve) => setTimeout(resolve, durationMs)));
        await sleep(retryPolicy.nextDelayMs(normalized, attempt));
        attempt += 1;
      }
    }
    throw failClosed({ code: "PROVIDER_UNAVAILABLE", message: "Provider retry policy exhausted", status: 503, context });
  }

  private async executeOnce(request: AiPromptRequest, route: AiModelRoute, context: ProviderExecutionContext): Promise<AiPromptResponse> {
    if (this.descriptor.kind !== providerKindCompatibility[this.compatibility] || route.providerKind !== this.descriptor.kind) {
      throw failClosed({
        code: "PROVIDER_AUTH_INVALID",
        message: "Provider adapter kind does not match descriptor or route kind",
        status: 403,
        context,
      });
    }

    requireTenantContext(context);
    assertAiModelRouteAllowed({
      tenantId: request.tenantId,
      requiredCapabilities: [...this.requiredTextCapabilities(request)],
      estimatedInputTokens: 0,
      maxOutputTokens: request.options.maxOutputTokens ?? route.maxOutputTokens,
      allowedProviderIds: request.allowedProviderIds,
      preferredProviderKind: route.providerKind,
      correlation: request.correlation,
    }, route);
    for (const capability of this.requiredTextCapabilities(request)) {
      assertProviderCapability(this.descriptor, capability, context);
    }
    const apiKey = await this.resolveCredential(context);

    const rawResponse = await this.dependencies.transport.sendText({
      tenantId: context.tenantId,
      providerId: context.providerId,
      providerKind: context.providerKind,
      model: route.model,
      messages: mapMessages(request),
      apiKey,
      responseFormat: request.options.responseFormat,
      maxOutputTokens: request.options.maxOutputTokens,
      temperature: request.options.temperature,
      anthropicVersion: anthropicVersionFor(this.descriptor),
      correlationId: context.correlationId,
    });
    const normalized = normalizeProviderTextResponse({
      tenantId: context.tenantId,
      providerId: context.providerId,
      providerKind: context.providerKind,
      model: route.model,
      content: rawResponse.content,
      finishReason: rawResponse.finishReason,
      inputTokens: rawResponse.inputTokens,
      outputTokens: rawResponse.outputTokens,
      rawResponseId: rawResponse.id,
      correlationId: context.correlationId,
    });

    return {
      tenantId: normalized.tenantId,
      agentId: request.agentId,
      providerId: normalized.providerId,
      providerKind: route.providerKind,
      model: normalized.model,
      message: { role: "ASSISTANT", content: normalized.content },
      toolCalls: [],
      usage: normalized.usage,
      finishReason: normalized.finishReason === "TOOL_CALL" ? "TOOL_CALLS" : normalized.finishReason === "UNKNOWN" ? "ERROR" : normalized.finishReason,
      rawResponseRef: normalized.rawResponseId,
      correlation: request.correlation,
    };
  }

  private async executeEmbeddingWithReliability(request: EmbeddingProviderRequest, context: ProviderExecutionContext): Promise<EmbeddingProviderResponse> {
    const breaker = this.dependencies.reliability?.circuitBreaker;
    if (breaker !== undefined && !(await breaker.canExecute(context))) {
      throw failClosed({ code: "PROVIDER_UNAVAILABLE", message: "Provider circuit is open", status: 503, context });
    }

    const retryPolicy = this.dependencies.reliability?.retryPolicy;
    const maxAttempts = retryPolicy?.maxAttempts ?? 1;
    let attempt = 1;
    while (attempt <= maxAttempts) {
      try {
        const response = await withTimeout(this.executeEmbeddingOnce(request, context), this.dependencies.reliability?.timeoutPolicy, context);
        await breaker?.recordSuccess(context);
        return response;
      } catch (error) {
        const normalized = normalizeProviderAdapterError(error, context);
        if (retryPolicy === undefined || attempt >= maxAttempts || !retryPolicy.shouldRetry(normalized, attempt)) {
          await breaker?.recordFailure(context, normalized);
          throw normalized;
        }
        const sleep = this.dependencies.sleep ?? ((durationMs: number) => new Promise<void>((resolve) => setTimeout(resolve, durationMs)));
        await sleep(retryPolicy.nextDelayMs(normalized, attempt));
        attempt += 1;
      }
    }
    throw failClosed({ code: "PROVIDER_UNAVAILABLE", message: "Provider retry policy exhausted", status: 503, context });
  }

  private async executeEmbeddingOnce(request: EmbeddingProviderRequest, context: ProviderExecutionContext): Promise<EmbeddingProviderResponse> {
    this.assertCompatibleContext(context);
    if (request.providerId !== this.descriptor.providerId) {
      throw failClosed({
        code: "PROVIDER_AUTH_INVALID",
        message: "Provider adapter kind or request provider does not match descriptor",
        status: 403,
        context,
      });
    }
    if (this.dependencies.transport.sendEmbedding === undefined) {
      throw failClosed({ code: "PROVIDER_CAPABILITY_UNSUPPORTED", message: "Provider transport does not support embeddings", status: 422, context });
    }
    if (request.tenantId !== context.tenantId || request.providerId !== context.providerId) {
      throw failClosed({
        code: "PROVIDER_AUTH_INVALID",
        message: "Embedding request tenant or provider context mismatch",
        status: 403,
        context,
      });
    }
    for (const capability of embeddingCapabilities) {
      assertProviderCapability(this.descriptor, capability, context);
    }
    const apiKey = await this.resolveCredential(context);
    const rawResponse = await this.dependencies.transport.sendEmbedding({
      tenantId: context.tenantId,
      providerId: context.providerId,
      providerKind: context.providerKind,
      model: request.model,
      inputs: request.input,
      dimensions: request.dimensions,
      apiKey,
      correlationId: context.correlationId,
    });
    return normalizeEmbeddingResponse({
      tenantId: context.tenantId,
      providerId: context.providerId,
      providerKind: context.providerKind,
      model: request.model,
      embeddings: rawResponse.embeddings,
      inputTokens: rawResponse.inputTokens,
      correlationId: context.correlationId,
    });
  }

  private durationMs(startedAt: Date): number {
    const now = this.dependencies.now?.() ?? new Date();
    return Math.max(0, now.getTime() - startedAt.getTime());
  }
}

export class OpenAiProviderAdapter extends ProviderTextGenerationAdapter {
  constructor(descriptor: ProviderDescriptor, dependencies: ProviderAdapterDependencies) {
    super(descriptor, "openai", dependencies);
  }
}

export class OpenAIProviderAdapter extends OpenAiProviderAdapter {}

export class AnthropicProviderAdapter extends ProviderTextGenerationAdapter {
  constructor(descriptor: ProviderDescriptor, dependencies: ProviderAdapterDependencies) {
    super(descriptor, "anthropic", dependencies);
  }
}

export class GeminiProviderAdapter extends ProviderTextGenerationAdapter {
  constructor(descriptor: ProviderDescriptor, dependencies: ProviderAdapterDependencies) {
    super(descriptor, "gemini", dependencies);
  }
}

export class ProviderModelExecutionRuntime {
  private readonly dependencies: ProviderExecutionRuntimeDependencies;

  constructor(dependencies: ProviderExecutionRuntimeDependencies) {
    this.dependencies = dependencies;
  }

  async generate(request: AiPromptRequest): Promise<AiPromptResponse> {
    const estimate = await this.dependencies.accountant.estimate(request);
    const routeRequest: AiModelRouteRequest = {
      tenantId: request.tenantId,
      requiredCapabilities: request.requiredCapabilities,
      estimatedInputTokens: estimate.inputTokens,
      maxOutputTokens: request.options.maxOutputTokens ?? 1,
      allowedProviderIds: request.allowedProviderIds,
      correlation: request.correlation,
    };
    const route = await this.dependencies.router.route(routeRequest);
    const descriptor = await this.dependencies.configLoader.loadProviderConfiguration({
      tenantId: request.tenantId,
      providerId: route.providerId,
      correlationId: request.correlation.correlationId,
    });
    assertProviderTenantIsolation({
      tenantId: request.tenantId,
      providerId: route.providerId,
      providerKind: descriptor.kind,
      operation: "model-runtime.load-provider",
      correlationId: request.correlation.correlationId,
      actorId: request.agentId,
    }, descriptor);
    if (descriptor.kind !== route.providerKind) {
      throw new ProviderRuntimeError({
        code: "PROVIDER_CONFIG_INVALID",
        message: "Provider configuration kind does not match selected model route",
        status: 409,
        providerKind: descriptor.kind,
        providerId: route.providerId,
        correlationId: request.correlation.correlationId,
      });
    }

    const adapter = this.dependencies.registry.getAdapter(route.providerId);
    if (adapter === undefined) {
      throw new ProviderRuntimeError({
        code: "PROVIDER_UNAVAILABLE",
        message: "No provider adapter registered for selected model route",
        status: 503,
        providerKind: descriptor.kind,
        providerId: route.providerId,
        correlationId: request.correlation.correlationId,
      });
    }

    const response = await adapter.generate(request, route);
    await this.dependencies.accountant.record({
      tenantId: request.tenantId,
      agentId: request.agentId,
      providerId: response.providerId,
      model: response.model,
      usage: response.usage,
      occurredAt: (this.dependencies.now?.() ?? new Date()).toISOString(),
      correlation: request.correlation,
    });
    return response;
  }
}

export {
  ResendEmailProvider,
  createResendEmailProviderFromEnv,
} from "./email/resend-provider.js";
export { HttpSmsProvider, createHttpSmsProviderFromEnv } from "./sms/http-sms-provider.js";
export { MetaWhatsAppCloudProvider, createMetaWhatsAppCloudProviderFromEnv } from "./whatsapp/meta-whatsapp-cloud-provider.js";
export type {
  EmailMessage,
  EmailProvider,
  SmsMessage,
  SmsProvider,
  WhatsAppMessage,
  WhatsAppProvider,
  ResendEmailProviderOptions,
} from "./email/resend-provider.js";
export type { HttpSmsProviderOptions } from "./sms/http-sms-provider.js";
export type { MetaWhatsAppCloudProviderOptions } from "./whatsapp/meta-whatsapp-cloud-provider.js";

export { RenderSellerHttpConnector, RenderSellerConnectorError, createRenderSellerConnectorFromEnv } from "./render-seller.js";
export type { RenderSellerConnector, RenderSellerPayload, CreateRenderSellerInput, CreateRenderSellerResult } from "./render-seller.js";

export * from "./discovery.js";
