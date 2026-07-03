import { z } from "zod";

import type {
  CampaignRuntimeExecutionRecord,
  CampaignRuntimeExecutionRepository,
  DealRecord,
  DealsRepository,
  MarketplaceCaptureRecord,
  MarketplaceCaptureRepository,
  MarketplaceClaimTokenRecord,
  MarketplaceClaimTokenRepository,
  SellerAcquisitionCampaignMemberRecord,
  SellerAcquisitionCampaignRecord,
  SellerAcquisitionCampaignRepository,
} from "@whisperm/repositories";
import type { TenantScoped } from "@whisperm/types";

const MAX_CAMPAIGNS_SCANNED = 20;
const MAX_EXECUTIONS_PER_CAMPAIGN = 20;
const MAX_MEMBERS_PER_CAMPAIGN = 100;
const MAX_LOOKUP_IDS = 300;
const STALE_RUN_MS = 24 * 60 * 60 * 1000;
const STALE_GROWTH_LOOP_MS = 7 * 24 * 60 * 60 * 1000;

const contextSchema = z.object({ tenantId: z.string().trim().min(1) }).strict();

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
const invitedStatuses = new Set(["INVITED", "CLAIMED", "CONVERTED", "COMPLETED"]);

export type RuntimeHealthStatus = "HEALTHY" | "DEGRADED" | "ACTION_REQUIRED" | "UNKNOWN";

export type RuntimeUnit =
  | "DISCOVERY"
  | "QUALIFICATION"
  | "INVITATION"
  | "CLAIM"
  | "CRM_CONVERSION"
  | "REVENUE_ATTRIBUTION"
  | "GROWTH_LOOP";

export interface RuntimeUnitHealth {
  readonly unit: RuntimeUnit;
  readonly status: RuntimeHealthStatus;
  readonly lastSuccessfulRunAt: string | null;
  readonly lastFailedRunAt: string | null;
  readonly failureCount: number;
  readonly retryBacklog: number;
  readonly deadLetterCount: number;
  readonly message: string | null;
}

export type RuntimeProvider = "WHATSAPP" | "EMAIL" | "DISCOVERY";

export interface ProviderHealth {
  readonly provider: RuntimeProvider;
  readonly status: RuntimeHealthStatus;
  readonly configured: boolean;
  readonly lastSuccessfulUseAt: string | null;
  readonly lastFailedUseAt: string | null;
  readonly message: string | null;
}

export type RuntimeFailureSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface RuntimeFailure {
  readonly id: string;
  readonly unit: RuntimeUnit;
  readonly severity: RuntimeFailureSeverity;
  readonly message: string;
  readonly occurredAt: string;
  readonly retryable: boolean;
  readonly recommendedAction: string;
}

export type OperationsActionType =
  | "CONFIGURE_PROVIDER"
  | "RETRY_FAILED_JOBS"
  | "REVIEW_DEAD_LETTER"
  | "CHECK_RUNTIME"
  | "REVIEW_CAMPAIGN"
  | "NO_ACTION";

export interface OperationsAction {
  readonly id: string;
  readonly priority: RuntimeFailureSeverity;
  readonly title: string;
  readonly description: string;
  readonly actionType: OperationsActionType;
}

export interface AcquisitionRuntimeHealthSnapshot {
  readonly overallStatus: RuntimeHealthStatus;
  readonly generatedAt: string;
  readonly units: readonly RuntimeUnitHealth[];
  readonly providers: readonly ProviderHealth[];
  readonly failures: readonly RuntimeFailure[];
  readonly retryBacklog: number;
  readonly deadLetterCount: number;
  readonly lastSuccessfulRunAt: string | null;
  readonly recommendedOperationsActions: readonly OperationsAction[];
}

export interface AcquisitionRuntimeHealthDependencies {
  readonly campaigns: Pick<SellerAcquisitionCampaignRepository, "list" | "listMembers">;
  readonly executions: Pick<CampaignRuntimeExecutionRepository, "listByCampaignId">;
  readonly deals?: Pick<DealsRepository, "findById"> | undefined;
  readonly claimTokens?: Pick<MarketplaceClaimTokenRepository, "listClaimTokensByMarketplaceCaptureIds"> | undefined;
  readonly marketplaceCaptures?: Pick<MarketplaceCaptureRepository, "findByIds"> | undefined;
  readonly clock?: (() => Date) | undefined;
}

interface UnitSignal {
  readonly failureCount: number;
  readonly retryBacklog: number;
  readonly deadLetterCount: number;
  readonly criticalFailure: boolean;
  readonly lastSuccessfulRunAt: string | null;
  readonly lastFailedRunAt: string | null;
  readonly hasActivity: boolean;
}

