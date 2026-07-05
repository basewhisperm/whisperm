import { randomUUID } from "node:crypto";

// ST1-011: shape mirrors MarketplaceCapturePayload (apps/web/src/lib/marketplace-capture/payload.ts).
// The real bookmarklet flow scrapes this from a live marketplace page; E2E constructs it directly
// since driving an actual third-party marketplace page in a browser is out of scope here.
export interface CapturePayloadOptions {
  readonly withPhone?: boolean;
  readonly priceText?: string;
}

export interface BuiltCapturePayload {
  readonly listingUrl: string;
  readonly sellerName: string;
  readonly payload: Record<string, unknown>;
}

export function buildCapturePayload(options: CapturePayloadOptions = {}): BuiltCapturePayload {
  const id = randomUUID();
  const listingUrl = `https://example-marketplace.test/listings/${id}`;
  const sellerName = `E2E Seller ${id.slice(0, 8)}`;

  const payload: Record<string, unknown> = {
    sourceUrl: listingUrl,
    sourceHost: "example-marketplace.test",
    listingUrl,
    marketplaceSource: "example-marketplace.test",
    title: `E2E acquisition regression listing ${id.slice(0, 8)}`,
    description: "Created by the ST1-011 end-to-end acquisition regression suite.",
    priceText: options.priceText ?? "500",
    price: options.priceText ?? "500",
    currency: "USD",
    images: [],
    imageUrls: [],
    rawExtract: { strategy: "fallback" },
    sellerName,
    ...(options.withPhone === true ? { phone: `+1555${Math.floor(1_000_000 + Math.random() * 8_000_000)}` } : {}),
  };

  return { listingUrl, sellerName, payload };
}

export function intakeUrl(campaignId: string, payload: Record<string, unknown>): string {
  const query = new URLSearchParams({ campaignId, payload: JSON.stringify(payload) });
  return `/marketplace-acquisition/capture/intake?${query.toString()}`;
}
