import { NextRequest, NextResponse } from "next/server";

import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { readJsonBody, RequestBodyError } from "@/lib/api/request-body";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import {
  PrismaAuditLogRepository,
  PrismaContactRepository,
  PrismaDealsRepository,
  PrismaMarketplaceCaptureRepository,
  PrismaMarketplaceClaimTokenRepository,
  PrismaPipelineRepository,
  PrismaSellerInvitationRepository,
  type PrismaPersistenceClient,
} from "@whisperm/repositories";
import { createHttpSmsProviderFromEnv, createMetaWhatsAppCloudProviderFromEnv } from "@whisperm/provider-adapters";
import { SellerInvitationService, ServiceError, type SellerInvitationProviderPorts } from "@whisperm/services";
import { sellerInvitationCreateRequestSchema } from "@whisperm/types";

interface RouteContext { readonly params: { readonly id: string } }

const serviceDependencies = () => ({
  contacts: new PrismaContactRepository(prisma as unknown as PrismaPersistenceClient),
  marketplaceCaptures: new PrismaMarketplaceCaptureRepository(prisma as unknown as PrismaPersistenceClient),
  sellerInvitations: new PrismaSellerInvitationRepository(prisma as unknown as PrismaPersistenceClient),
  marketplaceClaimTokens: new PrismaMarketplaceClaimTokenRepository(prisma as unknown as PrismaPersistenceClient),
  pipelines: new PrismaPipelineRepository(prisma as unknown as PrismaPersistenceClient),
  deals: new PrismaDealsRepository(prisma as unknown as PrismaPersistenceClient),
  auditLogs: new PrismaAuditLogRepository(prisma as unknown as PrismaPersistenceClient),
});

const configuredEmailProvider = (env: NodeJS.ProcessEnv): SellerInvitationProviderPorts["email"] | undefined => {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (apiKey === undefined || apiKey.length === 0) return undefined;
  const from = env.EMAIL_FROM ?? "WhispeRM <noreply@whisperm.ai>";
  return {
    async send(message) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to: message.to, subject: message.subject, html: message.html }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error("Seller invitation email provider failed");
    },
  };
};


const configuredSmsProvider = (env: NodeJS.ProcessEnv): SellerInvitationProviderPorts["sms"] | undefined => {
  const provider = env.SELLER_INVITATION_SMS_PROVIDER?.trim();
  const apiUrl = env.SELLER_INVITATION_SMS_API_URL?.trim();
  const apiKey = env.SELLER_INVITATION_SMS_API_KEY?.trim();
  const senderId = env.SELLER_INVITATION_SMS_SENDER_ID?.trim();
  if (provider === undefined || provider.length === 0 || apiUrl === undefined || apiUrl.length === 0 || apiKey === undefined || apiKey.length === 0 || senderId === undefined || senderId.length === 0) return undefined;
  return createHttpSmsProviderFromEnv(env);
};

const sellerInvitationNotifications = (): SellerInvitationProviderPorts => {
  const email = configuredEmailProvider(process.env);
  const sms = configuredSmsProvider(process.env);
  const whatsapp = createMetaWhatsAppCloudProviderFromEnv(process.env);
  const notifications: SellerInvitationProviderPorts = {
    whatsappEnabled: process.env.SELLER_INVITATION_WHATSAPP_ENABLED !== "false",
    fallbackToSmsWhenWhatsappMissing: process.env.SELLER_INVITATION_FALLBACK_TO_SMS !== "false",
    inviteBaseUrl: process.env.SELLER_INVITATION_BASE_URL,
    ...(email === undefined ? {} : { email }),
    ...(sms === undefined ? {} : { sms }),
    ...(whatsapp === undefined ? {} : { whatsapp }),
  };
  return notifications;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { tenant, tenantUserId } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  let body: unknown;
  try {
    body = await readJsonBody(request, { maxBytes: 16_000 });
  } catch (error) {
    if (error instanceof RequestBodyError) return NextResponse.json({ ok: false, error: { message: error.message, code: error.code } }, { status: error.status });
    body = {};
  }

  const parsed = sellerInvitationCreateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "A supported preferredChannel is required when provided" }, { status: 400 });
  }

  const service = new SellerInvitationService({
    ...serviceDependencies(),
    notifications: sellerInvitationNotifications(),
  } as unknown as ConstructorParameters<typeof SellerInvitationService>[0]);

  try {
    const result = await service.createSellerInvitation(
      {
        tenantId: tenant.id,
        actorId: tenantUserId,
        correlation: {
          correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
          requestId: request.headers.get("x-request-id") ?? undefined,
        },
      },
      { tenantId: tenant.id, captureId: params.id, ...parsed.data },
    );
    return NextResponse.json(result);
  } catch (error) {

    if (error instanceof ServiceError) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            message: error.message,
            code: error.code,
            details: error.details,
          },
        },
        { status: error.status },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: {
          message: error instanceof Error ? error.message : "Seller invitation failed",
          stack:
            process.env.NODE_ENV !== "production" && error instanceof Error
              ? error.stack
              : undefined,
        },
      },
      { status: 500 },
    );
  }
}
