import { PrismaQueueJobRepository, type PrismaPersistenceClient } from "@whisperm/repositories";
import {
  createInvitationRuntimeJobQueue as createSharedInvitationRuntimeJobQueue,
  createManualRetryInvitationRuntimeJobQueue as createSharedManualRetryInvitationRuntimeJobQueue,
  type CampaignRuntimeInvitationQueue,
} from "@whisperm/services";

/**
 * ST1-013M: thin Prisma-backed wrapper over the canonical producer in @whisperm/services
 * (invitation-runtime-job-queue.ts), which apps/worker's bootstrap also uses -- one producer
 * implementation, not two. See docs/runtime/runtime-surface.md.
 */
export const createInvitationRuntimeJobQueue = (prisma: PrismaPersistenceClient): CampaignRuntimeInvitationQueue =>
  createSharedInvitationRuntimeJobQueue(new PrismaQueueJobRepository(prisma));

export const createManualRetryInvitationRuntimeJobQueue = (prisma: PrismaPersistenceClient): CampaignRuntimeInvitationQueue =>
  createSharedManualRetryInvitationRuntimeJobQueue(new PrismaQueueJobRepository(prisma));
