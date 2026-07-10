import { NextResponse } from "next/server";

import { authorizeAcquisitionActionForApi } from "@/lib/acquisition-governance";
import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import { PersistenceError, PrismaCampaignRuntimeExecutionRepository, PrismaSellerAcquisitionCampaignRepository, type PrismaPersistenceClient } from "@whisperm/repositories";
import { CampaignRuntimeService, resolveExecutionChannel } from "@whisperm/services";
import { createSellerInvitationExecutor } from "@/lib/marketplace-acquisition/invitation-executor";
import { createManualRetryInvitationRuntimeJobQueue } from "@/lib/marketplace-acquisition/runtime-job-queue";

interface RouteContext { readonly params: { readonly campaignId: string; readonly executionId: string } }

const errorResponse = (message: string, status: number) => NextResponse.json({ ok: false, error: { message } }, { status });

const runtimeService = () => new CampaignRuntimeService({
  campaigns: new PrismaSellerAcquisitionCampaignRepository(prisma as unknown as PrismaPersistenceClient),
  executions: new PrismaCampaignRuntimeExecutionRepository(prisma as unknown as PrismaPersistenceClient),
  invitationQueue: createManualRetryInvitationRuntimeJobQueue(prisma as unknown as PrismaPersistenceClient),
  invitationExecutor: createSellerInvitationExecutor(prisma as unknown as PrismaPersistenceClient),
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
    if (execution.status === "FAILED") {
      return NextResponse.json({ ok: false, error: { message: execution.errorMessage ?? "Seller invitation retry failed", code: execution.errorCode ?? "INVITATION_DELIVERY_FAILED" } }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      data: {
        executionId: execution.id,
        status: execution.status === "COMPLETED" ? "COMPLETED" : "PENDING",
        retryCount: typeof metrics.retryCount === "number" ? metrics.retryCount : 0,
        nextRetryAt: typeof metrics.nextRetryAt === "string" ? metrics.nextRetryAt : null,
        channel: resolveExecutionChannel(metrics),
      },
    }, { status: execution.status === "COMPLETED" ? 200 : 202 });
  } catch (error) {
    if (error instanceof PersistenceError) return errorResponse(error.message, error.status);
    return errorResponse("Invitation execution retry failed.", 500);
  }
}
