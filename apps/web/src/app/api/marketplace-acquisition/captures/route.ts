import { NextRequest, NextResponse } from "next/server";

import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { readJsonBody, RequestBodyError } from "@/lib/api/request-body";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import { createPrismaRepositories, PrismaAcquisitionUsageEventRepository, PrismaSellerAcquisitionCampaignRepository, type PrismaPersistenceClient } from "@whisperm/repositories";
import { SellerAcquisitionCampaignService } from "@whisperm/services";
import { AcquisitionUsageMeteringService, createWhispeRMServices, ServiceError } from "@whisperm/services";

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
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? ({ ...value } as Record<string, unknown>)
    : {};

const portfolioListings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item) => typeof item === "object" && item !== null && !Array.isArray(item)).slice(0, 25).map((item) => {
        const record = item as Record<string, unknown>;
        return {
          listingUrl: validUrl(record.listingUrl),
          marketplaceListingId: clean(record.marketplaceListingId),
          title: clean(record.title) ?? "Marketplace listing",
          description: clean(record.description),
          price: clean(record.price),
          priceText: clean(record.priceText) ?? clean(record.price),
          currency: clean(record.currency),
          category: clean(record.category),
          images: urls(record.images),
          imageUrls: urls(record.imageUrls),
          location: clean(record.location),
          metadata: safeRecord(record.metadata),
        };
      }).filter((item) => item.listingUrl !== undefined || item.marketplaceListingId !== undefined)
    : undefined;

const errorResponse = (message: string, status: number, code?: string, details?: unknown) =>
  NextResponse.json(
    {
      ok: false,
      error: {
        message,
        ...(code === undefined ? {} : { code }),
        ...(details === undefined ? {} : { details }),
      },
    },
    { status },
  );

export async function POST(request: NextRequest) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return errorResponse("Unauthorized", 401);
  const { tenant, tenantUserId } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  let body: Record<string, unknown>;
  try {
    body = safeRecord(await readJsonBody(request, { maxBytes: 96_000 }));
  } catch (error) {
    if (error instanceof RequestBodyError) return errorResponse(error.message, error.status, error.code);
    return errorResponse("Capture request body must be valid JSON.", 400);
  }

  const campaignId = clean(body.campaignId);
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
    portfolioListings: portfolioListings(body.portfolioListings),
    metadata: {
      sourceHost: sourceHost ?? null,
      pageUrl: pageUrl ?? null,
      sourceMarketplace: clean(body.sourceMarketplace) ?? null,
      rawExtract,
    },
  };

  try {
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
      captureInput,
    );

    // Assign to campaign if provided
    if (campaignId !== undefined) {
      try {
        const campaignRepo = new PrismaSellerAcquisitionCampaignRepository(prisma as unknown as PrismaPersistenceClient);
        const campaignSvc = new SellerAcquisitionCampaignService(campaignRepo);
        await campaignSvc.addSeller(
          { tenantId: tenant.id },
          campaignId,
          {
            marketplaceCaptureId: result.captureId,
            ...(result.contactId === undefined ? {} : { contactId: result.contactId }),
            ...(result.dealId === undefined ? {} : { dealId: result.dealId }),
          }
        );
      } catch {
        // Non-fatal: capture succeeded, campaign assignment failed silently
      }
    }

    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    if (error instanceof ServiceError) {
      return errorResponse(error.message, error.status, error.code, error.details);
    }

    return errorResponse("Capture failed.", 500);
  }
}
