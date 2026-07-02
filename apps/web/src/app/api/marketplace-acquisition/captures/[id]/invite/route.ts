import { NextRequest, NextResponse } from "next/server";

import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { readJsonBody, RequestBodyError } from "@/lib/api/request-body";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import {
  PersistenceError,
  PrismaCampaignRuntimeExecutionRepository,
  PrismaSellerAcquisitionCampaignRepository,
  type PrismaPersistenceClient,
} from "@whisperm/repositories";
import { CampaignRuntimeService, type CampaignRuntimeInvitationQueue } from "@whisperm/services";
import { sellerInvitationCreateRequestSchema } from "@whisperm/types";

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
  invitationQueue: invitationQueue(),
});

const resolveCampaignId = async (tenantId: string, captureId: string): Promise<string | null> => {
  const membership = await prisma.sellerAcquisitionCampaignMember.findFirst({
    where: { tenantId, marketplaceCaptureId: captureId, removedAt: null },
    select: { campaignId: true },
    orderBy: { assignedAt: "desc" },
  });
  return membership?.campaignId ?? null;
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

  const campaignId = await resolveCampaignId(tenant.id, params.id);
  if (campaignId === null) return NextResponse.json({ ok: false, error: { message: "Capture is not assigned to a campaign." } }, { status: 409 });

  try {
    const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
    const execution = await runtimeService().executeInvitation(
      { tenantId: tenant.id },
      {
        campaignId,
        opportunityId: params.id,
        preferredChannel: parsed.data.preferredChannel,
        initiatedBy: tenantUserId,
        correlationId,
      },
    );
    return NextResponse.json({ ok: true, data: { executionId: execution.id, status: "ACCEPTED" } }, { status: 202 });
  } catch (error) {
    if (error instanceof PersistenceError) {
      return NextResponse.json({ ok: false, error: { message: error.message, code: error.code } }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: { message: "Seller invitation intent failed" } }, { status: 500 });
  }
}
