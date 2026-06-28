import { type NextRequest, NextResponse } from "next/server";
import { readJsonBody, RequestBodyError } from "@/lib/api/request-body";
import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";

const errorResponse = (message: string, status: number) =>
  NextResponse.json({ ok: false, error: { message } }, { status });

function normalizeToE164(raw: string, defaultCountryCode = "233"): string | undefined {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return undefined;
  if (raw.trim().startsWith("+")) {
    return digits.length >= 7 && digits.length <= 15 ? `+${digits}` : undefined;
  }
  if (digits.startsWith("0") && digits.length === 10) {
    return `+${defaultCountryCode}${digits.slice(1)}`;
  }
  if (digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }
  return undefined;
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

  const { captureIds, channel = "WHATSAPP" } = body as { captureIds?: unknown; channel?: string };

  if (!Array.isArray(captureIds) || captureIds.length === 0) {
    return errorResponse("captureIds must be a non-empty array.", 400);
  }
  if (captureIds.length > 100) {
    return errorResponse("Maximum 100 captures per bulk invite.", 400);
  }
  if (!["WHATSAPP", "SMS", "EMAIL"].includes(channel)) {
    return errorResponse("channel must be WHATSAPP, SMS, or EMAIL.", 400);
  }

  const validIds = captureIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
  if (validIds.length === 0) return errorResponse("No valid captureIds provided.", 400);

  const captures = await prisma.marketplaceCapture.findMany({
    where: { tenantId: tenant.id, id: { in: validIds } },
    select: { id: true, contact: { select: { phone: true } } },
  });

  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const now = Date.now();
  const invalid: string[] = [];
  const jobs: {
    tenantId: string;
    queueName: string;
    jobName: string;
    jobKey: string;
    payload: object;
    maxAttempts: number;
    correlationId: string;
  }[] = [];

  for (const capture of captures) {
    const rawPhone = capture.contact?.phone ?? null;
    if (rawPhone === null || rawPhone.trim().length === 0) {
      invalid.push(capture.id);
      continue;
    }
    const normalized = normalizeToE164(rawPhone);
    if (normalized === undefined) {
      invalid.push(capture.id);
      continue;
    }
    jobs.push({
      tenantId: tenant.id,
      queueName: "marketplace.invite",
      jobName: "marketplace.invite.send",
      jobKey: `invite:${tenant.id}:${capture.id}:${now}`,
      payload: {
        tenantId: tenant.id,
        captureId: capture.id,
        channel,
        normalizedPhone: normalized,
        idempotencyKey: `invite:${tenant.id}:${capture.id}`,
        replaySafe: true,
      },
      maxAttempts: 3,
      correlationId,
    });
  }

  if (jobs.length === 0) {
    return NextResponse.json(
      { ok: false, error: { message: "No captures with valid phone numbers.", invalid } },
      { status: 422 },
    );
  }

  await prisma.queueJob.createMany({ data: jobs, skipDuplicates: true });

  return NextResponse.json(
    { ok: true, data: { queued: jobs.length, invalid, channel } },
    { status: 202 },
  );
}
