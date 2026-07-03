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

const requestSchema = z.object({ trigger: z.enum(["MANUAL", "SCHEDULED_REVIEW"]).optional() }).strict().default({});

interface RouteContext {
  readonly params: { readonly campaignId: string };
}

// Growth loop (CS-019) reuses the canonical CampaignRuntimeService -- this route
// coordinates only; it never computes signals or mutates targeting/schedule itself.
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

const growthView = (campaign: { readonly metadata?: unknown }) => {
  const metadata = typeof campaign.metadata === "object" && campaign.metadata !== null ? campaign.metadata as Record<string, unknown> : {};
  return {
    growthLoopStatus: metadata.growthLoopStatus ?? "NOT_EVALUATED",
    growthLoopTrigger: metadata.growthLoopTrigger ?? null,
    lastGrowthEvaluatedAt: metadata.lastGrowthEvaluatedAt ?? null,
    growthCompleteness: metadata.growthCompleteness ?? null,
    growthFailureCode: metadata.growthFailureCode ?? null,
    growthFailureMessage: metadata.growthFailureMessage ?? null,
    growthSignalSnapshot: metadata.growthSignalSnapshot ?? null,
    growthRecommendations: Array.isArray(metadata.growthRecommendations) ? metadata.growthRecommendations : [],
    growthRecomputeCount: metadata.growthRecomputeCount ?? 0,
  };
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return errorResponse("Unauthorized", 401);

  const { tenant } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  const campaign = await prisma.sellerAcquisitionCampaign.findFirst({ where: { tenantId: tenant.id, id: context.params.campaignId } });
  if (campaign === null) return errorResponse("Seller acquisition campaign not found.", 404);

  return NextResponse.json({ ok: true, data: growthView(campaign) });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return errorResponse("Unauthorized", 401);

  const { tenant } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  let body: unknown = {};
  try {
    body = await readJsonBody(request, { maxBytes: 2_000 });
  } catch (error) {
    if (error instanceof RequestBodyError) return errorResponse(error.message, error.status);
  }

  const parsed = requestSchema.safeParse(body ?? {});
  if (!parsed.success) return errorResponse("Invalid growth loop recompute request.", 400);

  try {
    const campaign = await runtimeService().evaluateGrowthLoop(
      { tenantId: tenant.id },
      { campaignId: context.params.campaignId, trigger: parsed.data.trigger ?? "MANUAL" },
    );
    return NextResponse.json({ ok: true, data: growthView(campaign) });
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { readonly status: unknown }).status) : 500;
    const message = error instanceof Error ? error.message : "Growth loop recompute failed.";
    return errorResponse(message, Number.isFinite(status) ? status : 500);
  }
}