const emptySignal: UnitSignal = {
  failureCount: 0,
  retryBacklog: 0,
  deadLetterCount: 0,
  criticalFailure: false,
  lastSuccessfulRunAt: null,
  lastFailedRunAt: null,
  hasActivity: false,
};

const latestTimestamp = (current: string | null, candidate: string | null | undefined): string | null => {
  if (candidate == null) return current;
  if (current === null) return candidate;
  return Date.parse(candidate) > Date.parse(current) ? candidate : current;
};

const resolveUnitStatus = (signal: UnitSignal, now: Date, staleMs: number): RuntimeHealthStatus => {
  if (signal.criticalFailure || signal.deadLetterCount > 0) return "ACTION_REQUIRED";
  if (signal.retryBacklog > 0) return "DEGRADED";
  if (!signal.hasActivity) return "HEALTHY";
  if (signal.lastSuccessfulRunAt === null) return "DEGRADED";
  if (now.getTime() - Date.parse(signal.lastSuccessfulRunAt) > staleMs) return "DEGRADED";
  return "HEALTHY";
};

const configuredInvitationChannels = (metadata: unknown): readonly string[] => {
  const raw = isRecord(metadata) ? metadata.invitationChannels ?? metadata.availableInvitationChannels : undefined;
  if (!Array.isArray(raw)) return ["WHATSAPP", "SMS", "EMAIL"];
  const channels = raw.filter((item): item is string => typeof item === "string");
  return channels.length > 0 ? channels : ["WHATSAPP", "SMS", "EMAIL"];
};

/**
 * Tenant-scoped, read-only runtime health rollup for the autonomous acquisition
 * chain (CS-018/019/020). It never mutates campaign, execution, deal, or
 * capture state -- it only reads the canonical repositories those runtimes
 * already write to and explains what it finds.
 */
export class AcquisitionRuntimeHealthService {
  constructor(private readonly deps: AcquisitionRuntimeHealthDependencies) {}

  async getRuntimeHealth(scopeInput: TenantScoped): Promise<AcquisitionRuntimeHealthSnapshot> {
    const scope = contextSchema.parse(scopeInput) as TenantScoped;
    const now = this.deps.clock?.() ?? new Date();
    const generatedAt = now.toISOString();

    const campaignsPage = await this.deps.campaigns.list(scope, { limit: MAX_CAMPAIGNS_SCANNED });
    const campaigns = campaignsPage.items;

    if (campaigns.length === 0) {
      return this.unknownSnapshot(generatedAt);
    }

    const activeCampaigns = campaigns.filter((campaign) => campaign.status === "ACTIVE");

    const executionsByCampaign = new Map<string, readonly CampaignRuntimeExecutionRecord[]>();
    for (const campaign of campaigns) {
      const page = await this.deps.executions.listByCampaignId(scope, campaign.id, { limit: MAX_EXECUTIONS_PER_CAMPAIGN });
      executionsByCampaign.set(campaign.id, page.items);
    }
    const allExecutions = [...executionsByCampaign.values()].flat();

    const members = await this.collectMembers(scope, campaigns);
    const invitedMembers = members.filter((member) => invitedStatuses.has(member.status));
    const captureIds = [...new Set(invitedMembers.map((member) => member.marketplaceCaptureId))].slice(0, MAX_LOOKUP_IDS);
    const dealIds = [...new Set(members.map((member) => member.dealId).filter((id): id is string => typeof id === "string"))].slice(0, MAX_LOOKUP_IDS);

    const [claimTokens, captures, deals] = await Promise.all([
      this.deps.claimTokens?.listClaimTokensByMarketplaceCaptureIds(scope, captureIds) ?? Promise.resolve<readonly MarketplaceClaimTokenRecord[]>([]),
      this.deps.marketplaceCaptures?.findByIds(scope, captureIds) ?? Promise.resolve<readonly MarketplaceCaptureRecord[]>([]),
      Promise.all(dealIds.map((id) => this.deps.deals?.findById(scope.tenantId, id) ?? Promise.resolve(null))),
    ]);
    const resolvedDeals = deals.filter((deal): deal is DealRecord => deal !== null);

    const discovery = this.buildDiscoveryHealth(allExecutions, now);
    const qualification = this.buildQualificationHealth(allExecutions, now);
    const invitation = this.buildInvitationHealth(allExecutions, now);
    const claim = this.buildClaimHealth(claimTokens, now);
    const crmConversion = this.buildCrmConversionHealth(captures, now);
    const revenueAttribution = this.buildRevenueAttributionHealth(resolvedDeals, now);
    const growthLoop = this.buildGrowthLoopHealth(campaigns, now);

    const units = [discovery, qualification, invitation, claim, crmConversion, revenueAttribution, growthLoop];

    const providers = [
      this.buildWhatsappProvider(activeCampaigns, allExecutions),
      this.buildEmailProvider(activeCampaigns, allExecutions),
      this.buildDiscoveryProvider(activeCampaigns, allExecutions),
    ];

    const retryBacklog = units.reduce((sum, unit) => sum + unit.retryBacklog, 0);
    const deadLetterCount = units.reduce((sum, unit) => sum + unit.deadLetterCount, 0);
    const lastSuccessfulRunAt = units.reduce<string | null>((latest, unit) => latestTimestamp(latest, unit.lastSuccessfulRunAt), null);

    const failures = this.buildFailures(units, now);
    const overallStatus = this.resolveOverallStatus(units, providers);
    const recommendedOperationsActions = this.buildOperationsActions(overallStatus, units, providers);

    return {
      overallStatus,
      generatedAt,
      units,
      providers,
      failures,
      retryBacklog,
      deadLetterCount,
      lastSuccessfulRunAt,
      recommendedOperationsActions,
    };
  }

