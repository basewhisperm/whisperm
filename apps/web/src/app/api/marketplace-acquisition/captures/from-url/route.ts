import { NextRequest, NextResponse } from "next/server";
import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { readJsonOrFormBody, RequestBodyError } from "@/lib/api/request-body";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import { createPrismaRepositories, PrismaAcquisitionUsageEventRepository, type PrismaPersistenceClient } from "@whisperm/repositories";
import { AcquisitionUsageMeteringService, createWhispeRMServices, ServiceError } from "@whisperm/services";

const parseRequest = (value: unknown): { readonly url: string } | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const url = typeof (value as { readonly url?: unknown }).url === "string" ? (value as { readonly url: string }).url.trim() : "";
  if (url.length === 0 || url.length > 2048) return null;
  try {
    new URL(url);
    return { url };
  } catch {
    return null;
  }
};

import { extractMarketplaceUrlCapture } from "@/lib/marketplace-capture/url-extractors";

export async function POST(request: NextRequest) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return NextResponse.json({ ok: false, error: { message: "Unauthorized" } }, { status: 401 });
  const { tenant, tenantUserId } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  let body: Record<string, unknown>;
  try {
    body = await readJsonOrFormBody(request, { maxBytes: 16_000, allowFormData: true });
  } catch (error) {
    if (error instanceof RequestBodyError) return NextResponse.json({ ok: false, error: { message: error.message, code: error.code } }, { status: error.status });
    return NextResponse.json({ ok: false, error: { message: "Invalid request body." } }, { status: 400 });
  }

  const parsed = parseRequest(body);

  if (parsed === null) return NextResponse.json({ ok: false, error: { message: "A valid listing URL is required." } }, { status: 400 });

  const url = parsed.url;
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return NextResponse.json({ ok: false, error: { message: "URL must use http or https." } }, { status: 400 });
  }

  try {
    const response = await fetch(url, {
      headers: {
        "accept": "text/html,application/xhtml+xml",
        "user-agent": "WhispeRM Seller Capture/1.0",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      return NextResponse.json({ ok: false, error: { message: `Listing fetch failed with status ${response.status}.` } }, { status: 502 });
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) {
      return NextResponse.json({ ok: false, error: { message: "Listing URL did not return HTML." } }, { status: 415 });
    }

    const html = (await response.text()).slice(0, 500_000);
    const captureInput = extractMarketplaceUrlCapture(response.url || url, html);

    const repositories = createPrismaRepositories(prisma as unknown as PrismaPersistenceClient);
    const usageMetering = new AcquisitionUsageMeteringService({ usageEvents: new PrismaAcquisitionUsageEventRepository(prisma as unknown as PrismaPersistenceClient) });
    const services = createWhispeRMServices({ ...repositories, usageMetering });

    const result = await services.marketplaceAcquisition.capture(
      {
        tenantId: tenant.id,
        actorId: tenantUserId,
        correlation: {
          correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
          requestId: request.headers.get("x-request-id") ?? undefined,
        },
      },
      { tenantId: tenant.id, ...captureInput, images: [...captureInput.images], imageUrls: [...captureInput.imageUrls] },
    );

    const missingRequirements = result.qualificationStatus === "UNQUALIFIED" ? [result.qualificationReason ?? "PHONE_REQUIRED"] : [];
    return NextResponse.json({
      ok: true,
      data: result,
      extracted: captureInput,
      qualified: result.qualificationStatus === "QUALIFIED",
      blocked: result.qualificationStatus === "UNQUALIFIED",
      missingRequirements,
      nextAction: missingRequirements.includes("PHONE_REQUIRED") ? "REVEAL_PHONE" : undefined,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return NextResponse.json({ ok: false, error: { message: "Listing fetch timed out.", code: "EXTERNAL_TIMEOUT" } }, { status: 504 });
    }
    if (error instanceof ServiceError) {
      return NextResponse.json({ ok: false, error: { message: error.message, code: error.code } }, { status: error.status });
    }

    return NextResponse.json({ ok: false, error: { message: "URL capture failed." } }, { status: 500 });
  }
}
