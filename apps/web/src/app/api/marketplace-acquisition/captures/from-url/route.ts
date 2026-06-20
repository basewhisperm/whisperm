import { NextRequest, NextResponse } from "next/server";
import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import { createPrismaRepositories, type PrismaPersistenceClient } from "@whisperm/repositories";
import { createWhispeRMServices, ServiceError } from "@whisperm/services";

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

  const contentType = request.headers.get("content-type") ?? "";
  const parsed =
    contentType.toLowerCase().includes("application/json")
      ? parseRequest(await request.json().catch(() => ({})))
      : parseRequest(Object.fromEntries((await request.formData()).entries()));

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
      signal: AbortSignal.timeout(8000),
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
    const services = createWhispeRMServices(repositories);

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

    const missingRequirements = result.contactId === undefined ? ["PHONE_REQUIRED"] : [];
    return NextResponse.json({
      ok: true,
      data: result,
      extracted: captureInput,
      qualified: missingRequirements.length === 0,
      blocked: missingRequirements.length > 0,
      missingRequirements,
      nextAction: missingRequirements.includes("PHONE_REQUIRED") ? "REVEAL_PHONE" : undefined,
    });
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json({ ok: false, error: { message: error.message, code: error.code } }, { status: error.status });
    }

    return NextResponse.json({ ok: false, error: { message: "URL capture failed." } }, { status: 500 });
  }
}
