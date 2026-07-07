import { NextRequest, NextResponse } from "next/server";

import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import { createPrismaRepositories, PrismaAcquisitionUsageEventRepository, PrismaDealsRepository, PrismaMarketplaceCaptureRepository, PrismaPipelineRepository, type PrismaPersistenceClient } from "@whisperm/repositories";
import { AcquisitionUsageMeteringService, createWhispeRMServices, RevenueAttributionRuntimeService } from "@whisperm/services";
import { MARKETPLACE_ACQUISITION_PIPELINE_KEY } from "@whisperm/types";

const ACQUISITION_STAGE_NAMES = new Set(["Captured", "Invited", "Claim Started", "Claimed", "Converted", "Expired"]);
const STATUS_BY_STAGE = new Map<string, string>([
  ["Captured", "CAPTURED"],
  ["Invited", "INVITED"],
  ["Claim Started", "CLAIM_STARTED"],
  ["Claimed", "CLAIMED"],
  ["Converted", "CONVERTED"],
  ["Expired", "EXPIRED"],
]);
// "Invited", "Claim Started", and "Claimed" are deliberately NOT reachable through this generic
// stage-move endpoint. Each already has a canonical, evidence-backed execution path that moves
// the deal's stage as a side effect of real work: SellerInvitationService.createSellerInvitation
// (-> moveToInvited) only advances to "Invited" after an invitation is actually sent, and
// SellerClaimPortalService only advances to "Claim Started"/"Claimed" when the seller themselves
// opens the claim link / submits their ownership attestation. Allowing a bare PATCH to fake those
// transitions let a capture be marked "Claimed" with zero attestation on record, which then
// permanently blocked the real seller from ever attesting (SellerClaimPortalService treats an
// already-"CLAIMED" capture as already claimed). "Expired" and "Converted" have no such evidence
// requirement -- expiring is a safe, conservative override, and "Converted" already routes
// through the canonical DealService.recordOutcome/RevenueAttributionRuntimeService below.
const ALLOWED_TRANSITIONS = new Map<string, readonly string[]>([
  ["Captured", ["Expired"]],
  ["Invited", ["Expired"]],
  ["Claim Started", ["Expired"]],
  ["Claimed", ["Converted"]],
  // ST1-008: Converted is the revenue-generating outcome for this pipeline. Allowing the
  // self-transition keeps repeated completion requests idempotent (revenue attribution is
  // re-evaluated, never duplicated) instead of failing the request with 422.
  ["Converted", ["Converted"]],
  ["Expired", []],
]);

interface RouteContext {
  readonly params: {
    readonly dealId: string;
  };
}

function requestedStageName(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("stageName" in body)) return null;
  const stageName = (body as { readonly stageName?: unknown }).stageName;
  return typeof stageName === "string" && ACQUISITION_STAGE_NAMES.has(stageName) ? stageName : null;
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const tenant = await getTenantForCurrentUser();
  if (!tenant) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  const stageName = requestedStageName(await request.json().catch(() => null));
  if (stageName === null) {
    return NextResponse.json({ error: "A supported acquisition stageName is required" }, { status: 400 });
  }

  const workspaceId = tenant.id;
  const dealsRepo = new PrismaDealsRepository(prisma as any);
  const pipelineRepo = new PrismaPipelineRepository(prisma as any);
  const captureRepo = new PrismaMarketplaceCaptureRepository(prisma as any);
  const [pipeline, deal] = await Promise.all([
    pipelineRepo.findByDefaultKey(workspaceId, MARKETPLACE_ACQUISITION_PIPELINE_KEY),
    dealsRepo.findById(workspaceId, params.dealId),
  ]);

  if (!pipeline) {
    return NextResponse.json({ error: "Marketplace Acquisition pipeline is missing" }, { status: 404 });
  }
  if (!deal || deal.pipelineId !== pipeline.id) {
    return NextResponse.json({ error: "Deal is not in the Marketplace Acquisition pipeline" }, { status: 404 });
  }

  const previousStage = pipeline.stages.find((candidate) => candidate.id === deal.pipelineStageId);
  if (!previousStage || !ALLOWED_TRANSITIONS.get(previousStage.name)?.includes(stageName)) {
    return NextResponse.json({ error: `Marketplace Acquisition stage transition ${previousStage?.name ?? "Unknown"} → ${stageName} is not allowed` }, { status: 422 });
  }

  const stage = pipeline.stages.find((candidate) => candidate.name === stageName);
  if (!stage) {
    return NextResponse.json({ error: `Marketplace Acquisition ${stageName} stage is missing` }, { status: 409 });
  }

  const capture = await captureRepo.findByDealId({ tenantId: workspaceId }, deal.id);
  if (!capture) {
    return NextResponse.json({ error: "Marketplace capture not found for acquisition deal" }, { status: 404 });
  }

  const updatedDeal = await dealsRepo.updateStage(workspaceId, deal.id, stage.id);
  const status = STATUS_BY_STAGE.get(stage.name) ?? capture.status;
  const updatedCapture = await captureRepo.update({ tenantId: workspaceId }, capture.id, { status });

  // ST1-008: "Converted" is the canonical revenue-generating outcome for the Marketplace
  // Acquisition pipeline. Route through DealService.recordOutcome -- the single canonical
  // execution path -- which reuses RevenueAttributionRuntimeService rather than this route
  // implementing any attribution logic itself.
  let revenueAttributed = false;
  let attributionId: string | null = null;
  let attributedAmount: string | null = null;

  if (stage.name === "Converted") {
    const repositories = createPrismaRepositories(prisma as unknown as PrismaPersistenceClient);
    const usageMetering = new AcquisitionUsageMeteringService({ usageEvents: new PrismaAcquisitionUsageEventRepository(prisma as unknown as PrismaPersistenceClient) });
    const revenueAttribution = new RevenueAttributionRuntimeService({
      deals: repositories.deals,
      businessGrowthOpportunities: repositories.businessGrowthOpportunities,
      marketplaceCaptures: repositories.marketplaceCaptures,
      sellerInvitations: repositories.sellerInvitations,
      claimTokens: repositories.marketplaceClaimTokens,
      usageMetering,
    });
    const services = createWhispeRMServices({ ...repositories, revenueAttribution });
    const correlation = {
      correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
      requestId: request.headers.get("x-request-id") ?? undefined,
    };
    const { attribution } = await services.deals.recordOutcome(
      { tenantId: workspaceId, correlation },
      updatedDeal.id,
      { closedAt: updatedDeal.closedAt ?? new Date().toISOString(), expectedUpdatedAt: updatedDeal.updatedAt },
    );
    revenueAttributed = attribution?.status === "ATTRIBUTED";
    attributionId = attribution?.snapshot?.idempotencyKey ?? null;
    attributedAmount = attribution?.snapshot?.revenueAmount ?? null;
  }

  return NextResponse.json({
    ok: true,
    data: {
      dealId: updatedDeal.id,
      dealStatus: stage.name,
      captureId: updatedCapture.id,
      captureStatus: updatedCapture.status,
      previousStage: previousStage.name,
      currentStage: stage.name,
      updatedAt: updatedDeal.updatedAt,
      revenueAttributed,
      attributionId,
      attributedAmount,
    },
  });
}
