import {
  checkInvitationProviderHealth,
  createMessagingProviderRegistryFromEnv,
} from "@whisperm/provider-adapters";

type SharedInvitationChannel = "WHATSAPP" | "SMS" | "EMAIL";

/** V1 provider readiness comes from WhispeRM's operator-owned shared messaging registry. */
export const sharedInvitationProviderReady = (channel: SharedInvitationChannel): boolean =>
  checkInvitationProviderHealth({
    channel,
    registry: createMessagingProviderRegistryFromEnv(),
  }).ok;
