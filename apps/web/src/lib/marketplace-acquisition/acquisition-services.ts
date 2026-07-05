import { prisma } from "@/lib/prisma";
import {
  createPrismaRepositories,
  type PrismaPersistenceClient,
  type PrismaRepositories,
} from "@whisperm/repositories";
import { AcquisitionUsageMeteringService, createWhispeRMServices, type WhispeRMServices } from "@whisperm/services";

const persistenceClient = (): PrismaPersistenceClient => prisma as unknown as PrismaPersistenceClient;

/**
 * ST1-009: single construction point for the acquisition usage-metering ledger. Every
 * production route/service that can emit a canonical billable event (SELLER_DISCOVERED,
 * SELLER_QUALIFIED, INVITATION_SENT, SELLER_CLAIMED, CRM_CONVERSION_CREATED,
 * REVENUE_ATTRIBUTED, GROWTH_LOOP_EVALUATED, GROWTH_RECOMMENDATION_APPLIED) must construct
 * it through here (or createAcquisitionServiceBundle) instead of forgetting usageMetering
 * ad hoc when wiring up a service.
 */
export const createAcquisitionUsageMetering = (repositories: Pick<PrismaRepositories, "acquisitionUsageEvents">): AcquisitionUsageMeteringService =>
  new AcquisitionUsageMeteringService({ usageEvents: repositories.acquisitionUsageEvents });

export interface AcquisitionServiceBundle {
  readonly repositories: PrismaRepositories;
  readonly usageMetering: AcquisitionUsageMeteringService;
  readonly services: WhispeRMServices;
}

/** Repositories + usage metering + the full WhispeRMServices set, all wired together. */
export const createAcquisitionServiceBundle = (): AcquisitionServiceBundle => {
  const repositories = createPrismaRepositories(persistenceClient());
  const usageMetering = createAcquisitionUsageMetering(repositories);
  const services = createWhispeRMServices({ ...repositories, usageMetering });
  return { repositories, usageMetering, services };
};
