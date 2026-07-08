import { z } from "zod";

export const correlationMetadataSchema = z.object({
  correlationId: z.string().min(1),
  requestId: z.string().min(1).optional(),
  causationId: z.string().min(1).optional(),
  traceId: z.string().min(1).optional(),
  spanId: z.string().min(1).optional()
}).strict();

export type CorrelationMetadata = z.infer<typeof correlationMetadataSchema>;

export const tenantRoleValues = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;
export const tenantRoleSchema = z.enum(tenantRoleValues);
export type TenantRole = z.infer<typeof tenantRoleSchema>;

export const authPrincipalSchema = z.object({
  userId: z.string().min(1),
  externalSubject: z.string().min(1),
  tenantIds: z.array(z.string().min(1)).min(1)
}).strict();

export type AuthPrincipal = z.infer<typeof authPrincipalSchema>;

export const tenantMembershipSchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  role: tenantRoleSchema,
  isActive: z.boolean(),
  email: z.string().email().optional(),
  displayName: z.string().min(1).optional()
}).strict();

export type TenantMembership = z.infer<typeof tenantMembershipSchema>;

export const authContextSchema = z.object({
  principal: authPrincipalSchema,
  membership: tenantMembershipSchema.optional()
}).strict();

export type AuthContext = z.infer<typeof authContextSchema>;

export const tenantRequestContextSchema = z.object({
  tenantId: z.string().min(1),
  actorId: z.string().min(1).optional(),
  correlation: correlationMetadataSchema
}).strict();

export type TenantRequestContext = z.infer<typeof tenantRequestContextSchema>;

export const errorDetailsSchema = z.record(z.string(), z.unknown());

export const errorModelSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  status: z.number().int().min(400).max(599),
  details: errorDetailsSchema.optional(),
  correlation: correlationMetadataSchema.optional()
}).strict();

export type ErrorModel = z.infer<typeof errorModelSchema>;

export const apiSuccessResponseSchema = <TData extends z.ZodTypeAny>(dataSchema: TData) =>
  z.object({
    ok: z.literal(true),
    data: dataSchema,
    meta: correlationMetadataSchema.optional()
  }).strict();

export const apiErrorResponseSchema = z.object({
  ok: z.literal(false),
  error: errorModelSchema,
  meta: correlationMetadataSchema.optional()
}).strict();

export const apiResponseEnvelopeSchema = <TData extends z.ZodTypeAny>(dataSchema: TData) =>
  z.discriminatedUnion("ok", [apiSuccessResponseSchema(dataSchema), apiErrorResponseSchema]);

export type ApiSuccessResponse<TData> = {
  ok: true;
  data: TData;
  meta?: CorrelationMetadata;
};

export type ApiErrorResponse = {
  ok: false;
  error: ErrorModel;
  meta?: CorrelationMetadata;
};

export type ApiResponseEnvelope<TData> = ApiSuccessResponse<TData> | ApiErrorResponse;

export const eventEnvelopeSchema = <TPayload extends z.ZodTypeAny>(payloadSchema: TPayload) =>
  z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    version: z.number().int().nonnegative(),
    occurredAt: z.string().datetime(),
    tenantId: z.string().min(1),
    payload: payloadSchema,
    correlation: correlationMetadataSchema,
    idempotencyKey: z.string().min(1).optional()
  }).strict();

export type EventEnvelope<TPayload> = {
  id: string;
  type: string;
  version: number;
  occurredAt: string;
  tenantId: string;
  payload: TPayload;
  correlation: CorrelationMetadata;
  idempotencyKey?: string;
};

export const inboundEventProviderValues = ["META", "LINKEDIN", "GMAIL", "WEB_FORM", "INTERNAL_WORKFLOW"] as const;
export const inboundEventProviderSchema = z.enum(inboundEventProviderValues);
export type InboundEventProvider = z.infer<typeof inboundEventProviderSchema>;

export const inboundEventSourceSchema = z.object({
  provider: inboundEventProviderSchema,
  providerEventId: z.string().min(1),
  eventType: z.string().min(1),
  sourceId: z.string().min(1).optional()
}).strict();

export type InboundEventSource = z.infer<typeof inboundEventSourceSchema>;

export const inboundEventPayloadSchema = z.record(z.string(), z.unknown());

export const inboundEventSchema = z.object({
  tenantId: z.string().min(1),
  source: inboundEventSourceSchema,
  occurredAt: z.string().datetime().optional(),
  payload: inboundEventPayloadSchema,
  idempotencyKey: z.string().min(1).optional(),
  correlation: correlationMetadataSchema.optional()
}).strict();

export type InboundEvent = z.infer<typeof inboundEventSchema>;

export const normalizedInboundEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  version: z.literal(1),
  occurredAt: z.string().datetime(),
  receivedAt: z.string().datetime(),
  tenantId: z.string().min(1),
  source: inboundEventSourceSchema,
  payload: inboundEventPayloadSchema,
  correlation: correlationMetadataSchema,
  idempotencyKey: z.string().min(1)
}).strict();

export type NormalizedInboundEvent = z.infer<typeof normalizedInboundEventSchema>;

export interface NormalizeInboundEventInput {
  event: InboundEvent;
  correlation: CorrelationMetadata;
  receivedAt: Date;
  eventId: string;
}

const normalizeEventTypeSegment = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, ".").replace(/^\.+|\.+$/gu, "");

export const buildInboundEventIdempotencyKey = (event: InboundEvent): string => {
  const explicitKey = event.idempotencyKey?.trim();
  if (explicitKey !== undefined && explicitKey.length > 0) {
    return explicitKey;
  }

  return [event.tenantId, event.source.provider, event.source.providerEventId].join(":");
};

export const normalizeInboundEvent = (input: NormalizeInboundEventInput): NormalizedInboundEvent => {
  const typeSegment = normalizeEventTypeSegment(input.event.source.eventType);
  const normalized = {
    id: input.eventId,
    type: `whisperm.inbound.${normalizeEventTypeSegment(input.event.source.provider)}.${typeSegment}`,
    version: 1,
    occurredAt: input.event.occurredAt ?? input.receivedAt.toISOString(),
    receivedAt: input.receivedAt.toISOString(),
    tenantId: input.event.tenantId,
    source: input.event.source,
    payload: input.event.payload,
    correlation: input.event.correlation ?? input.correlation,
    idempotencyKey: buildInboundEventIdempotencyKey(input.event)
  } as const;

  return normalizedInboundEventSchema.parse(normalized);
};

export const inboundWebhookRequestSchema = z.object({
  tenantId: z.string().min(1),
  event: inboundEventSchema
}).strict().refine((value) => value.tenantId === value.event.tenantId, {
  message: "Webhook tenantId must match event tenantId",
  path: ["event", "tenantId"]
});

export type InboundWebhookRequest = z.infer<typeof inboundWebhookRequestSchema>;
export * from "./constants.js";
export * from "./workflow.js";
export * from "./ai.js";
export * from "./prompts.js";
export * from "./planning.js";
export * from "./crm.js";
export * from "./marketplace-acquisition.js";
export * from "./acquisition-metrics.js";
export * from "./i18n.js";

export * from "./tool-runtime.js";
export * from "./retrieval.js";
export * from "./persistence.js";
export * from "./providers.js";

export * from "./execution.js";
export * from "./observability.js";
export * from "./infrastructure.js";

export * from "./marketplace-acquisition.js";
