import { createPrismaRepositories, type PrismaPersistenceClient } from "@whisperm/repositories";
import { SellerInvitationService } from "@whisperm/services";
import {
  buildSellerInvitationNotificationPorts,
  createMessagingProviderRegistryFromEnv,
  createConsoleMessagingProviderLogger,
  type MessagingProviderRegistry,
} from "@whisperm/provider-adapters";
import type { SellerInvitationServicePort } from "./index.js";
import type { CorrelationMetadata } from "@whisperm/types";

/**
 * ST1-013: worker and API both wire seller invitation notifications through this same
 * MessagingProviderRegistry factory -- neither instantiates the WhatsApp/SMS/Email provider
 * clients independently.
 */
export const createSellerInvitationServicePort = (
  prisma: PrismaPersistenceClient,
  env: NodeJS.ProcessEnv = process.env,
  claimLifecycleScheduler?: ConstructorParameters<typeof SellerInvitationService>[0]["claimLifecycleScheduler"],
  registry: MessagingProviderRegistry = createMessagingProviderRegistryFromEnv({ env, logger: createConsoleMessagingProviderLogger() }),
): SellerInvitationServicePort => {
  const repositories = createPrismaRepositories(prisma);

  const notifications = buildSellerInvitationNotificationPorts(registry, env);

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