  private async collectMembers(scope: TenantScoped, campaigns: readonly SellerAcquisitionCampaignRecord[]): Promise<readonly SellerAcquisitionCampaignMemberRecord[]> {
    const members: SellerAcquisitionCampaignMemberRecord[] = [];
    for (const campaign of campaigns) {
      const page = await this.deps.campaigns.listMembers(scope, campaign.id, { limit: MAX_MEMBERS_PER_CAMPAIGN });
      members.push(...page.items.filter((member) => member.status !== "REMOVED"));
    }
    return members;
  }

  private buildDiscoveryHealth(executions: readonly CampaignRuntimeExecutionRecord[], now: Date): RuntimeUnitHealth {
    let lastSuccessfulRunAt: string | null = null;
    let lastFailedRunAt: string | null = null;
    let failureCount = 0;
    let hasActivity = false;

    for (const execution of executions) {
      const metrics = isRecord(execution.metrics) ? execution.metrics : {};
      const discoveryStatus = typeof metrics.discoveryStatus === "string" ? metrics.discoveryStatus : undefined;
      if (discoveryStatus === undefined && execution.status !== "FAILED") continue;
      hasActivity = true;
      if (discoveryStatus === "COMPLETED") {
        lastSuccessfulRunAt = latestTimestamp(lastSuccessfulRunAt, stringValue(metrics.discoveryCompletedAt) ?? execution.completedAt ?? null);
      } else if (discoveryStatus === "FAILED" || (discoveryStatus === undefined && execution.status === "FAILED")) {
        failureCount += 1;
        lastFailedRunAt = latestTimestamp(lastFailedRunAt, stringValue(metrics.discoveryFailedAt) ?? execution.failedAt ?? null);
      }
    }

    const resolved: UnitSignal = { ...emptySignal, failureCount, hasActivity, lastSuccessfulRunAt, lastFailedRunAt };
    const status = resolveUnitStatus(resolved, now, STALE_RUN_MS);
    return {
      unit: "DISCOVERY",
      status,
      lastSuccessfulRunAt,
      lastFailedRunAt,
      failureCount,
      retryBacklog: 0,
      deadLetterCount: 0,
      message: this.unitMessage(status, "Seller discovery", failureCount, 0, 0, lastSuccessfulRunAt, hasActivity),
    };
  }

  private buildQualificationHealth(executions: readonly CampaignRuntimeExecutionRecord[], now: Date): RuntimeUnitHealth {
    let lastSuccessfulRunAt: string | null = null;
    let lastFailedRunAt: string | null = null;
    let failureCount = 0;
    let hasActivity = false;

    for (const execution of executions) {
      const metrics = isRecord(execution.metrics) ? execution.metrics : {};
      const qualificationStatus = typeof metrics.qualificationStatus === "string" ? metrics.qualificationStatus : undefined;
      if (qualificationStatus === undefined) continue;
      hasActivity = true;
      if (qualificationStatus === "COMPLETED") {
        lastSuccessfulRunAt = latestTimestamp(lastSuccessfulRunAt, stringValue(metrics.qualificationCompletedAt) ?? execution.completedAt ?? null);
      } else if (qualificationStatus === "FAILED") {
        failureCount += 1;
        lastFailedRunAt = latestTimestamp(lastFailedRunAt, stringValue(metrics.qualificationFailedAt) ?? execution.failedAt ?? null);
      }
    }

    const resolved: UnitSignal = { ...emptySignal, failureCount, hasActivity, lastSuccessfulRunAt, lastFailedRunAt };
    const status = resolveUnitStatus(resolved, now, STALE_RUN_MS);
    return {
      unit: "QUALIFICATION",
      status,
      lastSuccessfulRunAt,
      lastFailedRunAt,
      failureCount,
      retryBacklog: 0,
      deadLetterCount: 0,
      message: this.unitMessage(status, "Seller qualification", failureCount, 0, 0, lastSuccessfulRunAt, hasActivity),
    };
  }

