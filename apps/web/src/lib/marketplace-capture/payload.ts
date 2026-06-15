export const MARKETPLACE_CAPTURE_MAX_PAYLOAD_BYTES = 12_000;
export const MARKETPLACE_CAPTURE_MAX_IMAGE_URLS = 10;
export const MARKETPLACE_CAPTURE_MAX_TEXT_LENGTH = 1_000;

type Strategy = "jsonld" | "opengraph" | "fallback";

export interface MarketplaceCapturePayload {
  readonly sourceUrl: string;
  readonly sourceHost: string;
  readonly listingUrl: string;
  readonly marketplaceSource: string;
  readonly sourceMarketplace?: string | undefined;
  readonly marketplaceListingId?: string | undefined;
  readonly title: string;
  readonly description: string;
  readonly priceText: string;
  readonly price?: string | undefined;
  readonly currency?: string | undefined;
  readonly images: readonly string[];
  readonly imageUrls: readonly string[];
  readonly category?: string | undefined;
  readonly sellerName?: string | undefined;
  readonly sellerProfileUrl?: string | undefined;
  readonly marketplaceIdentifier?: string | undefined;
  readonly phone?: string | undefined;
  readonly email?: string | undefined;
  readonly location?: string | undefined;
  readonly capturedAt?: string | undefined;
  readonly capturedBy?: string | undefined;
  readonly pageUrl?: string | undefined;
  readonly userAgent?: string | undefined;
  readonly rawExtract: Readonly<{ strategy: Strategy }>;
}

export interface MarketplaceCaptureValidationResult { readonly payload: MarketplaceCapturePayload | null; readonly error: string | null; }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, maxLength = MARKETPLACE_CAPTURE_MAX_TEXT_LENGTH): string => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
const optional = (value: unknown, maxLength = MARKETPLACE_CAPTURE_MAX_TEXT_LENGTH): string | undefined => { const result = text(value, maxLength); return result.length > 0 ? result : undefined; };
const strategyOf = (value: unknown): Strategy => value === "jsonld" || value === "opengraph" ? value : "fallback";
const urls = (value: unknown): readonly string[] => Array.isArray(value) ? value.map((item) => text(item, 2_000)).filter(Boolean).slice(0, MARKETPLACE_CAPTURE_MAX_IMAGE_URLS) : [];

export function validateMarketplaceCapturePayload(value: unknown): MarketplaceCaptureValidationResult {
  if (!isRecord(value)) return { payload: null, error: "Capture payload must be an object." };
  const sourceUrl = text(value.sourceUrl || value.listingUrl, 2_000);
  const sourceHost = text(value.sourceHost, 255).toLowerCase();
  if (!sourceUrl || !sourceHost) return { payload: null, error: "Capture payload is missing the source URL or host." };
  let parsedUrl: URL;
  try { parsedUrl = new URL(sourceUrl); } catch { return { payload: null, error: "Capture payload contains an invalid source URL." }; }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") return { payload: null, error: "Capture source URL must use http or https." };
  if (parsedUrl.hostname.toLowerCase() !== sourceHost) return { payload: null, error: "Capture source host does not match the source URL." };
  const rawExtract = isRecord(value.rawExtract) ? value.rawExtract : {};
  const imageUrls = urls(value.imageUrls).length > 0 ? urls(value.imageUrls) : urls(value.images);
  return { payload: { sourceUrl, sourceHost, listingUrl: text(value.listingUrl || sourceUrl, 2_000), marketplaceSource: optional(value.marketplaceSource, 255) ?? sourceHost, sourceMarketplace: optional(value.sourceMarketplace, 255), marketplaceListingId: optional(value.marketplaceListingId, 255), title: text(value.title, 300), description: text(value.description), priceText: text(value.priceText || value.price, 120), price: optional(value.price, 120), currency: optional(value.currency, 16), images: imageUrls, imageUrls, category: optional(value.category, 255), sellerName: optional(value.sellerName, 255), sellerProfileUrl: optional(value.sellerProfileUrl, 2_000), marketplaceIdentifier: optional(value.marketplaceIdentifier, 255), phone: optional(value.phone || value.sellerPhone, 64), email: optional(value.email || value.sellerEmail, 320), location: optional(value.location || value.sellerLocation, 255), capturedAt: optional(value.capturedAt, 64), capturedBy: optional(value.capturedBy, 255), pageUrl: optional(value.pageUrl, 2_000), userAgent: optional(value.userAgent, 1024), rawExtract: { strategy: strategyOf(rawExtract.strategy) } }, error: null };
}

export function decodeMarketplaceCapturePayload(encodedPayload: string | undefined): MarketplaceCaptureValidationResult {
  if (!encodedPayload) return { payload: null, error: "No capture payload was provided." };
  if (new TextEncoder().encode(encodedPayload).length > MARKETPLACE_CAPTURE_MAX_PAYLOAD_BYTES) return { payload: null, error: "Capture payload exceeds the intake size limit." };
  try { return validateMarketplaceCapturePayload(JSON.parse(encodedPayload)); } catch { return { payload: null, error: "Capture payload is not valid JSON." }; }
}
