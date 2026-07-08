import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, RequestBodyError } from "@/lib/api/request-body";
import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import { PrismaSellerAcquisitionCampaignRepository, type PrismaPersistenceClient } from "@whisperm/repositories";
import { SellerAcquisitionCampaignService, campaignTargetingConfigSchema, mergeCampaignTargetingMetadata } from "@whisperm/services";

const errorResponse = (message: string, status: number) =>
  NextResponse.json({ ok: false, error: { message } }, { status });

const campaignScheduleSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().min(1).nullable().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"]).optional(),
  ownerId: z.string().min(1).nullable().optional(),
  goalSellerCount: z.number().int().positive().nullable().optional(),
  scheduleEnabled: z.boolean().optional(),
  scheduleCadence: z.enum(["HOURLY", "DAILY", "WEEKLY"]).nullable().optional(),
  scheduleTimezone: z.string().min(1).nullable().optional(),
  nextRunAt: z.string().datetime().nullable().optional(),
  targeting: campaignTargetingConfigSchema.nullable().optional(),
}).strict();

const normalizeCampaignInput = (body: unknown) => {
  const parsed = campaignScheduleSchema.safeParse(body);
  if (!parsed.success) return parsed;
  const data = parsed.data;
  if (data.scheduleEnabled === true && (data.scheduleCadence ?? null) === null) {
    return { success: false as const, error: { issues: [{ message: "Schedule cadence is required when scheduling is enabled." }] } };
  }
  const { targeting, ...campaignData } = data;
  return { success: true as const, data: { ...campaignData, ...(targeting === undefined ? {} : { metadata: mergeCampaignTargetingMetadata(undefined, targeting === null ? null : campaignTargetingConfigSchema.parse(targeting)) }), scheduleTimezone: data.scheduleTimezone ?? (data.scheduleEnabled === true ? "UTC" : data.scheduleTimezone) } };
};

interface RouteContext {
  readonly params: { readonly campaignId: string };
}

const campaignService = () =>
  new SellerAcquisitionCampaignService(
    new PrismaSellerAcquisitionCampaignRepository(prisma as unknown as PrismaPersistenceClient),
  );

export async function GET(_request: NextRequest, context: RouteContext) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return errorResponse("Unauthorized", 401);

  const { tenant } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  const service = campaignService();
  const campaign = await service.findById({ tenantId: tenant.id }, context.params.campaignId);
  if (campaign === null) return errorResponse("Seller acquisition campaign not found.", 404);
  const memberCount = await service.countMembers({ tenantId: tenant.id }, campaign.id);

  return NextResponse.json({ ok: true, data: { campaign: { ...campaign, memberCount } } });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return errorResponse("Unauthorized", 401);

  const { tenant } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  let body: unknown;
  try {
    body = await readJsonBody(request, { maxBytes: 32_000 });
  } catch (error) {
    if (error instanceof RequestBodyError) return errorResponse(error.message, error.status);
    body = {};
  }

  const service = campaignService();
  const input = body as { readonly archive?: boolean };
  const parsed = input.archive === true ? null : normalizeCampaignInput(body);
  if (parsed !== null && !parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? "Invalid campaign request.", 400);
  const existingCampaign = input.archive === true || parsed === null ? null : await service.findById({ tenantId: tenant.id }, context.params.campaignId);
  if (input.archive !== true && parsed !== null && existingCampaign === null) return errorResponse("Seller acquisition campaign not found.", 404);
  const updateData = parsed !== null && "metadata" in parsed.data && existingCampaign !== null
    ? { ...parsed.data, metadata: mergeCampaignTargetingMetadata(existingCampaign.metadata, (body as { readonly targeting?: unknown }).targeting === null ? null : campaignTargetingConfigSchema.parse((body as { readonly targeting?: unknown }).targeting)) }
    : parsed?.data;
  const campaign = input.archive === true || parsed === null
    ? await service.archive({ tenantId: tenant.id }, context.params.campaignId)
    : await service.update({ tenantId: tenant.id }, context.params.campaignId, updateData as never);
  const memberCount = await service.countMembers({ tenantId: tenant.id }, campaign.id);

  return NextResponse.json({ ok: true, data: { campaign: { ...campaign, memberCount } } });
}
