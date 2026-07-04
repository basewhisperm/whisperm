import { createPrismaRepositories, PrismaAcquisitionUsageEventRepository, type PrismaPersistenceClient } from "@whisperm/repositories";
import { AcquisitionUsageMeteringService, CrmConversionRuntimeService, RevenueAttributionRuntimeService } from "@whisperm/services";

// ST-003: claim acceptance must not silently depend on an undeployed worker to convert a
// claimed seller into a CRM contact/deal. Both services below have no `scheduler` wired,
// so `executeConversion`/`evaluateForDeal` run synchronously in the same request instead of
// only enqueueing a job that nothing in production ever consumes.
export const createCrmConversionRuntime = (prisma: PrismaPersistenceClient): CrmConversionRuntimeService => {
  const repositories = createPrismaRepositories(prisma);
  const usageMetering = new AcquisitionUsageMeteringService({ usageEvents: new PrismaAcquisitionUsageEventRepository(prisma) });

  const revenueAttribution = new RevenueAttributionRuntimeService({
    deals: repositories.deals,
    businessGrowthOpportunities: repositories.businessGrowthOpportunities,
    marketplaceCaptures: repositories.marketplaceCaptures,
    sellerInvitations: repositories.sellerInvitations,
    claimTokens: repositories.marketplaceClaimTokens,
    usageMetering,
  });

  return new CrmConversionRuntimeService({
    marketplaceCaptures: repositories.marketplaceCaptures,
    draftInventories: repositories.draftInventories,
    claimTokens: repositories.marketplaceClaimTokens,
    contacts: repositories.contacts,
    pipelines: repositories.pipelines,
    deals: repositories.deals,
    businessGrowthOpportunities: repositories.businessGrowthOpportunities,
    auditLogs: repositories.auditLogs,
    activities: repositories.activities,
    revenueAttribution,
    usageMetering,
  });
};

// Adapter matching SellerClaimPortalService's `crmConversionRuntime` seam: it calls this
// right after claim acceptance expecting an enqueue, so this executes the conversion (and,
// transitively, revenue attribution) inline and returns the real, completed outcome.
export const createInlineCrmConversionForClaimPortal = (prisma: PrismaPersistenceClient) => {
  const service = createCrmConversionRuntime(prisma);
  return {
    async enqueueForCompletedClaim(context: Parameters<CrmConversionRuntimeService["executeConversion"]>[0], input: Parameters<CrmConversionRuntimeService["executeConversion"]>[1]) {
      return service.executeConversion(context, input);
    },
  };
};
