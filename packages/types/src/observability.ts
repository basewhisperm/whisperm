import { z } from "zod";

const otelTraceIdPattern = /^[0-9a-f]{32}$/u;
const otelSpanIdPattern = /^[0-9a-f]{16}$/u;
const traceFlagsPattern = /^[0-9a-f]{2}$/u;
const traceStatePattern = /^[a-z0-9_*/-]+=[ -~]{0,256}(,[a-z0-9_*/-]+=[ -~]{0,256})*$/u;
const safeKeyPattern = /^[a-zA-Z0-9_.:-]+$/u;

export const telemetryPayloadSchema = z.record(z.string(), z.unknown());
export type TelemetryPayload = z.infer<typeof telemetryPayloadSchema>;

export const telemetryCorrelationSchema = z.object({
  correlationId: z.string().min(1),
  requestId: z.string().min(1).optional(),
  causationId: z.string().min(1).optional(),
  traceId: z.string().regex(otelTraceIdPattern).optional(),
  spanId: z.string().regex(otelSpanIdPattern).optional()
}).strict();
export type TelemetryCorrelation = z.infer<typeof telemetryCorrelationSchema>;

export const observabilityErrorCodeValues = [
  "TELEMETRY_VALIDATION_FAILED",
  "TRACE_CONTEXT_INVALID",
  "TRACE_TENANT_MISMATCH",
  "TRACE_TENANT_CONTEXT_MISSING",
  "TRACE_REPLAY_MISMATCH",
  "LOG_REDACTION_FAILED",
  "SAMPLING_POLICY_INVALID",
  "EXPORT_CONTRACT_INVALID",
  "METRIC_CONTRACT_INVALID",
  "AUDIT_EVENT_INVALID"
] as const;
export const observabilityErrorCodeSchema = z.enum(observabilityErrorCodeValues);
export type ObservabilityErrorCode = z.infer<typeof observabilityErrorCodeSchema>;

export const observabilityErrorModelSchema = z.object({
  code: observabilityErrorCodeSchema,
  message: z.string().min(1),
  status: z.number().int().min(400).max(599),
  retryable: z.boolean().default(false),
  details: telemetryPayloadSchema.optional(),
  correlation: telemetryCorrelationSchema.optional()
}).strict();
export type ObservabilityErrorModel = z.infer<typeof observabilityErrorModelSchema>;

export interface ObservabilityErrorInput {
  readonly code: ObservabilityErrorCode;
  readonly message: string;
  readonly status: number;
  readonly retryable?: boolean | undefined;
  readonly details?: TelemetryPayload | undefined;
  readonly correlation?: TelemetryCorrelation | undefined;
}

export class ObservabilityContractError extends Error {
  readonly code: ObservabilityErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: TelemetryPayload | undefined;
  readonly correlation?: TelemetryCorrelation | undefined;

  constructor(input: ObservabilityErrorInput) {
    super(input.message);
    this.name = "ObservabilityContractError";
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable ?? false;
    this.details = input.details;
    this.correlation = input.correlation;
    Object.setPrototypeOf(this, ObservabilityContractError.prototype);
  }

  toErrorModel(): ObservabilityErrorModel {
    return observabilityErrorModelSchema.parse({
      code: this.code,
      message: this.message,
      status: this.status,
      retryable: this.retryable,
      details: this.details,
      correlation: this.correlation
    });
  }
}

const validationIssues = (error: z.ZodError): readonly TelemetryPayload[] => error.issues.map((issue) => ({
  path: issue.path.join("."),
  message: issue.message,
  code: issue.code
}));

export const parseTelemetryContract = <TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  input: unknown,
  correlation?: TelemetryCorrelation,
): z.output<TSchema> => {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ObservabilityContractError({
      code: "TELEMETRY_VALIDATION_FAILED",
      message: "Telemetry contract validation failed",
      status: 400,
      details: { issues: validationIssues(result.error) },
      correlation
    });
  }
  return result.data;
};

export const traceKindValues = ["INTERNAL", "SERVER", "CLIENT", "PRODUCER", "CONSUMER"] as const;
export const traceKindSchema = z.enum(traceKindValues);
export type TraceKind = z.infer<typeof traceKindSchema>;

