import type {
  CreateSellerAcquisitionCampaignInput,
  CreateSellerAcquisitionCampaignMemberInput,
  PageRequest,
  SellerAcquisitionCampaignMemberRecord,
  SellerAcquisitionCampaignRecord,
  SellerAcquisitionCampaignRepository,
  UpdateSellerAcquisitionCampaignInput,
} from "@whisperm/repositories";
import type { TenantScoped } from "@whisperm/types";

export class SellerAcquisitionCampaignService {
  constructor(private readonly campaigns: SellerAcquisitionCampaignRepository) {}

  list(context: TenantScoped, page?: PageRequest) {
    return this.campaigns.list(context, page);
  }

  create(context: TenantScoped, input: Omit<CreateSellerAcquisitionCampaignInput, "tenantId">): Promise<SellerAcquisitionCampaignRecord> {
    return this.campaigns.create(context, { ...input, tenantId: context.tenantId });
  }

  findById(context: TenantScoped, campaignId: string): Promise<SellerAcquisitionCampaignRecord | null> {
    return this.campaigns.findById(context, campaignId);
  }

  update(context: TenantScoped, campaignId: string, input: UpdateSellerAcquisitionCampaignInput): Promise<SellerAcquisitionCampaignRecord> {
    return this.campaigns.update(context, campaignId, input);
  }

  archive(context: TenantScoped, campaignId: string): Promise<SellerAcquisitionCampaignRecord> {
    return this.campaigns.update(context, campaignId, { status: "ARCHIVED" });
  }

  addSeller(
    context: TenantScoped,
    campaignId: string,
    input: Omit<CreateSellerAcquisitionCampaignMemberInput, "tenantId" | "campaignId">,
  ): Promise<SellerAcquisitionCampaignMemberRecord> {
    return this.campaigns.addSeller(context, { ...input, tenantId: context.tenantId, campaignId });
  }

  removeSeller(context: TenantScoped, campaignId: string, memberId: string): Promise<SellerAcquisitionCampaignMemberRecord> {
    return this.campaigns.removeSeller(context, campaignId, memberId);
  }

  listMembers(context: TenantScoped, campaignId: string, page?: PageRequest) {
    return this.campaigns.listMembers(context, campaignId, page);
  }
}
