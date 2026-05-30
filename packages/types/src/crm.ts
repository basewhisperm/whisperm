import { z } from "zod";

const idSchema = z.string().min(1);
const isoDateSchema = z.string().datetime();
const metadataSchema = z.record(z.string(), z.unknown());
const correlationMetadataSchema = z.object({
  correlationId: z.string().min(1),
  requestId: z.string().min(1).optional(),
  causationId: z.string().min(1).optional(),
  traceId: z.string().min(1).optional(),
  spanId: z.string().min(1).optional(),
}).strict();

export const trustBandValues = ["LOW", "MEDIUM", "HIGH"] as const;
export const trustBandSchema = z.enum(trustBandValues);
export type TrustBand = z.output<typeof trustBandSchema>;

export const contactSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  externalId: idSchema.nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: idSchema.nullable().optional(),
  firstName: idSchema.nullable().optional(),
  lastName: idSchema.nullable().optional(),
  leadScore: z.number().int().min(0).max(100).default(0),
  trajectoryScore: z.number().int().min(-100).max(100).default(0),
  trustBand: trustBandSchema.default("LOW"),
  metadata: metadataSchema.nullable().optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
}).strict();
export type Contact = z.output<typeof contactSchema>;

const contactIdentity = <T extends { email?: string | null | undefined; phone?: string | null | undefined; externalId?: string | null | undefined }>(contact: T): boolean =>
  contact.email != null || contact.phone != null || contact.externalId != null;

export const createContactRequestSchema = z.object({
  tenantId: idSchema,
  externalId: idSchema.nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: idSchema.nullable().optional(),
  firstName: idSchema.nullable().optional(),
  lastName: idSchema.nullable().optional(),
  metadata: metadataSchema.nullable().optional(),
}).strict().refine(contactIdentity, { message: "Contact requires at least one non-null stable identifier", path: ["externalId"] });
export type CreateContactRequest = z.output<typeof createContactRequestSchema>;

export const updateContactRequestSchema = z.object({
  externalId: idSchema.nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: idSchema.nullable().optional(),
  firstName: idSchema.nullable().optional(),
  lastName: idSchema.nullable().optional(),
  leadScore: z.number().int().min(0).max(100).optional(),
  trajectoryScore: z.number().int().min(-100).max(100).optional(),
  trustBand: trustBandSchema.optional(),
  metadata: metadataSchema.nullable().optional(),
  expectedUpdatedAt: isoDateSchema.optional(),
}).strict();
export type UpdateContactRequest = z.output<typeof updateContactRequestSchema>;

export const leadEventTypeValues = ["EMAIL_OPEN", "EMAIL_CLICK", "FORM_SUBMIT", "MEETING_BOOKED", "NEGATIVE_SIGNAL"] as const;
export const leadEventTypeSchema = z.enum(leadEventTypeValues);
export type LeadEventType = z.output<typeof leadEventTypeSchema>;

export const leadEventSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  contactId: idSchema,
  eventType: leadEventTypeSchema,
  occurredAt: isoDateSchema,
  weight: z.number().int().min(-100).max(100).default(0),
  metadata: metadataSchema.nullable().optional(),
  createdAt: isoDateSchema,
}).strict();
export type LeadEvent = z.output<typeof leadEventSchema>;

export const leadScoreBreakdownSchema = z.object({
  eventScore: z.number().int().min(0).max(100),
  identityScore: z.number().int().min(0).max(100),
  engagementScore: z.number().int().min(0).max(100),
  eventCount: z.number().int().nonnegative(),
}).strict();
export type LeadScoreBreakdown = z.output<typeof leadScoreBreakdownSchema>;

export const trajectoryScoreBreakdownSchema = z.object({
  score: z.number().int().min(-100).max(100),
  recentScore: z.number().int().min(-1000).max(1000),
  previousScore: z.number().int().min(-1000).max(1000),
  recentEventCount: z.number().int().nonnegative(),
  previousEventCount: z.number().int().nonnegative(),
}).strict();
export type TrajectoryScoreBreakdown = z.output<typeof trajectoryScoreBreakdownSchema>;

export const scoreRecomputationResultSchema = z.object({
  tenantId: idSchema,
  contactId: idSchema,
  leadScore: z.number().int().min(0).max(100),
  trajectoryScore: z.number().int().min(-100).max(100),
  trustBand: trustBandSchema,
  leadScoreBreakdown: leadScoreBreakdownSchema,
  trajectoryScoreBreakdown: trajectoryScoreBreakdownSchema,
  recomputedAt: isoDateSchema,
  correlation: correlationMetadataSchema,
}).strict();
export type ScoreRecomputationResult = z.output<typeof scoreRecomputationResultSchema>;

export const scoreRecomputationJobPayloadSchema = z.object({
  tenantId: idSchema,
  contactId: idSchema,
  reason: idSchema,
  requestedAt: isoDateSchema,
  requestId: idSchema.optional(),
  correlation: correlationMetadataSchema,
}).strict();
export type ScoreRecomputationJobPayload = z.output<typeof scoreRecomputationJobPayloadSchema>;

export const scoreRecomputationQueueContract = {
  queueName: "crm.scoring",
  jobType: "crm.score.recompute",
} as const;

export const buildScoreRecomputationIdempotencyKey = (input: Pick<ScoreRecomputationJobPayload, "tenantId" | "contactId" | "reason" | "requestedAt" | "requestId">): string => {
  // Idempotency is scoped per tenant/contact/reason/request timestamp so one active request is deduped without suppressing later recomputations.
  return [scoreRecomputationQueueContract.jobType, input.tenantId, input.contactId, input.reason, input.requestId ?? input.requestedAt].join(":");
};
