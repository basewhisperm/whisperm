import { createPrismaRepositories, type PrismaPersistenceClient } from "@whisperm/repositories";
import { SellerInvitationService } from "@whisperm/services";
import { createMetaWhatsAppCloudProviderFromEnv, createHttpSmsProviderFromEnv } from "@whisperm/provider-adapters";
import type { SellerInvitationServicePort } from "./index.js";
import type { CorrelationMetadata } from "@whisperm/types";

export const createSellerInvitationServicePort = (
  prisma: PrismaPersistenceClient,
  env: NodeJS.ProcessEnv = process.env,
  claimLifecycleScheduler?: ConstructorParameters<typeof SellerInvitationService>[0]["claimLifecycleScheduler"],
): SellerInvitationServicePort => {
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
    ...(claimLifecycleScheduler === undefined ? {} : { claimLifecycleScheduler }),
  } as ConstructorParameters<typeof SellerInvitationService>[0]);

  return {
    async sendInvitation(
      context: { readonly tenantId: string; readonly correlation: CorrelationMetadata },
      input: { readonly tenantId: string; readonly captureId: string; readonly channel: string },
    ) {
      const result = await service.createSellerInvitation(
        {
          tenantId: context.tenantId,
          actorId: "worker",
          correlation: context.correlation,
        },
        {
          tenantId: input.tenantId,
          captureId: input.captureId,
          preferredChannel: input.channel as "WHATSAPP" | "SMS" | "EMAIL",
        },
      );
      return {
        invitationId: result.invitationId,
        status: result.status,
      };
    },
  };
};
