import { PrismaQueueJobRepository, type PrismaPersistenceClient } from "@whisperm/repositories";
import {
  RuntimeJobService,
  marketplaceInviteQueueName,
  marketplaceInviteSendJobType,
  type CampaignRuntimeInvitationQueue,
} from "@whisperm/services";

/**
 * ST1-013M: canonical producer for `marketplace.invite.send` QueueJob rows. Every route that
 * needs a CampaignRuntimeInvitationQueue must build it from here instead of calling
 * `prisma.queueJob.create` directly -- this validates the payload against the same contract the
 * worker's durable consumer validates on the way out (see runtime-job-contracts.ts in
 * @whisperm/services) and goes through the same idempotent-enqueue path the worker's own
 * schedulers use, instead of three separate hand-rolled copies of this object literal.
 *
 * This queue is the ST-003 fallback path: `CampaignRuntimeService` only calls it when no
 * `invitationExecutor` is configured (or an executor-dispatched invitation needs a retry
 * scheduled), since the synchronous executor is the golden path in production. See
 * docs/runtime/runtime-surface.md.
 */
export const createInvitationRuntimeJobQueue = (prisma: PrismaPersistenceClient): CampaignRuntimeInvitationQueue => {
  const runtimeJobs = new RuntimeJobService({ queueJobs: new PrismaQueueJobRepository(prisma) });
  return {
    async enqueueInvitation(input) {
      await runtimeJobs.enqueueRuntimeJob(
        { tenantId: input.tenantId },
        {
          queueName: marketplaceInviteQueueName,
          jobName: marketplaceInviteSendJobType,
          jobKey: `campaign-runtime:${input.tenantId}:${input.executionId}`,
          payload: {
            tenantId: input.tenantId,
            campaignId: input.campaignId,
            opportunityId: input.opportunityId,
            captureId: input.opportunityId,
            executionId: input.executionId,
            invitationId: input.invitationId ?? null,
            preferredChannel: input.preferredChannel ?? "WHATSAPP",
            channel: input.preferredChannel ?? "WHATSAPP",
            correlationId: input.correlationId ?? input.executionId,
            delayMs: input.delayMs ?? 0,
            replaySafe: true,
          },
          maxAttempts: 3,
          correlationId: input.correlationId ?? input.executionId,
        },
      );
    },
  };
};

/** Manual-retry variant: distinct jobKey per retry attempt so a retry never collapses onto the original dispatch job's idempotency key. */
export const createManualRetryInvitationRuntimeJobQueue = (prisma: PrismaPersistenceClient): CampaignRuntimeInvitationQueue => {
  const runtimeJobs = new RuntimeJobService({ queueJobs: new PrismaQueueJobRepository(prisma) });
  return {
    async enqueueInvitation(input) {
      await runtimeJobs.enqueueRuntimeJob(
        { tenantId: input.tenantId },
        {
          queueName: marketplaceInviteQueueName,
          jobName: marketplaceInviteSendJobType,
          jobKey: `campaign-runtime:${input.tenantId}:${input.executionId}:manual-retry:${Date.now()}`,
          payload: {
            tenantId: input.tenantId,
            campaignId: input.campaignId,
            opportunityId: input.opportunityId,
            captureId: input.opportunityId,
            executionId: input.executionId,
            invitationId: input.invitationId ?? null,
            preferredChannel: input.preferredChannel ?? "WHATSAPP",
            channel: input.preferredChannel ?? "WHATSAPP",
            correlationId: input.correlationId ?? input.executionId,
            delayMs: input.delayMs ?? 0,
            replaySafe: true,
          },
          maxAttempts: 3,
          correlationId: input.correlationId ?? input.executionId,
        },
      );
    },
  };
};
