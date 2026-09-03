import { PersistenceError, type PersistenceCorrelationMetadata, type TenantScoped } from "@whisperm/types";
import type {
  MarketplaceDiscoveryRepository,
  DiscoveryRunRecord,
  DiscoveredSellerRecord,
  CreateDiscoveredSellerInput,
  SellerAcquisitionCampaignRepository,
  SellerAcquisitionCampaignMemberRecord,
} from "@whisperm/repositories";
import type { BusinessGrowthOpportunityService } from "../business-growth-opportunity.js";
import { recordUsageEventBestEffort, type AcquisitionUsageMeteringService } from "../acquisition-usage-metering.js";
import { SellerQualificationService, type QualificationPolicy } from "./qualification-service.js";
import type { CampaignTargetingConfig } from "../campaign-targeting.js";
import { SellerDedupeService, computeSellerIdentityKey } from "./dedupe-service.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscoveryServiceContext extends TenantScoped {
  readonly actorId: string;
}

export interface ManualSeedEntry {
  readonly listingUrl: string;
  readonly sellerName?: string;
  readonly phone?: string;
  readonly email?: string;
  readonly sellerProfileUrl?: string;
  readonly title?: string;
  readonly description?: string;
  readonly price?: string | number;
  readonly currency?: string;
  readonly category?: string;
  readonly location?: string;
  readonly images?: readonly string[];
  readonly portfolioListingCount?: number;
}

export interface StartDiscoveryRunInput {
  readonly campaignId: string;
  readonly marketplaceSourceId: string;
  readonly marketplaceSourceKey: string;
  readonly mode: DiscoveryRunRecord["mode"];
  readonly entries: readonly ManualSeedEntry[];
  readonly qualificationPolicy?: QualificationPolicy;
  readonly deferQualification?: boolean;
  readonly discoveryCreditsRemaining: number;
  readonly targeting?: CampaignTargetingConfig | undefined;
}

export interface DiscoveryRunResult {
  readonly run: DiscoveryRunRecord;
  readonly sellersFound: number;
  readonly sellersQualified: number;
  readonly sellersRejected: number;
  readonly sellersNeedsReview: number;
  readonly sellersDuplicate: number;
  readonly creditsConsumed: number;
}

export type DiscoveryCampaignRepository = Pick<SellerAcquisitionCampaignRepository, "findById" | "addSeller" | "findMemberByCapture">;

/**
 * ST1-006: structural port onto the canonical `MarketplaceAcquisitionCaptureService.capture`
 * method (packages/services/src/index.ts). Declared locally -- rather than importing the class
 * from index.ts -- to avoid a circular module dependency, since index.ts re-exports this file.
 */
export type CanonicalMarketplaceCaptureQualificationStatus = "QUALIFIED" | "UNQUALIFIED";
export type CanonicalMarketplaceCaptureCrmConversionStatus = "CREATED" | "EXISTING" | "NOT_ELIGIBLE";

export interface CanonicalMarketplaceCaptureContext extends TenantScoped {
  readonly actorId?: string | undefined;
  readonly correlation: PersistenceCorrelationMetadata;
}

export interface CanonicalMarketplaceCaptureInput extends TenantScoped {
  readonly listingUrl: string;
  readonly title: string;
  readonly description?: string | null | undefined;
  readonly price?: string | number | null | undefined;
  readonly currency?: string | null | undefined;
  readonly sellerName?: string | null | undefined;
  readonly sellerPhone?: string | null | undefined;
  readonly phone?: string | null | undefined;
  readonly sellerEmail?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly sellerProfileUrl?: string | null | undefined;
  readonly marketplaceSourceId?: string | null | undefined;
  readonly category?: string | null | undefined;
  readonly location?: string | null | undefined;
  readonly images?: string[] | null | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | null | undefined;
}

