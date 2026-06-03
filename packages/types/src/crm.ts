import { z } from "zod";

import { persistenceCorrelationMetadataSchema } from "./persistence.js";

const idSchema = z.string().min(1);
const isoDateSchema = z.string().datetime();
const metadataSchema = z.record(z.string(), z.unknown());
export const contactStageValues = ["PROSPECT", "QUALIFIED", "PROPOSAL", "ENGAGEMENT", "RENEWAL", "INACTIVE"] as const;
export const contactStageSchema = z.enum(contactStageValues);
export type ContactStage = z.output<typeof contactStageSchema>;

export const contactSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  externalId: idSchema.nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: idSchema.nullable().optional(),
  firstName: idSchema.nullable().optional(),
  lastName: idSchema.nullable().optional(),
  stage: contactStageSchema.default("PROSPECT"),
  metadata: metadataSchema.nullable().optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
}).strict();
export type Contact = z.output<typeof contactSchema>;

export const createContactRequestSchema = z.object({
  tenantId: idSchema,
  externalId: idSchema.nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: idSchema.nullable().optional(),
  firstName: idSchema.nullable().optional(),
  lastName: idSchema.nullable().optional(),
  stage: contactStageSchema.default("PROSPECT"),
  metadata: metadataSchema.nullable().optional(),
}).strict().refine((contact) => contact.email !== undefined || contact.phone !== undefined || contact.externalId !== undefined, {
  message: "Contact create requires at least one stable identifier",
  path: ["email"],
});
export type CreateContactRequest = z.output<typeof createContactRequestSchema>;

export const updateContactRequestSchema = z.object({
  externalId: idSchema.nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: idSchema.nullable().optional(),
  firstName: idSchema.nullable().optional(),
  lastName: idSchema.nullable().optional(),
  stage: contactStageSchema.optional(),
  metadata: metadataSchema.nullable().optional(),
  expectedUpdatedAt: isoDateSchema,
}).strict();
export type UpdateContactRequest = z.output<typeof updateContactRequestSchema>;

export const leadEventSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  contactId: idSchema.nullable().optional(),
  inboundEventId: idSchema.nullable().optional(),
  externalId: idSchema.nullable().optional(),
  eventType: idSchema,
  correlationId: idSchema.nullable().optional(),
  occurredAt: isoDateSchema,
  payload: metadataSchema.nullable().optional(),
  createdAt: isoDateSchema,
}).strict();
export type LeadEvent = z.output<typeof leadEventSchema>;

export const leadScoreBreakdownSchema = z.object({
  eventScore: z.number().int().min(0).max(100),
  identityScore: z.number().int().min(0).max(20),
  engagementScore: z.number().int().min(0).max(80),
  eventCount: z.number().int().nonnegative(),
}).strict();
export type LeadScoreBreakdown = z.output<typeof leadScoreBreakdownSchema>;

export const trajectoryScoreBreakdownSchema = z.object({
  score: z.number().int().min(-100).max(100),
  recentScore: z.number().int().nonnegative(),
  previousScore: z.number().int().nonnegative(),
  recentEventCount: z.number().int().nonnegative(),
  previousEventCount: z.number().int().nonnegative(),
}).strict();
export type TrajectoryScoreBreakdown = z.output<typeof trajectoryScoreBreakdownSchema>;

export const trustBandValues = ["LOW", "MEDIUM", "HIGH"] as const;
export const trustBandSchema = z.enum(trustBandValues);
export type TrustBand = z.output<typeof trustBandSchema>;

export const scoreRecomputationResultSchema = z.object({
  tenantId: idSchema,
  contactId: idSchema,
  leadScore: z.number().int().min(0).max(100),
  trajectoryScore: z.number().int().min(-100).max(100),
  trustBand: trustBandSchema,
  leadScoreBreakdown: leadScoreBreakdownSchema,
  trajectoryScoreBreakdown: trajectoryScoreBreakdownSchema,
  recomputedAt: isoDateSchema,
  correlation: persistenceCorrelationMetadataSchema,
}).strict();
export type ScoreRecomputationResult = z.output<typeof scoreRecomputationResultSchema>;

export const scoreRecomputationJobPayloadSchema = z.object({
  tenantId: idSchema,
  contactId: idSchema,
  reason: idSchema.default("manual"),
  requestedAt: isoDateSchema,
  correlation: persistenceCorrelationMetadataSchema,
}).strict().refine((payload) => payload.tenantId.length > 0 && payload.contactId.length > 0, {
  message: "Score recomputation jobs require tenant and contact identifiers",
});
export type ScoreRecomputationJobPayload = z.output<typeof scoreRecomputationJobPayloadSchema>;

export const scoreRecomputationQueueContract = {
  queueName: "crm.scoring",
  jobType: "crm.score.recompute",
  idempotencyScope: "JOB",
} as const;

export const buildScoreRecomputationIdempotencyKey = (input: Pick<ScoreRecomputationJobPayload, "tenantId" | "contactId">): string =>
  `${scoreRecomputationQueueContract.jobType}:${input.tenantId}:${input.contactId}`;
