import { NextRequest } from "next/server";

import { apiFailure, apiSuccess } from "@/app/api/_lib/api-response";
import { apiFailureFromError } from "@/app/api/_lib/service-error";
import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { readJsonBody, RequestBodyError } from "@/lib/api/request-body";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import { PersistenceError } from "@whisperm/repositories";
import { SellerAcquisitionCampaignService } from "@whisperm/services";
import { createAcquisitionServiceBundle } from "@/lib/marketplace-acquisition/acquisition-services";

type CampaignAssignmentResult =
  | { readonly status: "COMPLETED" }
  | { readonly status: "ALREADY_ASSIGNED" }
  | { readonly status: "FAILED"; readonly error: { readonly code: string; readonly message: string } };

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

export async function POST(request: NextRequest) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return apiFailure(401, "UNAUTHORIZED", "Unauthorized");
  const { tenant, tenantUserId } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  let body: Record<string, unknown>;
  try {
    body = safeRecord(await readJsonBody(request, { maxBytes: 96_000 }));
  } catch (error) {
    if (error instanceof RequestBodyError) return apiFailure(error.status, "VALIDATION_ERROR", error.message);
    return apiFailure(400, "VALIDATION_ERROR", "Capture request body must be valid JSON.");
  }

  const campaignId = clean(body.campaignId);
  const listingUrl = validUrl(body.listingUrl);
  const sourceUrl = validUrl(body.sourceUrl) ?? listingUrl;
  const pageUrl = validUrl(body.pageUrl);

  if (listingUrl === undefined && sourceUrl === undefined) {
    return apiFailure(400, "VALIDATION_ERROR", "Capture requires a valid listingUrl or sourceUrl.");
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
    const { services, repositories } = createAcquisitionServiceBundle();
    const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();

    const result = await services.marketplaceAcquisition.capture(
      {
        tenantId: tenant.id,
        actorId: tenantUserId,
        correlation: {
          correlationId,
          requestId: request.headers.get("x-request-id") ?? undefined,
        },
      },
      captureInput,
    );

    // ST1-013M: campaign assignment is intentionally not transactional with capture (capture
    // must still succeed if a campaign later becomes invalid), but a failure here must never be
    // silently swallowed -- it is surfaced in the response and recorded durably in the audit log
    // so operators and the caller can both see and retry it. See docs/runtime/runtime-surface.md.
    let campaignAssignment: CampaignAssignmentResult | undefined;
    if (campaignId !== undefined) {
      const campaignSvc = new SellerAcquisitionCampaignService(repositories.sellerAcquisitionCampaigns);
      try {
        await campaignSvc.addSeller(
          { tenantId: tenant.id },
          campaignId,
          {
            marketplaceCaptureId: result.captureId,
            ...(result.contactId === undefined ? {} : { contactId: result.contactId }),
            ...(result.dealId === undefined ? {} : { dealId: result.dealId }),
          }
        );
        campaignAssignment = { status: "COMPLETED" };
      } catch (error) {
        if (error instanceof PersistenceError && error.code === "PERSISTENCE_CONFLICT") {
          // Idempotent: the unique constraint on [tenantId, campaignId, marketplaceCaptureId]
          // means this capture is already a member of this campaign -- not a failure.
          campaignAssignment = { status: "ALREADY_ASSIGNED" };
        } else {
          const code = error instanceof PersistenceError ? error.code : "CAMPAIGN_ASSIGNMENT_FAILED";
          const message = error instanceof Error ? error.message : "Campaign assignment failed";
          campaignAssignment = { status: "FAILED", error: { code, message } };
          await repositories.auditLogs.append(
            { tenantId: tenant.id },
            {
              tenantId: tenant.id,
              actorId: tenantUserId,
              action: "MARKETPLACE_CAPTURE_CAMPAIGN_ASSIGNMENT_FAILED",
              targetType: "MarketplaceCapture",
              targetId: result.captureId,
              correlationId,
              metadata: { campaignId, errorCode: code, errorMessage: message },
            },
          );
        }
      }
    }

    return apiSuccess({ ...result, ...(campaignAssignment === undefined ? {} : { campaignAssignment }) });
  } catch (error) {
    return apiFailureFromError(error, "Capture failed.");
  }
}
