import type { TenantScoped } from "@whisperm/types";
import type { CreateDiscoveredSellerInput } from "@whisperm/repositories";

// ---------------------------------------------------------------------------
// Qualification policy — configurable per campaign
// ---------------------------------------------------------------------------

export interface QualificationPolicy {
  readonly minScore: number;
  readonly weights: {
    readonly phone: number;
    readonly sellerProfileUrl: number;
    readonly sellerName: number;
    readonly images: number;
    readonly price: number;
    readonly location: number;
    readonly multipleListings: number;
    readonly email: number;
  };
}

export const DEFAULT_QUALIFICATION_POLICY: QualificationPolicy = {
  minScore: 60,
  weights: {
    phone: 30,
    sellerProfileUrl: 15,
    sellerName: 15,
    images: 10,
    price: 10,
    location: 10,
    multipleListings: 10,
    email: 0,
  },
};

// ---------------------------------------------------------------------------
// Input type for qualification
// ---------------------------------------------------------------------------

export interface SellerDataForQualification {
  readonly phone?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly sellerName?: string | null | undefined;
  readonly sellerProfileUrl?: string | null | undefined;
  readonly images?: readonly string[] | null | undefined;
  readonly price?: string | number | null | undefined;
  readonly location?: string | null | undefined;
  readonly portfolioListingCount?: number | undefined;
}

export interface QualificationResult {
  readonly score: number;
  readonly status: "QUALIFIED" | "REJECTED";
  readonly breakdown: Readonly<Record<string, number>>;
  readonly policy: QualificationPolicy;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SellerQualificationService {
  qualify(
    seller: SellerDataForQualification,
    policy: QualificationPolicy = DEFAULT_QUALIFICATION_POLICY,
  ): QualificationResult {
    const breakdown: Record<string, number> = {};

    // Phone — highest weight, required for WhatsApp invitation
    if (seller.phone !== null && seller.phone !== undefined && seller.phone.trim().length > 0) {
      breakdown.phone = policy.weights.phone;
    }

    // Seller profile URL — confirms seller identity on marketplace
    if (seller.sellerProfileUrl !== null && seller.sellerProfileUrl !== undefined && seller.sellerProfileUrl.trim().length > 0) {
      breakdown.sellerProfileUrl = policy.weights.sellerProfileUrl;
    }

    // Seller name — basic identity signal
    if (seller.sellerName !== null && seller.sellerName !== undefined && seller.sellerName.trim().length > 0) {
      breakdown.sellerName = policy.weights.sellerName;
    }

    // Images — indicates active, quality seller
    if (seller.images !== null && seller.images !== undefined && seller.images.length > 0) {
      breakdown.images = policy.weights.images;
    }

    // Price — listing is complete
    const priceVal = seller.price !== null && seller.price !== undefined
      ? Number(String(seller.price).replace(/[^0-9.]/g, ""))
      : NaN;
    if (!Number.isNaN(priceVal) && priceVal > 0) {
      breakdown.price = policy.weights.price;
    }

    // Location — seller is locatable
    if (seller.location !== null && seller.location !== undefined && seller.location.trim().length > 0) {
      breakdown.location = policy.weights.location;
    }

    // Multiple listings — established seller, higher conversion probability
    if ((seller.portfolioListingCount ?? 0) > 1) {
      breakdown.multipleListings = policy.weights.multipleListings;
    }

    // Email — optional signal
    if (seller.email !== null && seller.email !== undefined && seller.email.trim().length > 0) {
      breakdown.email = policy.weights.email;
    }

    const score = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
    const status = score >= policy.minScore ? "QUALIFIED" : "REJECTED";

    return { score, status, breakdown, policy };
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
    const result = this.qualify(seller, policy);
    return {
      qualificationScore: result.score,
      qualificationPolicy: result.breakdown as Readonly<Record<string, unknown>>,
      status: result.status,
      qualificationResult: result,
    };
  }
}
