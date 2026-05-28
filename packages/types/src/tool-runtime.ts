import { z } from "zod";

export const toolCorrelationMetadataSchema = z.object({
  correlationId: z.string().min(1),
  requestId: z.string().min(1).optional(),
  causationId: z.string().min(1).optional(),
  traceId: z.string().min(1).optional(),
  spanId: z.string().min(1).optional()
}).strict();

export type ToolCorrelationMetadata = z.infer<typeof toolCorrelationMetadataSchema>;

export const toolRuntimePayloadSchema = z.record(z.string(), z.unknown());
export type ToolRuntimePayload = z.infer<typeof toolRuntimePayloadSchema>;

export const toolRuntimeErrorCodeValues = [
  "TOOL_TENANT_CONTEXT_MISSING",
  "TOOL_TENANT_CONTEXT_MISMATCH",
  "TOOL_NOT_FOUND",
  "TOOL_PERMISSION_DENIED",
  "TOOL_APPROVAL_REQUIRED",
  "TOOL_NON_DETERMINISTIC",
  "TOOL_INPUT_VALIDATION_FAILED",
  "TOOL_OUTPUT_VALIDATION_FAILED",
  "TOOL_EXECUTION_FAILED",
  "TOOL_IDEMPOTENCY_CONFLICT",
  "TOOL_RETRY_EXHAUSTED"
] as const;

export const toolRuntimeErrorCodeSchema = z.enum(toolRuntimeErrorCodeValues);
export type ToolRuntimeErrorCode = z.infer<typeof toolRuntimeErrorCodeSchema>;

export interface ToolRuntimeErrorInput {
  readonly code: ToolRuntimeErrorCode;
  readonly message: string;
  readonly status: number;
  readonly retryable?: boolean;
  readonly details?: ToolRuntimePayload | undefined;
  readonly correlation?: ToolCorrelationMetadata | undefined;
}

export class ToolRuntimeError extends Error {
  readonly code: ToolRuntimeErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: ToolRuntimePayload | undefined;
  readonly correlation?: ToolCorrelationMetadata | undefined;

  constructor(input: ToolRuntimeErrorInput) {
    super(input.message);
    this.name = "ToolRuntimeError";
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable ?? false;
    this.details = input.details;
    this.correlation = input.correlation;
    Object.setPrototypeOf(this, ToolRuntimeError.prototype);
  }
}

const validationIssues = (error: z.ZodError): readonly ToolRuntimePayload[] => error.issues.map((issue) => ({
  path: issue.path.join("."),
  message: issue.message,
  code: issue.code
}));

const parseToolRuntimeSchema = <TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  input: unknown,
  code: ToolRuntimeErrorCode,
  message: string,
  correlation: ToolCorrelationMetadata | undefined,
): z.output<TSchema> => {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ToolRuntimeError({
      code,
      message,
      status: 400,
      details: { issues: validationIssues(result.error) },
      correlation
    });
  }
  return result.data;
};

export const toolPermissionActionValues = ["READ", "WRITE", "EXECUTE", "ADMIN"] as const;
export const toolPermissionActionSchema = z.enum(toolPermissionActionValues);
export type ToolPermissionAction = z.infer<typeof toolPermissionActionSchema>;

export const toolPermissionSchema = z.object({
  resource: z.string().min(1),
  action: toolPermissionActionSchema
}).strict();

export type ToolPermission = z.infer<typeof toolPermissionSchema>;

const permissionKey = (permission: ToolPermission): string => `${permission.resource}:${permission.action}`;

export const hasToolPermissions = (
  requiredPermissions: readonly ToolPermission[],
  grantedPermissions: readonly ToolPermission[],
): boolean => {
  const granted = new Set(grantedPermissions.map(permissionKey));
  return requiredPermissions.every((permission) => granted.has(permissionKey(permission)));
};

export const toolApprovalPolicyValues = ["NEVER", "REQUIRED"] as const;
export const toolApprovalPolicySchema = z.enum(toolApprovalPolicyValues);
export type ToolApprovalPolicy = z.infer<typeof toolApprovalPolicySchema>;

