import type { MarketplaceDiscoveryRepository, DiscoveredSellerRecord } from "@whisperm/repositories";
import type { TenantScoped } from "@whisperm/types";
import type { BusinessGrowthOpportunityService } from "../business-growth-opportunity.js";
import { SellerQualificationService, type QualificationPolicy } from "./qualification-service.js";

export interface QualificationExecutionInput {
  readonly campaignId: string;
  readonly qualificationPolicy?: QualificationPolicy | undefined;
}

export interface QualificationExecutionResult {
  readonly qualifiedCount: number;
  readonly disqualifiedCount: number;
  readonly needsReviewCount: number;
  readonly skippedDuplicateCount: number;
  readonly failedCount: number;
}

export interface QualificationExecutionServiceDependencies {
  readonly discoveryRepo: MarketplaceDiscoveryRepository;
  readonly businessGrowthOpportunities?: BusinessGrowthOpportunityService | undefined;
}

const sourceKey = (seller: DiscoveredSellerRecord): string => {
  const raw = seller.rawData?.marketplaceSourceKey ?? seller.metadata?.marketplaceSourceKey;
  return typeof raw === "string" && raw.trim().length > 0 ? raw : seller.marketplaceSourceId;
};

export class MarketplaceQualificationExecutionService {
  private readonly qualification = new SellerQualificationService();

  constructor(private readonly deps: QualificationExecutionServiceDependencies) {}

  async qualifyDiscoveredSellers(context: TenantScoped, input: QualificationExecutionInput): Promise<QualificationExecutionResult> {
    const candidates = await this.deps.discoveryRepo.listDiscoveredSellersByCampaign(context, input.campaignId);
    let qualifiedCount = 0;
    let disqualifiedCount = 0;
    let needsReviewCount = 0;
    let skippedDuplicateCount = 0;
    let failedCount = 0;

    for (const seller of candidates) {
      if (seller.status === "DUPLICATE") {
        skippedDuplicateCount += 1;
        continue;
      }
      if (!["NEW", "PENDING", "QUALIFYING", "NEEDS_REVIEW", "REJECTED", "QUALIFIED"].includes(seller.status)) continue;
      try {
        await this.deps.discoveryRepo.updateDiscoveredSellerStatus(context, seller.id, "QUALIFYING");
        const result = this.qualification.qualify({
          listingUrl: seller.listingUrl,
          marketplaceSourceKey: sourceKey(seller),
          phone: seller.phone,
          email: seller.email,
          sellerName: seller.sellerName,
          sellerProfileUrl: seller.sellerProfileUrl,
          title: seller.title,
          category: seller.category,
          images: seller.images,
          price: seller.price,
          location: seller.location,
        }, input.qualificationPolicy);
        const updated = await this.deps.discoveryRepo.updateDiscoveredSellerQualification(context, seller.id, {
          status: result.status,
          qualificationScore: result.score,
          qualificationPolicy: result.breakdown as Readonly<Record<string, unknown>>,
          metadata: { ...(seller.metadata ?? {}), reasons: result.reasons, confidence: result.confidence, qualifiedAt: result.status === "QUALIFIED" ? new Date().toISOString() : undefined, disqualifiedAt: result.status === "REJECTED" ? new Date().toISOString() : undefined },
        });
        const opportunity = await this.deps.businessGrowthOpportunities?.createFromDiscoveredSeller(context, updated);
        if (opportunity !== undefined) await this.deps.businessGrowthOpportunities?.attachQualificationOutput(context, opportunity.id, result);
        if (result.status === "QUALIFIED") qualifiedCount += 1;
        else if (result.status === "NEEDS_REVIEW") needsReviewCount += 1;
        else disqualifiedCount += 1;
      } catch (error) {
        failedCount += 1;
        await this.deps.discoveryRepo.updateDiscoveredSellerQualification(context, seller.id, { status: "REJECTED", qualificationScore: 0, metadata: { ...(seller.metadata ?? {}), qualificationFailureCode: "QUALIFICATION_EXECUTION_FAILED", failureMessage: error instanceof Error ? error.message.slice(0, 500) : "Qualification execution failed" } });
      }
    }
    return { qualifiedCount, disqualifiedCount, needsReviewCount, skippedDuplicateCount, failedCount };
  }
}
