import type { TenantScoped } from "@whisperm/types";
import type { CreateDiscoveredSellerInput } from "@whisperm/repositories";

export interface QualificationPolicy {
  readonly minScore: number;
  readonly reviewScore: number;
  readonly weights: {
    readonly listingUrl: number;
    readonly marketplace: number;
    readonly category: number;
    readonly phone: number;
    readonly sellerProfileUrl: number;
    readonly sellerName: number;
    readonly title: number;
    readonly images: number;
    readonly price: number;
    readonly location: number;
    readonly multipleListings: number;
    readonly email: number;
  };
}

export const DEFAULT_QUALIFICATION_POLICY: QualificationPolicy = {
  minScore: 75,
  reviewScore: 40,
  weights: {
    listingUrl: 20,
    marketplace: 15,
    category: 10,
    phone: 20,
    sellerProfileUrl: 10,
    sellerName: 10,
    title: 10,
    images: 5,
    price: 5,
    location: 5,
    multipleListings: 5,
    email: 5,
  },
};

export type QualificationStatus = "NEW" | "QUALIFYING" | "QUALIFIED" | "NEEDS_REVIEW" | "REJECTED";

export type QualificationReason =
  | "INVALID_URL"
  | "DUPLICATE_LISTING"
  | "OUTSIDE_CAMPAIGN_SCOPE"
  | "UNSUPPORTED_MARKETPLACE"
  | "INVALID_PAYLOAD"
  | "LOW_CONFIDENCE"
  | "MISSING_REQUIRED_DATA"
  | "MISSING_PHONE"
  | "MISSING_SELLER_IDENTITY"
  | "PARTIAL_EXTRACTION"
  | "PRICE_NOT_NORMALIZED";

export interface QualificationConfidence {
  readonly overallConfidence: number;
  readonly sellerConfidence: number;
  readonly phoneConfidence: number;
  readonly listingConfidence: number;
  readonly locationConfidence: number;
  readonly priceConfidence: number;
}

export interface SellerDataForQualification {
  readonly listingUrl?: string | null | undefined;
  readonly marketplaceSourceKey?: string | null | undefined;
  readonly campaignTargetMarketplaces?: readonly string[] | null | undefined;
  readonly phone?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly sellerName?: string | null | undefined;
  readonly sellerProfileUrl?: string | null | undefined;
  readonly title?: string | null | undefined;
  readonly category?: string | null | undefined;
  readonly images?: readonly string[] | null | undefined;
  readonly price?: string | number | null | undefined;
  readonly location?: string | null | undefined;
  readonly portfolioListingCount?: number | undefined;
  readonly targetingCategory?: string | null | undefined;
  readonly targetingLocation?: string | null | undefined;
  readonly targetingKeyword?: string | null | undefined;
  readonly targetingPriceMin?: number | null | undefined;
  readonly targetingPriceMax?: number | null | undefined;
}

export interface QualificationResult {
  readonly score: number;
  readonly status: QualificationStatus;
  readonly reasons: readonly QualificationReason[];
  readonly confidence: QualificationConfidence;
  readonly breakdown: Readonly<Record<string, number | readonly QualificationReason[] | QualificationConfidence>>;
  readonly policy: QualificationPolicy;
}

const SUPPORTED_MARKETPLACES = new Set(["JIJI", "TONATON"]);

const hasText = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value.trim().length > 0;