export const toolManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  tenantId: z.string().min(1).optional(),
  deterministic: z.literal(true),
  idempotent: z.literal(true),
  tenantScoped: z.literal(true),
  networkAccess: z.literal(false),
  approvalPolicy: toolApprovalPolicySchema.default("NEVER"),
  requiredPermissions: z.array(toolPermissionSchema).default([]),
  inputManifest: toolRuntimePayloadSchema.default({}),
  outputManifest: toolRuntimePayloadSchema.default({}),
  metadata: toolRuntimePayloadSchema.optional()
}).strict();

export type ToolManifest = z.output<typeof toolManifestSchema>;

export interface ToolDefinition<TInput, TOutput> {
  readonly manifest: ToolManifest;
  readonly inputSchema: z.ZodType<TInput>;
  readonly outputSchema: z.ZodType<TOutput>;
}

export const toolExecutionContextSchema = z.object({
  tenantId: z.string().min(1),
  actorId: z.string().min(1).optional(),
  agentId: z.string().min(1),
  executionId: z.string().min(1),
  invocationId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  grantedPermissions: z.array(toolPermissionSchema).default([]),
  approvedByActorId: z.string().min(1).optional(),
  correlation: toolCorrelationMetadataSchema
}).strict();

export type ToolExecutionContext = z.output<typeof toolExecutionContextSchema>;

export const toolExecutionRequestSchema = z.object({
  tenantId: z.string().min(1),
  toolName: z.string().min(1),
  toolVersion: z.string().min(1),
  invocationId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  input: z.unknown(),
  correlation: toolCorrelationMetadataSchema
}).strict();

export type ToolExecutionRequest = z.infer<typeof toolExecutionRequestSchema>;

export const toolExecutionStatusValues = ["SUCCEEDED", "REJECTED"] as const;
export const toolExecutionStatusSchema = z.enum(toolExecutionStatusValues);
export type ToolExecutionStatus = z.infer<typeof toolExecutionStatusSchema>;

export const toolExecutionResultSchema = z.object({
  tenantId: z.string().min(1),
  toolName: z.string().min(1),
  toolVersion: z.string().min(1),
  invocationId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  status: toolExecutionStatusSchema,
  output: z.unknown(),
  attempt: z.number().int().min(1),
  correlation: toolCorrelationMetadataSchema
}).strict();

export type ToolExecutionResult<TOutput = unknown> = Omit<z.infer<typeof toolExecutionResultSchema>, "output"> & {
  readonly output: TOutput;
};

export interface ToolHandler<TInput, TOutput> {
  readonly definition: ToolDefinition<TInput, TOutput>;
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>;
}

export interface ToolRegistry {
  register<TInput, TOutput>(handler: ToolHandler<TInput, TOutput>): void;
  get(name: string, version: string): ToolHandler<unknown, unknown> | undefined;
  list(): readonly ToolManifest[];
}

export const createToolRegistry = (): ToolRegistry => {
  const handlers = new Map<string, ToolHandler<unknown, unknown>>();

  return {
    register<TInput, TOutput>(handler: ToolHandler<TInput, TOutput>): void {
      const manifest = parseToolRuntimeSchema(
        toolManifestSchema,
        handler.definition.manifest,
        "TOOL_INPUT_VALIDATION_FAILED",
        "Tool manifest validation failed",
        undefined,
      );
      handlers.set(`${manifest.name}:${manifest.version}`, handler as ToolHandler<unknown, unknown>);
    },
    get(name: string, version: string): ToolHandler<unknown, unknown> | undefined {
      return handlers.get(`${name}:${version}`);
    },
    list(): readonly ToolManifest[] {
      return [...handlers.values()].map((handler) => handler.definition.manifest);
    }
  };
};

export interface ToolIdempotencyStore<TOutput = unknown> {
  get(key: string, tenantId: string): Promise<ToolExecutionResult<TOutput> | undefined>;
  set(key: string, tenantId: string, result: ToolExecutionResult<TOutput>): Promise<void>;
}

