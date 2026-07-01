import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, RequestBodyError } from "@/lib/api/request-body";
import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import {
  PrismaCampaignRuntimeExecutionRepository,
  PrismaSellerAcquisitionCampaignRepository,
  type PrismaPersistenceClient,
} from "@whisperm/repositories";
import { CampaignRuntimeService, type CampaignRuntimeInvitationQueue } from "@whisperm/services";

const bulkInviteRequestSchema = z.object({
  captureIds: z.array(z.string().min(1)).min(1).max(100),
  channel: z.enum(["WHATSAPP", "SMS", "EMAIL"]).default("WHATSAPP"),
}).strict();

const errorResponse = (message: string, status: number) =>
  NextResponse.json({ ok: false, error: { message } }, { status });

const invitationQueue = (): CampaignRuntimeInvitationQueue => ({
  async enqueueInvitation(input) {
    await prisma.queueJob.create({
      data: {
        tenantId: input.tenantId,
        queueName: "marketplace.invite",
        jobName: "marketplace.invite.send",
        jobKey: `campaign-runtime:${input.tenantId}:${input.executionId}`,
        payload: {
          tenantId: input.tenantId,
          campaignId: input.campaignId,
          opportunityId: input.opportunityId,
          captureId: input.opportunityId,
          executionId: input.executionId,
          invitationId: input.invitationId ?? null,
          preferredChannel: input.preferredChannel ?? "WHATSAPP",
          channel: input.preferredChannel ?? "WHATSAPP",
          correlationId: input.correlationId ?? input.executionId,
          replaySafe: true,
        },
        maxAttempts: 3,
        correlationId: input.correlationId ?? input.executionId,
      },
    });
  },
});

const runtimeService = () => new CampaignRuntimeService({
  campaigns: new PrismaSellerAcquisitionCampaignRepository(prisma as unknown as PrismaPersistenceClient),
  executions: new PrismaCampaignRuntimeExecutionRepository(prisma as unknown as PrismaPersistenceClient),
  invitationQueue: invitationQueue(),
});

export async function POST(request: NextRequest) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return errorResponse("Unauthorized", 401);

  const { tenant, tenantUserId } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  let body: unknown;
  try {
    body = await readJsonBody(request, { maxBytes: 32_000 });
  } catch (error) {
    if (error instanceof RequestBodyError) return errorResponse(error.message, error.status);
    body = {};
  }

  const parsed = bulkInviteRequestSchema.safeParse(body);
  if (!parsed.success) return errorResponse("captureIds and channel are invalid.", 400);

  const captures = await prisma.marketplaceCapture.findMany({
    where: { tenantId: tenant.id, id: { in: parsed.data.captureIds } },
    select: {
      id: true,
      campaignMemberships: {
        where: { removedAt: null },
        select: { campaignId: true },
        orderBy: { assignedAt: "desc" },
        take: 1,
      },
    },
  });

  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const runtime = runtimeService();
  const invalid: string[] = [];
  const accepted: string[] = [];

  for (const capture of captures) {
    const campaignId = capture.campaignMemberships[0]?.campaignId;
    if (campaignId === undefined) {
      invalid.push(capture.id);
      continue;
    }
    const execution = await runtime.executeInvitation(
      { tenantId: tenant.id },
      {
        campaignId,
        opportunityId: capture.id,
        preferredChannel: parsed.data.channel,
        initiatedBy: tenantUserId,
        correlationId,
      },
    );
    accepted.push(execution.id);
  }

  if (accepted.length === 0) return errorResponse("No captures assigned to a campaign.", 422);

  return NextResponse.json(
    { ok: true, data: { accepted: accepted.length, executionIds: accepted, invalid, channel: parsed.data.channel } },
    { status: 202 },
  );
}