export const traceStatusValues = ["UNSET", "OK", "ERROR"] as const;
export const traceStatusSchema = z.enum(traceStatusValues);
export type TraceStatus = z.infer<typeof traceStatusSchema>;

export const replayTraceModeValues = ["LIVE", "REPLAY", "REPLAY_VALIDATION"] as const;
export const replayTraceModeSchema = z.enum(replayTraceModeValues);
export type ReplayTraceMode = z.infer<typeof replayTraceModeSchema>;

export const traceContextSchema = z.object({
  tenantId: z.string().min(1),
  traceId: z.string().regex(otelTraceIdPattern),
  spanId: z.string().regex(otelSpanIdPattern),
  parentSpanId: z.string().regex(otelSpanIdPattern).optional(),
  traceFlags: z.string().regex(traceFlagsPattern).default("01"),
  traceState: z.string().regex(traceStatePattern).optional(),
  correlation: telemetryCorrelationSchema,
  replay: z.object({
    mode: replayTraceModeSchema.default("LIVE"),
    originalTraceId: z.string().regex(otelTraceIdPattern).optional(),
    replayId: z.string().min(1).optional(),
    deterministic: z.literal(true).default(true)
  }).strict().default({ mode: "LIVE", deterministic: true })
}).strict().superRefine((value, context) => {
  if (value.correlation.traceId !== undefined && value.correlation.traceId !== value.traceId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Correlation traceId must match trace context traceId", path: ["correlation", "traceId"] });
  }
  if (value.correlation.spanId !== undefined && value.correlation.spanId !== value.spanId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Correlation spanId must match trace context spanId", path: ["correlation", "spanId"] });
  }
  if (value.replay.mode !== "LIVE" && value.replay.originalTraceId === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Replay traces must reference the original traceId", path: ["replay", "originalTraceId"] });
  }
});
export type TraceContext = z.output<typeof traceContextSchema>;

export const traceAttributeValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.array(z.number()), z.array(z.boolean())]);
export const traceAttributesSchema = z.record(z.string().regex(safeKeyPattern), traceAttributeValueSchema);
export type TraceAttributes = z.infer<typeof traceAttributesSchema>;

export const spanEventSchema = z.object({
  name: z.string().min(1),
  occurredAt: z.string().datetime(),
  attributes: traceAttributesSchema.default({})
}).strict();
export type SpanEvent = z.output<typeof spanEventSchema>;

const baseSpanShape = {
  name: z.string().min(1),
  kind: traceKindSchema,
  tenantId: z.string().min(1),
  context: traceContextSchema,
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  status: traceStatusSchema.default("UNSET"),
  attributes: traceAttributesSchema.default({}),
  events: z.array(spanEventSchema).default([])
} as const;

export const baseSpanSchema = z.object(baseSpanShape).strict().refine((value) => value.tenantId === value.context.tenantId, {
  message: "Span tenantId must match trace context tenantId",
  path: ["tenantId"]
});
export type BaseSpan = z.output<typeof baseSpanSchema>;

const spanTenantIsolation = <TSchema extends z.ZodTypeAny>(schema: TSchema): TSchema => schema.refine((value: { tenantId: string; context: { tenantId: string } }) => value.tenantId === value.context.tenantId, {
  message: "Span tenantId must match trace context tenantId",
  path: ["tenantId"]
}) as unknown as TSchema;

export const workflowExecutionSpanSchema = spanTenantIsolation(z.object(baseSpanShape).extend({
  spanModel: z.literal("WORKFLOW_EXECUTION"),
  workflowId: z.string().min(1),
  workflowVersion: z.number().int().nonnegative(),
  executionId: z.string().min(1),
  stepId: z.string().min(1).optional(),
  attempt: z.number().int().min(1).default(1),
  replayMode: replayTraceModeSchema.default("LIVE")
}).strict());
export type WorkflowExecutionSpan = z.output<typeof workflowExecutionSpanSchema>;

