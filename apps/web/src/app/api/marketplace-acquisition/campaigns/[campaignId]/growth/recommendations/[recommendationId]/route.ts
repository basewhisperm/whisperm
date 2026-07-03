import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, RequestBodyError } from "@/lib/api/request-body";
import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import {
  createPrismaRepositories,
  PrismaCampaignRuntimeExecutionRepository,
  type PrismaPersistenceClient,
} from "@whisperm/repositories";
import { CampaignRuntimeService } from "@whisperm/services";

const errorResponse = (message: string, status: number) =>
  NextResponse.json({ ok: false, error: { message } }, { status });

const requestSchema = z.object({
  action: z.enum(["APPLY", "DISMISS"]),
  reason: z.string().trim().min(1).max(500).optional(),
}).strict();

interface RouteContext {
  readonly params: { readonly campaignId: string; readonly recommendationId: string };
}

// Approval/rejection of a growth recommendation delegates to CampaignRuntimeService,
// which mutates the campaign only through the existing SellerAcquisitionCampaignRepository
// ownership -- this route coordinates the request and never mutates targeting/schedule itself.
const runtimeService = () => {
  const persistence = prisma as unknown as PrismaPersistenceClient;
  const repositories = createPrismaRepositories(persistence);
  return new CampaignRuntimeService({
    campaigns: repositories.sellerAcquisitionCampaigns,
    executions: new PrismaCampaignRuntimeExecutionRepository(persistence),
    opportunities: repositories.businessGrowthOpportunities,
    deals: repositories.deals,
    auditLogs: repositories.auditLogs,
  });
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return errorResponse("Unauthorized", 401);

  const { tenant, tenantUserId } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  let body: unknown;
  try {
    body = await readJsonBody(request, { maxBytes: 2_000 });
  } catch (error) {
    if (error instanceof RequestBodyError) return errorResponse(error.message, error.status);
    body = {};
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? "Invalid growth recommendation request.", 400);

  const service = runtimeService();
  const scope = { tenantId: tenant.id };
  const input = { campaignId: context.params.campaignId, recommendationId: context.params.recommendationId, actorId: tenantUserId };

  try {
    const campaign = parsed.data.action === "APPLY"
      ? await service.applyGrowthRecommendation(scope, input)
      : await service.dismissGrowthRecommendation(scope, { ...input, reason: parsed.data.reason });
    return NextResponse.json({ ok: true, data: { campaign } });
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { readonly status: unknown }).status) : 500;
    const message = error instanceof Error ? error.message : "Growth recommendation update failed.";
    return errorResponse(message, Number.isFinite(status) ? status : 500);
  }
}
