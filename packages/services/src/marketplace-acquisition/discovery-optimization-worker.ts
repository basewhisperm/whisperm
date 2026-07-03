import { z } from "zod";
import type { CampaignRuntimeExecutionRecord, SellerAcquisitionCampaignRecord } from "@whisperm/repositories";
import type { TenantScoped } from "@whisperm/types";

const metricsSchema = z.record(z.string(), z.unknown()).nullable().optional();

type Metrics = Readonly<Record<string, unknown>>;

export type DiscoveryOptimizationRecommendationType =
  | "DECREASE_EXECUTION_LIMIT"
  | "INCREASE_EXECUTION_LIMIT"
  | "NARROW_CATEGORY"
  | "BROADEN_CATEGORY"
  | "CHANGE_LOCATION"
  | "EXCLUDE_DUPLICATE_HEAVY_TERMS"
  | "PRIORITIZE_PROVIDER"
  | "FLAG_PROVIDER_UNHEALTHY"
  | "IMPROVE_CONTACTABILITY";

export type DiscoveryOptimizationSeverity = "INFO" | "WARNING" | "ACTIONABLE";
export type DiscoveryOptimizationConfidence = "LOW" | "MEDIUM" | "HIGH";

export interface DiscoveryOptimizationRecommendation {
  readonly id: string;
  readonly type: DiscoveryOptimizationRecommendationType;
  readonly reason: string;
  readonly supportingMetrics: Metrics;
  readonly severity: DiscoveryOptimizationSeverity;
  readonly confidence: DiscoveryOptimizationConfidence;
  readonly targetingCandidate?: Metrics | undefined;
  readonly createdAt: string;
  readonly campaignId: string;
  readonly executionId: string;
}

export interface DiscoveryOptimizationResult {
  readonly optimizationStatus: "COMPLETED";
  readonly lastOptimizedAt: string;
  readonly recommendations: readonly DiscoveryOptimizationRecommendation[];
}

export interface DiscoveryOptimizationWorkerInput {
  readonly context: TenantScoped;
  readonly campaign: SellerAcquisitionCampaignRecord;
  readonly execution: CampaignRuntimeExecutionRecord;
  readonly now?: Date | undefined;
}