export const aiProviderSpanSchema = spanTenantIsolation(z.object(baseSpanShape).extend({
  spanModel: z.literal("AI_PROVIDER"),
  providerId: z.string().min(1),
  capability: z.string().min(1),
  operation: z.string().min(1),
  model: z.string().min(1).optional(),
  requestId: z.string().min(1).optional(),
  tokenUsage: z.object({
    inputTokens: z.number().int().min(0).default(0),
    outputTokens: z.number().int().min(0).default(0),
    totalTokens: z.number().int().min(0).default(0)
  }).strict().optional()
}).strict());
export type AiProviderSpan = z.output<typeof aiProviderSpanSchema>;

export const toolExecutionTraceSpanSchema = spanTenantIsolation(z.object(baseSpanShape).extend({
  spanModel: z.literal("TOOL_EXECUTION"),
  toolName: z.string().min(1),
  toolVersion: z.string().min(1),
  invocationId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  attempt: z.number().int().min(1).default(1)
}).strict());
export type ToolExecutionTraceSpan = z.output<typeof toolExecutionTraceSpanSchema>;

export const retrievalTraceSpanSchema = spanTenantIsolation(z.object(baseSpanShape).extend({
  spanModel: z.literal("RETRIEVAL"),
  retrievalId: z.string().min(1),
  strategy: z.string().min(1),
  corpusId: z.string().min(1).optional(),
  queryHash: z.string().min(1),
  resultCount: z.number().int().min(0).default(0)
}).strict());
export type RetrievalTraceSpan = z.output<typeof retrievalTraceSpanSchema>;

export const telemetrySpanSchema = z.union([
  workflowExecutionSpanSchema,
  aiProviderSpanSchema,
  toolExecutionTraceSpanSchema,
  retrievalTraceSpanSchema
]);
export type TelemetrySpan = z.output<typeof telemetrySpanSchema>;

export const logSeverityValues = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"] as const;
export const logSeveritySchema = z.enum(logSeverityValues);
export type LogSeverity = z.infer<typeof logSeveritySchema>;

export const piiClassificationValues = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "PII", "SENSITIVE_PII", "SECRET"] as const;
export const piiClassificationSchema = z.enum(piiClassificationValues);
export type PiiClassification = z.infer<typeof piiClassificationSchema>;

export const logFieldPolicySchema = z.object({
  path: z.string().min(1),
  classification: piiClassificationSchema,
  action: z.enum(["ALLOW", "REDACT", "HASH", "DROP"])
}).strict();
export type LogFieldPolicy = z.infer<typeof logFieldPolicySchema>;

export const logRedactionPolicySchema = z.object({
  policyId: z.string().min(1),
  version: z.number().int().min(1),
  defaultAction: z.enum(["ALLOW", "REDACT"]).default("REDACT"),
  mask: z.string().min(1).default("[REDACTED]"),
  secretMask: z.string().min(1).default("[SECRET]"),
  fields: z.array(logFieldPolicySchema).default([])
}).strict();
export type LogRedactionPolicy = z.output<typeof logRedactionPolicySchema>;

export const defaultLogRedactionPolicy = logRedactionPolicySchema.parse({
  policyId: "whisperm.default.v1",
  version: 1,
  defaultAction: "ALLOW",
  fields: [
    { path: "password", classification: "SECRET", action: "REDACT" },
    { path: "token", classification: "SECRET", action: "REDACT" },
    { path: "authorization", classification: "SECRET", action: "REDACT" },
    { path: "cookie", classification: "SECRET", action: "REDACT" },
    { path: "email", classification: "PII", action: "REDACT" },
    { path: "phone", classification: "PII", action: "REDACT" },
    { path: "ssn", classification: "SENSITIVE_PII", action: "REDACT" }
  ]
});

const sensitiveKeyFragments = ["secret", "password", "token", "authorization", "cookie", "apiKey", "privateKey", "credential", "ssn"] as const;

const normalizePath = (path: readonly string[]): string => path.join(".").toLowerCase();
const normalizeKey = (key: string): string => key.replace(/[_-]/gu, "").toLowerCase();

const classifyPath = (path: readonly string[], policy: LogRedactionPolicy): LogFieldPolicy | undefined => {
  const normalizedPath = normalizePath(path);
  return policy.fields.find((field) => normalizedPath === field.path.toLowerCase() || normalizedPath.endsWith(`.${field.path.toLowerCase()}`));
};

