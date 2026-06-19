import { NextRequest, NextResponse } from "next/server";

import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import {
  PrismaAuditLogRepository,
  PrismaDealsRepository,
  PrismaMarketplaceCaptureRepository,
  PrismaPipelineRepository,
  PrismaSellerInvitationRepository,
  type PrismaPersistenceClient,
} from "@whisperm/repositories";
import { SellerInvitationService, ServiceError } from "@whisperm/services";
import { sellerInvitationCreateRequestSchema } from "@whisperm/types";

interface RouteContext { readonly params: { readonly id: string } }

const serviceDependencies = () => ({
  marketplaceCaptures: new PrismaMarketplaceCaptureRepository(prisma as unknown as PrismaPersistenceClient),
  sellerInvitations: new PrismaSellerInvitationRepository(prisma as unknown as PrismaPersistenceClient),
  pipelines: new PrismaPipelineRepository(prisma as unknown as PrismaPersistenceClient),
  deals: new PrismaDealsRepository(prisma as unknown as PrismaPersistenceClient),
  auditLogs: new PrismaAuditLogRepository(prisma as unknown as PrismaPersistenceClient),
});

export async function POST(request: NextRequest, { params }: RouteContext) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { tenant, tenantUserId } = tenantContext;

  const parsed = sellerInvitationCreateRequestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "A supported preferredChannel is required when provided" }, { status: 400 });
  }

  const service = new SellerInvitationService({
    ...serviceDependencies(),
    notifications: {
      whatsappEnabled: process.env.SELLER_INVITATION_WHATSAPP_ENABLED !== "false",
      fallbackToSmsWhenWhatsappMissing: process.env.SELLER_INVITATION_FALLBACK_TO_SMS !== "false",
      inviteBaseUrl: process.env.SELLER_INVITATION_BASE_URL,
    },
  } as unknown as ConstructorParameters<typeof SellerInvitationService>[0]);

  try {
    const result = await service.createSellerInvitation({ tenantId: tenant.id, actorId: tenantUserId, correlation: { correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(), requestId: request.headers.get("x-request-id") ?? undefined } }, { tenantId: tenant.id, captureId: params.id, ...parsed.data });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: "Seller invitation failed" }, { status: 500 });
  }
}
