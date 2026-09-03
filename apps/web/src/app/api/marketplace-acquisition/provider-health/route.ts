import { type NextRequest } from "next/server";

import { apiFailure, apiSuccess } from "@/app/api/_lib/api-response";
import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import {
  checkInvitationProviderHealth,
  createMessagingProviderRegistryFromEnv,
  type SellerInvitationChannelName,
} from "@whisperm/provider-adapters";

const supportedChannels = new Set<SellerInvitationChannelName>(["WHATSAPP", "SMS", "EMAIL"]);

// ST1-013J: read-only diagnostic -- lets an operator (or the workbench UI) ask "can WhispeRM
// actually deliver an invitation on this channel, in this environment, right now?" without
// guessing from env vars directly. Never returns secret values, only env var names, provider
// names, and the claim link origin.
export async function GET(request: NextRequest) {
  const tenant = await getTenantForCurrentUser();
  if (!tenant) return apiFailure(401, "UNAUTHORIZED", "Unauthorized");
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  const requestedChannel = (request.nextUrl.searchParams.get("channel") ?? "WHATSAPP").toUpperCase();
  if (!supportedChannels.has(requestedChannel as SellerInvitationChannelName)) {
    return apiFailure(400, "VALIDATION_ERROR", "channel must be one of WHATSAPP, SMS, EMAIL.");
  }

  const health = checkInvitationProviderHealth({
    channel: requestedChannel as SellerInvitationChannelName,
    registry: createMessagingProviderRegistryFromEnv(),
  });

  if (health.ok) {
    return apiSuccess({
      provider: health.provider,
      channel: health.channel,
      claimBaseUrlConfigured: true,
    });
  }

  const details = {
    code: health.code,
    ...(health.diagnostics?.missingEnv === undefined ? {} : { missingEnv: health.diagnostics.missingEnv }),
    ...(health.diagnostics?.invalidEnv === undefined ? {} : { invalidEnv: health.diagnostics.invalidEnv }),
  };
  return apiFailure(503, "RUNTIME_UNAVAILABLE", health.message, details);
}
