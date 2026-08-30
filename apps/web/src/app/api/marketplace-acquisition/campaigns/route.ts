import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, RequestBodyError } from "@/lib/api/request-body";
import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import { PersistenceError, PrismaSellerAcquisitionCampaignRepository, type PrismaPersistenceClient } from "@whisperm/repositories";
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

const parseLimit = (value: string | null): number | undefined => {
  if (value === null || value.trim().length === 0) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(Math.max(parsed, 1), 100);
};

const campaignService = () =>
  new SellerAcquisitionCampaignService(
    new PrismaSellerAcquisitionCampaignRepository(prisma as unknown as PrismaPersistenceClient),
  );

export async function GET(request: NextRequest) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return errorResponse("Unauthorized", 401);

  const { tenant } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
  const service = campaignService();
  const page = await service.list(
    { tenantId: tenant.id },
    { ...(limit === undefined ? {} : { limit }), ...(cursor === undefined ? {} : { cursor }) },
  );
  const campaigns = await Promise.all(
    page.items.map(async (campaign) => ({ ...campaign, memberCount: await service.countMembers({ tenantId: tenant.id }, campaign.id) })),
  );

  return NextResponse.json({ ok: true, data: { campaigns, nextCursor: page.nextCursor } });
}

export async function POST(request: NextRequest) {
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

  try {
    const parsed = normalizeCampaignInput(body);
    if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? "Invalid campaign request.", 400);

    const campaign = await campaignService().create({ tenantId: tenant.id }, parsed.data as never);
    return NextResponse.json({ ok: true, data: { campaign: { ...campaign, memberCount: 0 } } }, { status: 201 });
  } catch (error) {
    if (error instanceof PersistenceError) return errorResponse(error.message, error.status);
    return errorResponse("Campaign could not be created. Please try again.", 500);
  }
}