export const toolRetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(10),
  initialDelayMs: z.number().int().min(0).max(60_000),
  backoffMultiplier: z.number().min(1).max(10),
  maxDelayMs: z.number().int().min(0).max(300_000)
}).strict();

export type ToolRetryPolicy = z.output<typeof toolRetryPolicySchema>;

export const defaultToolRetryPolicy: ToolRetryPolicy = {
  maxAttempts: 1,
  initialDelayMs: 0,
  backoffMultiplier: 1,
  maxDelayMs: 0
};

export const calculateToolRetryDelayMs = (policy: ToolRetryPolicy, nextAttempt: number): number => {
  const parsed = toolRetryPolicySchema.parse(policy);
  const exponent = Math.max(0, nextAttempt - 2);
  return Math.min(parsed.maxDelayMs, Math.floor(parsed.initialDelayMs * (parsed.backoffMultiplier ** exponent)));
};

export interface ToolExecutionEvent {
  readonly type: "TOOL_EXECUTION_REQUESTED" | "TOOL_EXECUTION_SUCCEEDED" | "TOOL_EXECUTION_REJECTED" | "TOOL_EXECUTION_RETRIED";
  readonly tenantId: string;
  readonly toolName: string;
  readonly toolVersion: string;
  readonly invocationId: string;
  readonly idempotencyKey: string;
  readonly attempt: number;
  readonly occurredAt: string;
  readonly payload: ToolRuntimePayload;
  readonly correlation: ToolCorrelationMetadata;
}

export interface ToolExecutionEventHook {
  emit(event: ToolExecutionEvent): Promise<void>;
}

export interface ToolExecutionSpan {
  end(result: ToolExecutionResult<unknown>): void;
  fail(error: ToolRuntimeError): void;
}

export interface ToolExecutionTracer {
  startSpan(context: ToolExecutionContext, manifest: ToolManifest): ToolExecutionSpan;
}

export interface ExecuteToolOptions<TOutput> {
  readonly registry: ToolRegistry;
  readonly request: ToolExecutionRequest;
  readonly context: ToolExecutionContext;
  readonly retryPolicy?: ToolRetryPolicy;
  readonly idempotencyStore?: ToolIdempotencyStore<TOutput>;
  readonly eventHook?: ToolExecutionEventHook;
  readonly tracer?: ToolExecutionTracer;
  readonly now?: () => Date;
  readonly sleep?: (delayMs: number) => Promise<void>;
}

const assertTenantSafeToolExecution = (
  manifest: ToolManifest,
  request: ToolExecutionRequest,
  context: ToolExecutionContext,
): void => {
  if (request.tenantId.trim().length === 0 || context.tenantId.trim().length === 0) {
    throw new ToolRuntimeError({
      code: "TOOL_TENANT_CONTEXT_MISSING",
      message: "Tool execution requires explicit tenant context",
      status: 403,
      correlation: context.correlation
    });
  }
  if (request.tenantId !== context.tenantId || (manifest.tenantId !== undefined && manifest.tenantId !== context.tenantId)) {
    throw new ToolRuntimeError({
      code: "TOOL_TENANT_CONTEXT_MISMATCH",
      message: "Tool execution tenant boundary mismatch",
      status: 403,
      details: { requestTenantId: request.tenantId, contextTenantId: context.tenantId, manifestTenantId: manifest.tenantId },
      correlation: context.correlation
    });
  }
};

