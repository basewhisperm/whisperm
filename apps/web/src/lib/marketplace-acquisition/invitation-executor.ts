import { createPrismaRepositories, type PrismaPersistenceClient } from "@whisperm/repositories";
import {
  buildSellerInvitationNotificationPorts,
  createConsoleMessagingProviderLogger,
  createMessagingProviderRegistryFromEnv,
  type MessagingProviderRegistry,
} from "@whisperm/provider-adapters";
import { SellerInvitationService, type CampaignRuntimeInvitationExecutor } from "@whisperm/services";

// ST1-013: constructed once per process at module scope (same idiom as the shared `prisma`
// client) so every request in this process reuses the same WhatsApp/SMS/Email providers
// instead of re-parsing env and re-constructing clients on every invite request. apps/worker
// wires the identical registry factory in seller-invitation-port.ts.
const messagingProviderRegistry = createMessagingProviderRegistryFromEnv({ logger: createConsoleMessagingProviderLogger() });

// ST-003: the golden-path invite route calls this directly instead of only enqueueing a
// QueueJob row, so a successful response means the invitation was actually created/sent
// (or that delivery genuinely failed) rather than "a job was queued but may never run".
export const createSellerInvitationExecutor = (
  prisma: PrismaPersistenceClient,
  env: NodeJS.ProcessEnv = process.env,
  registry: MessagingProviderRegistry = messagingProviderRegistry,
): CampaignRuntimeInvitationExecutor => {
  const repositories = createPrismaRepositories(prisma);
  const notifications = buildSellerInvitationNotificationPorts(registry, env);

  const service = new SellerInvitationService({
    ...repositories,
    notifications,
  } as ConstructorParameters<typeof SellerInvitationService>[0]);

  return {
    async sendInvitation(context, input) {
      const result = await service.createSellerInvitation(
        { tenantId: context.tenantId, actorId: "api", correlation: context.correlation },
        { tenantId: input.tenantId, captureId: input.captureId, preferredChannel: input.channel },
      );
      return { invitationId: result.invitationId, status: result.status, provider: result.channel };
    },
  };
};