const isValidUrl = (value: string | null | undefined): boolean => {
  if (!hasText(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const normalizeMarketplace = (value: string | null | undefined): string | undefined => {
  if (!hasText(value)) return undefined;
  const normalized = value.trim().toUpperCase();
  if (normalized.includes("JIJI")) return "JIJI";
  if (normalized.includes("TONATON")) return "TONATON";
  return normalized;
};

const clampConfidence = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

export class SellerQualificationService {
  qualify(
    seller: SellerDataForQualification,
    policy: QualificationPolicy = DEFAULT_QUALIFICATION_POLICY,
  ): QualificationResult {
    const breakdown: Record<string, number> = {};
    const reasons = new Set<QualificationReason>();
    const marketplace = normalizeMarketplace(seller.marketplaceSourceKey);

    if (!isValidUrl(seller.listingUrl)) {
      reasons.add("INVALID_URL");
      return this.result(0, "REJECTED", reasons, breakdown, policy, {
        sellerConfidence: 0,
        phoneConfidence: hasText(seller.phone) ? 100 : 0,
        listingConfidence: 0,
        locationConfidence: hasText(seller.location) ? 100 : 0,
        priceConfidence: 0,
      });
    }
    breakdown.listingUrl = policy.weights.listingUrl;

    if (marketplace === undefined || !SUPPORTED_MARKETPLACES.has(marketplace)) {
      reasons.add("UNSUPPORTED_MARKETPLACE");
      return this.result(policy.weights.listingUrl, "REJECTED", reasons, breakdown, policy, {
        sellerConfidence: 0,
        phoneConfidence: hasText(seller.phone) ? 100 : 0,
        listingConfidence: 50,
        locationConfidence: hasText(seller.location) ? 100 : 0,
        priceConfidence: 0,
      });
    }
    breakdown.marketplace = policy.weights.marketplace;

    if (seller.campaignTargetMarketplaces !== null && seller.campaignTargetMarketplaces !== undefined && seller.campaignTargetMarketplaces.length > 0) {
      const targets = seller.campaignTargetMarketplaces.map((target) => normalizeMarketplace(target));
      if (!targets.includes(marketplace)) {
        reasons.add("OUTSIDE_CAMPAIGN_SCOPE");
        return this.result(policy.weights.listingUrl + policy.weights.marketplace, "REJECTED", reasons, breakdown, policy, {
          sellerConfidence: 0,
          phoneConfidence: hasText(seller.phone) ? 100 : 0,
          listingConfidence: 60,
          locationConfidence: hasText(seller.location) ? 100 : 0,
          priceConfidence: 0,
        });
      }
    }

    if (hasText(seller.targetingCategory) && hasText(seller.category) && seller.category.toLowerCase() !== seller.targetingCategory.toLowerCase()) {
      reasons.add("OUTSIDE_CAMPAIGN_SCOPE");
    }
    if (hasText(seller.targetingLocation) && hasText(seller.location) && !seller.location.toLowerCase().includes(seller.targetingLocation.toLowerCase())) {
      reasons.add("OUTSIDE_CAMPAIGN_SCOPE");
    }
    if (hasText(seller.targetingKeyword)) {
      const haystack = [seller.title, seller.category].filter(hasText).join(" ").toLowerCase();
      if (!haystack.includes(seller.targetingKeyword.toLowerCase())) reasons.add("OUTSIDE_CAMPAIGN_SCOPE");
    }
    if (hasText(seller.category)) breakdown.category = policy.weights.category;
    if (hasText(seller.phone)) breakdown.phone = policy.weights.phone;
    else reasons.add("MISSING_PHONE");
    if (hasText(seller.sellerProfileUrl)) breakdown.sellerProfileUrl = policy.weights.sellerProfileUrl;
    if (hasText(seller.sellerName)) breakdown.sellerName = policy.weights.sellerName;
    if (!hasText(seller.sellerName) && !hasText(seller.sellerProfileUrl)) reasons.add("MISSING_SELLER_IDENTITY");
    if (hasText(seller.title)) breakdown.title = policy.weights.title;
    if (seller.images !== null && seller.images !== undefined && seller.images.length > 0) breakdown.images = policy.weights.images;

    const priceVal = seller.price !== null && seller.price !== undefined ? Number(String(seller.price).replace(/[^0-9.]/g, "")) : NaN;
    if (!Number.isNaN(priceVal) && priceVal > 0) {
      breakdown.price = policy.weights.price;
      if ((seller.targetingPriceMin !== null && seller.targetingPriceMin !== undefined && priceVal < seller.targetingPriceMin) || (seller.targetingPriceMax !== null && seller.targetingPriceMax !== undefined && priceVal > seller.targetingPriceMax)) {
        reasons.add("OUTSIDE_CAMPAIGN_SCOPE");
      }
    } else reasons.add("PRICE_NOT_NORMALIZED");
    if (hasText(seller.location)) breakdown.location = policy.weights.location;
    if ((seller.portfolioListingCount ?? 0) > 1) breakdown.multipleListings = policy.weights.multipleListings;
    if (hasText(seller.email)) breakdown.email = policy.weights.email;

    if (!hasText(seller.title) || !hasText(seller.category) || seller.images === null || seller.images === undefined || seller.images.length === 0) {
      reasons.add("PARTIAL_EXTRACTION");
    }

    const score = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
    if (reasons.has("OUTSIDE_CAMPAIGN_SCOPE")) {
      return this.result(score, "REJECTED", reasons, breakdown, policy, {
        sellerConfidence: hasText(seller.sellerName) || hasText(seller.sellerProfileUrl) ? 100 : 35,
        phoneConfidence: hasText(seller.phone) ? 100 : 0,
        listingConfidence: hasText(seller.title) && hasText(seller.category) ? 100 : 65,
        locationConfidence: hasText(seller.location) ? 100 : 0,
        priceConfidence: !Number.isNaN(priceVal) && priceVal > 0 ? 100 : 0,
      });
    }

    const preliminaryStatus = score >= policy.minScore
      ? "QUALIFIED"
      : score >= policy.reviewScore
        ? "NEEDS_REVIEW"
        : "REJECTED";
    const requiresHumanReview = reasons.has("MISSING_PHONE")
      || reasons.has("MISSING_SELLER_IDENTITY")
      || reasons.has("PARTIAL_EXTRACTION")
      || reasons.has("PRICE_NOT_NORMALIZED");
    const status = preliminaryStatus === "QUALIFIED" && requiresHumanReview ? "NEEDS_REVIEW" : preliminaryStatus;
    if (status === "REJECTED" && reasons.size === 0) reasons.add("LOW_CONFIDENCE");

    return this.result(score, status, reasons, breakdown, policy, {
      sellerConfidence: hasText(seller.sellerName) || hasText(seller.sellerProfileUrl) ? 100 : 35,
      phoneConfidence: hasText(seller.phone) ? 100 : 0,
      listingConfidence: hasText(seller.title) && hasText(seller.category) ? 100 : 65,
      locationConfidence: hasText(seller.location) ? 100 : 0,
      priceConfidence: !Number.isNaN(priceVal) && priceVal > 0 ? 100 : 0,
    });
  }

  qualifyForInput(
    seller: SellerDataForQualification,
    context: TenantScoped,
    runId: string,
    campaignId: string,
    marketplaceSourceId: string,
    listingUrl: string,
    policy?: QualificationPolicy,
  ): Pick<CreateDiscoveredSellerInput, "qualificationScore" | "qualificationPolicy" | "status"> & { qualificationResult: QualificationResult } {
    const result = this.qualify({ ...seller, listingUrl }, policy);
    return {
      qualificationScore: result.score,
      qualificationPolicy: result.breakdown as Readonly<Record<string, unknown>>,
      status: result.status,
      qualificationResult: result,
    };
  }

  private result(
    score: number,
    status: QualificationStatus,
    reasons: ReadonlySet<QualificationReason>,
    breakdown: Record<string, number>,
    policy: QualificationPolicy,
    confidenceInput: Omit<QualificationConfidence, "overallConfidence">,
  ): QualificationResult {
    const confidence = {
      ...confidenceInput,
      overallConfidence: clampConfidence(score),
    };
    return {
      score: clampConfidence(score),
      status,
      reasons: [...reasons],
      confidence,
      breakdown: { ...breakdown, reasons: [...reasons], confidence },
      policy,
    };
  }
}
