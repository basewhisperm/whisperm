import { NextRequest, NextResponse } from "next/server";

import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { createPrismaRepositories, type PrismaPersistenceClient } from "@whisperm/repositories";
import { createWhispeRMServices, ServiceError } from "@whisperm/services";

const clean = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const urls = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && /^https?:\/\//iu.test(item)).slice(0, 10)
    : [];

export async function POST(request: NextRequest) {
  const tenant = await getTenantForCurrentUser();
  if (!tenant) return NextResponse.json({ ok: false, error: { message: "Unauthorized" } }, { status: 401 });

  try {
    const body = await request.json();

    const captureInput = {
      tenantId: tenant.id,
      listingUrl: clean(body.listingUrl),
      sourceUrl: clean(body.sourceUrl),
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
      sellerProfileUrl: clean(body.sellerProfileUrl),
      marketplaceSourceId: clean(body.marketplaceSourceId),
      marketplaceSource: clean(body.marketplaceSource) ?? clean(body.sourceMarketplace),
      marketplaceListingId: clean(body.marketplaceListingId),
      category: clean(body.category),
      images: urls(body.images),
      imageUrls: urls(body.imageUrls),
      capturedAt: clean(body.capturedAt),
      capturedBy: clean(body.capturedBy),
      pageUrl: clean(body.pageUrl),
      sourceMarketplace: clean(body.sourceMarketplace),
      userAgent: clean(body.userAgent),
      contactId: clean(body.contactId),
      externalId: clean(body.externalId) ?? clean(body.marketplaceListingId),
    };

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
