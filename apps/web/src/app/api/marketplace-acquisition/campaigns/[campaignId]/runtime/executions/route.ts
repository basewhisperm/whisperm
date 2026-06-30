import { type NextRequest, NextResponse } from "next/server";
import { readJsonBody, RequestBodyError } from "@/lib/api/request-body";
import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import { PersistenceError, PrismaCampaignRuntimeExecutionRepository, PrismaSellerAcquisitionCampaignRepository, type PrismaPersistenceClient } from "@whisperm/repositories";
import { CampaignRuntimeService } from "@whisperm/services";
import { z } from "zod";

const requestSchema = z.object({ trigger: z.enum(["MANUAL", "SCHEDULED", "SYSTEM"]).optional() }).strict().default({});

const errorResponse = (message: string, status: number) =>
  NextResponse.json({ ok: false, error: { message } }, { status });

interface RouteContext {
  readonly params: { readonly campaignId: string };
}

const runtimeService = () => new CampaignRuntimeService({
  campaigns: new PrismaSellerAcquisitionCampaignRepository(prisma as unknown as PrismaPersistenceClient),
  executions: new PrismaCampaignRuntimeExecutionRepository(prisma as unknown as PrismaPersistenceClient),
});

export async function GET(request: NextRequest, context: RouteContext) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return errorResponse("Unauthorized", 401);

  const { tenant } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  const limitParam = request.nextUrl.searchParams.get("limit");
  const parsedLimit = limitParam === null ? undefined : Number.parseInt(limitParam, 10);
  const limit = parsedLimit === undefined || !Number.isFinite(parsedLimit) ? undefined : Math.min(Math.max(parsedLimit, 1), 100);
  const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
  const page = await runtimeService().listCampaignExecutions(
    { tenantId: tenant.id },
    context.params.campaignId,
    { ...(limit === undefined ? {} : { limit }), ...(cursor === undefined ? {} : { cursor }) },
  );

  return NextResponse.json({ ok: true, data: { executions: page.items, nextCursor: page.nextCursor } });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return errorResponse("Unauthorized", 401);

  const { tenant } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  let body: unknown = {};
  try {
    body = await readJsonBody(request, { maxBytes: 4_000 });
  } catch (error) {
    if (error instanceof RequestBodyError) return errorResponse(error.message, error.status);
  }

  const parsed = requestSchema.safeParse(body ?? {});
  if (!parsed.success) return errorResponse("Invalid campaign runtime execution request.", 400);

  try {
    const execution = await runtimeService().startCampaignExecution(
      { tenantId: tenant.id },
      { campaignId: context.params.campaignId, trigger: parsed.data.trigger ?? "MANUAL" },
    );
    return NextResponse.json({ data: { execution } }, { status: 201 });
  } catch (error) {
    if (error instanceof PersistenceError) return errorResponse(error.message, error.status);
    return errorResponse("Campaign runtime execution failed.", 500);
  }
}
