import { NextResponse } from "next/server";

import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { featureNotEnabledResponse, isTenantFeatureEnabled, SELLER_ACQUISITION_FEATURE } from "@/lib/tenant-features";
import { PrismaDealsRepository, PrismaPipelineRepository } from "@whisperm/repositories";
import { MARKETPLACE_ACQUISITION_PIPELINE_KEY } from "@whisperm/types";

export async function GET() {
  const tenant = await getTenantForCurrentUser();
  if (!tenant) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const featureEnabled = await isTenantFeatureEnabled(tenant.id, SELLER_ACQUISITION_FEATURE);
  if (!featureEnabled) return featureNotEnabledResponse();

  const workspaceId = tenant.id;
  const dealsRepo = new PrismaDealsRepository(prisma as any);
  const pipelineRepo = new PrismaPipelineRepository(prisma as any);
  const pipeline = await pipelineRepo.findByDefaultKey(workspaceId, MARKETPLACE_ACQUISITION_PIPELINE_KEY);

  if (!pipeline) {
    return NextResponse.json({ pipeline: null, deals: [], error: "Marketplace Acquisition pipeline is missing" });
  }

  const deals = await dealsRepo.list(workspaceId, { pipelineId: pipeline.id });

  return NextResponse.json({ pipeline, deals });
}