const numberMetric = (metrics: Metrics, key: string): number => {
  const value = metrics[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

const stringMetric = (metrics: Metrics, key: string): string | undefined => {
  const value = metrics[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
};

const recordValue = (value: unknown): Metrics | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Metrics : undefined;

const targetingSnapshot = (campaign: SellerAcquisitionCampaignRecord): Metrics => {
  const metadata = recordValue(campaign.metadata) ?? {};
  return recordValue(metadata.discoveryExecution) ?? recordValue(metadata.discovery) ?? recordValue(metadata.targeting) ?? recordValue(metadata.strategy) ?? {};
};

const recommendationId = (executionId: string, type: DiscoveryOptimizationRecommendationType): string =>
  `${executionId}:${type}`;

const confidenceFromVolume = (total: number): DiscoveryOptimizationConfidence => {
  if (total >= 25) return "HIGH";
  if (total >= 8) return "MEDIUM";
  return "LOW";
};

export class DiscoveryOptimizationWorker {
  async analyze(input: DiscoveryOptimizationWorkerInput): Promise<DiscoveryOptimizationResult> {
    z.object({ tenantId: z.string().min(1) }).strict().parse(input.context);
    const metrics = metricsSchema.parse(input.execution.metrics) ?? {};
    const createdAt = (input.now ?? new Date()).toISOString();
    const campaignTargeting = targetingSnapshot(input.campaign);
    const executionId = input.execution.id;
    const campaignId = input.campaign.id;
    const discoveredCount = numberMetric(metrics, "discoveredCount");
    const capturedCount = numberMetric(metrics, "capturedCount");
    const duplicateCount = numberMetric(metrics, "skippedDuplicateCount");
    const qualifiedCount = numberMetric(metrics, "qualifiedCount");
    const disqualifiedCount = numberMetric(metrics, "disqualifiedCount");
    const needsReviewCount = numberMetric(metrics, "needsReviewCount");
    const qualificationFailedCount = numberMetric(metrics, "qualificationFailedCount");
    const requestedLimit = numberMetric(metrics, "requestedLimit");
    const failureCategory = stringMetric(metrics, "failureCategory");
    const failureCode = stringMetric(metrics, "failureCode") ?? input.execution.errorCode ?? undefined;
    const providerKey = stringMetric(metrics, "providerKey") ?? stringMetric(metrics, "marketplaceSource");
    const totalJudged = qualifiedCount + disqualifiedCount + needsReviewCount;
    const qualificationYield = totalJudged > 0 ? qualifiedCount / totalJudged : null;
    const duplicateRate = discoveredCount > 0 ? duplicateCount / discoveredCount : capturedCount + duplicateCount > 0 ? duplicateCount / (capturedCount + duplicateCount) : null;
    const recommendations: DiscoveryOptimizationRecommendation[] = [];

    const add = (type: DiscoveryOptimizationRecommendationType, reason: string, supportingMetrics: Metrics, severity: DiscoveryOptimizationSeverity, targetingCandidate?: Metrics): void => {
      recommendations.push({
        id: recommendationId(executionId, type),
        type,
        reason,
        supportingMetrics: { ...supportingMetrics, targetingSnapshot: campaignTargeting },
        severity,
        confidence: confidenceFromVolume(Math.max(discoveredCount, totalJudged, capturedCount + duplicateCount)),
        ...(targetingCandidate === undefined ? {} : { targetingCandidate }),
        createdAt,
        campaignId,
        executionId,
      });
    };

    if (qualificationYield !== null && totalJudged >= 3 && qualificationYield < 0.35) {
      add("NARROW_CATEGORY", "Qualification yield is low for the current campaign targeting snapshot.", { qualifiedCount, disqualifiedCount, needsReviewCount, qualificationYield }, "ACTIONABLE", { targeting: campaignTargeting, change: "narrow_category" });
    }

    if (duplicateRate !== null && duplicateRate >= 0.4 && duplicateCount >= 2) {
      add("EXCLUDE_DUPLICATE_HEAVY_TERMS", "Duplicate rate is high for this discovery execution.", { discoveredCount, capturedCount, skippedDuplicateCount: duplicateCount, duplicateRate }, "ACTIONABLE", { targeting: campaignTargeting, change: "exclude_duplicate_heavy_terms" });
    }

    if (failureCategory !== undefined && /RATE_LIMIT|PROVIDER|THROTT/i.test(`${failureCategory} ${failureCode ?? ""}`)) {
      add("FLAG_PROVIDER_UNHEALTHY", "Provider failure or rate-limit behavior was observed during discovery.", { providerKey: providerKey ?? "unknown", failureCategory, failureCode: failureCode ?? "UNKNOWN" }, "WARNING");
    }

    if (capturedCount > 0 && totalJudged > 0 && qualificationYield !== null && qualificationYield >= 0.7 && duplicateRate !== null && duplicateRate < 0.2 && requestedLimit > 0) {
      add("INCREASE_EXECUTION_LIMIT", "Current targeting produced a strong qualification yield with low duplication.", { requestedLimit, qualificationYield, duplicateRate, qualifiedCount }, "INFO", { targeting: campaignTargeting, limit: Math.min(requestedLimit * 2, 500) });
    }

    if (capturedCount > 0 && totalJudged === 0 && qualificationFailedCount === 0) {
      add("IMPROVE_CONTACTABILITY", "Captured sellers did not produce qualification outcomes; review contactability inputs before increasing discovery volume.", { capturedCount, totalJudged }, "WARNING");
    }

    return { optimizationStatus: "COMPLETED", lastOptimizedAt: createdAt, recommendations };
  }
}
