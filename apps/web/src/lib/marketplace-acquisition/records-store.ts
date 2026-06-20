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

export interface SellerAcquisitionDeal {
  readonly deal: { readonly id: string; readonly title?: string | null };
}

export interface DraftInventoryRecord {
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
  readonly expiresAt: string;
}

export interface SellerAcquisitionRecord {
  readonly capture: MarketplaceCaptureRecord;
  readonly contact: SellerAcquisitionContact | null;
  readonly deal: SellerAcquisitionDeal | null;
  readonly draftInventory: DraftInventoryRecord | null;
  readonly images: readonly string[];
  readonly latestInvitation: SellerInvitationRecord | null;
  readonly invitationHistory: readonly SellerInvitationRecord[];
  readonly claimTokenStatus: { readonly status: string; readonly expiresAt?: string | null } | null;
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
  if (!response.ok) throw new Error("Unable to load marketplace seller acquisition records");
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
