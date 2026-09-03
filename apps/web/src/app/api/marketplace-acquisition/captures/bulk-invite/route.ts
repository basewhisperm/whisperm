import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAcquisitionActionForApi } from "@/lib/acquisition-governance";
import { readJsonBody, RequestBodyError } from "@/lib/api/request-body";
import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import {
  PrismaCampaignRuntimeExecutionRepository,
  PrismaSellerAcquisitionCampaignRepository,
  PrismaSellerInvitationRepository,
  type PrismaPersistenceClient,
} from "@whisperm/repositories";
import { CampaignRuntimeService, resolveExecutionChannel } from "@whisperm/services";
import { createSellerInvitationExecutor } from "@/lib/marketplace-acquisition/invitation-executor";
import { createInvitationRuntimeJobQueue } from "@/lib/marketplace-acquisition/runtime-job-queue";
import { resolveInvitationEligibility, type InvitationEligibility } from "@/lib/marketplace-acquisition/invitation-eligibility";
import { getCurrentPlanUsage } from "@/lib/billing/plan-usage";

const bulkInviteRequestSchema = z.object({
  captureIds: z.array(z.string().min(1)).min(1).max(100),
  channel: z.enum(["WHATSAPP", "SMS", "EMAIL"]).default("WHATSAPP"),
}).strict();

const errorResponse = (message: string, status: number) =>
  NextResponse.json({ ok: false, error: { message } }, { status });

const planLimitResponse = (input: {
  readonly plan: string;
  readonly requested: number;
  readonly used: number;
  readonly included: number;
  readonly remaining: number;
}) => NextResponse.json({
  ok: false,
  error: {
    code: "PLAN_LIMIT_REACHED",
    message: `This bulk invitation would exceed the ${input.plan} plan's monthly acquisition-action allowance.`,
    upgradeUrl: "/billing",
    details: input,
  },
}, { status: 402 });

const runtimeService = () => new CampaignRuntimeService({
  campaigns: new PrismaSellerAcquisitionCampaignRepository(prisma as unknown as PrismaPersistenceClient),
  executions: new PrismaCampaignRuntimeExecutionRepository(prisma as unknown as PrismaPersistenceClient),
  sellerInvitations: new PrismaSellerInvitationRepository(prisma as unknown as PrismaPersistenceClient),
  invitationQueue: createInvitationRuntimeJobQueue(prisma as unknown as PrismaPersistenceClient),
  invitationExecutor: createSellerInvitationExecutor(prisma as unknown as PrismaPersistenceClient),
});

type BulkInviteResult =
  | {
      readonly captureId: string;
      readonly ok: true;
      readonly status: "QUEUED" | "SENT" | "MANUAL_DELIVERY_REQUIRED";
      readonly invitationId?: string;
      readonly executionId?: string;
      readonly channel?: "WHATSAPP" | "SMS" | "EMAIL";
    }
  | {
      readonly captureId: string;
      readonly ok: false;
      readonly code: Exclude<InvitationEligibility, { readonly eligible: true }>["code"] | "INVITATION_DELIVERY_FAILED" | "INVITATION_AUTHORIZATION_DENIED";
      readonly message: string;
    };

const summarize = (requested: number, results: readonly BulkInviteResult[]) => {
  const queued = results.filter((result) => result.ok && result.status === "QUEUED").length;
  const sent = results.filter((result) => result.ok && result.status === "SENT").length;
  const failed = results.filter((result) => !result.ok && result.code !== "CAPTURE_NOT_FOUND").length;
  const skipped = results.filter((result) => !result.ok && result.code === "CAPTURE_NOT_FOUND").length;
  return { requested, eligible: queued + sent, queued, skipped, failed };
};

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

  const requestedIds = parsed.data.captureIds;
  const usage = await getCurrentPlanUsage(tenant.id);
  if (requestedIds.length > usage.remainingBillableActions) {
    return planLimitResponse({
      plan: usage.plan,
      requested: requestedIds.length,
      used: usage.usedBillableActions,
      included: usage.includedBillableActions,
      remaining: usage.remainingBillableActions,
    });
  }
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const runtime = runtimeService();
  const results: BulkInviteResult[] = [];

  for (const captureId of requestedIds) {
    const eligibility = await resolveInvitationEligibility(prisma, { tenantId: tenant.id, captureId, channel: parsed.data.channel });
    if (!eligibility.eligible) {
      results.push({ captureId, ok: false, code: eligibility.code, message: eligibility.message });
      continue;
    }

    const { denied } = await authorizeAcquisitionActionForApi(tenant.id, {
      capability: "INVITATION",
      campaignId: eligibility.campaignId,
      provider: parsed.data.channel,
      actorId: tenantUserId,
      source: "API",
    });
    if (denied) {
      results.push({ captureId, ok: false, code: "INVITATION_AUTHORIZATION_DENIED", message: "Invitation is not authorized for this capture." });
      continue;
    }

    try {
      const execution = await runtime.executeInvitation(
        { tenantId: tenant.id },
        {
          campaignId: eligibility.campaignId,
          opportunityId: eligibility.captureId,
          preferredChannel: parsed.data.channel,
          initiatedBy: tenantUserId,
          correlationId,
        },
      );
      if (execution.status === "FAILED") {
        results.push({ captureId, ok: false, code: "INVITATION_DELIVERY_FAILED", message: execution.errorMessage ?? "Seller invitation delivery failed." });
        continue;
      }
      const metrics = execution.metrics ?? {};
      const invitationId = typeof metrics.invitationId === "string" ? metrics.invitationId : undefined;
      const channel = resolveExecutionChannel(metrics);
      results.push({
        captureId,
        ok: true,
        status: execution.status === "COMPLETED" ? "SENT" : "QUEUED",
        ...(invitationId === undefined ? {} : { invitationId }),
        ...(channel === undefined ? {} : { channel }),
        executionId: execution.id,
      });
    } catch {
      results.push({ captureId, ok: false, code: "INVITATION_DELIVERY_FAILED", message: "Seller invitation delivery failed." });
    }
  }

  return NextResponse.json({ ok: true, summary: summarize(requestedIds.length, results), results }, { status: 200 });
}
