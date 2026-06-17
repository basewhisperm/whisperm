import { NextRequest, NextResponse } from "next/server";

import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { createPrismaRepositories, type PrismaPersistenceClient } from "@whisperm/repositories";
import { createWhispeRMServices, ServiceError } from "@whisperm/services";

const clean = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const validUrl = (value: unknown): string | undefined => {
  const input = clean(value);
  if (input === undefined) return undefined;

  try {
    const parsed = new URL(input);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? input : undefined;
  } catch {
    return undefined;
  }
};

const validDateTime = (value: unknown): string | undefined => {
  const input = clean(value);
  if (input === undefined) return undefined;

  const parsed = Date.parse(input);
  if (Number.isNaN(parsed)) return undefined;

  return new Date(parsed).toISOString();
};

const urls = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .map((item) => validUrl(item))
        .filter((item): item is string => item !== undefined),
    ),
  ).slice(0, 10);
};

const safeRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } as Record<string, unknown> : {};

const errorResponse = (message: string, status: number) =>
  NextResponse.json({ ok: false, error: { message } }, { status });

export async function POST(request: NextRequest) {
  const tenant = await getTenantForCurrentUser();
  if (!tenant) return errorResponse("Unauthorized", 401);

  let body: Record<string, unknown>;
  try {
    body = safeRecord(await request.json());
  } catch {
    return errorResponse("Capture request body must be valid JSON.", 400);
  }

  const listingUrl = validUrl(body.listingUrl);
  const sourceUrl = validUrl(body.sourceUrl) ?? listingUrl;
  const pageUrl = validUrl(body.pageUrl);

  if (listingUrl === undefined && sourceUrl === undefined) {
    return errorResponse("Capture requires a valid listingUrl or sourceUrl.", 400);
  }

  const rawExtract = safeRecord(body.rawExtract);
  const sourceHost = clean(body.sourceHost);

  const captureInput = {
    tenantId: tenant.id,
    listingUrl,
    sourceUrl,
    title: clean(body.title) ?? "Marketplace listing",
    description: clean(body.description) ?? "Captured marketplace listing",
    price: clean(body.price) ?? clean(body.priceText),
    priceText: clean(body.priceText) ?? clean(body.price),
    currency: clean(body.currency),
    sellerName: clean(body.sellerName),
    sellerEmail: clean(body.sellerEmail) ?? clean(body.email),
    email: clean(body.email),
    sellerPhone: clean(body.sellerPhone) ?? clean(body.phone),
    phone: clean(body.phone),
    sellerLocation: clean(body.sellerLocation) ?? clean(body.location),
    location: clean(body.location),
    marketplaceIdentifier: clean(body.marketplaceIdentifier),
    sellerProfileUrl: validUrl(body.sellerProfileUrl),
    marketplaceSourceId: clean(body.marketplaceSourceId),
    marketplaceSource: clean(body.marketplaceSource) ?? clean(body.sourceMarketplace) ?? sourceHost,
    marketplaceListingId: clean(body.marketplaceListingId),
    category: clean(body.category),
    images: urls(body.images),
    imageUrls: urls(body.imageUrls),
    capturedAt: validDateTime(body.capturedAt),
    capturedBy: clean(body.capturedBy),
    pageUrl,
    sourceMarketplace: clean(body.sourceMarketplace),
    userAgent: clean(body.userAgent),
    contactId: clean(body.contactId),
    externalId: clean(body.externalId) ?? clean(body.marketplaceListingId),
    metadata: {
      sourceHost: sourceHost ?? null,
      pageUrl: pageUrl ?? null,
      sourceMarketplace: clean(body.sourceMarketplace) ?? null,
      rawExtract,
    },
  };

  try {
    const repositories = createPrismaRepositories(prisma as unknown as PrismaPersistenceClient);
    const services = createWhispeRMServices(repositories);

    const result = await services.marketplaceAcquisition.capture(
      {
        tenantId: tenant.id,
        correlation: {
          correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
          requestId: request.headers.get("x-request-id") ?? undefined,
        },
      },
      captureInput,
    );

    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json({ ok: false, error: { message: error.message, code: error.code } }, { status: error.status });
    }

    return NextResponse.json({ ok: false, error: { message: "Capture failed." } }, { status: 500 });
  }
}
