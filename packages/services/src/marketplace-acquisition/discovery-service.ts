import type { TenantScoped } from "@whisperm/types";
import type {
  MarketplaceDiscoveryRepository,
  DiscoveryRunRecord,
  DiscoveredSellerRecord,
  CreateDiscoveredSellerInput,
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

export interface DiscoveryServiceDependencies {
  readonly discoveryRepo: MarketplaceDiscoveryRepository;
  readonly businessGrowthOpportunities?: BusinessGrowthOpportunityService | undefined;
  /** CS-023: best-effort billable-usage recording; never blocks discovery on failure. */
  readonly usageMetering?: Pick<AcquisitionUsageMeteringService, "recordUsageEvent"> | undefined;
}

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

  async promoteSellerToCapture(
    context: DiscoveryServiceContext,
    sellerId: string,
    captureId: string,
  ): Promise<DiscoveredSellerRecord> {
    const seller = await this.deps.discoveryRepo.updateDiscoveredSellerStatus(
      context,
      sellerId,
      "PROMOTED",
      { promotedCaptureId: captureId, reviewedBy: context.actorId },
    );
    await this.deps.businessGrowthOpportunities?.createFromDiscoveredSeller({ tenantId: context.tenantId }, seller);
    return seller;
  }

  async rejectSeller(
    context: DiscoveryServiceContext,
    sellerId: string,
  ): Promise<DiscoveredSellerRecord> {
    return this.deps.discoveryRepo.updateDiscoveredSellerStatus(
      context,
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
