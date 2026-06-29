import { createHash } from "crypto";
import type { TenantScoped } from "@whisperm/types";
import type { MarketplaceDiscoveryRepository } from "@whisperm/repositories";

// ---------------------------------------------------------------------------
// Identity key computation
// ---------------------------------------------------------------------------

export function computeSellerIdentityKey(
  phone: string | null | undefined,
  sellerProfileUrl: string | null | undefined,
  marketplaceSourceKey: string,
): string | undefined {
  // Primary: phone + source (most reliable cross-listing identity)
  if (phone !== null && phone !== undefined && phone.trim().length > 0) {
    const normalized = phone.replace(/\D/g, "");
    if (normalized.length >= 7) {
      return createHash("sha256")
        .update(`phone:${normalized}:${marketplaceSourceKey}`)
        .digest("hex")
        .slice(0, 32);
    }
  }

  // Fallback: seller profile URL (stable per seller on marketplace)
  if (sellerProfileUrl !== null && sellerProfileUrl !== undefined && sellerProfileUrl.trim().length > 0) {
    try {
      const url = new URL(sellerProfileUrl);
      const canonical = `${url.hostname}${url.pathname}`.toLowerCase().replace(/\/$/, "");
      return createHash("sha256")
        .update(`profile:${canonical}`)
        .digest("hex")
        .slice(0, 32);
    } catch {
      // invalid URL — skip
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Dedup result
// ---------------------------------------------------------------------------

export type DedupStatus =
  | { readonly isDuplicate: false }
  | { readonly isDuplicate: true; readonly duplicateOfId: string; readonly reason: "PHONE_MATCH" | "PROFILE_URL_MATCH" };

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SellerDedupeService {
  constructor(
    private readonly discoveryRepo: MarketplaceDiscoveryRepository,
  ) {}

  async checkDuplicate(
    context: TenantScoped,
    campaignId: string,
    sellerIdentityKey: string | undefined,
  ): Promise<DedupStatus> {
    if (sellerIdentityKey === undefined) {
      return { isDuplicate: false };
    }

    // Check within campaign — same identity key means same physical seller
    const existing = await this.discoveryRepo.findDiscoveredSellerByIdentityKey(
      context,
      campaignId,
      sellerIdentityKey,
    );

    if (existing !== null) {
      return {
        isDuplicate: true,
        duplicateOfId: existing.id,
        reason: existing.phone !== null && existing.phone !== undefined
          ? "PHONE_MATCH"
          : "PROFILE_URL_MATCH",
      };
    }

    return { isDuplicate: false };
  }
}
