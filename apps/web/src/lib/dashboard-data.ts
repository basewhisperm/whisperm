import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { resolveTenantForCurrentUser } from "@/lib/get-tenant";
import { getTenantFeatureState } from "@/lib/tenant-features";
import { SELLER_ACQUISITION_FEATURE } from "@/lib/tenant-feature-keys";
import {
  createPrismaRepositories,
  PersistenceError,
  PrismaDashboardRepository,
  type DashboardActivityRecord,
  type DashboardContactRecord,
  type PrismaPersistenceClient,
  type SellerAcquisitionCampaignRecord,
} from "@whisperm/repositories";
import { AcquisitionMetricsService, createWhispeRMServices, SellerAcquisitionCampaignService } from "@whisperm/services";
import type { AcquisitionMetrics } from "@whisperm/services/acquisition-metrics";
import type { SellerAcquisitionRecord } from "@whisperm/services";

// ST1-013H: the single place that assembles /dashboard's data, for both the
// server component (dashboard/page.tsx) and the API route
// (api/dashboard/route.ts). Neither surface may query Prisma or the
// acquisition services directly -- both call this helper so they can never
// disagree, and neither can fall back to fake zeros on failure.

export interface DashboardCampaign {
  readonly id: string;
  readonly name: string;
  readonly status: SellerAcquisitionCampaignRecord["status"];
  readonly goalSellerCount: number | null;
  readonly memberCount: number;
}

export interface DashboardData {
  readonly activeContacts: number;
  readonly pipelineValue: number;
  readonly activities: readonly DashboardActivityRecord[];
  readonly healthContacts: readonly DashboardContactRecord[];
  readonly followUpAlerts: readonly DashboardContactRecord[];
  readonly acquisitionMetrics: AcquisitionMetrics;
  readonly acquisitionRecords: readonly SellerAcquisitionRecord[];
  readonly campaigns: readonly DashboardCampaign[];
}

export type DashboardLoadErrorCode =
  | "AUTH_REQUIRED"
  | "TENANT_REQUIRED"
  | "FEATURE_DISABLED"
  | "CONFIGURATION_ERROR"
  | "UPSTREAM_ERROR"
  | "UNKNOWN_ERROR";

export interface DashboardLoadError {
  readonly code: DashboardLoadErrorCode;
  readonly message: string;
  readonly detail?: string;
}

export type DashboardLoadResult =
  | { readonly ok: true; readonly data: DashboardData }
  | { readonly ok: false; readonly error: DashboardLoadError };

const GENERIC_LOAD_FAILURE_MESSAGE = "Dashboard data could not be loaded.";

const CONFIGURATION_PRISMA_ERROR_CODES: ReadonlySet<string> = new Set([
  "P1001", // can't reach database server
  "P1002", // database server timed out
  "P1003", // database does not exist
  "P1008", // operation timed out
  "P1009", // database already exists
  "P1010", // access denied
  "P1017", // server closed the connection
]);

const isConfigurationError = (error: unknown): boolean => {
  if (error instanceof PersistenceError) return error.code === "PERSISTENCE_TRANSIENT";
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  if (error instanceof Prisma.PrismaClientKnownRequestError) return CONFIGURATION_PRISMA_ERROR_CODES.has(error.code);
  return false;
};

/**
 * Turns any thrown error into a safe, typed `DashboardLoadError`. Only ever
 * surfaces the error's *class/code* (a stable, non-secret symbol) as
 * `detail` -- never `error.message`, which for Prisma init failures can
 * contain connection strings.
 */
