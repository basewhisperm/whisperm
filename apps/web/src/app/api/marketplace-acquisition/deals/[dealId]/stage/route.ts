import { NextRequest, NextResponse } from "next/server";

import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import { PrismaDealsRepository, PrismaMarketplaceCaptureRepository, PrismaPipelineRepository } from "@whisperm/repositories";
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
const ALLOWED_TRANSITIONS = new Map<string, readonly string[]>([
  ["Captured", ["Invited", "Expired"]],
  ["Invited", ["Claim Started", "Expired"]],
  ["Claim Started", ["Claimed", "Expired"]],
  ["Claimed", ["Converted"]],
  ["Converted", []],
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

  return NextResponse.json({
    deal: updatedDeal,
    captureId: updatedCapture.id,
    dealId: updatedDeal.id,
    currentStage: stage.name,
    previousStage: previousStage.name,
    status: updatedCapture.status,
    updatedAt: updatedDeal.updatedAt,
  });
}
