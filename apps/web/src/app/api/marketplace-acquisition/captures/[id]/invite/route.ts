import { NextRequest, NextResponse } from "next/server";

import { authorizeAcquisitionActionForApi } from "@/lib/acquisition-governance";
import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { readJsonBody, RequestBodyError } from "@/lib/api/request-body";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import {
  PersistenceError,
  PrismaCampaignRuntimeExecutionRepository,
  PrismaSellerAcquisitionCampaignRepository,
  PrismaSellerInvitationRepository,
  type PrismaPersistenceClient,
} from "@whisperm/repositories";
import { CampaignRuntimeService, type CampaignRuntimeInvitationQueue } from "@whisperm/services";
import { sellerInvitationCreateRequestSchema } from "@whisperm/types";
import { createSellerInvitationExecutor } from "@/lib/marketplace-acquisition/invitation-executor";
import {
  invitationEligibilityHttpStatus,
  resolveInvitationEligibility,
} from "@/lib/marketplace-acquisition/invitation-eligibility";

interface RouteContext { readonly params: { readonly id: string } }

const invitationQueue = (): CampaignRuntimeInvitationQueue => ({
  async enqueueInvitation(input) {
    await prisma.queueJob.create({
      data: {
        tenantId: input.tenantId,
        queueName: "marketplace.invite",
        jobName: "marketplace.invite.send",
        jobKey: `campaign-runtime:${input.tenantId}:${input.executionId}`,
        payload: {
          tenantId: input.tenantId,
          campaignId: input.campaignId,
          opportunityId: input.opportunityId,
          captureId: input.opportunityId,
          executionId: input.executionId,
          invitationId: input.invitationId ?? null,
          preferredChannel: input.preferredChannel ?? "WHATSAPP",
          channel: input.preferredChannel ?? "WHATSAPP",
          correlationId: input.correlationId ?? input.executionId,
          delayMs: input.delayMs ?? 0,
          replaySafe: true,
        },
        maxAttempts: 3,
        correlationId: input.correlationId ?? input.executionId,
      },
    });
  },
});

const runtimeService = () => new CampaignRuntimeService({
  campaigns: new PrismaSellerAcquisitionCampaignRepository(prisma as unknown as PrismaPersistenceClient),
  executions: new PrismaCampaignRuntimeExecutionRepository(prisma as unknown as PrismaPersistenceClient),
  sellerInvitations: new PrismaSellerInvitationRepository(prisma as unknown as PrismaPersistenceClient),
  invitationQueue: invitationQueue(),
  invitationExecutor: createSellerInvitationExecutor(prisma as unknown as PrismaPersistenceClient),
});

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

  const preferredChannel = parsed.data.preferredChannel ?? "WHATSAPP";
  const eligibility = await resolveInvitationEligibility(prisma, { tenantId: tenant.id, captureId: params.id, channel: preferredChannel });
  if (!eligibility.eligible) {
    return NextResponse.json(
      { ok: false, error: { code: eligibility.code, message: eligibility.message } },
      { status: invitationEligibilityHttpStatus(eligibility) },
    );
  }

  const { denied } = await authorizeAcquisitionActionForApi(tenant.id, {
    capability: "INVITATION",
    campaignId: eligibility.campaignId,
    provider: preferredChannel,
    actorId: tenantUserId,
    source: "API",
  });
  if (denied) return denied;

  try {
    const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
    const execution = await runtimeService().executeInvitation(
      { tenantId: tenant.id },
      {
        campaignId: eligibility.campaignId,
        opportunityId: eligibility.captureId,
        preferredChannel,
        initiatedBy: tenantUserId,
        correlationId,
      },
    );
    const metrics = execution.metrics ?? {};
    const invitationId = typeof metrics.invitationId === "string" ? metrics.invitationId : undefined;
    if (execution.status === "FAILED") {
      return NextResponse.json(
        { ok: false, error: { code: execution.errorCode ?? "INVITATION_DELIVERY_FAILED", message: execution.errorMessage ?? "Seller invitation delivery failed" } },
        { status: execution.errorCode === "SERVICE_PROVIDER_UNAVAILABLE" ? 503 : 422 },
      );
    }
    return NextResponse.json({
      ok: true,
      invitationId,
      executionId: execution.id,
      status: execution.status === "COMPLETED" ? "SENT" : "QUEUED",
    }, { status: execution.status === "COMPLETED" ? 200 : 202 });
  } catch (error) {
    if (error instanceof PersistenceError) {
      return NextResponse.json({ ok: false, error: { message: error.message, code: error.code } }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: { message: "Seller invitation intent failed" } }, { status: 500 });
  }
}