export interface CanonicalMarketplaceCaptureResult {
  readonly captureId: string;
  readonly contactId?: string | undefined;
  readonly dealId?: string | undefined;
  readonly contactCreated: boolean;
  readonly dealCreated: boolean;
  readonly qualificationStatus: CanonicalMarketplaceCaptureQualificationStatus;
  readonly crmConversionStatus: CanonicalMarketplaceCaptureCrmConversionStatus;
}

export interface CanonicalMarketplaceCapturePort {
  capture(context: CanonicalMarketplaceCaptureContext, input: CanonicalMarketplaceCaptureInput): Promise<CanonicalMarketplaceCaptureResult>;
}

export interface DiscoveryServiceDependencies {
  readonly discoveryRepo: MarketplaceDiscoveryRepository;
  /**
   * ST1-006: the canonical acquisition pipeline entry point (qualification, Contact, Deal).
   * Required only for promoteSellerToCapture; other methods do not need the capture/campaign bridge.
   */
  readonly canonicalCapture?: CanonicalMarketplaceCapturePort | undefined;
  readonly campaigns?: DiscoveryCampaignRepository | undefined;
  readonly businessGrowthOpportunities?: BusinessGrowthOpportunityService | undefined;
  /** CS-023: best-effort billable-usage recording; never blocks discovery on failure. */
  readonly usageMetering?: Pick<AcquisitionUsageMeteringService, "recordUsageEvent"> | undefined;
}

export interface PromoteDiscoveredSellerResult {
  readonly discoveredSellerId: string;
  readonly marketplaceCaptureId: string;
  readonly campaignMemberId: string | null;
  readonly status: "PROMOTED";
  readonly alreadyPromoted: boolean;
  /** ST1-006: canonical qualification/CRM-conversion outcome from the shared acquisition pipeline. */
  readonly qualificationStatus: CanonicalMarketplaceCaptureQualificationStatus;
  readonly crmConversionStatus: CanonicalMarketplaceCaptureCrmConversionStatus;
  readonly contactId?: string | undefined;
  readonly dealId?: string | undefined;
}

export type DiscoveryPromotionErrorCode =
  | "PROMOTION_NOT_CONFIGURED"
  | "SELLER_NOT_FOUND"
  | "CAMPAIGN_NOT_FOUND"
  | "CAMPAIGN_MISMATCH"
  | "INSUFFICIENT_CAPTURE_DATA"
  | "CAPTURE_ASSIGNMENT_FAILED";

export class DiscoveryPromotionError extends Error {
  readonly code: DiscoveryPromotionErrorCode;
  readonly status: number;

  constructor(input: { readonly code: DiscoveryPromotionErrorCode; readonly message: string; readonly status: number }) {
    super(input.message);
    this.name = "DiscoveryPromotionError";
    this.code = input.code;
    this.status = input.status;
  }
}

const isValidUrl = (value: string): boolean => {
  try {
    // eslint-disable-next-line no-new
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

const isValidEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value.trim());

const hasSufficientCaptureData = (seller: DiscoveredSellerRecord): boolean => {
  if (seller.listingUrl.trim().length === 0 || !isValidUrl(seller.listingUrl)) return false;
  const title = seller.title ?? seller.sellerName;
  return title !== undefined && title !== null && title.trim().length > 0;
};

const compact = (input: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> =>
  Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null));

/**
 * ST1-006: builds the canonical capture-pipeline input from a discovered-seller projection.
 * This is the only place discovery data crosses into the shared MarketplaceCapture boundary --
 * everything downstream (qualification, Contact, Deal) is owned by the canonical service.
 */
const nonEmptyTrimmed = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
};

