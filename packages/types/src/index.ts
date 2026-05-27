import { z } from "zod";

export const correlationMetadataSchema = z.object({
  correlationId: z.string().min(1),
  requestId: z.string().min(1).optional(),
  causationId: z.string().min(1).optional(),
  traceId: z.string().min(1).optional(),
  spanId: z.string().min(1).optional()
}).strict();

export type CorrelationMetadata = z.infer<typeof correlationMetadataSchema>;

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