  private buildInvitationHealth(executions: readonly CampaignRuntimeExecutionRecord[], now: Date): RuntimeUnitHealth {
    let lastSuccessfulRunAt: string | null = null;
    let lastFailedRunAt: string | null = null;
    let failureCount = 0;
    let retryBacklog = 0;
    let deadLetterCount = 0;
    let hasActivity = false;

    for (const execution of executions) {
      const metrics = isRecord(execution.metrics) ? execution.metrics : {};
      const state = typeof metrics.invitationExecutionState === "string" ? metrics.invitationExecutionState : undefined;
      if (state === undefined) continue;
      hasActivity = true;
      if (state === "DELIVERED") {
        lastSuccessfulRunAt = latestTimestamp(lastSuccessfulRunAt, stringValue(metrics.deliveredAt) ?? execution.completedAt ?? null);
      } else if (state === "DEAD_LETTERED") {
        deadLetterCount += 1;
        failureCount += 1;
        lastFailedRunAt = latestTimestamp(lastFailedRunAt, stringValue(metrics.deadLetteredAt) ?? execution.failedAt ?? null);
      } else if (state === "RETRY_SCHEDULED") {
        retryBacklog += 1;
        failureCount += 1;
        lastFailedRunAt = latestTimestamp(lastFailedRunAt, stringValue(metrics.lastAttemptAt) ?? execution.failedAt ?? null);
      } else if (state === "FAILED") {
        failureCount += 1;
        lastFailedRunAt = latestTimestamp(lastFailedRunAt, stringValue(metrics.failedAt) ?? execution.failedAt ?? null);
      }
    }

    const resolved: UnitSignal = { ...emptySignal, failureCount, retryBacklog, deadLetterCount, hasActivity, lastSuccessfulRunAt, lastFailedRunAt };
    const status = resolveUnitStatus(resolved, now, STALE_RUN_MS);
    return {
      unit: "INVITATION",
      status,
      lastSuccessfulRunAt,
      lastFailedRunAt,
      failureCount,
      retryBacklog,
      deadLetterCount,
      message: this.unitMessage(status, "Seller invitations", failureCount, retryBacklog, deadLetterCount, lastSuccessfulRunAt, hasActivity),
    };
  }

  private buildClaimHealth(tokens: readonly MarketplaceClaimTokenRecord[], now: Date): RuntimeUnitHealth {
    let lastSuccessfulRunAt: string | null = null;
    let lastFailedRunAt: string | null = null;
    let failureCount = 0;
    const hasActivity = tokens.length > 0;

    for (const token of tokens) {
      if (token.claimedAt != null) {
        lastSuccessfulRunAt = latestTimestamp(lastSuccessfulRunAt, token.claimedAt);
      } else if (token.status === "EXPIRED" || token.expiredAt != null) {
        failureCount += 1;
        lastFailedRunAt = latestTimestamp(lastFailedRunAt, token.expiredAt ?? null);
      }
    }

    const resolved: UnitSignal = { ...emptySignal, failureCount, hasActivity, lastSuccessfulRunAt, lastFailedRunAt };
    const status = resolveUnitStatus(resolved, now, STALE_RUN_MS);
    return {
      unit: "CLAIM",
      status,
      lastSuccessfulRunAt,
      lastFailedRunAt,
      failureCount,
      retryBacklog: 0,
      deadLetterCount: 0,
      message: this.unitMessage(status, "Seller claim", failureCount, 0, 0, lastSuccessfulRunAt, hasActivity),
    };
  }

