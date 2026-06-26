type CaptureConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface CaptureQualityInput {
  readonly title?: string | null;
  readonly sellerName?: string | null;
  readonly sellerPhone?: string | null;
  readonly phone?: string | null;
  readonly price?: string | number | null;
  readonly location?: string | null;
  readonly images?: readonly unknown[] | null;
  readonly listingUrl?: string | null;
  readonly marketplaceSource?: string | null;
}

export interface CaptureQualityResult {
  readonly overallScore: number;
  readonly confidence: CaptureConfidence;
  readonly reviewRequired: boolean;
  readonly reviewReasons: readonly string[];
  readonly fieldScores: Readonly<Record<string, number>>;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function phoneValue(input: CaptureQualityInput): string | null {
  return hasText(input.sellerPhone) ? input.sellerPhone : hasText(input.phone) ? input.phone : null;
}

function priceIsMalformed(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (typeof value === "number") return !Number.isFinite(value) || value <= 0;
  if (typeof value !== "string") return true;

  const rawPrice = value.trim();
  if (rawPrice.includes("[object")) return true;

  const numeric = Number.parseFloat(rawPrice.replace(/[^0-9.]/g, ""));
  return !Number.isFinite(numeric) || numeric <= 0;
}

export function evaluateCaptureQuality(input: CaptureQualityInput): CaptureQualityResult {
  const title = hasText(input.title) ? input.title.trim() : "";
  const phone = phoneValue(input);
  const sellerName = hasText(input.sellerName) ? input.sellerName.trim() : "";
  const location = hasText(input.location) ? input.location.trim() : "";
  const listingUrl = hasText(input.listingUrl) ? input.listingUrl.trim() : "";
  const marketplaceSource = hasText(input.marketplaceSource) ? input.marketplaceSource.trim() : "";
  const hasImage = Array.isArray(input.images) && input.images.length > 0;
  const malformedPrice = priceIsMalformed(input.price);

  const fieldScores = {
    title: title.length >= 8 ? 20 : title.length >= 3 ? 10 : 0,
    phone: phone ? 25 : 0,
    sellerName: sellerName ? 15 : 0,
    price: malformedPrice ? 0 : 15,
    location: location ? 10 : 0,
    image: hasImage ? 5 : 0,
    sourceUrl: listingUrl || marketplaceSource ? 10 : 0,
  } as const;

  const overallScore = Object.values(fieldScores).reduce<number>((sum, score) => sum + score, 0);
  const reviewReasons: string[] = [];

  if (!phone) reviewReasons.push("PHONE_REQUIRED");
  if (malformedPrice) reviewReasons.push("PRICE_REVIEW_REQUIRED");
  if (title.length < 8) reviewReasons.push("TITLE_REVIEW_REQUIRED");
  if (!sellerName && !phone) reviewReasons.push("SELLER_IDENTITY_REVIEW_REQUIRED");
  if (!listingUrl && !marketplaceSource) reviewReasons.push("SOURCE_REVIEW_REQUIRED");

  const confidence =
    overallScore >= 80 && reviewReasons.length === 0 ? "HIGH" :
    overallScore >= 55 ? "MEDIUM" :
    "LOW";

  return {
    overallScore,
    confidence,
    reviewRequired: reviewReasons.length > 0 || confidence === "LOW",
    reviewReasons,
    fieldScores,
  };
}