const assertToolPolicy = (manifest: ToolManifest, context: ToolExecutionContext): void => {
  if (manifest.deterministic !== true || manifest.idempotent !== true || manifest.tenantScoped !== true || manifest.networkAccess !== false) {
    throw new ToolRuntimeError({
      code: "TOOL_NON_DETERMINISTIC",
      message: "Tool execution requires deterministic, idempotent, tenant-scoped, no-network tools",
      status: 422,
      details: { toolName: manifest.name, toolVersion: manifest.version },
      correlation: context.correlation
    });
  }
  if (manifest.approvalPolicy === "REQUIRED" && context.approvedByActorId === undefined) {
    throw new ToolRuntimeError({
      code: "TOOL_APPROVAL_REQUIRED",
      message: "Tool execution requires an approval actor",
      status: 409,
      details: { toolName: manifest.name, toolVersion: manifest.version },
      correlation: context.correlation
    });
  }
  if (!hasToolPermissions(manifest.requiredPermissions, context.grantedPermissions)) {
    throw new ToolRuntimeError({
      code: "TOOL_PERMISSION_DENIED",
      message: "Tool execution permissions are insufficient",
      status: 403,
      details: { requiredPermissions: manifest.requiredPermissions },
      correlation: context.correlation
    });
  }
};

const emitToolEvent = async (
  hook: ToolExecutionEventHook | undefined,
  event: ToolExecutionEvent,
): Promise<void> => {
  if (hook !== undefined) {
    await hook.emit(event);
  }
};

const toToolRuntimeError = (
  error: unknown,
  correlation: ToolCorrelationMetadata,
): ToolRuntimeError => {
  if (error instanceof ToolRuntimeError) {
    return error;
  }
  return new ToolRuntimeError({
    code: "TOOL_EXECUTION_FAILED",
    message: "Tool execution failed with a non-runtime error",
    status: 500,
    retryable: false,
    correlation
  });
};

