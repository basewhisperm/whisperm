import type { QueueJobRepository } from "@whisperm/repositories";
import type { CampaignRuntimeInvitationQueue } from "./campaign-runtime.js";
import { RuntimeJobService } from "./runtime-job-service.js";
import { marketplaceInviteQueueName, marketplaceInviteSendJobType } from "./runtime-job-contracts.js";

/**
 * ST1-013M: canonical producer for `marketplace.invite.send` QueueJob rows, shared by every
 * caller that needs a CampaignRuntimeInvitationQueue -- apps/web's routes and apps/worker's
 * bootstrap alike -- instead of each hand-rolling its own copy (which is how the durable worker
 * ended up with no invitationQueue configured at all: retries after a worker-driven send failure
 * had nowhere to go). See docs/runtime/runtime-surface.md.
 *
 * This queue is the ST-003 fallback path: `CampaignRuntimeService` only calls it when no
 * `invitationExecutor` is configured, or to schedule a backoff retry after a failed attempt.
 */
const buildPayload = (input: {
  readonly tenantId: string;
  readonly campaignId: string;
  readonly opportunityId: string;
  readonly executionId: string;
  readonly invitationId?: string | undefined;
  readonly preferredChannel?: "WHATSAPP" | "SMS" | "EMAIL" | undefined;
  readonly correlationId?: string | undefined;
}) => ({
  tenantId: input.tenantId,
  campaignId: input.campaignId,
  opportunityId: input.opportunityId,
  captureId: input.opportunityId,
  executionId: input.executionId,
  invitationId: input.invitationId ?? null,
  preferredChannel: input.preferredChannel ?? "WHATSAPP",
  channel: input.preferredChannel ?? "WHATSAPP",
  correlationId: input.correlationId ?? input.executionId,
  replaySafe: true,
});

/** delayMs -> the actual future instant QueueJob.availableAt must hold for backoff to be honored. */
const availableAtFromDelay = (delayMs: number | undefined): string =>
  new Date(Date.now() + Math.max(0, delayMs ?? 0)).toISOString();

export const createInvitationRuntimeJobQueue = (queueJobs: QueueJobRepository): CampaignRuntimeInvitationQueue => {
  const runtimeJobs = new RuntimeJobService({ queueJobs });
  return {
    async enqueueInvitation(input) {
      await runtimeJobs.enqueueRuntimeJob(
        { tenantId: input.tenantId },
        {
          queueName: marketplaceInviteQueueName,
          jobName: marketplaceInviteSendJobType,
          // ST1-013M: the initial dispatch (attempt undefined) and each scheduled retry
          // (attempt = the new retry count) get distinct keys -- reusing the initial job's key
          // for a retry would make the enqueue call return that (still-ACTIVE) row instead of
          // creating a new one, and the retry would never actually run.
          jobKey: input.attempt === undefined
            ? `campaign-runtime:${input.tenantId}:${input.executionId}`
            : `campaign-runtime:${input.tenantId}:${input.executionId}:retry:${input.attempt}`,
          payload: buildPayload(input),
          maxAttempts: 3,
          availableAt: availableAtFromDelay(input.delayMs),
          correlationId: input.correlationId ?? input.executionId,
        },
      );
    },
  };
};

/** Manual-retry variant: always a fresh jobKey, since a human can retry the same execution repeatedly. */
export const createManualRetryInvitationRuntimeJobQueue = (queueJobs: QueueJobRepository): CampaignRuntimeInvitationQueue => {
  const runtimeJobs = new RuntimeJobService({ queueJobs });
  return {
    async enqueueInvitation(input) {
      await runtimeJobs.enqueueRuntimeJob(
        { tenantId: input.tenantId },
        {
          queueName: marketplaceInviteQueueName,
          jobName: marketplaceInviteSendJobType,
          jobKey: `campaign-runtime:${input.tenantId}:${input.executionId}:manual-retry:${Date.now()}`,
          payload: buildPayload(input),
          maxAttempts: 3,
          availableAt: availableAtFromDelay(input.delayMs),
          correlationId: input.correlationId ?? input.executionId,
        },
      );
    },
  };
};
