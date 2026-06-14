import { NextRequest, NextResponse } from "next/server";

import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { PrismaDealsRepository, PrismaPipelineRepository } from "@whisperm/repositories";

const MARKETPLACE_ACQUISITION_PIPELINE_KEY = "marketplace_acquisition";
const ACQUISITION_STAGE_NAMES = new Set(["Captured", "Invited", "Converted"]);

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

  const stageName = requestedStageName(await request.json().catch(() => null));
  if (stageName === null) {
    return NextResponse.json({ error: "A supported acquisition stageName is required" }, { status: 400 });
  }

  const workspaceId = tenant.id;
  const dealsRepo = new PrismaDealsRepository(prisma as any);
  const pipelineRepo = new PrismaPipelineRepository(prisma as any);
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

  const stage = pipeline.stages.find((candidate) => candidate.name === stageName);
  if (!stage) {
    return NextResponse.json({ error: `Marketplace Acquisition ${stageName} stage is missing` }, { status: 409 });
  }

  const updatedDeal = await dealsRepo.updateStage(workspaceId, deal.id, stage.id);

  return NextResponse.json({ deal: updatedDeal });
}