  private buildCrmConversionHealth(captures: readonly MarketplaceCaptureRecord[], now: Date): RuntimeUnitHealth {
    let lastSuccessfulRunAt: string | null = null;
    let lastFailedRunAt: string | null = null;
    let retryBacklog = 0;
    let deadLetterCount = 0;
    let hasActivity = false;

    for (const capture of captures) {
      const metadata = isRecord(capture.metadata) ? capture.metadata : {};
      const conversionStatus = typeof metadata.crmConversionStatus === "string" ? metadata.crmConversionStatus : undefined;
      if (conversionStatus === undefined) continue;
      hasActivity = true;
      if (conversionStatus === "CONVERTED") {
        lastSuccessfulRunAt = latestTimestamp(lastSuccessfulRunAt, stringValue(metadata.crmConversionCompletedAt) ?? null);
      } else if (conversionStatus === "NEEDS_MANUAL_REVIEW") {
        deadLetterCount += 1;
        lastFailedRunAt = latestTimestamp(lastFailedRunAt, stringValue(metadata.crmConversionFailedAt) ?? null);
      } else if (conversionStatus === "CONVERSION_FAILED") {
        retryBacklog += 1;
        lastFailedRunAt = latestTimestamp(lastFailedRunAt, stringValue(metadata.crmConversionFailedAt) ?? null);
      }
    }

    const failureCount = retryBacklog + deadLetterCount;
    const resolved: UnitSignal = { ...emptySignal, failureCount, retryBacklog, deadLetterCount, hasActivity, lastSuccessfulRunAt, lastFailedRunAt };
    const status = resolveUnitStatus(resolved, now, STALE_RUN_MS);
    return {
      unit: "CRM_CONVERSION",
      status,
      lastSuccessfulRunAt,
      lastFailedRunAt,
      failureCount,
      retryBacklog,
      deadLetterCount,
      message: this.unitMessage(status, "CRM conversion", failureCount, retryBacklog, deadLetterCount, lastSuccessfulRunAt, hasActivity),
    };
  }

  private buildRevenueAttributionHealth(deals: readonly DealRecord[], now: Date): RuntimeUnitHealth {
    let lastSuccessfulRunAt: string | null = null;
    let lastFailedRunAt: string | null = null;
    let failureCount = 0;
    let hasActivity = false;

    for (const deal of deals) {
      const metadata = isRecord(deal.metadata) ? deal.metadata : {};
      const snapshot = isRecord(metadata.revenueAttribution) ? metadata.revenueAttribution : undefined;
      const attributionStatus = typeof snapshot?.attributionStatus === "string" ? snapshot.attributionStatus : undefined;
      if (attributionStatus === undefined) continue;
      hasActivity = true;
      if (attributionStatus === "ATTRIBUTED") {
        lastSuccessfulRunAt = latestTimestamp(lastSuccessfulRunAt, stringValue(snapshot?.attributedAt) ?? stringValue(snapshot?.evaluatedAt) ?? null);
      } else if (attributionStatus === "ATTRIBUTION_FAILED") {
        failureCount += 1;
        lastFailedRunAt = latestTimestamp(lastFailedRunAt, stringValue(snapshot?.evaluatedAt) ?? null);
      }
    }

    const criticalFailure = failureCount > 0;
    const resolved: UnitSignal = { ...emptySignal, failureCount, criticalFailure, hasActivity, lastSuccessfulRunAt, lastFailedRunAt };
    const status = resolveUnitStatus(resolved, now, STALE_RUN_MS);
    return {
      unit: "REVENUE_ATTRIBUTION",
      status,
      lastSuccessfulRunAt,
      lastFailedRunAt,
      failureCount,
      retryBacklog: 0,
      deadLetterCount: 0,
      message: this.unitMessage(status, "Revenue attribution", failureCount, 0, 0, lastSuccessfulRunAt, hasActivity),
    };
  }

  private buildGrowthLoopHealth(campaigns: readonly SellerAcquisitionCampaignRecord[], now: Date): RuntimeUnitHealth {
    let lastSuccessfulRunAt: string | null = null;
    let lastFailedRunAt: string | null = null;
    let failureCount = 0;
    let hasActivity = false;

    for (const campaign of campaigns) {
      const metadata = isRecord(campaign.metadata) ? campaign.metadata : {};
      const growthLoopStatus = typeof metadata.growthLoopStatus === "string" ? metadata.growthLoopStatus : undefined;
      if (growthLoopStatus === undefined) continue;
      hasActivity = true;
      if (growthLoopStatus === "COMPLETED") {
        lastSuccessfulRunAt = latestTimestamp(lastSuccessfulRunAt, stringValue(metadata.lastGrowthEvaluatedAt) ?? null);
      } else if (growthLoopStatus === "FAILED") {
        failureCount += 1;
        lastFailedRunAt = latestTimestamp(lastFailedRunAt, stringValue(metadata.growthLoopFailedAt) ?? stringValue(metadata.lastGrowthEvaluatedAt) ?? null);
      }
    }

    const criticalFailure = failureCount > 0;
    const resolved: UnitSignal = { ...emptySignal, failureCount, criticalFailure, hasActivity, lastSuccessfulRunAt, lastFailedRunAt };
    const status = resolveUnitStatus(resolved, now, STALE_GROWTH_LOOP_MS);
    return {
      unit: "GROWTH_LOOP",
      status,
      lastSuccessfulRunAt,
      lastFailedRunAt,
      failureCount,
      retryBacklog: 0,
      deadLetterCount: 0,
      message: this.unitMessage(status, "Growth loop", failureCount, 0, 0, lastSuccessfulRunAt, hasActivity),
    };
  }