const buildCanonicalCaptureInput = (tenantId: string, seller: DiscoveredSellerRecord): CanonicalMarketplaceCaptureInput => {
  const sellerProfileUrl = seller.sellerProfileUrl !== undefined && seller.sellerProfileUrl !== null && isValidUrl(seller.sellerProfileUrl)
    ? seller.sellerProfileUrl
    : undefined;
  const email = seller.email !== undefined && seller.email !== null && isValidEmail(seller.email) ? seller.email : undefined;
  const category = nonEmptyTrimmed(seller.category);
  const location = nonEmptyTrimmed(seller.location);
  // ST1-006: the canonical schema requires every image to be a valid URL (unlike the discovery
  // repo's untyped string array), so malformed scraped image URLs are dropped rather than
  // failing promotion for an otherwise-qualified seller.
  const images = seller.images?.filter((image) => isValidUrl(image));

  return {
    tenantId,
    listingUrl: seller.listingUrl,
    title: (seller.title ?? seller.sellerName ?? "").trim(),
    marketplaceSourceId: seller.marketplaceSourceId,
    ...(seller.description !== undefined && seller.description !== null ? { description: seller.description } : {}),
    ...(seller.price !== undefined && seller.price !== null ? { price: seller.price } : {}),
    ...(seller.currency !== undefined && seller.currency !== null ? { currency: seller.currency } : {}),
    ...(seller.sellerName !== undefined && seller.sellerName !== null ? { sellerName: seller.sellerName } : {}),
    ...(seller.phone !== undefined && seller.phone !== null ? { sellerPhone: seller.phone, phone: seller.phone } : {}),
    ...(email !== undefined ? { sellerEmail: email, email } : {}),
    ...(sellerProfileUrl !== undefined ? { sellerProfileUrl } : {}),
    ...(category !== undefined ? { category } : {}),
    ...(location !== undefined ? { location } : {}),
    ...(images !== undefined && images.length > 0 ? { images } : {}),
    metadata: compact({
      discoveredSellerId: seller.id,
      discoveryRunId: seller.discoveryRunId,
    }),
  };
};

