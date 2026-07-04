import { NextResponse } from "next/server";

import { authorizeAcquisitionActionForApi } from "@/lib/acquisition-governance";
import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import { PersistenceError, PrismaCampaignRuntimeExecutionRepository, PrismaSellerAcquisitionCampaignRepository, type PrismaPersistenceClient } from "@whisperm/repositories";
import { CampaignRuntimeService, type CampaignRuntimeInvitationQueue } from "@whisperm/services";

interface RouteContext { readonly params: { readonly campaignId: string; readonly executionId: string } }

const errorResponse = (message: string, status: number) => NextResponse.json({ ok: false, error: { message } }, { status });

const invitationQueue = (): CampaignRuntimeInvitationQueue => ({
  async enqueueInvitation(input) {
    await prisma.queueJob.create({
      data: {
        tenantId: input.tenantId,
        queueName: "marketplace.invite",
        jobName: "marketplace.invite.send",
        jobKey: `campaign-runtime:${input.tenantId}:${input.executionId}:manual-retry:${Date.now()}`,
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

export async function POST(_request: Request, context: RouteContext) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return errorResponse("Unauthorized", 401);
  const { tenant } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  const { denied } = await authorizeAcquisitionActionForApi(tenant.id, {
    capability: "INVITATION",
    campaignId: context.params.campaignId,
    source: "API",
  });
  if (denied) return denied;

  try {
    const service = runtimeService();
    const existing = await service.getCampaignExecution({ tenantId: tenant.id }, context.params.executionId);
    if (existing === null || existing.campaignId !== context.params.campaignId) return errorResponse("Campaign runtime execution not found", 404);
    const execution = await service.retryInvitationExecution({ tenantId: tenant.id }, context.params.executionId);
    const metrics = typeof execution.metrics === "object" && execution.metrics !== null ? execution.metrics : {};
    return NextResponse.json({
      ok: true,
      data: {
        executionId: execution.id,
        status: execution.status,
        retryCount: typeof metrics.retryCount === "number" ? metrics.retryCount : 0,
        nextRetryAt: typeof metrics.nextRetryAt === "string" ? metrics.nextRetryAt : null,
      },
    }, { status: 202 });
  } catch (error) {
    if (error instanceof PersistenceError) return errorResponse(error.message, error.status);
    return errorResponse("Invitation execution retry failed.", 500);
  }
}