const isSecretKey = (key: string): boolean => {
  const normalized = normalizeKey(key);
  return sensitiveKeyFragments.some((fragment) => normalized.includes(normalizeKey(fragment)));
};

export const maskSecret = (value: unknown, mask = "[SECRET]"): unknown => {
  if (typeof value !== "string") {
    return mask;
  }
  if (value.length <= 4) {
    return mask;
  }
  return `${value.slice(0, 2)}${mask}${value.slice(-2)}`;
};

export const redactTelemetryValue = (value: unknown, policy: LogRedactionPolicy = defaultLogRedactionPolicy, path: readonly string[] = []): unknown => {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => redactTelemetryValue(item, policy, [...path, String(index)]));
  }

  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
    const childPath = [...path, key];
    const fieldPolicy = classifyPath(childPath, policy);
    if (fieldPolicy?.action === "DROP") {
      return [];
    }
    if (fieldPolicy?.action === "REDACT") {
      return [[key, fieldPolicy.classification === "SECRET" ? maskSecret(child, policy.secretMask) : policy.mask]];
    }
    if (fieldPolicy?.action === "HASH") {
      return [[key, stableTelemetryHash(String(child))]];
    }
    if (fieldPolicy?.action === undefined && isSecretKey(key)) {
      return [[key, maskSecret(child, policy.secretMask)]];
    }
    if (fieldPolicy?.action === undefined && policy.defaultAction === "REDACT") {
      return [[key, policy.mask]];
    }
    return [[key, redactTelemetryValue(child, policy, childPath)]];
  }));
};

export const structuredLogSchema = z.object({
  timestamp: z.string().datetime(),
  severity: logSeveritySchema,
  message: z.string().min(1),
  tenantId: z.string().min(1),
  service: z.string().min(1),
  correlation: telemetryCorrelationSchema,
  trace: traceContextSchema.optional(),
  attributes: telemetryPayloadSchema.default({}),
  redactionPolicyId: z.string().min(1)
}).strict().refine((value) => value.trace === undefined || value.trace.tenantId === value.tenantId, {
  message: "Log tenantId must match trace tenantId",
  path: ["tenantId"]
});
export type StructuredLog = z.output<typeof structuredLogSchema>;

export const auditEventSchema = z.object({
  eventId: z.string().min(1),
  tenantId: z.string().min(1),
  occurredAt: z.string().datetime(),
  actorId: z.string().min(1),
  action: z.string().min(1),
  target: z.object({ type: z.string().min(1), id: z.string().min(1) }).strict(),
  outcome: z.enum(["ALLOWED", "DENIED", "SUCCEEDED", "FAILED"]),
  correlation: telemetryCorrelationSchema,
  trace: traceContextSchema.optional(),
  attributes: telemetryPayloadSchema.default({}),
  idempotencyKey: z.string().min(1)
}).strict().refine((value) => value.trace === undefined || value.trace.tenantId === value.tenantId, {
  message: "Audit tenantId must match trace tenantId",
  path: ["tenantId"]
});
export type AuditEvent = z.output<typeof auditEventSchema>;

export const metricKindValues = ["COUNTER", "GAUGE", "HISTOGRAM"] as const;
export const metricKindSchema = z.enum(metricKindValues);
export type MetricKind = z.infer<typeof metricKindSchema>;

export const metricUnitValues = ["COUNT", "MILLISECONDS", "SECONDS", "BYTES", "RATIO", "PERCENT"] as const;
export const metricUnitSchema = z.enum(metricUnitValues);
export type MetricUnit = z.infer<typeof metricUnitSchema>;

export const metricPointSchema = z.object({
  name: z.string().min(1),
  kind: metricKindSchema,
  unit: metricUnitSchema,
  value: z.number().finite(),
  tenantId: z.string().min(1).optional(),
  recordedAt: z.string().datetime(),
  labels: z.record(z.string().regex(safeKeyPattern), z.string().min(1)).default({}),
  correlation: telemetryCorrelationSchema.optional()
}).strict();
export type MetricPoint = z.output<typeof metricPointSchema>;