  private unitMessage(status: RuntimeHealthStatus, label: string, failureCount: number, retryBacklog: number, deadLetterCount: number, lastSuccessfulRunAt: string | null, hasActivity: boolean): string {
    if (!hasActivity) return `${label} has no runtime activity yet.`;
    if (deadLetterCount > 0) return `${label} has ${deadLetterCount} dead-lettered failure${deadLetterCount === 1 ? "" : "s"} that need manual review.`;
    if (retryBacklog > 0) return `${label} has ${retryBacklog} failure${retryBacklog === 1 ? "" : "s"} scheduled for automatic retry.`;
    if (status === "ACTION_REQUIRED") return `${label} has a critical failure that needs operator attention.`;
    if (status === "DEGRADED" && lastSuccessfulRunAt === null) return `${label} has run but has not yet completed successfully.`;
    if (status === "DEGRADED") return `${label} last succeeded at ${lastSuccessfulRunAt}, which is longer ago than expected.`;
    if (failureCount > 0) return `${label} recovered after ${failureCount} earlier failure${failureCount === 1 ? "" : "s"}.`;
    return `${label} is running normally.`;
  }

  private buildWhatsappProvider(activeCampaigns: readonly SellerAcquisitionCampaignRecord[], executions: readonly CampaignRuntimeExecutionRecord[]): ProviderHealth {
    const required = activeCampaigns.some((campaign) => configuredInvitationChannels(campaign.metadata).includes("WHATSAPP"));
    const configured = activeCampaigns.some((campaign) => {
      const metadata = isRecord(campaign.metadata) ? campaign.metadata : {};
      const providers = isRecord(metadata.invitationProviders) ? metadata.invitationProviders : {};
      return stringValue(providers.WHATSAPP) !== undefined;
    });
    const health = activeCampaigns
      .map((campaign) => (isRecord(campaign.metadata) && isRecord(campaign.metadata.providerHealth) ? stringValue(campaign.metadata.providerHealth.WHATSAPP)?.toUpperCase() : undefined))
      .find((value) => value !== undefined);

    const { lastSuccessfulUseAt, lastFailedUseAt } = this.channelUsage(executions, "WHATSAPP");

    let status: RuntimeHealthStatus = "HEALTHY";
    let message: string | null = null;
    if (required && !configured) {
      status = "ACTION_REQUIRED";
      message = "WhatsApp is not configured but an active campaign depends on it for invitations.";
    } else if (health === "DOWN" || health === "UNHEALTHY") {
      status = "ACTION_REQUIRED";
      message = "WhatsApp provider is reporting an unhealthy status.";
    } else if (health === "DEGRADED" || health === "RATE_LIMITED") {
      status = "DEGRADED";
      message = "WhatsApp provider is degraded or rate limited.";
    } else if (!configured) {
      message = "WhatsApp is not configured; no active campaign currently requires it.";
    } else {
      message = "WhatsApp is configured and healthy.";
    }

    return { provider: "WHATSAPP", status, configured, lastSuccessfulUseAt, lastFailedUseAt, message };
  }

  private buildEmailProvider(activeCampaigns: readonly SellerAcquisitionCampaignRecord[], executions: readonly CampaignRuntimeExecutionRecord[]): ProviderHealth {
    const requiredFallback = activeCampaigns.some((campaign) => stringValue(isRecord(campaign.metadata) ? campaign.metadata.requiredFallbackChannel : undefined) === "EMAIL");
    const configured = activeCampaigns.some((campaign) => {
      const metadata = isRecord(campaign.metadata) ? campaign.metadata : {};
      const providers = isRecord(metadata.invitationProviders) ? metadata.invitationProviders : {};
      return stringValue(providers.EMAIL) !== undefined;
    });
    const { lastSuccessfulUseAt, lastFailedUseAt } = this.channelUsage(executions, "EMAIL");

    let status: RuntimeHealthStatus = "HEALTHY";
    let message: string | null = "Email fallback is not required by any active campaign.";
    if (requiredFallback && !configured) {
      status = "ACTION_REQUIRED";
      message = "Email is configured as the required fallback channel but has no provider configured.";
    } else if (requiredFallback) {
      message = "Email fallback is configured and required.";
    } else if (configured) {
      message = "Email is configured as an optional invitation channel.";
    }

    return { provider: "EMAIL", status, configured, lastSuccessfulUseAt, lastFailedUseAt, message };
  }

