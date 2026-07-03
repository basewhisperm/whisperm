import { z } from "zod";

import type {
  BusinessGrowthOpportunityRecord,
  BusinessGrowthOpportunityRepository,
} from "@whisperm/repositories";
import type {
  CampaignRuntimeExecutionRecord,
  CampaignRuntimeExecutionRepository,
  DealRecord,
  DealsRepository,
  MarketplaceClaimTokenRepository,
  SellerAcquisitionCampaignMemberRecord,
  SellerAcquisitionCampaignRecord,
  SellerAcquisitionCampaignRepository,
} from "@whisperm/repositories";
import { PersistenceError } from "@whisperm/repositories";
import type { TenantScoped } from "@whisperm/types";

import type { GrowthRecommendation } from "./marketplace-acquisition/growth-loop-worker.js";

const MAX_MEMBERS = 1000;
const MAX_OPPORTUNITIES = 500;
const STALE_GROWTH_LOOP_MS = 7 * 24 * 60 * 60 * 1000;

const contextSchema = z.object({ tenantId: z.string().trim().min(1) }).strict();
const inputSchema = z.object({ campaignId: z.string().trim().min(1).optional() }).strict();

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const numeric = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};
const numberMetric = (metrics: unknown, key: string): number => {
  const value = isRecord(metrics) ? metrics[key] : undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};
const round2 = (value: number): number => Number(value.toFixed(2));
const round4 = (value: number): number => Number(value.toFixed(4));

const asGrowthRecommendations = (metadata: unknown): readonly GrowthRecommendation[] => {
  const value = isRecord(metadata) ? metadata.growthRecommendations : undefined;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.type !== "string" || typeof item.status !== "string") return [];
    return [item as unknown as GrowthRecommendation];
  });
};

export type AcquisitionActionType =
  | "APPLY_GROWTH_RECOMMENDATION"
  | "PAUSE_POOR_SOURCE"
  | "RETRY_FAILED_INVITATION"
  | "REVIEW_UNCLAIMED_SELLER"
  | "CONVERT_CLAIMED_SELLER";

export type AcquisitionActionSeverity = "INFO" | "WARNING" | "ACTIONABLE";

export interface AcquisitionCommandCenterAction {
  readonly id: string;
  readonly type: AcquisitionActionType;
  readonly label: string;
  readonly description: string;
  readonly severity: AcquisitionActionSeverity;
  readonly count?: number | undefined;
  readonly workbenchHref: string;
}

export type AcquisitionReadinessWarningCode =
  | "NO_ACTIVE_CAMPAIGN"
  | "MISSING_WHATSAPP_PROVIDER"
  | "NO_CLAIM_URL_CONFIGURED"
  | "NO_REVENUE_ATTRIBUTION_SIGNAL"
  | "FAILED_WORKER_JOBS"
  | "STALE_GROWTH_LOOP";

export interface AcquisitionReadinessWarning {
  readonly code: AcquisitionReadinessWarningCode;
  readonly severity: "INFO" | "WARNING" | "CRITICAL";
  readonly message: string;
}

export interface AcquisitionSourcePerformance {
  readonly key: string;
  readonly attributedRevenue: number;
  readonly wonDealsCount: number;
}

export interface AcquisitionCommandCenterSnapshot {
  readonly campaignId: string;
  readonly campaignName: string;
  readonly status: string;
  readonly funnel: {
    readonly discovered: number;
    readonly qualified: number;
    readonly invited: number;
    readonly claimed: number;
    readonly crmConverted: number;
    readonly dealsCreated: number;
    readonly revenueAttributed: number;
  };
  readonly revenue: {
    readonly pipelineValue: number;
    readonly attributedRevenue: number;
    readonly currency: string;
  };
  readonly rates: {
    readonly qualificationRate: number;
    readonly inviteRate: number;
    readonly claimRate: number;
    readonly crmConversionRate: number;
    readonly revenueConversionRate: number;
  };
  readonly bestSource: AcquisitionSourcePerformance | null;
  readonly worstSource: AcquisitionSourcePerformance | null;
  readonly topActions: readonly AcquisitionCommandCenterAction[];
  readonly readinessWarnings: readonly AcquisitionReadinessWarning[];
  readonly growthRecommendations: readonly unknown[];
  readonly generatedAt: string;
}