export const sloMetricContractSchema = z.object({
  sloId: z.string().min(1),
  tenantId: z.string().min(1).optional(),
  objective: z.string().min(1),
  targetRatio: z.number().min(0).max(1),
  window: z.enum(["5m", "1h", "1d", "7d", "30d"]),
  goodEventsMetric: z.string().min(1),
  totalEventsMetric: z.string().min(1),
  burnRateMetric: z.string().min(1)
}).strict();
export type SloMetricContract = z.infer<typeof sloMetricContractSchema>;

export const runtimeHealthStatusValues = ["HEALTHY", "DEGRADED", "UNHEALTHY"] as const;
export const runtimeHealthStatusSchema = z.enum(runtimeHealthStatusValues);
export type RuntimeHealthStatus = z.infer<typeof runtimeHealthStatusSchema>;

export const runtimeHealthMetricSchema = z.object({
  service: z.string().min(1),
  component: z.string().min(1),
  status: runtimeHealthStatusSchema,
  checkedAt: z.string().datetime(),
  latencyMs: z.number().int().min(0).optional(),
  details: telemetryPayloadSchema.default({})
}).strict();
export type RuntimeHealthMetric = z.output<typeof runtimeHealthMetricSchema>;

export const telemetrySamplingDecisionValues = ["RECORD_AND_SAMPLE", "RECORD_ONLY", "DROP"] as const;
export const telemetrySamplingDecisionSchema = z.enum(telemetrySamplingDecisionValues);
export type TelemetrySamplingDecision = z.infer<typeof telemetrySamplingDecisionSchema>;

export const telemetrySamplingPolicySchema = z.object({
  policyId: z.string().min(1),
  defaultRatio: z.number().min(0).max(1),
  tenantOverrides: z.record(z.string().min(1), z.number().min(0).max(1)).default({}),
  alwaysSampleSeverities: z.array(logSeveritySchema).default(["ERROR", "FATAL"]),
  alwaysSampleReplay: z.boolean().default(true)
}).strict();
export type TelemetrySamplingPolicy = z.output<typeof telemetrySamplingPolicySchema>;