  private buildDiscoveryProvider(activeCampaigns: readonly SellerAcquisitionCampaignRecord[], executions: readonly CampaignRuntimeExecutionRecord[]): ProviderHealth {
    const activeCampaignIds = new Set(activeCampaigns.map((campaign) => campaign.id));
    const targetingInvalid = executions.some((execution) => activeCampaignIds.has(execution.campaignId) && execution.errorCode === "CAMPAIGN_TARGETING_INVALID");
    const configured = !targetingInvalid;

    const successes = executions.filter((execution) => {
      const metrics = isRecord(execution.metrics) ? execution.metrics : {};
      return metrics.discoveryStatus === "COMPLETED";
    });
    const failures = executions.filter((execution) => {
      const metrics = isRecord(execution.metrics) ? execution.metrics : {};
      return metrics.discoveryStatus === "FAILED";
    });
    const lastSuccessfulUseAt = successes.reduce<string | null>((latest, execution) => latestTimestamp(latest, execution.completedAt ?? null), null);
    const lastFailedUseAt = failures.reduce<string | null>((latest, execution) => latestTimestamp(latest, execution.failedAt ?? null), null);

    let status: RuntimeHealthStatus = "HEALTHY";
    let message: string | null = "Discovery targeting is configured.";
    if (targetingInvalid && activeCampaigns.length > 0) {
      status = "ACTION_REQUIRED";
      message = "An active campaign has invalid discovery targeting configuration and cannot run discovery.";
    }

    return { provider: "DISCOVERY", status, configured, lastSuccessfulUseAt, lastFailedUseAt, message };
  }

  private channelUsage(executions: readonly CampaignRuntimeExecutionRecord[], channel: "WHATSAPP" | "EMAIL"): { readonly lastSuccessfulUseAt: string | null; readonly lastFailedUseAt: string | null } {
    let lastSuccessfulUseAt: string | null = null;
    let lastFailedUseAt: string | null = null;
    for (const execution of executions) {
      const metrics = isRecord(execution.metrics) ? execution.metrics : {};
      const usedChannel = stringValue(metrics.channel) ?? stringValue(metrics.selectedChannel);
      if (usedChannel !== channel) continue;
      const state = typeof metrics.invitationExecutionState === "string" ? metrics.invitationExecutionState : undefined;
      if (state === "DELIVERED") lastSuccessfulUseAt = latestTimestamp(lastSuccessfulUseAt, stringValue(metrics.deliveredAt) ?? execution.completedAt ?? null);
      if (state === "FAILED" || state === "DEAD_LETTERED") lastFailedUseAt = latestTimestamp(lastFailedUseAt, execution.failedAt ?? null);
    }
    return { lastSuccessfulUseAt, lastFailedUseAt };
  }

  private buildFailures(units: readonly RuntimeUnitHealth[], now: Date): readonly RuntimeFailure[] {
    const failures: RuntimeFailure[] = [];
    for (const unit of units) {
      if (unit.status !== "ACTION_REQUIRED" && unit.status !== "DEGRADED") continue;
      const severity: RuntimeFailureSeverity = unit.deadLetterCount > 0 || unit.status === "ACTION_REQUIRED" ? "CRITICAL" : unit.retryBacklog > 0 ? "MEDIUM" : "LOW";
      const retryable = unit.status === "DEGRADED" && unit.retryBacklog > 0;
      failures.push({
        id: `${unit.unit}:${unit.lastFailedRunAt ?? now.toISOString()}`,
        unit: unit.unit,
        severity,
        message: unit.message ?? `${unit.unit} is not healthy.`,
        occurredAt: unit.lastFailedRunAt ?? now.toISOString(),
        retryable,
        recommendedAction: unit.deadLetterCount > 0
          ? "Review dead-lettered jobs and resolve manually."
          : unit.retryBacklog > 0
          ? "Allow automatic retries to complete, or retry manually if backlog persists."
          : "Investigate the runtime unit for the root cause of the failure.",
      });
    }
    return failures.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  }

  private resolveOverallStatus(units: readonly RuntimeUnitHealth[], providers: readonly ProviderHealth[]): RuntimeHealthStatus {
    const statuses = [...units.map((unit) => unit.status), ...providers.map((provider) => provider.status)];
    if (statuses.includes("ACTION_REQUIRED")) return "ACTION_REQUIRED";
    if (statuses.includes("DEGRADED")) return "DEGRADED";
    return "HEALTHY";
  }