export const executeRegisteredTool = async <TOutput = unknown>(
  options: ExecuteToolOptions<TOutput>,
): Promise<ToolExecutionResult<TOutput>> => {
  const parsedContext = parseToolRuntimeSchema(
    toolExecutionContextSchema,
    options.context,
    "TOOL_INPUT_VALIDATION_FAILED",
    "Tool execution context validation failed",
    options.context.correlation,
  );
  const parsedRequest = parseToolRuntimeSchema(
    toolExecutionRequestSchema,
    options.request,
    "TOOL_INPUT_VALIDATION_FAILED",
    "Tool execution request validation failed",
    parsedContext.correlation,
  );

  if (parsedContext.invocationId !== parsedRequest.invocationId || parsedContext.idempotencyKey !== parsedRequest.idempotencyKey) {
    throw new ToolRuntimeError({
      code: "TOOL_IDEMPOTENCY_CONFLICT",
      message: "Tool request and execution context invocation boundaries must match",
      status: 409,
      correlation: parsedContext.correlation
    });
  }

  const handler = options.registry.get(parsedRequest.toolName, parsedRequest.toolVersion);
  if (handler === undefined) {
    throw new ToolRuntimeError({
      code: "TOOL_NOT_FOUND",
      message: "Requested tool is not registered",
      status: 404,
      details: { toolName: parsedRequest.toolName, toolVersion: parsedRequest.toolVersion },
      correlation: parsedContext.correlation
    });
  }

  const manifest = parseToolRuntimeSchema(
    toolManifestSchema,
    handler.definition.manifest,
    "TOOL_INPUT_VALIDATION_FAILED",
    "Tool manifest validation failed",
    parsedContext.correlation,
  );
  assertTenantSafeToolExecution(manifest, parsedRequest, parsedContext);
  assertToolPolicy(manifest, parsedContext);

  const cached = await options.idempotencyStore?.get(parsedRequest.idempotencyKey, parsedContext.tenantId);
  if (cached !== undefined) {
    return cached;
  }

  const retryPolicy = options.retryPolicy ?? defaultToolRetryPolicy;
  const parsedRetryPolicy = parseToolRuntimeSchema(
    toolRetryPolicySchema,
    retryPolicy,
    "TOOL_INPUT_VALIDATION_FAILED",
    "Tool retry policy validation failed",
    parsedContext.correlation,
  );
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? (async () => undefined);
  const span = options.tracer?.startSpan(parsedContext, manifest);

  await emitToolEvent(options.eventHook, {
    type: "TOOL_EXECUTION_REQUESTED",
    tenantId: parsedContext.tenantId,
    toolName: manifest.name,
    toolVersion: manifest.version,
    invocationId: parsedRequest.invocationId,
    idempotencyKey: parsedRequest.idempotencyKey,
    attempt: 1,
    occurredAt: now().toISOString(),
    payload: {},
    correlation: parsedContext.correlation
  });

  for (let attempt = 1; attempt <= parsedRetryPolicy.maxAttempts; attempt += 1) {
    try {
      const input = parseToolRuntimeSchema(
        handler.definition.inputSchema,
        parsedRequest.input,
        "TOOL_INPUT_VALIDATION_FAILED",
        "Tool input validation failed",
        parsedContext.correlation,
      );
      const output = parseToolRuntimeSchema(
        handler.definition.outputSchema,
        await handler.execute(input, parsedContext),
        "TOOL_OUTPUT_VALIDATION_FAILED",
        "Tool output validation failed",
        parsedContext.correlation,
      ) as TOutput;
      const result: ToolExecutionResult<TOutput> = parseToolRuntimeSchema(
        toolExecutionResultSchema,
        {
          tenantId: parsedContext.tenantId,
          toolName: manifest.name,
          toolVersion: manifest.version,
          invocationId: parsedRequest.invocationId,
          idempotencyKey: parsedRequest.idempotencyKey,
          status: "SUCCEEDED",
          output,
          attempt,
          correlation: parsedContext.correlation
        },
        "TOOL_OUTPUT_VALIDATION_FAILED",
        "Tool result validation failed",
        parsedContext.correlation,
      ) as ToolExecutionResult<TOutput>;
      await options.idempotencyStore?.set(parsedRequest.idempotencyKey, parsedContext.tenantId, result);
      span?.end(result);
      await emitToolEvent(options.eventHook, {
        type: "TOOL_EXECUTION_SUCCEEDED",
        tenantId: result.tenantId,
        toolName: result.toolName,
        toolVersion: result.toolVersion,
        invocationId: result.invocationId,
        idempotencyKey: result.idempotencyKey,
        attempt,
        occurredAt: now().toISOString(),
        payload: { status: result.status },
        correlation: result.correlation
      });
      return result;
    } catch (error) {
      const runtimeError = toToolRuntimeError(error, parsedContext.correlation);
      const shouldRetry = runtimeError.retryable && attempt < parsedRetryPolicy.maxAttempts;
      if (!shouldRetry) {
        const terminalError = attempt >= parsedRetryPolicy.maxAttempts && runtimeError.retryable
          ? new ToolRuntimeError({
            code: "TOOL_RETRY_EXHAUSTED",
            message: "Tool execution retry policy exhausted",
            status: runtimeError.status,
            details: { attempts: attempt, causeCode: runtimeError.code },
            correlation: parsedContext.correlation
          })
          : runtimeError;
        span?.fail(terminalError);
        await emitToolEvent(options.eventHook, {
          type: "TOOL_EXECUTION_REJECTED",
          tenantId: parsedContext.tenantId,
          toolName: manifest.name,
          toolVersion: manifest.version,
          invocationId: parsedRequest.invocationId,
          idempotencyKey: parsedRequest.idempotencyKey,
          attempt,
          occurredAt: now().toISOString(),
          payload: { code: terminalError.code },
          correlation: parsedContext.correlation
        });
        throw terminalError;
      }
      await emitToolEvent(options.eventHook, {
        type: "TOOL_EXECUTION_RETRIED",
        tenantId: parsedContext.tenantId,
        toolName: manifest.name,
        toolVersion: manifest.version,
        invocationId: parsedRequest.invocationId,
        idempotencyKey: parsedRequest.idempotencyKey,
        attempt,
        occurredAt: now().toISOString(),
        payload: { code: runtimeError.code },
        correlation: parsedContext.correlation
      });
      await sleep(calculateToolRetryDelayMs(parsedRetryPolicy, attempt + 1));
    }
  }

  throw new ToolRuntimeError({
    code: "TOOL_RETRY_EXHAUSTED",
    message: "Tool execution retry policy exhausted",
    status: 500,
    correlation: parsedContext.correlation
  });
};
