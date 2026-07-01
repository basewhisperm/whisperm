import type {
  BusinessGrowthOpportunityRecord,
  BusinessGrowthOpportunityRepository,
  BusinessGrowthOpportunityStatus,
  DiscoveredSellerRecord,
  MarketplaceCaptureRecord,
} from "@whisperm/repositories";
import type { TenantScoped } from "@whisperm/types";
import type { QualificationResult } from "./marketplace-acquisition/qualification-service.js";

export interface BusinessGrowthOpportunityServiceDependencies {
  readonly opportunities: BusinessGrowthOpportunityRepository;
}

export class BusinessGrowthOpportunityService {
  constructor(private readonly deps: BusinessGrowthOpportunityServiceDependencies) {}

  async createFromMarketplaceCapture(context: TenantScoped, capture: MarketplaceCaptureRecord): Promise<BusinessGrowthOpportunityRecord> {
    return this.deps.opportunities.createOrUpdateFromMarketplaceCapture(context, {
      tenantId: context.tenantId,
      marketplaceCaptureId: capture.id,
      contactId: capture.contactId ?? undefined,
      dealId: capture.dealId ?? undefined,
      status: statusFromCapture(capture.status),
      sourceType: "MARKETPLACE_CAPTURE",
      sourceUrl: capture.listingUrl,
      sourceKey: capture.marketplaceSourceId ?? undefined,
    });
  }

  async createFromDiscoveredSeller(context: TenantScoped, seller: DiscoveredSellerRecord): Promise<BusinessGrowthOpportunityRecord> {
    return this.deps.opportunities.createOrUpdateFromDiscoveredSeller(context, {
      tenantId: context.tenantId,
      discoveredSellerId: seller.id,
      campaignId: seller.campaignId,
      marketplaceCaptureId: seller.promotedCaptureId ?? undefined,
      status: statusFromQualificationStatus(seller.status),
      qualificationStatus: seller.status,
      qualificationScore: seller.qualificationScore,
      qualificationReasons: seller.qualificationPolicy ?? seller.metadata ?? undefined,
      sourceType: "DISCOVERED_MARKETPLACE_SELLER",
      sourceUrl: seller.listingUrl,
      sourceKey: seller.marketplaceSourceId,
    });
  }

  async attachQualificationOutput(
    context: TenantScoped,
    opportunityId: string,
    qualification: QualificationResult,
  ): Promise<BusinessGrowthOpportunityRecord> {
    return this.deps.opportunities.updateQualification(context, opportunityId, {
      status: qualification.status,
      score: qualification.score,
      reasons: { reasons: qualification.reasons, confidence: qualification.confidence, breakdown: qualification.breakdown },
    });
  }

  async linkContact(context: TenantScoped, opportunityId: string, contactId: string): Promise<BusinessGrowthOpportunityRecord> {
    return this.deps.opportunities.linkContact(context, opportunityId, contactId);
  }

  async linkDeal(context: TenantScoped, opportunityId: string, dealId: string): Promise<BusinessGrowthOpportunityRecord> {
    return this.deps.opportunities.linkDeal(context, opportunityId, dealId);
  }

  async linkDraftInventory(context: TenantScoped, opportunityId: string, draftInventoryId: string): Promise<BusinessGrowthOpportunityRecord> {
    return this.deps.opportunities.linkDraftInventory(context, opportunityId, draftInventoryId);
  }
}

const statusFromQualificationStatus = (status: string): BusinessGrowthOpportunityStatus => {
  if (status === "QUALIFIED") return "QUALIFIED";
  if (status === "NEEDS_REVIEW") return "NEEDS_REVIEW";
  if (status === "REJECTED" || status === "DUPLICATE") return "REJECTED";
  if (status === "PROMOTED") return "IDENTIFIED";
  return "IDENTIFIED";
};

const statusFromCapture = (status: string): BusinessGrowthOpportunityStatus => {
  if (status === "INVITED" || status === "CLAIM_STARTED") return "INVITED";
  if (status === "CLAIMED") return "CLAIMED";
  if (status === "CONVERTED") return "CONVERTED";
  if (status === "EXPIRED") return "ARCHIVED";
  return "IDENTIFIED";
};
