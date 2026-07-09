import { z } from "zod";

/**
 * ST1-013M: canonical payload contracts for every job type that crosses the QueueJob producer
 * boundary (an API route or a service enqueueing durable work). Each schema is validated before
 * a QueueJob row is ever persisted (see RuntimeJobService.enqueueRuntimeJob in
 * runtime-job-service.ts) -- an invalid payload fails the enqueue call with a clear error
 * instead of being written to the durable queue and only discovered as a handler crash later.
 *
 * apps/worker's handlers (createSellerInvitationHandler, createClaimLifecycleHandler,
 * createGrowthLoopHandler) import these same schemas to validate `context.job.payload` again on
 * the consumption side -- one contract, enforced at both ends, not two schemas that can drift.
 *
 * See docs/runtime/runtime-surface.md for the full producer -> queue -> consumer map.
 */

export const invitationChannelSchema = z.enum(["WHATSAPP", "SMS", "EMAIL"]);
export type InvitationChannelPayload = z.infer<typeof invitationChannelSchema>;

export const marketplaceInviteQueueName = "marketplace.invite" as const;
export const marketplaceInviteSendJobType = "marketplace.invite.send" as const;

export const marketplaceInviteSendPayloadSchema = z.object({
  tenantId: z.string().min(1),
  campaignId: z.string().min(1).optional(),
  opportunityId: z.string().min(1).optional(),
  captureId: z.string().min(1).optional(),
  executionId: z.string().min(1).optional(),
  invitationId: z.string().min(1).nullable().optional(),
  preferredChannel: invitationChannelSchema.optional(),
  channel: invitationChannelSchema.optional(),
  correlationId: z.string().min(1).optional(),
  delayMs: z.number().int().min(0).optional(),
  replaySafe: z.literal(true).optional(),
}).passthrough().transform((payload, ctx) => {
  const captureId = payload.captureId ?? payload.opportunityId;
  if (captureId === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "captureId or opportunityId is required" });
    return z.NEVER;
  }
  return { ...payload, captureId, channel: payload.preferredChannel ?? payload.channel ?? "WHATSAPP" };
});
export type MarketplaceInviteSendPayload = z.output<typeof marketplaceInviteSendPayloadSchema>;

export const marketplaceClaimLifecycleQueueName = "marketplace.claim.lifecycle" as const;
export const marketplaceClaimReminderJobType = "marketplace.claim.reminder" as const;
export const marketplaceClaimExpireJobType = "marketplace.claim.expire" as const;
export const marketplaceClaimIntelligenceJobType = "marketplace.claim.intelligence" as const;

export const claimLifecycleJobPayloadSchema = z.object({
  tenantId: z.string().min(1),
  invitationId: z.string().min(1),
  campaignId: z.string().min(1).optional(),
  executionId: z.string().min(1).optional(),
  correlationId: z.string().min(1).optional(),
  replaySafe: z.literal(true).optional(),
  reminderType: z.enum(["DAY_3", "DAY_6"]).optional(),
}).strict();
export type ClaimLifecycleJobPayload = z.output<typeof claimLifecycleJobPayloadSchema>;

export const growthLoopQueueName = "marketplace.growth.loop" as const;
export const growthLoopJobType = "marketplace.growth.loop.evaluate" as const;
const growthLoopTriggerValues = ["MANUAL", "REVENUE_ATTRIBUTION_COMPLETED", "CAMPAIGN_EXECUTION_COMPLETED", "SCHEDULED_REVIEW"] as const;

export const growthLoopJobPayloadSchema = z.object({
  tenantId: z.string().min(1),
  campaignId: z.string().min(1),
  trigger: z.enum(growthLoopTriggerValues).default("MANUAL"),
  correlationId: z.string().min(1).optional(),
  replaySafe: z.literal(true).optional(),
}).passthrough();
export type GrowthLoopJobPayload = z.output<typeof growthLoopJobPayloadSchema>;

/** Keyed by `${queueName}:${jobName}` -- see RuntimeJobService.enqueueRuntimeJob. */
export const runtimeJobPayloadSchemas: Readonly<Record<string, z.ZodTypeAny>> = {
  [`${marketplaceInviteQueueName}:${marketplaceInviteSendJobType}`]: marketplaceInviteSendPayloadSchema,
  [`${marketplaceClaimLifecycleQueueName}:${marketplaceClaimReminderJobType}`]: claimLifecycleJobPayloadSchema,
  [`${marketplaceClaimLifecycleQueueName}:${marketplaceClaimExpireJobType}`]: claimLifecycleJobPayloadSchema,
  [`${marketplaceClaimLifecycleQueueName}:${marketplaceClaimIntelligenceJobType}`]: claimLifecycleJobPayloadSchema,
  [`${growthLoopQueueName}:${growthLoopJobType}`]: growthLoopJobPayloadSchema,
};
