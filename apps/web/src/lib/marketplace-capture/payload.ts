export const MARKETPLACE_CAPTURE_MAX_PAYLOAD_BYTES = 12_000;
export const MARKETPLACE_CAPTURE_MAX_IMAGE_URLS = 3;
export const MARKETPLACE_CAPTURE_MAX_TEXT_LENGTH = 1_000;

export interface MarketplaceCapturePayload {
  readonly sourceUrl: string;
  readonly sourceHost: string;
  readonly title: string;
  readonly description: string;
  readonly priceText: string;
  readonly imageUrls: readonly string[];
  readonly rawExtract: Readonly<{ strategy: "jsonld" | "opengraph" | "fallback" }>;
}

export interface MarketplaceCaptureValidationResult {
  readonly payload: MarketplaceCapturePayload | null;
  readonly error: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const text = (value: unknown, maxLength = MARKETPLACE_CAPTURE_MAX_TEXT_LENGTH): string => (
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : ""
);

const isAllowedStrategy = (value: unknown): value is MarketplaceCapturePayload["rawExtract"]["strategy"] => (
  value === "jsonld" || value === "opengraph" || value === "fallback"
);

export function validateMarketplaceCapturePayload(value: unknown): MarketplaceCaptureValidationResult {
  if (!isRecord(value)) return { payload: null, error: "Capture payload must be an object." };

  const sourceUrl = text(value.sourceUrl, 2_000);
  const sourceHost = text(value.sourceHost, 255).toLowerCase();
  if (sourceUrl.length === 0 || sourceHost.length === 0) {
    return { payload: null, error: "Capture payload is missing the source URL or host." };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    return { payload: null, error: "Capture payload contains an invalid source URL." };
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return { payload: null, error: "Capture source URL must use http or https." };
  }

  if (parsedUrl.hostname.toLowerCase() !== sourceHost) {
    return { payload: null, error: "Capture source host does not match the source URL." };
  }

  const rawExtract = isRecord(value.rawExtract) ? value.rawExtract : null;
  const strategy = rawExtract && isAllowedStrategy(rawExtract.strategy) ? rawExtract.strategy : "fallback";
  const imageUrls = Array.isArray(value.imageUrls)
    ? value.imageUrls
      .map((imageUrl) => text(imageUrl, 2_000))
      .filter((imageUrl) => imageUrl.length > 0)
      .slice(0, MARKETPLACE_CAPTURE_MAX_IMAGE_URLS)
    : [];

  return {
    payload: {
      sourceUrl,
      sourceHost,
      title: text(value.title, 300),
      description: text(value.description),
      priceText: text(value.priceText, 120),
      imageUrls,
      rawExtract: { strategy },
    },
    error: null,
  };
}

export function decodeMarketplaceCapturePayload(encodedPayload: string | undefined): MarketplaceCaptureValidationResult {
  if (!encodedPayload) return { payload: null, error: "No capture payload was provided." };

  if (new TextEncoder().encode(encodedPayload).length > MARKETPLACE_CAPTURE_MAX_PAYLOAD_BYTES) {
    return { payload: null, error: "Capture payload exceeds the intake size limit." };
  }

  try {
    return validateMarketplaceCapturePayload(JSON.parse(encodedPayload));
  } catch {
    return { payload: null, error: "Capture payload is not valid JSON." };
  }
}
