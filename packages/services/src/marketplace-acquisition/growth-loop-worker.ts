type Metrics = Readonly<Record<string, unknown>>;

export const growthRecommendationTypeValues = [
  "SCALE_CAMPAIGN",
  "REDUCE_CAMPAIGN_VOLUME",
  "PAUSE_LOW_ROI_SOURCE",
  "PRIORITIZE_PROVIDER",
  "EXPAND_TARGETING",
  "NARROW_TARGETING",
  "INCREASE_SCHEDULE_FREQUENCY",
  "DECREASE_SCHEDULE_FREQUENCY",
  "INVESTIGATE_CONVERSION_DROP_OFF",
  "IMPROVE_CONTACTABILITY",
  "REVIEW_CLAIM_RECOVERY",
  "MANUAL_REVIEW_REQUIRED",
] as const;
export type GrowthRecommendationType = typeof growthRecommendationTypeValues[number];

export type GrowthLoopStatus = "COMPLETED" | "INSUFFICIENT_DATA" | "FAILED" | "QUEUED";
export type GrowthLoopTrigger = "MANUAL" | "REVENUE_ATTRIBUTION_COMPLETED" | "CAMPAIGN_EXECUTION_COMPLETED" | "SCHEDULED_REVIEW";
export type GrowthRecommendationSeverity = "INFO" | "WARNING" | "ACTIONABLE";
export type GrowthRecommendationConfidence = "LOW" | "MEDIUM" | "HIGH";
export type GrowthRecommendationLifecycleStatus = "PENDING" | "APPLIED" | "DISMISSED";

export interface GrowthProviderPerformance {
  readonly key: string;
  readonly wonDealsCount: number;
  readonly attributedRevenue: number;
  readonly memberCount: number;
}

export interface GrowthScheduleSnapshot {
  readonly scheduleEnabled: boolean;
  readonly scheduleCadence: string | null;
}

export interface GrowthSignalSnapshot {
  readonly campaignId: string;
  readonly generatedAt: string;
  readonly currency: string;
  readonly attributedRevenue: number;
  readonly wonDealsCount: number;
  readonly openDealsCount: number;
  readonly totalDeals: number;
  readonly totalMembers: number;
  readonly qualifiedCount: number;
  readonly invitedCount: number;
  readonly claimedCount: number;
  readonly convertedCount: number;
  readonly conversionRate: number | null;
  readonly qualifiedToClaimRate: number | null;
  readonly claimToConversionRate: number | null;
  readonly duplicateRate: number | null;
  readonly qualificationYield: number | null;
  readonly goalRevenue: number | null;
  readonly goalSellerCount: number | null;
  readonly targetingSnapshot: Metrics;
  readonly scheduleSnapshot: GrowthScheduleSnapshot;
  readonly providerPerformance: readonly GrowthProviderPerformance[];
}

export interface GrowthRecommendation {
  readonly id: string;
  readonly type: GrowthRecommendationType;
  readonly reason: string;
  readonly severity: GrowthRecommendationSeverity;
  readonly confidence: GrowthRecommendationConfidence;
  readonly supportingMetrics: Metrics;
  readonly campaignId: string;
  readonly sourceRef?: Metrics | undefined;
  readonly targetingCandidate?: Metrics | undefined;
  readonly scheduleCandidate?: Metrics | undefined;
  readonly attributionRef?: Metrics | undefined;
  readonly createdAt: string;
  readonly status: GrowthRecommendationLifecycleStatus;
  readonly appliedAt?: string | undefined;
  readonly appliedBy?: string | undefined;
  readonly dismissedAt?: string | undefined;
  readonly dismissedBy?: string | undefined;
  readonly dismissedReason?: string | undefined;
}

export interface GrowthLoopCampaignInput {
  readonly id: string;
}

export interface GrowthLoopAnalysisInput {
  readonly campaign: GrowthLoopCampaignInput;
  readonly snapshot: GrowthSignalSnapshot;
  readonly now?: Date | undefined;
}

export interface GrowthLoopAnalysisResult {
  readonly growthLoopStatus: GrowthLoopStatus;
  readonly lastGrowthEvaluatedAt: string;
  readonly recommendations: readonly GrowthRecommendation[];
  readonly completeness: number;
}

const MIN_MEMBERS_FOR_SIGNAL = 3;
const CONFIDENCE_VOLUME_HIGH = 20;
const CONFIDENCE_VOLUME_MEDIUM = 6;
const cadenceLadder = ["WEEKLY", "DAILY", "HOURLY"] as const;

const round = (value: number, digits = 4): number => Number(value.toFixed(digits));