export const stableTelemetryHash = (value: string): string => {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const shouldSampleTelemetry = (input: {
  readonly tenantId: string;
  readonly correlationId: string;
  readonly policy: TelemetrySamplingPolicy;
  readonly severity?: LogSeverity | undefined;
  readonly replayMode?: ReplayTraceMode | undefined;
}): TelemetrySamplingDecision => {
  const policy = telemetrySamplingPolicySchema.parse(input.policy);
  if (input.severity !== undefined && policy.alwaysSampleSeverities.includes(input.severity)) {
    return "RECORD_AND_SAMPLE";
  }
  if (policy.alwaysSampleReplay && input.replayMode !== undefined && input.replayMode !== "LIVE") {
    return "RECORD_AND_SAMPLE";
  }
  const ratio = policy.tenantOverrides[input.tenantId] ?? policy.defaultRatio;
  if (ratio <= 0) {
    return "RECORD_ONLY";
  }
  if (ratio >= 1) {
    return "RECORD_AND_SAMPLE";
  }
  const bucket = Number.parseInt(stableTelemetryHash(`${input.tenantId}:${input.correlationId}`).slice(0, 8), 16) / 0xffffffff;
  return bucket < ratio ? "RECORD_AND_SAMPLE" : "RECORD_ONLY";
};

export const telemetryExporterValues = ["OTLP_HTTP", "OTLP_GRPC", "PROMETHEUS", "LOKI", "SIEM", "FILE"] as const;
export const telemetryExporterSchema = z.enum(telemetryExporterValues);
export type TelemetryExporter = z.infer<typeof telemetryExporterSchema>;

export const telemetryExportContractSchema = z.object({
  exporter: telemetryExporterSchema,
  endpoint: z.string().url().optional(),
  enabled: z.boolean(),
  batchSize: z.number().int().min(1).max(10_000).default(512),
  timeoutMs: z.number().int().min(1).max(300_000).default(30_000),
  headers: z.record(z.string().min(1), z.string().min(1)).default({}),
  redactionPolicy: logRedactionPolicySchema.default(defaultLogRedactionPolicy)
}).strict();
export type TelemetryExportContract = z.output<typeof telemetryExportContractSchema>;

export const propagationCarrierSchema = z.record(z.string().min(1), z.string().min(1));
export type PropagationCarrier = z.infer<typeof propagationCarrierSchema>;

export const createTraceParent = (context: TraceContext): string => {
  const parsed = traceContextSchema.parse(context);
  return `00-${parsed.traceId}-${parsed.spanId}-${parsed.traceFlags}`;
};

export const parseTraceParent = (traceParent: string): Pick<TraceContext, "traceId" | "spanId" | "traceFlags"> => {
  const parts = traceParent.split("-");
  const [version, traceId, spanId, traceFlags] = parts;
  if (parts.length !== 4 || version !== "00" || traceId === undefined || spanId === undefined || traceFlags === undefined) {
    throw new ObservabilityContractError({ code: "TRACE_CONTEXT_INVALID", message: "Invalid W3C traceparent header", status: 400 });
  }
  return z.object({
    traceId: z.string().regex(otelTraceIdPattern),
    spanId: z.string().regex(otelSpanIdPattern),
    traceFlags: z.string().regex(traceFlagsPattern)
  }).parse({ traceId, spanId, traceFlags });
};

export const injectTraceContext = (context: TraceContext, carrier: PropagationCarrier = {}): PropagationCarrier => {
  const parsed = traceContextSchema.parse(context);
  return {
    ...carrier,
    traceparent: createTraceParent(parsed),
    ...(parsed.traceState === undefined ? {} : { tracestate: parsed.traceState }),
    "x-whisperm-tenant-id": parsed.tenantId,
    "x-whisperm-correlation-id": parsed.correlation.correlationId,
    ...(parsed.correlation.requestId === undefined ? {} : { "x-whisperm-request-id": parsed.correlation.requestId }),
    "x-whisperm-replay-mode": parsed.replay.mode,
    ...(parsed.replay.originalTraceId === undefined ? {} : { "x-whisperm-original-trace-id": parsed.replay.originalTraceId }),
    ...(parsed.replay.replayId === undefined ? {} : { "x-whisperm-replay-id": parsed.replay.replayId })
  };
};

const headerValue = (carrier: PropagationCarrier, key: string): string | undefined => carrier[key] ?? carrier[key.toLowerCase()];

export const extractTraceContext = (carrier: PropagationCarrier, expectedTenantId: string): TraceContext => {
  const parsedCarrier = propagationCarrierSchema.parse(Object.fromEntries(Object.entries(carrier).map(([key, value]) => [key.toLowerCase(), value])));
  const tenantId = headerValue(parsedCarrier, "x-whisperm-tenant-id");
  if (tenantId === undefined) {
    throw new ObservabilityContractError({ code: "TRACE_TENANT_CONTEXT_MISSING", message: "Missing tenant trace context", status: 400 });
  }
  if (tenantId !== expectedTenantId) {
    throw new ObservabilityContractError({ code: "TRACE_TENANT_MISMATCH", message: "Trace context tenant mismatch", status: 403 });
  }
  const traceParent = headerValue(parsedCarrier, "traceparent");
  if (traceParent === undefined) {
    throw new ObservabilityContractError({ code: "TRACE_CONTEXT_INVALID", message: "Missing W3C traceparent header", status: 400 });
  }
  const parent = parseTraceParent(traceParent);
  const correlationId = headerValue(parsedCarrier, "x-whisperm-correlation-id");
  if (correlationId === undefined) {
    throw new ObservabilityContractError({ code: "TRACE_CONTEXT_INVALID", message: "Missing correlation id", status: 400 });
  }
  const replayMode = replayTraceModeSchema.parse(headerValue(parsedCarrier, "x-whisperm-replay-mode") ?? "LIVE");
  return traceContextSchema.parse({
    tenantId,
    traceId: parent.traceId,
    spanId: parent.spanId,
    traceFlags: parent.traceFlags,
    traceState: headerValue(parsedCarrier, "tracestate"),
    correlation: {
      correlationId,
      requestId: headerValue(parsedCarrier, "x-whisperm-request-id"),
      traceId: parent.traceId,
      spanId: parent.spanId
    },
    replay: {
      mode: replayMode,
      originalTraceId: headerValue(parsedCarrier, "x-whisperm-original-trace-id"),
      replayId: headerValue(parsedCarrier, "x-whisperm-replay-id"),
      deterministic: true
    }
  });
};