const classifyThrown = (error: unknown): DashboardLoadError => {
  if (isConfigurationError(error)) {
    return {
      code: "CONFIGURATION_ERROR",
      message: GENERIC_LOAD_FAILURE_MESSAGE,
      ...(error instanceof Error ? { detail: error.name } : {}),
    };
  }
  if (error instanceof PersistenceError) {
    return { code: "UPSTREAM_ERROR", message: GENERIC_LOAD_FAILURE_MESSAGE, detail: error.code };
  }
  if (error instanceof Error) {
    return { code: "UPSTREAM_ERROR", message: GENERIC_LOAD_FAILURE_MESSAGE, detail: error.name };
  }
  return { code: "UNKNOWN_ERROR", message: GENERIC_LOAD_FAILURE_MESSAGE };
};

const RECORDS_PAGE_LIMIT = 100;

const buildServices = () => {
  const repositories = createPrismaRepositories(prisma as unknown as PrismaPersistenceClient);
  const services = createWhispeRMServices(repositories);
  const campaigns = new SellerAcquisitionCampaignService(repositories.sellerAcquisitionCampaigns);
  return {
    dashboardRepo: new PrismaDashboardRepository(prisma as unknown as PrismaPersistenceClient),
    records: services.sellerAcquisitionRecords,
    campaigns,
    metrics: new AcquisitionMetricsService({ sellerAcquisitionRecords: services.sellerAcquisitionRecords, sellerAcquisitionCampaigns: campaigns }),
  };
};

/**
 * The only place that assembles WhispeRM's /dashboard data. Never returns
 * fake zero metrics or empty arrays to mask a failure -- a broken data path
 * always comes back as `ok: false` with a typed, diagnosable error instead.
 */
export async function getDashboardDataForCurrentTenant(): Promise<DashboardLoadResult> {
  let resolution;
  try {
    resolution = await resolveTenantForCurrentUser();
  } catch (error) {
    return { ok: false, error: classifyThrown(error) };
  }

  if (!resolution.ok) {
    return {
      ok: false,
      error: resolution.code === "AUTH_REQUIRED"
        ? { code: "AUTH_REQUIRED", message: "Sign in to view this workspace's dashboard." }
        : { code: "TENANT_REQUIRED", message: "This account is not linked to a workspace yet." },
    };
  }

  const context = { tenantId: resolution.tenant.id };

  let featureState;
  try {
    featureState = await getTenantFeatureState(resolution.tenant.id, SELLER_ACQUISITION_FEATURE);
  } catch (error) {
    return { ok: false, error: classifyThrown(error) };
  }

  if (!featureState.ok) {
    return { ok: false, error: classifyThrown(new Error(featureState.code)) };
  }

  if (!featureState.enabled) {
    return {
      ok: false,
      error: {
        code: "FEATURE_DISABLED",
        message: "Marketplace acquisition is disabled for this workspace.",
        detail: "Ask a workspace admin to enable the Seller Acquisition add-on.",
      },
    };
  }

  try {
    const { dashboardRepo, records, campaigns, metrics } = buildServices();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);

    const [activeContacts, pipelineValue, healthContacts, followUpAlerts, activities, acquisitionMetrics, recordsPage, campaignsPage] = await Promise.all([
      dashboardRepo.countActiveContacts(context),
      dashboardRepo.sumOpenPipelineValue(context),
      dashboardRepo.listContactsForHealth(context),
      dashboardRepo.listContactsForFollowUpAlerts(context, cutoff),
      dashboardRepo.listLatestActivities(context, 5),
      metrics.getGlobalMetrics(context),
      records.list(context, { limit: RECORDS_PAGE_LIMIT }),
      campaigns.list(context),
    ]);

    const campaignsWithMembers = await Promise.all(
      campaignsPage.items.map(async (campaign) => ({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        goalSellerCount: campaign.goalSellerCount ?? null,
        memberCount: await campaigns.countMembers(context, campaign.id),
      })),
    );

    return {
      ok: true,
      data: {
        activeContacts,
        pipelineValue,
        healthContacts,
        followUpAlerts,
        activities,
        acquisitionMetrics,
        acquisitionRecords: recordsPage.records,
        campaigns: campaignsWithMembers,
      },
    };
  } catch (error) {
    return { ok: false, error: classifyThrown(error) };
  }
}
