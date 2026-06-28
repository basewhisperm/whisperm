import { type NextRequest, NextResponse } from "next/server";
import { readJsonBody, RequestBodyError } from "@/lib/api/request-body";
import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";

const errorResponse = (message: string, status: number) =>
  NextResponse.json({ ok: false, error: { message } }, { status });

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

  const { captureIds, channel = "WHATSAPP" } = body as {
    captureIds?: unknown;
    channel?: string;
  };

  if (!Array.isArray(captureIds) || captureIds.length === 0) {
    return errorResponse("captureIds must be a non-empty array.", 400);
  }
  if (captureIds.length > 100) {
    return errorResponse("Maximum 100 captures per bulk invite.", 400);
  }
  if (!["WHATSAPP", "SMS", "EMAIL"].includes(channel)) {
    return errorResponse("channel must be WHATSAPP, SMS, or EMAIL.", 400);
  }

  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();

  const jobs = captureIds
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    .map((captureId) => ({
      tenantId: tenant.id,
      queueName: "marketplace.invite",
      jobName: "marketplace.invite.send",
      jobKey: `invite:${tenant.id}:${captureId}:${Date.now()}`,
      payload: {
        tenantId: tenant.id,
        captureId,
        channel,
        idempotencyKey: `invite:${tenant.id}:${captureId}`,
        replaySafe: true,
      },
      maxAttempts: 3,
      correlationId,
    }));

  if (jobs.length === 0) {
    return errorResponse("No valid captureIds provided.", 400);
  }

  await prisma.queueJob.createMany({ data: jobs, skipDuplicates: true });

  return NextResponse.json(
    { ok: true, data: { queued: jobs.length, channel } },
    { status: 202 },
  );
}