const confidenceFromVolume = (total: number): GrowthRecommendationConfidence => {
  if (total >= CONFIDENCE_VOLUME_HIGH) return "HIGH";
  if (total >= CONFIDENCE_VOLUME_MEDIUM) return "MEDIUM";
  return "LOW";
};

const numericMetric = (targeting: Metrics, key: string, fallback: number): number => {
  const value = targeting[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const expandLimit = (targeting: Metrics): number => Math.min(500, Math.round(numericMetric(targeting, "executionLimit", 50) * 1.5));
const narrowLimit = (targeting: Metrics): number => Math.max(1, Math.round(numericMetric(targeting, "executionLimit", 50) * 0.5));

const nextCadence = (cadence: string, direction: 1 | -1): string => {
  const index = cadenceLadder.indexOf(cadence as typeof cadenceLadder[number]);
  if (index === -1) return cadence;
  const nextIndex = Math.min(cadenceLadder.length - 1, Math.max(0, index + direction));
  return cadenceLadder[nextIndex] ?? cadence;
};

interface AddRecommendationExtra {
  readonly sourceRef?: Metrics | undefined;
  readonly targetingCandidate?: Metrics | undefined;
  readonly scheduleCandidate?: Metrics | undefined;
  readonly attributionRef?: Metrics | undefined;
  readonly confidence?: GrowthRecommendationConfidence | undefined;
}

/**
 * Deterministic, revenue-informed growth analysis. Pure function of the supplied
 * snapshot -- all data gathering (deals, members, executions) happens in the
 * runtime layer so this class stays side-effect free and easy to test.
 */
export class GrowthLoopWorker {
  analyze(input: GrowthLoopAnalysisInput): GrowthLoopAnalysisResult {
    const now = input.now ?? new Date();
    const createdAt = now.toISOString();
    const { snapshot, campaign } = input;
    const campaignId = campaign.id;
    const completeness = round(Math.min(1, snapshot.totalMembers / (MIN_MEMBERS_FOR_SIGNAL * 2)));

    if (snapshot.totalMembers < MIN_MEMBERS_FOR_SIGNAL) {
      return { growthLoopStatus: "INSUFFICIENT_DATA", lastGrowthEvaluatedAt: createdAt, recommendations: [], completeness };
    }

    const recommendations: GrowthRecommendation[] = [];
    const add = (
      type: GrowthRecommendationType,
      reason: string,
      supportingMetrics: Metrics,
      severity: GrowthRecommendationSeverity,
      extra: AddRecommendationExtra = {},
    ): void => {
      recommendations.push({
        id: `${campaignId}:${type}`,
        type,
        reason,
        severity,
        confidence: extra.confidence ?? confidenceFromVolume(snapshot.totalMembers),
        supportingMetrics: { ...supportingMetrics, targetingSnapshot: snapshot.targetingSnapshot },
        campaignId,
        createdAt,
        status: "PENDING",
        ...(extra.sourceRef === undefined ? {} : { sourceRef: extra.sourceRef }),
        ...(extra.targetingCandidate === undefined ? {} : { targetingCandidate: extra.targetingCandidate }),
        ...(extra.scheduleCandidate === undefined ? {} : { scheduleCandidate: extra.scheduleCandidate }),
        ...(extra.attributionRef === undefined ? {} : { attributionRef: extra.attributionRef }),
      });
    };

    const {
      conversionRate, qualifiedToClaimRate, claimToConversionRate, attributedRevenue, wonDealsCount,
      claimedCount, invitedCount, qualifiedCount, totalMembers, goalSellerCount, goalRevenue, scheduleSnapshot,
    } = snapshot;

    const performing = attributedRevenue > 0 && conversionRate !== null && conversionRate >= 0.25 && wonDealsCount >= 2;
    const underperforming = totalMembers >= 5 && conversionRate !== null && conversionRate < 0.05 && attributedRevenue === 0;

    if (performing) {
      add(
        "SCALE_CAMPAIGN",
        "Attributed revenue and conversion rate indicate this campaign is outperforming; scale acquisition volume.",
        { attributedRevenue, conversionRate, wonDealsCount },
        goalRevenue !== null && attributedRevenue >= goalRevenue ? "ACTIONABLE" : "INFO",
        {
          attributionRef: { wonDealsCount, attributedRevenue, currency: snapshot.currency },
          targetingCandidate: { ...snapshot.targetingSnapshot, executionLimit: expandLimit(snapshot.targetingSnapshot) },
        },
      );
      if (scheduleSnapshot.scheduleEnabled && scheduleSnapshot.scheduleCadence !== null && scheduleSnapshot.scheduleCadence !== "HOURLY") {
        add(
          "INCREASE_SCHEDULE_FREQUENCY",
          "Campaign is converting attributed revenue well; increasing run frequency can compound growth.",
          { conversionRate, attributedRevenue },
          "INFO",
          { scheduleCandidate: { scheduleCadence: nextCadence(scheduleSnapshot.scheduleCadence, 1) } },
        );
      }
    }

    if (underperforming) {
      add(
        "REDUCE_CAMPAIGN_VOLUME",
        "Campaign volume is not converting into attributed revenue; reduce acquisition spend until the root cause is addressed.",
        { totalMembers, conversionRate, attributedRevenue },
        "ACTIONABLE",
        { targetingCandidate: { ...snapshot.targetingSnapshot, executionLimit: narrowLimit(snapshot.targetingSnapshot) } },
      );
      if (scheduleSnapshot.scheduleEnabled && scheduleSnapshot.scheduleCadence !== null && scheduleSnapshot.scheduleCadence !== "WEEKLY") {
        add(
          "DECREASE_SCHEDULE_FREQUENCY",
          "Reduce campaign run frequency until conversion recovers.",
          { conversionRate, attributedRevenue },
          "WARNING",
          { scheduleCandidate: { scheduleCadence: nextCadence(scheduleSnapshot.scheduleCadence, -1) } },
        );
      }
    }

    for (const provider of snapshot.providerPerformance) {
      if (provider.memberCount >= 3 && provider.attributedRevenue === 0) {
        add(
          "PAUSE_LOW_ROI_SOURCE",
          `Source "${provider.key}" produced no attributed revenue across ${provider.memberCount} sellers.`,
          { source: provider.key, memberCount: provider.memberCount },
          "ACTIONABLE",
          { sourceRef: { key: provider.key } },
        );
      }
    }
    const topProvider = [...snapshot.providerPerformance].sort((a, b) => b.attributedRevenue - a.attributedRevenue)[0];
    if (topProvider !== undefined && topProvider.attributedRevenue > 0 && snapshot.providerPerformance.length > 1) {
      add(
        "PRIORITIZE_PROVIDER",
        `Source "${topProvider.key}" is the strongest attributed-revenue performer for this campaign.`,
        { source: topProvider.key, attributedRevenue: topProvider.attributedRevenue },
        "INFO",
        { sourceRef: { key: topProvider.key } },
      );
    }

    if (qualifiedToClaimRate !== null && qualifiedToClaimRate >= 0.6 && goalSellerCount !== null && totalMembers < goalSellerCount) {
      add(
        "EXPAND_TARGETING",
        "Qualified-to-claim rate is strong and the campaign has room remaining against its seller goal; broaden targeting.",
        { qualifiedToClaimRate, totalMembers, goalSellerCount },
        "INFO",
        { targetingCandidate: { ...snapshot.targetingSnapshot, executionLimit: expandLimit(snapshot.targetingSnapshot) } },
      );
    }
    if (conversionRate !== null && conversionRate < 0.1 && totalMembers >= 8) {
      add(
        "NARROW_TARGETING",
        "Targeting is producing seller volume without converting to attributed revenue; narrow targeting toward higher-intent sellers.",
        { conversionRate, totalMembers },
        "ACTIONABLE",
        { targetingCandidate: { ...snapshot.targetingSnapshot, executionLimit: narrowLimit(snapshot.targetingSnapshot) } },
      );
    }
    if (claimedCount >= 3 && claimToConversionRate !== null && claimToConversionRate < 0.2) {
      add(
        "INVESTIGATE_CONVERSION_DROP_OFF",
        "Sellers are claiming but not converting into CRM revenue; investigate the claim-to-conversion handoff.",
        { claimedCount, claimToConversionRate },
        "WARNING",
      );
    }
    if (qualifiedCount > 0 && invitedCount === 0) {
      add(
        "IMPROVE_CONTACTABILITY",
        "Qualified sellers exist but none have been invited; review contactability inputs before scaling discovery.",
        { qualifiedCount, invitedCount },
        "WARNING",
      );
    }
    if (invitedCount >= 5 && qualifiedToClaimRate !== null && qualifiedToClaimRate < 0.15) {
      add(
        "REVIEW_CLAIM_RECOVERY",
        "Invited sellers are not converting into claims; review claim recovery outcomes for this campaign.",
        { invitedCount, qualifiedToClaimRate },
        "ACTIONABLE",
      );
    }

    if (recommendations.length === 0) {
      add(
        "MANUAL_REVIEW_REQUIRED",
        "Growth signals are mixed and do not deterministically indicate a scale, reduce, or targeting action; manual review recommended.",
        { conversionRate, attributedRevenue, totalMembers },
        "INFO",
      );
    }

    return { growthLoopStatus: "COMPLETED", lastGrowthEvaluatedAt: createdAt, recommendations, completeness };
  }
}
