import { type NextRequest, NextResponse } from "next/server";

import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import {
  checkInvitationProviderHealth,
  createMessagingProviderRegistryFromEnv,
  type SellerInvitationChannelName,
} from "@whisperm/provider-adapters";

const supportedChannels = new Set<SellerInvitationChannelName>(["WHATSAPP", "SMS", "EMAIL"]);

const errorResponse = (message: string, status: number) => NextResponse.json({ ok: false, error: { message } }, { status });

// ST1-013J: read-only diagnostic -- lets an operator (or the workbench UI) ask "can WhispeRM
// actually deliver an invitation on this channel, in this environment, right now?" without
// guessing from env vars directly. Never returns secret values, only env var names, provider
// names, and the claim link origin.
export async function GET(request: NextRequest) {
  const tenant = await getTenantForCurrentUser();
  if (!tenant) return errorResponse("Unauthorized", 401);
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  const requestedChannel = (request.nextUrl.searchParams.get("channel") ?? "WHATSAPP").toUpperCase();
  if (!supportedChannels.has(requestedChannel as SellerInvitationChannelName)) {
    return errorResponse("channel must be one of WHATSAPP, SMS, EMAIL.", 400);
  }

  const health = checkInvitationProviderHealth({
    channel: requestedChannel as SellerInvitationChannelName,
    registry: createMessagingProviderRegistryFromEnv(),
  });

  if (health.ok) {
    return NextResponse.json({
      ok: true,
      provider: health.provider,
      channel: health.channel,
      claimBaseUrlConfigured: true,
    });
  }

  return NextResponse.json(
    {
      ok: false,
      error: {
        code: health.code,
        message: health.message,
        ...(health.diagnostics?.missingEnv === undefined ? {} : { missingEnv: health.diagnostics.missingEnv }),
        ...(health.diagnostics?.invalidEnv === undefined ? {} : { invalidEnv: health.diagnostics.invalidEnv }),
      },
    },
    { status: 503 },
  );
}