const isConflictError = (error: unknown): error is PersistenceError =>
  error instanceof PersistenceError && error.code === "PERSISTENCE_CONFLICT";

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class MarketplaceDiscoveryService {
  private readonly qualificationService: SellerQualificationService;
  private readonly dedupeService: SellerDedupeService;

  constructor(private readonly deps: DiscoveryServiceDependencies) {
    this.qualificationService = new SellerQualificationService();
    this.dedupeService = new SellerDedupeService(deps.discoveryRepo);
  }

  async runDiscovery(
    context: DiscoveryServiceContext,
    input: StartDiscoveryRunInput,
  ): Promise<DiscoveryRunResult> {
    if (input.discoveryCreditsRemaining <= 0) {
      throw new Error("DISCOVERY_CREDITS_EXHAUSTED");
    }

    // Create the run record
    const repoContext = { tenantId: context.tenantId };
    const run = await this.deps.discoveryRepo.createDiscoveryRun(repoContext, {
      tenantId: context.tenantId,
      campaignId: input.campaignId,
      marketplaceSourceId: input.marketplaceSourceId,
      mode: input.mode,
      config: { marketplaceSourceKey: input.marketplaceSourceKey, targetingSnapshot: input.targeting ?? null },
    });

    const startedAtMs = Date.now();

    // Mark as running
    await this.deps.discoveryRepo.updateDiscoveryRun(repoContext, run.id, {
      status: "RUNNING",
      startedAt: new Date(startedAtMs).toISOString(),
    });

    let sellersFound = 0;
    let sellersQualified = 0;
    let sellersRejected = 0;
    let sellersNeedsReview = 0;
    let sellersDuplicate = 0;
    let confidenceTotal = 0;
    let creditsConsumed = 0;

    try {
      for (const entry of input.entries) {
        // Stop if credits exhausted mid-run
        if (creditsConsumed >= input.discoveryCreditsRemaining) break;

        // Skip empty listing URLs
        if (!entry.listingUrl || entry.listingUrl.trim().length === 0) continue;

        // Record already-seen listing URLs in this run as explicit duplicates.
        const existingByUrl = await this.deps.discoveryRepo.findDiscoveredSellerByListingUrl(
          repoContext,
          run.id,
          entry.listingUrl,
        );
        if (existingByUrl !== null) {
          sellersFound++;
          sellersDuplicate++;
          sellersRejected++;
          await this.deps.discoveryRepo.createDiscoveredSeller(repoContext, {
            tenantId: context.tenantId,
            discoveryRunId: run.id,
            campaignId: input.campaignId,
            marketplaceSourceId: input.marketplaceSourceId,
            listingUrl: `${entry.listingUrl}#duplicate-${sellersDuplicate}`,
            status: "DUPLICATE",
            duplicateOfId: existingByUrl.id,
            qualificationPolicy: { reasons: ["DUPLICATE_LISTING"], duplicateReason: "LISTING_URL_MATCH" },
            rawData: entry as unknown as Readonly<Record<string, unknown>>,
            metadata: { reasons: ["DUPLICATE_LISTING"], duplicateReason: "LISTING_URL_MATCH", originalListingUrl: entry.listingUrl },
          });
          continue;
        }

        sellersFound++;
        creditsConsumed++;

        // Compute identity key for dedup
        const sellerIdentityKey = computeSellerIdentityKey(
          entry.phone,
          entry.sellerProfileUrl,
          input.marketplaceSourceKey,
        );

        // Check for duplicates within this campaign
        const dedupResult = await this.dedupeService.checkDuplicate(
          repoContext,
          input.campaignId,
          sellerIdentityKey,
        );

        if (dedupResult.isDuplicate) {
          sellersDuplicate++;
          await this.deps.discoveryRepo.createDiscoveredSeller(repoContext, {
            tenantId: context.tenantId,
            discoveryRunId: run.id,
            campaignId: input.campaignId,
            marketplaceSourceId: input.marketplaceSourceId,
            listingUrl: entry.listingUrl,
            ...(sellerIdentityKey !== undefined ? { sellerIdentityKey } : {}),
            status: "DUPLICATE",
            duplicateOfId: dedupResult.duplicateOfId,
            qualificationPolicy: { reasons: ["DUPLICATE_LISTING"], duplicateReason: dedupResult.reason },
            ...(entry.sellerName !== undefined ? { sellerName: entry.sellerName } : {}),
            ...(entry.phone !== undefined ? { phone: entry.phone } : {}),
            ...(entry.sellerProfileUrl !== undefined ? { sellerProfileUrl: entry.sellerProfileUrl } : {}),
            rawData: entry as unknown as Readonly<Record<string, unknown>>,
            metadata: { reasons: ["DUPLICATE_LISTING"], duplicateReason: dedupResult.reason },
          });
          continue;
        }

        // Qualify the seller unless autonomous Campaign Runtime has deferred this to the qualification worker.
        const qualification = input.deferQualification ? undefined : this.qualificationService.qualify(
          {
            listingUrl: entry.listingUrl,
            marketplaceSourceKey: input.marketplaceSourceKey,
            campaignTargetMarketplaces: input.targeting === undefined ? undefined : [input.targeting.marketplaceSourceKey ?? input.targeting.marketplaceSourceId ?? input.marketplaceSourceKey],
            targetingCategory: input.targeting?.category ?? null,
            targetingLocation: input.targeting?.location ?? null,
            targetingKeyword: input.targeting?.keyword ?? null,
            targetingPriceMin: input.targeting?.priceMin ?? null,
            targetingPriceMax: input.targeting?.priceMax ?? null,
            phone: entry.phone ?? null,
            email: entry.email ?? null,
            sellerName: entry.sellerName ?? null,
            sellerProfileUrl: entry.sellerProfileUrl ?? null,
            title: entry.title ?? null,
            category: entry.category ?? null,
            images: entry.images ?? null,
            price: entry.price ?? null,
            location: entry.location ?? null,
            ...(entry.portfolioListingCount !== undefined ? { portfolioListingCount: entry.portfolioListingCount } : {}),
          },
          input.qualificationPolicy,
        );

        if (qualification !== undefined) confidenceTotal += qualification.confidence.overallConfidence;
        if (qualification?.status === "QUALIFIED") {
          sellersQualified++;
        } else if (qualification?.status === "NEEDS_REVIEW") {
          sellersNeedsReview++;
        } else {
          if (qualification !== undefined) sellersRejected++;
        }

        const sellerInput: CreateDiscoveredSellerInput = {
          tenantId: context.tenantId,
          discoveryRunId: run.id,
          campaignId: input.campaignId,
          marketplaceSourceId: input.marketplaceSourceId,
          listingUrl: entry.listingUrl,
          ...(sellerIdentityKey !== undefined ? { sellerIdentityKey } : {}),
          status: qualification?.status ?? "PENDING",
          qualificationScore: qualification?.score ?? 0,
          ...(qualification !== undefined ? { qualificationPolicy: qualification.breakdown as Readonly<Record<string, unknown>> } : {}),
          ...(entry.sellerName !== undefined ? { sellerName: entry.sellerName } : {}),
          ...(entry.phone !== undefined ? { phone: entry.phone } : {}),
          ...(entry.email !== undefined ? { email: entry.email } : {}),
          ...(entry.sellerProfileUrl !== undefined ? { sellerProfileUrl: entry.sellerProfileUrl } : {}),
          ...(entry.title !== undefined ? { title: entry.title } : {}),
          ...(entry.description !== undefined ? { description: entry.description } : {}),
          ...(entry.price !== undefined ? { price: entry.price } : {}),
          ...(entry.currency !== undefined ? { currency: entry.currency } : {}),
          ...(entry.category !== undefined ? { category: entry.category } : {}),
          ...(entry.location !== undefined ? { location: entry.location } : {}),
          ...(entry.images !== undefined ? { images: [...entry.images] } : {}),
          rawData: entry as unknown as Readonly<Record<string, unknown>>,
          metadata: {
            reasons: qualification?.reasons ?? [],
            confidence: qualification?.confidence ?? 0,
            targetingSnapshot: input.targeting ?? null,
          },
        };

        const seller = await this.deps.discoveryRepo.createDiscoveredSeller(repoContext, sellerInput);
        if (qualification !== undefined) {
          const opportunity = await this.deps.businessGrowthOpportunities?.createFromDiscoveredSeller(repoContext, seller);
          if (opportunity !== undefined) {
            await this.deps.businessGrowthOpportunities?.attachQualificationOutput(repoContext, opportunity.id, qualification);
          }
        }
        if (this.deps.usageMetering !== undefined) {
          await recordUsageEventBestEffort(this.deps.usageMetering, repoContext, {
            eventType: "SELLER_DISCOVERED",
            campaignId: input.campaignId,
            captureId: seller.id,
            idempotencyKey: `usage:SELLER_DISCOVERED:${context.tenantId}:${input.campaignId}:${sellerIdentityKey ?? entry.listingUrl}`,
          });
        }
      }

      // Mark run complete
      const completedRun = await this.deps.discoveryRepo.updateDiscoveryRun(repoContext, run.id, {
        status: "COMPLETED",
        completedAt: new Date().toISOString(),
        sellersFound,
        sellersQualified,
        sellersRejected,
        sellersDuplicate,
        metadata: {
          submitted: input.entries.length,
          processed: sellersFound,
          uniqueListings: sellersFound - sellersDuplicate,
          duplicateListings: sellersDuplicate,
          qualified: sellersQualified,
          needsReview: sellersNeedsReview,
          rejected: sellersRejected,
          promoted: 0,
          averageConfidence: sellersFound - sellersDuplicate > 0 ? Math.round(confidenceTotal / (sellersFound - sellersDuplicate)) : 0,
          elapsedTime: Date.now() - startedAtMs,
          targetingSnapshot: input.targeting ?? null,
          reconciliationGap: "Discovery runs are persisted by the existing discovery service; broad Campaign Runtime execution migration remains a follow-up.",
        },
      });

      return {
        run: completedRun,
        sellersFound,
        sellersQualified,
        sellersRejected,
        sellersNeedsReview,
        sellersDuplicate,
        creditsConsumed,
      };
    } catch (error) {
      // Mark run failed
      await this.deps.discoveryRepo.updateDiscoveryRun(repoContext, run.id, {
        status: "FAILED",
        completedAt: new Date().toISOString(),
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        sellersFound,
        sellersQualified,
        sellersRejected,
        sellersDuplicate,
        metadata: {
          submitted: input.entries.length,
          processed: sellersFound,
          uniqueListings: sellersFound - sellersDuplicate,
          duplicateListings: sellersDuplicate,
          qualified: sellersQualified,
          needsReview: sellersNeedsReview,
          rejected: sellersRejected,
          promoted: 0,
          averageConfidence: sellersFound - sellersDuplicate > 0 ? Math.round(confidenceTotal / (sellersFound - sellersDuplicate)) : 0,
          elapsedTime: Date.now() - startedAtMs,
          targetingSnapshot: input.targeting ?? null,
          reconciliationGap: "Discovery runs are persisted by the existing discovery service; broad Campaign Runtime execution migration remains a follow-up.",
        },
      });
      throw error;
    }
  }

  /**
   * ST1-006: Routes a discovered-seller projection through the canonical acquisition
   * pipeline (MarketplaceCapture -> qualification -> CRM conversion) instead of creating
   * or reusing a capture directly. Discovery and manual/URL capture become identical from
   * MarketplaceCapture onward; there is no discovery-specific downstream behavior.
   * The canonical capture step is itself idempotent (matches by listing URL / phone / email /
   * external id), so re-running it on an already-promoted seller is safe and lets a seller who
   * is later enriched with a phone number become qualified and CRM-converted on re-promotion.
   */
  async promoteSellerToCapture(
    context: DiscoveryServiceContext,
    campaignId: string,
    sellerId: string,
  ): Promise<PromoteDiscoveredSellerResult> {
    if (this.deps.canonicalCapture === undefined || this.deps.campaigns === undefined) {
      throw new DiscoveryPromotionError({
        code: "PROMOTION_NOT_CONFIGURED",
        message: "Discovery promotion is not configured for this service instance.",
        status: 500,
      });
    }
    const { canonicalCapture, campaigns } = this.deps;
    const repoContext = { tenantId: context.tenantId };

    const seller = await this.deps.discoveryRepo.findDiscoveredSellerById(repoContext, sellerId);
    if (seller === null) {
      throw new DiscoveryPromotionError({ code: "SELLER_NOT_FOUND", message: "Discovered seller was not found for this workspace.", status: 404 });
    }
    if (seller.campaignId !== campaignId) {
      throw new DiscoveryPromotionError({ code: "CAMPAIGN_MISMATCH", message: "Discovered seller does not belong to the specified campaign.", status: 409 });
    }

    const campaign = await campaigns.findById(repoContext, campaignId);
    if (campaign === null) {
      throw new DiscoveryPromotionError({ code: "CAMPAIGN_NOT_FOUND", message: "Seller acquisition campaign was not found for this workspace.", status: 404 });
    }

    if (!hasSufficientCaptureData(seller)) {
      throw new DiscoveryPromotionError({
        code: "INSUFFICIENT_CAPTURE_DATA",
        message: "Discovered seller is missing a valid listing URL or title required to create a marketplace capture.",
        status: 422,
      });
    }

    const wasAlreadyPromoted = seller.status === "PROMOTED" && seller.promotedCaptureId !== undefined && seller.promotedCaptureId !== null;

    const captureResult = await canonicalCapture.capture(
      {
        tenantId: context.tenantId,
        actorId: context.actorId,
        correlation: { correlationId: `discovery-promotion:${context.tenantId}:${sellerId}` },
      },
      buildCanonicalCaptureInput(context.tenantId, seller),
    );

    let member: SellerAcquisitionCampaignMemberRecord | null = await campaigns.findMemberByCapture(repoContext, campaignId, captureResult.captureId);
    if (member === null) {
      try {
        member = await campaigns.addSeller(repoContext, { tenantId: context.tenantId, campaignId, marketplaceCaptureId: captureResult.captureId });
      } catch (error) {
        if (!isConflictError(error)) {
          throw new DiscoveryPromotionError({ code: "CAPTURE_ASSIGNMENT_FAILED", message: "Failed to assign the marketplace capture to this campaign.", status: 502 });
        }
        member = await campaigns.findMemberByCapture(repoContext, campaignId, captureResult.captureId);
        if (member === null) {
          throw new DiscoveryPromotionError({ code: "CAPTURE_ASSIGNMENT_FAILED", message: "Failed to assign the marketplace capture to this campaign.", status: 502 });
        }
      }
    }

    const updatedSeller = await this.deps.discoveryRepo.updateDiscoveredSellerStatus(
      repoContext,
      sellerId,
      "PROMOTED",
      { promotedCaptureId: captureResult.captureId, reviewedBy: context.actorId },
    );
    await this.deps.businessGrowthOpportunities?.createFromDiscoveredSeller(repoContext, updatedSeller);

    return {
      discoveredSellerId: updatedSeller.id,
      marketplaceCaptureId: captureResult.captureId,
      campaignMemberId: member.id,
      status: "PROMOTED",
      alreadyPromoted: wasAlreadyPromoted,
      qualificationStatus: captureResult.qualificationStatus,
      crmConversionStatus: captureResult.crmConversionStatus,
      contactId: captureResult.contactId,
      dealId: captureResult.dealId,
    };
  }

  /**
   * ST1-013N: campaign-scoped like promoteSellerToCapture -- a seller row belongs to exactly
   * one campaign (DiscoveredMarketplaceSeller.campaignId), so rejecting must verify the seller
   * actually belongs to the campaign named in the request before mutating it. Without this
   * check, any sellerId known to the tenant could be rejected via any campaignId's URL,
   * silently mutating a different campaign's roster.
   */
  async rejectSeller(
    context: DiscoveryServiceContext,
    campaignId: string,
    sellerId: string,
  ): Promise<DiscoveredSellerRecord> {
    const repoContext = { tenantId: context.tenantId };
    const seller = await this.deps.discoveryRepo.findDiscoveredSellerById(repoContext, sellerId);
    if (seller === null) {
      throw new DiscoveryPromotionError({ code: "SELLER_NOT_FOUND", message: "Discovered seller was not found for this workspace.", status: 404 });
    }
    if (seller.campaignId !== campaignId) {
      throw new DiscoveryPromotionError({ code: "CAMPAIGN_MISMATCH", message: "Discovered seller does not belong to the specified campaign.", status: 409 });
    }

    return this.deps.discoveryRepo.updateDiscoveredSellerStatus(
      repoContext,
      sellerId,
      "REJECTED",
      { reviewedBy: context.actorId },
    );
  }

  async getRunSummary(
    context: TenantScoped,
    campaignId: string,
  ): Promise<{
    totalRuns: number;
    pendingReview: number;
    qualified: number;
    promoted: number;
  }> {
    const [pending, qualified, promoted] = await Promise.all([
      this.deps.discoveryRepo.countDiscoveredSellersByCampaign(context, campaignId, "NEEDS_REVIEW"),
      this.deps.discoveryRepo.countDiscoveredSellersByCampaign(context, campaignId, "QUALIFIED"),
      this.deps.discoveryRepo.countDiscoveredSellersByCampaign(context, campaignId, "PROMOTED"),
    ]);
    const runs = await this.deps.discoveryRepo.listDiscoveryRunsByCampaign(context, campaignId);
    return {
      totalRuns: runs.length,
      pendingReview: pending,
      qualified,
      promoted,
    };
  }
}