export interface AcquisitionCommandCenterDependencies {
  readonly campaigns: Pick<SellerAcquisitionCampaignRepository, "list" | "findById" | "listMembers">;
  readonly executions: Pick<CampaignRuntimeExecutionRepository, "listByCampaignId">;
  readonly deals: Pick<DealsRepository, "findById">;
  readonly claimTokens: Pick<MarketplaceClaimTokenRepository, "listClaimTokensByMarketplaceCaptureId">;
  readonly opportunities?: Pick<BusinessGrowthOpportunityRepository, "findByCampaignId"> | undefined;
  readonly clock?: (() => Date) | undefined;
}

export interface GetCommandCenterSnapshotInput {
  readonly campaignId?: string | undefined;
}

const qualifiedStatuses = new Set(["QUALIFIED", "INVITED", "CLAIMED", "CONVERTED", "COMPLETED"]);
const invitedStatuses = new Set(["INVITED", "CLAIMED", "CONVERTED", "COMPLETED"]);
const claimedStatuses = new Set(["CLAIMED", "CONVERTED", "COMPLETED"]);
const convertedStatuses = new Set(["CONVERTED", "COMPLETED"]);

const severityRank: Readonly<Record<AcquisitionActionSeverity, number>> = { ACTIONABLE: 0, WARNING: 1, INFO: 2 };

/**
 * Production-facing read model over the existing acquisition chain (CS-020).
 * Aggregates canonical CampaignRuntimeService/repository data into a single
 * executive snapshot -- it never mutates campaign, member, or deal state.
 */
export class AcquisitionCommandCenterService {
  constructor(private readonly deps: AcquisitionCommandCenterDependencies) {}

