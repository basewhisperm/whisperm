"use client";

import useSWR, { type KeyedMutator } from "swr";

export const marketplaceAcquisitionRecordsPath = "/api/marketplace-acquisition/records" as const;

export type SellerAcquisitionHealthStatus = "READY" | "ACTION_REQUIRED" | "BLOCKED" | "EXPIRED" | "COMPLETED";
export type SellerAcquisitionNextAction = "REVEAL_PHONE" | "SEND_INVITATION" | "RETRY_INVITATION" | "WAIT_FOR_CLAIM" | "CONVERT_SELLER" | "CONVERT_INVENTORY" | "COMPLETE_ACQUISITION" | "NONE";
export type SellerAcquisitionMissingRequirement = "PHONE_REQUIRED" | "DRAFT_INVENTORY_REQUIRED" | "CLAIM_REQUIRED" | "SELLER_CONVERSION_REQUIRED" | "INVENTORY_CONVERSION_REQUIRED";
export type CaptureConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface MarketplaceCaptureRecord {
  readonly id: string;
  readonly listingUrl: string;
  readonly title: string;
  readonly description?: string | null;
  readonly price?: number | string | null;
  readonly currency?: string | null;
  readonly sellerName?: string | null;
  readonly marketplaceSourceId?: string | null;
  readonly status: string;
  readonly capturedAt?: string | null;
  readonly createdAt: string;
  readonly updatedAt?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>> | null;
}

export interface SellerAcquisitionContact {
  readonly id: string;
  readonly firstName?: string | null;
  readonly lastName?: string | null;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly company?: string | null;
}

export interface RevenueAttributionSnapshot {
  readonly attributionStatus: string;
  readonly attributedAt?: string;
  readonly revenueAmount?: string;
  readonly revenueCurrency?: string;
  readonly campaignId?: string;
  readonly marketplaceSource?: string;
  readonly providerKey?: string;
  readonly qualificationScore?: string;
  readonly qualificationStatus?: string;
  readonly attributionCompleteness: "COMPLETE" | "PARTIAL" | "FAILED";
  readonly missingLinks: readonly string[];
}

export interface SellerAcquisitionDeal {
  readonly deal: { readonly id: string; readonly title?: string | null; readonly metadata?: Readonly<Record<string, unknown>> | null };
}

export interface DraftInventoryRecord {
  readonly id?: string;
  readonly title: string;
  readonly description?: string | null;
  readonly price?: number | string | null;
  readonly currency?: string | null;
  readonly category?: string | null;
  readonly images?: unknown;
  readonly listingUrl?: string | null;
  readonly marketplaceSource?: string | null;
  readonly marketplaceListingId?: string | null;
  readonly status: string;
}

export interface SellerInvitationRecord {
  readonly id: string;
  readonly channel: "WHATSAPP" | "SMS" | "EMAIL";
  readonly status: string;
  readonly recipient: string;
  readonly createdAt: string;
  readonly updatedAt?: string;
  readonly expiresAt: string;
  readonly metadata?: unknown;
}

export interface SellerAcquisitionPortfolioSummary {
  readonly listingCount: number;
  readonly captureIds: readonly string[];
  readonly draftInventoryIds: readonly string[];
  readonly images: readonly string[];
}

export interface SellerRelationshipTimelineEvent {
  readonly id: string;
  readonly occurredAt: string;
  readonly kind: "DISCOVERY" | "QUALIFICATION" | "INVITATION" | "CLAIM" | "CRM" | "REVENUE";
  readonly label: string;
  readonly captureId: string;
  readonly campaignId?: string;
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
}

export interface SellerRelationshipMemory {
  readonly canonicalSellerKey: string;
  readonly captureIds: readonly string[];
  readonly marketplacesSeen: readonly string[];
  readonly campaignIds: readonly string[];
  readonly hasPriorInvitation: boolean;
  readonly hasClaimed: boolean;
  readonly wasPreviouslyDisqualified: boolean;
  readonly hasConverted: boolean;
  readonly hasRevenueAttributed?: boolean;
  readonly attributedRevenueAmount?: string;
  readonly attributedRevenueCurrency?: string;
  readonly attributionCompleteness?: "COMPLETE" | "PARTIAL" | "FAILED";
  readonly historyCompleteness: "COMPLETE" | "PARTIAL";
  readonly timelineGenerationStatus: "SUCCESS" | "PARTIAL";
  readonly timelineGenerationFailures: readonly string[];
  readonly identityResolutionConfidence?: string;
  readonly timeline: readonly SellerRelationshipTimelineEvent[];
}

export interface SellerAcquisitionRecord {
  readonly capture: MarketplaceCaptureRecord;
  readonly contact: SellerAcquisitionContact | null;
  readonly deal: SellerAcquisitionDeal | null;
  readonly draftInventory: DraftInventoryRecord | null;
  readonly images: readonly string[];
  readonly portfolio?: SellerAcquisitionPortfolioSummary;
  readonly latestInvitation: SellerInvitationRecord | null;
  readonly invitationHistory: readonly SellerInvitationRecord[];
  readonly claimTokenStatus: { readonly status: string; readonly expiresAt?: string | null; readonly sentAt?: string | null; readonly updatedAt?: string | null; readonly claimedAt?: string | null; readonly metadata?: Readonly<Record<string, unknown>> | null } | null;
  readonly ownershipAttestation: unknown | null;
  readonly sellerConversion: unknown | null;
  readonly inventoryConversion: unknown | null;
  readonly activityTimeline: readonly unknown[];
  readonly currentStage: string;
  readonly healthStatus: SellerAcquisitionHealthStatus;
  readonly nextAction: SellerAcquisitionNextAction;
  readonly missingRequirements: readonly SellerAcquisitionMissingRequirement[];
  readonly isQualifiedSellerLead: boolean;
  readonly captureConfidence?: CaptureConfidence;
  readonly acquisitionScore?: number;
  readonly slaStatus?: string;
  readonly relationshipMemory?: SellerRelationshipMemory;
}

export interface MarketplaceAcquisitionRecordsResponse {
  readonly records: readonly SellerAcquisitionRecord[];
}

export interface MarketplaceAcquisitionRecordsStore {
  readonly records: readonly SellerAcquisitionRecord[];
  readonly isLoading: boolean;
  readonly isValidating: boolean;
  readonly error: Error | undefined;
  readonly refresh: KeyedMutator<MarketplaceAcquisitionRecordsResponse>;
}

async function fetchMarketplaceAcquisitionRecords(url: string): Promise<MarketplaceAcquisitionRecordsResponse> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Unable to load captured sellers");
  const payload = await response.json() as { readonly data?: Partial<MarketplaceAcquisitionRecordsResponse> };
  return { records: payload.data?.records ?? [] };
}

export function useMarketplaceAcquisitionRecordsStore(): MarketplaceAcquisitionRecordsStore {
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    marketplaceAcquisitionRecordsPath,
    fetchMarketplaceAcquisitionRecords,
  );

  return {
    records: data?.records ?? [],
    isLoading,
    isValidating,
    error,
    refresh: mutate,
  };
}