  private buildOperationsActions(overallStatus: RuntimeHealthStatus, units: readonly RuntimeUnitHealth[], providers: readonly ProviderHealth[]): readonly OperationsAction[] {
    const actions: OperationsAction[] = [];

    const misconfiguredProviders = providers.filter((provider) => provider.status === "ACTION_REQUIRED");
    for (const provider of misconfiguredProviders) {
      actions.push({
        id: `CONFIGURE_PROVIDER:${provider.provider}`,
        priority: "CRITICAL",
        title: `Configure ${provider.provider} provider`,
        description: provider.message ?? `${provider.provider} provider requires configuration.`,
        actionType: "CONFIGURE_PROVIDER",
      });
    }

    const deadLetterUnits = units.filter((unit) => unit.deadLetterCount > 0);
    for (const unit of deadLetterUnits) {
      actions.push({
        id: `REVIEW_DEAD_LETTER:${unit.unit}`,
        priority: "CRITICAL",
        title: `Review dead-lettered ${unit.unit.toLowerCase().replaceAll("_", " ")} jobs`,
        description: unit.message ?? `${unit.unit} has dead-lettered jobs awaiting review.`,
        actionType: "REVIEW_DEAD_LETTER",
      });
    }

    const retryBacklogUnits = units.filter((unit) => unit.retryBacklog > 0);
    for (const unit of retryBacklogUnits) {
      actions.push({
        id: `RETRY_FAILED_JOBS:${unit.unit}`,
        priority: "MEDIUM",
        title: `Monitor retrying ${unit.unit.toLowerCase().replaceAll("_", " ")} jobs`,
        description: unit.message ?? `${unit.unit} has jobs retrying automatically.`,
        actionType: "RETRY_FAILED_JOBS",
      });
    }

    const criticalUnits = units.filter((unit) => unit.status === "ACTION_REQUIRED" && unit.deadLetterCount === 0);
    for (const unit of criticalUnits) {
      actions.push({
        id: `CHECK_RUNTIME:${unit.unit}`,
        priority: "CRITICAL",
        title: `Check ${unit.unit.toLowerCase().replaceAll("_", " ")} runtime`,
        description: unit.message ?? `${unit.unit} needs operator attention.`,
        actionType: "CHECK_RUNTIME",
      });
    }

    if (actions.length === 0) {
      actions.push({
        id: "NO_ACTION:runtime",
        priority: "LOW",
        title: overallStatus === "HEALTHY" ? "No action needed" : "Monitor runtime",
        description: overallStatus === "HEALTHY"
          ? "The autonomous acquisition runtime is healthy. No operator action is needed."
          : "The autonomous acquisition runtime is degraded but self-recovering. Continue monitoring.",
        actionType: "NO_ACTION",
      });
    }

    const priorityRank: Readonly<Record<RuntimeFailureSeverity, number>> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return actions.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);
  }

  private unknownSnapshot(generatedAt: string): AcquisitionRuntimeHealthSnapshot {
    const units: readonly RuntimeUnitHealth[] = (["DISCOVERY", "QUALIFICATION", "INVITATION", "CLAIM", "CRM_CONVERSION", "REVENUE_ATTRIBUTION", "GROWTH_LOOP"] as const).map((unit) => ({
      unit,
      status: "UNKNOWN",
      lastSuccessfulRunAt: null,
      lastFailedRunAt: null,
      failureCount: 0,
      retryBacklog: 0,
      deadLetterCount: 0,
      message: "No seller acquisition campaign exists yet, so this runtime unit has never executed.",
    }));
    const providers: readonly ProviderHealth[] = (["WHATSAPP", "EMAIL", "DISCOVERY"] as const).map((provider) => ({
      provider,
      status: "UNKNOWN",
      configured: false,
      lastSuccessfulUseAt: null,
      lastFailedUseAt: null,
      message: "No seller acquisition campaign exists yet to evaluate provider configuration.",
    }));
    return {
      overallStatus: "UNKNOWN",
      generatedAt,
      units,
      providers,
      failures: [],
      retryBacklog: 0,
      deadLetterCount: 0,
      lastSuccessfulRunAt: null,
      recommendedOperationsActions: [{
        id: "NO_ACTION:no-campaign",
        priority: "LOW",
        title: "Create a seller acquisition campaign",
        description: "No seller acquisition campaign exists yet. Create a campaign to start the autonomous acquisition runtime.",
        actionType: "NO_ACTION",
      }],
    };
  }
}
