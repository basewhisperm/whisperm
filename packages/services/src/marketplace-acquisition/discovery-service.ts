import type { TenantScoped } from "@whisperm/types";
import type {
  MarketplaceDiscoveryRepository,
  DiscoveryRunRecord,
  DiscoveredSellerRecord,
  CreateDiscoveredSellerInput,
} from "@whisperm/repositories";
import { SellerQualificationService, type QualificationPolicy } from "./qualification-service.js";
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
  readonly discoveryCreditsRemaining: number;
}

export interface DiscoveryRunResult {
  readonly run: DiscoveryRunRecord;
  readonly sellersFound: number;
  readonly sellersQualified: number;
  readonly sellersRejected: number;
  readonly sellersDuplicate: number;
  readonly creditsConsumed: number;
}

export interface DiscoveryServiceDependencies {
  readonly discoveryRepo: MarketplaceDiscoveryRepository;
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
    const run = await this.deps.discoveryRepo.createDiscoveryRun(context, {
      tenantId: context.tenantId,
      campaignId: input.campaignId,
      marketplaceSourceId: input.marketplaceSourceId,
      mode: input.mode,
      config: { marketplaceSourceKey: input.marketplaceSourceKey },
    });

    // Mark as running
    await this.deps.discoveryRepo.updateDiscoveryRun(context, run.id, {
      status: "RUNNING",
      startedAt: new Date().toISOString(),
    });

    let sellersFound = 0;
    let sellersQualified = 0;
    let sellersRejected = 0;
    let sellersDuplicate = 0;
    let creditsConsumed = 0;

    try {
      for (const entry of input.entries) {
        // Stop if credits exhausted mid-run
        if (creditsConsumed >= input.discoveryCreditsRemaining) break;

        // Skip empty listing URLs
        if (!entry.listingUrl || entry.listingUrl.trim().length === 0) continue;

        // Skip already-seen listing URLs in this run
        const existingByUrl = await this.deps.discoveryRepo.findDiscoveredSellerByListingUrl(
          context,
          run.id,
          entry.listingUrl,
        );
        if (existingByUrl !== null) continue;

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
          context,
          input.campaignId,
          sellerIdentityKey,
        );

        if (dedupResult.isDuplicate) {
          sellersDuplicate++;
          await this.deps.discoveryRepo.createDiscoveredSeller(context, {
            tenantId: context.tenantId,
            discoveryRunId: run.id,
            campaignId: input.campaignId,
            marketplaceSourceId: input.marketplaceSourceId,
            listingUrl: entry.listingUrl,
            ...(sellerIdentityKey !== undefined ? { sellerIdentityKey } : {}),
            status: "DUPLICATE",
            duplicateOfId: dedupResult.duplicateOfId,
            ...(entry.sellerName !== undefined ? { sellerName: entry.sellerName } : {}),
          ...(entry.phone !== undefined ? { phone: entry.phone } : {}),
          ...(entry.sellerProfileUrl !== undefined ? { sellerProfileUrl: entry.sellerProfileUrl } : {}),
            rawData: entry as unknown as Readonly<Record<string, unknown>>,
          });
          continue;
        }

        // Qualify the seller
        const qualification = this.qualificationService.qualify(
          {
            phone: entry.phone ?? null,
            email: entry.email ?? null,
            sellerName: entry.sellerName ?? null,
            sellerProfileUrl: entry.sellerProfileUrl ?? null,
            images: entry.images ?? null,
            price: entry.price ?? null,
            location: entry.location ?? null,
            portfolioListingCount: entry.portfolioListingCount,
          },
          input.qualificationPolicy,
        );

        if (qualification.status === "QUALIFIED") {
          sellersQualified++;
        } else {
          sellersRejected++;
        }

        const sellerInput: CreateDiscoveredSellerInput = {
          tenantId: context.tenantId,
          discoveryRunId: run.id,
          campaignId: input.campaignId,
          marketplaceSourceId: input.marketplaceSourceId,
          listingUrl: entry.listingUrl,
          ...(sellerIdentityKey !== undefined ? { sellerIdentityKey } : {}),
          status: qualification.status,
          qualificationScore: qualification.score,
          qualificationPolicy: qualification.breakdown as Readonly<Record<string, unknown>>,
          sellerName: entry.sellerName,
          ...(entry.phone !== undefined ? { phone: entry.phone } : {}),
          ...(entry.email !== undefined ? { email: entry.email } : {}),
          ...(entry.sellerProfileUrl !== undefined ? { sellerProfileUrl: entry.sellerProfileUrl } : {}),
          title: entry.title,
          description: entry.description,
          price: entry.price,
          currency: entry.currency,
          category: entry.category,
          location: entry.location,
          images: entry.images ? [...entry.images] : undefined,
          rawData: entry as unknown as Readonly<Record<string, unknown>>,
        };

        await this.deps.discoveryRepo.createDiscoveredSeller(context, sellerInput);
      }

      // Mark run complete
      const completedRun = await this.deps.discoveryRepo.updateDiscoveryRun(context, run.id, {
        status: "COMPLETED",
        completedAt: new Date().toISOString(),
        sellersFound,
        sellersQualified,
        sellersRejected,
        sellersDuplicate,
      });

      return {
        run: completedRun,
        sellersFound,
        sellersQualified,
        sellersRejected,
        sellersDuplicate,
        creditsConsumed,
      };
    } catch (error) {
      // Mark run failed
      await this.deps.discoveryRepo.updateDiscoveryRun(context, run.id, {
        status: "FAILED",
        completedAt: new Date().toISOString(),
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        sellersFound,
        sellersQualified,
        sellersRejected,
        sellersDuplicate,
      });
      throw error;
    }
  }

  async promoteSellerToCapture(
    context: DiscoveryServiceContext,
    sellerId: string,
    captureId: string,
  ): Promise<DiscoveredSellerRecord> {
    return this.deps.discoveryRepo.updateDiscoveredSellerStatus(
      context,
      sellerId,
      "PROMOTED",
      { promotedCaptureId: captureId, reviewedBy: context.actorId },
    );
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
      this.deps.discoveryRepo.countDiscoveredSellersByCampaign(context, campaignId, "PENDING"),
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