  async getSnapshot(contextInput: TenantScoped, input: GetCommandCenterSnapshotInput = {}): Promise<AcquisitionCommandCenterSnapshot> {
    const context = contextSchema.parse(contextInput) as TenantScoped;
    const parsed = inputSchema.parse(input);
    const now = this.deps.clock?.() ?? new Date();

    const campaign = await this.resolveCampaign(context, parsed.campaignId);
    if (campaign === null) return this.emptySnapshot(now);

    const [members, executions] = await Promise.all([
      this.listAllMembers(context, campaign.id),
      this.deps.executions.listByCampaignId(context, campaign.id, { limit: 20 }).then((page) => page.items),
    ]);

    const active = members.filter((member) => member.status !== "REMOVED");
    const dealIds = [...new Set(active.map((member) => member.dealId).filter((id): id is string => typeof id === "string"))];
    const deals = (await Promise.all(dealIds.map((id) => this.deps.deals.findById(context.tenantId, id)))).filter((deal): deal is DealRecord => deal !== null);
    const dealById = new Map(deals.map((deal) => [deal.id, deal] as const));

    const executionDiscovered = executions.reduce((sum, execution) => sum + numberMetric(execution.metrics, "discoveredCount"), 0);
    const discovered = executionDiscovered > 0 ? executionDiscovered : active.length;
    const qualified = active.filter((member) => qualifiedStatuses.has(member.status)).length;
    const invited = active.filter((member) => invitedStatuses.has(member.status)).length;
    const claimed = active.filter((member) => claimedStatuses.has(member.status)).length;
    const crmConverted = active.filter((member) => convertedStatuses.has(member.status)).length;
    const dealsCreated = dealById.size;

    const wonDeals = deals.filter((deal) => deal.closedAt != null);
    const openDeals = deals.filter((deal) => deal.closedAt == null);
    const revenueAttributedCount = wonDeals.length;
    const attributedRevenue = round2(wonDeals.reduce((sum, deal) => sum + numeric(deal.value), 0));
    const pipelineValue = round2(openDeals.reduce((sum, deal) => sum + numeric(deal.value), 0));
    const currency = campaign.currency ?? deals[0]?.currency ?? "USD";

    const rates = {
      qualificationRate: discovered > 0 ? round4(qualified / discovered) : 0,
      inviteRate: qualified > 0 ? round4(invited / qualified) : 0,
      claimRate: invited > 0 ? round4(claimed / invited) : 0,
      crmConversionRate: claimed > 0 ? round4(crmConverted / claimed) : 0,
      revenueConversionRate: dealsCreated > 0 ? round4(revenueAttributedCount / dealsCreated) : 0,
    };

    const { bestSource, worstSource } = await this.resolveSourcePerformance(context, campaign.id, dealById);

    const claimTokenCount = await this.countClaimTokens(context, active);
    const growthRecommendations = asGrowthRecommendations(campaign.metadata);
    const readinessWarnings = this.buildReadinessWarnings(campaign, {
      invited,
      claimed,
      crmConverted,
      attributedRevenue,
      claimTokenCount,
      executions,
      now,
    });
    const topActions = this.buildTopActions(campaign, {
      invited,
      claimed,
      crmConverted,
      executions,
      growthRecommendations,
    });

    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      status: campaign.status,
      funnel: { discovered, qualified, invited, claimed, crmConverted, dealsCreated, revenueAttributed: revenueAttributedCount },
      revenue: { pipelineValue, attributedRevenue, currency },
      rates,
      bestSource,
      worstSource,
      topActions,
      readinessWarnings,
      growthRecommendations,
      generatedAt: now.toISOString(),
    };
  }

  private async resolveCampaign(context: TenantScoped, campaignId: string | undefined): Promise<SellerAcquisitionCampaignRecord | null> {
    if (campaignId !== undefined) {
      const campaign = await this.deps.campaigns.findById(context, campaignId);
      if (campaign === null) throw new PersistenceError({ code: "PERSISTENCE_NOT_FOUND", message: "Seller acquisition campaign not found", status: 404 });
      return campaign;
    }

    const page = await this.deps.campaigns.list(context, { limit: 100 });
    if (page.items.length === 0) return null;

    const byRecency = [...page.items].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    return byRecency.find((campaign) => campaign.status === "ACTIVE") ?? byRecency[0] ?? null;
  }

  private async listAllMembers(context: TenantScoped, campaignId: string): Promise<readonly SellerAcquisitionCampaignMemberRecord[]> {
    const members: SellerAcquisitionCampaignMemberRecord[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.deps.campaigns.listMembers(context, campaignId, { limit: 100, ...(cursor === undefined ? {} : { cursor }) });
      members.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== undefined && members.length < MAX_MEMBERS);
    return members;
  }

  private async resolveSourcePerformance(
    context: TenantScoped,
    campaignId: string,
    dealById: ReadonlyMap<string, DealRecord>,
  ): Promise<{ readonly bestSource: AcquisitionSourcePerformance | null; readonly worstSource: AcquisitionSourcePerformance | null }> {
    if (this.deps.opportunities === undefined) return { bestSource: null, worstSource: null };

    const opportunities: BusinessGrowthOpportunityRecord[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.deps.opportunities.findByCampaignId(context, campaignId, { limit: 100, ...(cursor === undefined ? {} : { cursor }) });
      opportunities.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== undefined && opportunities.length < MAX_OPPORTUNITIES);

    const groups = new Map<string, { attributedRevenue: number; wonDealsCount: number }>();
    for (const opportunity of opportunities) {
      const key = opportunity.sourceKey ?? opportunity.sourceType ?? "UNKNOWN";
      const current = groups.get(key) ?? { attributedRevenue: 0, wonDealsCount: 0 };
      const deal = opportunity.dealId == null ? undefined : dealById.get(opportunity.dealId);
      if (deal !== undefined && deal.closedAt != null) {
        current.wonDealsCount += 1;
        current.attributedRevenue += numeric(deal.value);
      }
      groups.set(key, current);
    }

    const sources = [...groups.entries()].map(([key, value]) => ({ key, attributedRevenue: round2(value.attributedRevenue), wonDealsCount: value.wonDealsCount }));
    if (sources.length === 0) return { bestSource: null, worstSource: null };

    const ranked = [...sources].sort((a, b) => b.attributedRevenue - a.attributedRevenue || b.wonDealsCount - a.wonDealsCount);
    const bestSource = ranked[0] ?? null;
    const worstSource = ranked.length > 1 ? ranked[ranked.length - 1] ?? null : null;
    return { bestSource, worstSource };
  }

  private async countClaimTokens(context: TenantScoped, members: readonly SellerAcquisitionCampaignMemberRecord[]): Promise<number> {
    const invitedMembers = members.filter((member) => invitedStatuses.has(member.status));
    if (invitedMembers.length === 0) return 0;
    const captureIds = [...new Set(invitedMembers.map((member) => member.marketplaceCaptureId))];
    const tokenLists = await Promise.all(captureIds.map((id) => this.deps.claimTokens.listClaimTokensByMarketplaceCaptureId(context, id)));
    return tokenLists.reduce((sum, list) => sum + list.length, 0);
  }

  private buildReadinessWarnings(
    campaign: SellerAcquisitionCampaignRecord,
    signal: {
      readonly invited: number;
      readonly claimed: number;
      readonly crmConverted: number;
      readonly attributedRevenue: number;
      readonly claimTokenCount: number;
      readonly executions: readonly CampaignRuntimeExecutionRecord[];
      readonly now: Date;
    },
  ): readonly AcquisitionReadinessWarning[] {
    const warnings: AcquisitionReadinessWarning[] = [];
    const metadata = isRecord(campaign.metadata) ? campaign.metadata : {};

    if (campaign.status !== "ACTIVE") {
      warnings.push({ code: "NO_ACTIVE_CAMPAIGN", severity: "CRITICAL", message: `Campaign status is ${campaign.status}; no acquisition activity will run until it is ACTIVE.` });
    }

    const invitationProviders = isRecord(metadata.invitationProviders) ? metadata.invitationProviders : {};
    const providerHealth = isRecord(metadata.providerHealth) ? metadata.providerHealth : {};
    const whatsappConfigured = typeof invitationProviders.WHATSAPP === "string" && invitationProviders.WHATSAPP.trim().length > 0;
    const whatsappHealth = typeof providerHealth.WHATSAPP === "string" ? providerHealth.WHATSAPP.toUpperCase() : undefined;
    if (!whatsappConfigured || whatsappHealth === "DOWN" || whatsappHealth === "UNHEALTHY") {
      warnings.push({ code: "MISSING_WHATSAPP_PROVIDER", severity: "WARNING", message: "No healthy WhatsApp provider is configured; invitations will fall back to SMS or email." });
    }

    if (signal.invited > 0 && signal.claimTokenCount === 0) {
      warnings.push({ code: "NO_CLAIM_URL_CONFIGURED", severity: "WARNING", message: "Sellers have been invited but no claim tokens exist yet; claim links may not be reaching sellers." });
    }

    if (signal.crmConverted > 0 && signal.attributedRevenue === 0) {
      warnings.push({ code: "NO_REVENUE_ATTRIBUTION_SIGNAL", severity: "INFO", message: "Sellers have converted to CRM but no revenue has been attributed yet." });
    }

    const failedExecutions = signal.executions.filter((execution) => execution.status === "FAILED").length;
    if (failedExecutions > 0) {
      warnings.push({ code: "FAILED_WORKER_JOBS", severity: "WARNING", message: `${failedExecutions} recent runtime execution${failedExecutions === 1 ? "" : "s"} failed and may need retry.` });
    }

    const growthLoopStatus = typeof metadata.growthLoopStatus === "string" ? metadata.growthLoopStatus : undefined;
    const lastGrowthEvaluatedAt = typeof metadata.lastGrowthEvaluatedAt === "string" ? metadata.lastGrowthEvaluatedAt : undefined;
    const staleByAge = lastGrowthEvaluatedAt !== undefined && signal.now.getTime() - Date.parse(lastGrowthEvaluatedAt) > STALE_GROWTH_LOOP_MS;
    if (growthLoopStatus === "FAILED" || staleByAge) {
      warnings.push({ code: "STALE_GROWTH_LOOP", severity: "WARNING", message: growthLoopStatus === "FAILED" ? "Growth loop evaluation last failed and has not recovered." : "Growth loop has not been evaluated in over 7 days." });
    }

    return warnings;
  }

  private buildTopActions(
    campaign: SellerAcquisitionCampaignRecord,
    signal: {
      readonly invited: number;
      readonly claimed: number;
      readonly crmConverted: number;
      readonly executions: readonly CampaignRuntimeExecutionRecord[];
      readonly growthRecommendations: readonly GrowthRecommendation[];
    },
  ): readonly AcquisitionCommandCenterAction[] {
    const workbenchHref = `/marketplace-acquisition/campaigns/${encodeURIComponent(campaign.id)}/workbench`;
    const actions: AcquisitionCommandCenterAction[] = [];

    for (const recommendation of signal.growthRecommendations) {
      if (recommendation.status !== "PENDING") continue;
      const type: AcquisitionActionType = recommendation.type === "PAUSE_LOW_ROI_SOURCE" ? "PAUSE_POOR_SOURCE" : "APPLY_GROWTH_RECOMMENDATION";
      actions.push({
        id: `${type}:${recommendation.id}`,
        type,
        label: recommendation.type.replaceAll("_", " "),
        description: recommendation.reason,
        severity: recommendation.severity,
        workbenchHref,
      });
    }

    const failedInvitations = signal.executions.filter((execution) => {
      const state = typeof execution.metrics?.invitationExecutionState === "string" ? execution.metrics.invitationExecutionState : undefined;
      return state === "DEAD_LETTERED" || (execution.status === "FAILED" && state !== undefined);
    }).length;
    if (failedInvitations > 0) {
      actions.push({
        id: `RETRY_FAILED_INVITATION:${campaign.id}`,
        type: "RETRY_FAILED_INVITATION",
        label: "Retry failed invitations",
        description: `${failedInvitations} invitation${failedInvitations === 1 ? "" : "s"} failed to deliver and can be retried from the workbench.`,
        severity: "WARNING",
        count: failedInvitations,
        workbenchHref,
      });
    }

    const unclaimed = Math.max(0, signal.invited - signal.claimed);
    if (unclaimed > 0) {
      actions.push({
        id: `REVIEW_UNCLAIMED_SELLER:${campaign.id}`,
        type: "REVIEW_UNCLAIMED_SELLER",
        label: "Review unclaimed sellers",
        description: `${unclaimed} invited seller${unclaimed === 1 ? "" : "s"} have not yet claimed their listing.`,
        severity: "INFO",
        count: unclaimed,
        workbenchHref,
      });
    }

    const unconverted = Math.max(0, signal.claimed - signal.crmConverted);
    if (unconverted > 0) {
      actions.push({
        id: `CONVERT_CLAIMED_SELLER:${campaign.id}`,
        type: "CONVERT_CLAIMED_SELLER",
        label: "Convert claimed sellers",
        description: `${unconverted} claimed seller${unconverted === 1 ? "" : "s"} are ready for CRM conversion.`,
        severity: "ACTIONABLE",
        count: unconverted,
        workbenchHref,
      });
    }

    return actions.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]).slice(0, 5);
  }

  private emptySnapshot(now: Date): AcquisitionCommandCenterSnapshot {
    return {
      campaignId: "",
      campaignName: "",
      status: "NO_CAMPAIGN",
      funnel: { discovered: 0, qualified: 0, invited: 0, claimed: 0, crmConverted: 0, dealsCreated: 0, revenueAttributed: 0 },
      revenue: { pipelineValue: 0, attributedRevenue: 0, currency: "USD" },
      rates: { qualificationRate: 0, inviteRate: 0, claimRate: 0, crmConversionRate: 0, revenueConversionRate: 0 },
      bestSource: null,
      worstSource: null,
      topActions: [],
      readinessWarnings: [{ code: "NO_ACTIVE_CAMPAIGN", severity: "CRITICAL", message: "No seller acquisition campaign exists yet. Create a campaign to start acquiring sellers." }],
      growthRecommendations: [],
      generatedAt: now.toISOString(),
    };
  }
}
