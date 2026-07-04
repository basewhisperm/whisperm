import { createPrismaRepositories, type PrismaPersistenceClient } from "@whisperm/repositories";
import { createHttpSmsProviderFromEnv, createMetaWhatsAppCloudProviderFromEnv } from "@whisperm/provider-adapters";
import { SellerInvitationService, type CampaignRuntimeInvitationExecutor } from "@whisperm/services";

// ST-003: the golden-path invite route calls this directly instead of only enqueueing a
// QueueJob row, so a successful response means the invitation was actually created/sent
// (or that delivery genuinely failed) rather than "a job was queued but may never run".
export const createSellerInvitationExecutor = (
  prisma: PrismaPersistenceClient,
  env: NodeJS.ProcessEnv = process.env,
): CampaignRuntimeInvitationExecutor => {
  const repositories = createPrismaRepositories(prisma);
  const whatsapp = createMetaWhatsAppCloudProviderFromEnv(env);
  const sms = createHttpSmsProviderFromEnv(env);

  const notifications = {
    whatsappEnabled: env.SELLER_INVITATION_WHATSAPP_ENABLED !== "false",
    fallbackToSmsWhenWhatsappMissing: env.SELLER_INVITATION_FALLBACK_TO_SMS !== "false",
    inviteBaseUrl: env.SELLER_INVITATION_BASE_URL,
    ...(whatsapp === undefined ? {} : { whatsapp }),
    ...(sms === undefined ? {} : { sms }),
  };

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
