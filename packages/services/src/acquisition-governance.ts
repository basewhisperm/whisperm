import { z } from "zod";

import type {
  AcquisitionGovernanceRepository,
  AuditLogRepository,
  CreateAuditLogInput,
  SellerAcquisitionCampaignRecord,
  SellerAcquisitionCampaignRepository,
} from "@whisperm/repositories";
import type { TenantScoped } from "@whisperm/types";

const scopeSchema = z.object({ tenantId: z.string().trim().min(1) }).strict();

export type AcquisitionGovernanceCapability =
  | "DISCOVERY"
  | "QUALIFICATION"
  | "INVITATION"
  | "CLAIM"
  | "CRM_CONVERSION"
  | "REVENUE_ATTRIBUTION"
  | "GROWTH_LOOP"
  | "COMMAND_CENTER"
  | "RUNTIME_HEALTH";

const capabilityValues = [
  "DISCOVERY",
  "QUALIFICATION",
  "INVITATION",
  "CLAIM",
  "CRM_CONVERSION",
  "REVENUE_ATTRIBUTION",
  "GROWTH_LOOP",
  "COMMAND_CENTER",
  "RUNTIME_HEALTH",
] as const;

export type AcquisitionGovernanceDecisionStatus = "ALLOW" | "DEGRADE" | "DENY";

export type AcquisitionGovernanceDenialReason =
  | "FEATURE_DISABLED"
  | "TENANT_INACTIVE"
  | "PLAN_LIMIT_EXCEEDED"
  | "MONTHLY_QUOTA_EXCEEDED"
  | "DAILY_RATE_LIMIT_EXCEEDED"
  | "PROVIDER_REQUIRED"
  | "CAMPAIGN_NOT_ACTIVE"
  | "TENANT_MISMATCH"
  | "UNKNOWN";

export interface AcquisitionGovernanceAuthorizationInput {
  readonly capability: AcquisitionGovernanceCapability;
  readonly campaignId?: string | undefined;
  readonly requestedUnits?: number | undefined;
  readonly provider?: "WHATSAPP" | "SMS" | "EMAIL" | "DISCOVERY" | undefined;
  readonly actorId?: string | undefined;
  readonly source?: "API" | "WORKER" | "UI" | "SYSTEM" | undefined;
  /** Whether previously captured seller data already exists for this qualification target -- lets a rate-limited QUALIFICATION degrade instead of hard-denying. */
  readonly hasCapturedData?: boolean | undefined;
}

const authorizationInputSchema = z.object({
  capability: z.enum(capabilityValues),
  campaignId: z.string().trim().min(1).optional(),
  requestedUnits: z.number().int().positive().optional(),
  provider: z.enum(["WHATSAPP", "SMS", "EMAIL", "DISCOVERY"]).optional(),
  actorId: z.string().trim().min(1).optional(),
  source: z.enum(["API", "WORKER", "UI", "SYSTEM"]).optional(),
  hasCapturedData: z.boolean().optional(),
}).strict();

export type AcquisitionGovernanceLimitPeriod = "DAY" | "MONTH" | "PLAN" | "NONE";
export type AcquisitionGovernanceLimitStatus = "OK" | "NEAR_LIMIT" | "EXCEEDED" | "UNLIMITED";

export interface AcquisitionGovernanceLimit {
  readonly key: string;
  readonly used: number;
  readonly limit: number | null;
  readonly period: AcquisitionGovernanceLimitPeriod;
  readonly status: AcquisitionGovernanceLimitStatus;
}

export type AcquisitionGovernanceWarningSeverity = "LOW" | "MEDIUM" | "HIGH";

export interface AcquisitionGovernanceWarning {
  readonly code: string;
  readonly message: string;
  readonly severity: AcquisitionGovernanceWarningSeverity;
}

export interface AcquisitionGovernanceAuditEvent {
  readonly action: string;
  readonly capability: AcquisitionGovernanceCapability;
  readonly status: AcquisitionGovernanceDecisionStatus;
  readonly reason: AcquisitionGovernanceDenialReason | null;
  readonly recordedAt: string;
  readonly persisted: boolean;
}

export interface AcquisitionGovernanceDecision {
  readonly status: AcquisitionGovernanceDecisionStatus;
  readonly capability: AcquisitionGovernanceCapability;
  readonly reason: AcquisitionGovernanceDenialReason | null;
  readonly message: string;
  readonly limits: readonly AcquisitionGovernanceLimit[];
  readonly warnings: readonly AcquisitionGovernanceWarning[];
  readonly auditEvent: AcquisitionGovernanceAuditEvent;
}

export type AcquisitionGovernanceCapabilityStatus = "AVAILABLE" | "DEGRADED" | "BLOCKED";

export interface AcquisitionGovernanceCapabilitySnapshot {
  readonly enabled: boolean;
  readonly status: AcquisitionGovernanceCapabilityStatus;
  readonly message: string | null;
}

export type AcquisitionGovernanceOverallStatus = "ACTIVE" | "DEGRADED" | "ACTION_REQUIRED" | "DISABLED";

export interface AcquisitionGovernanceSnapshot {
  readonly tenantId: string;
  readonly generatedAt: string;
  readonly overallStatus: AcquisitionGovernanceOverallStatus;
  readonly featureEnabled: boolean;
  readonly planName: string | null;
  readonly capabilities: Record<AcquisitionGovernanceCapability, AcquisitionGovernanceCapabilitySnapshot>;
  readonly limits: readonly AcquisitionGovernanceLimit[];
  readonly warnings: readonly AcquisitionGovernanceWarning[];
}

export interface AcquisitionGovernanceDependencies {
  readonly governance: AcquisitionGovernanceRepository;
  readonly campaigns?: Pick<SellerAcquisitionCampaignRepository, "findById"> | undefined;
  readonly auditLogs?: Pick<AuditLogRepository, "append"> | undefined;
  readonly clock?: (() => Date) | undefined;
}

const mutationCapabilities = new Set<AcquisitionGovernanceCapability>([
  "DISCOVERY",
  "QUALIFICATION",
  "INVITATION",
  "CLAIM",
  "CRM_CONVERSION",
  "REVENUE_ATTRIBUTION",
  "GROWTH_LOOP",
]);
const readOnlyCapabilities = new Set<AcquisitionGovernanceCapability>(["COMMAND_CENTER", "RUNTIME_HEALTH"]);

interface PlanLimits {
  readonly monthlyDiscovery: number | null;
  readonly monthlyInvitations: number | null;
  readonly dailyDiscovery: number | null;
  readonly dailyInvitations: number | null;
}

const planLimitsByPlan: Readonly<Record<string, PlanLimits>> = {
  STARTER: { monthlyDiscovery: 200, monthlyInvitations: 300, dailyDiscovery: 50, dailyInvitations: 75 },
  GROWTH: { monthlyDiscovery: 2000, monthlyInvitations: 3000, dailyDiscovery: 300, dailyInvitations: 400 },
  PRO: { monthlyDiscovery: null, monthlyInvitations: null, dailyDiscovery: null, dailyInvitations: null },
};
const defaultPlanLimits: PlanLimits = { monthlyDiscovery: 200, monthlyInvitations: 300, dailyDiscovery: 50, dailyInvitations: 75 };

const planLimitsFor = (planName: string | null): PlanLimits => (planName !== null ? planLimitsByPlan[planName] ?? defaultPlanLimits : defaultPlanLimits);

const nearLimitThreshold = 0.8;

const limitStatus = (used: number, limit: number | null): AcquisitionGovernanceLimitStatus => {
  if (limit === null) return "UNLIMITED";
  if (used >= limit) return "EXCEEDED";
  if (used >= limit * nearLimitThreshold) return "NEAR_LIMIT";
  return "OK";
};

const buildLimit = (key: string, used: number, limit: number | null, period: AcquisitionGovernanceLimitPeriod): AcquisitionGovernanceLimit => ({
  key,
  used,
  limit,
  period,
  status: limitStatus(used, limit),
});

const startOfUtcDay = (now: Date): Date => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const startOfUtcMonth = (now: Date): Date => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

const inactiveSubscriptionStatuses = new Set(["CANCELED", "UNPAID"]);
const isTenantActive = (subscriptionStatus: string | null): boolean => subscriptionStatus === null || !inactiveSubscriptionStatuses.has(subscriptionStatus);

interface TenantGovernanceState {
  readonly featureEnabled: boolean;
  readonly discoveryFeatureEnabled: boolean;
  readonly planName: string | null;
  readonly subscriptionStatus: string | null;
  readonly tenantActive: boolean;
  readonly whatsappConfigured: boolean;
  readonly discoveryConfigured: boolean;
  readonly limits: readonly AcquisitionGovernanceLimit[];
  readonly monthlyDiscoveryExceeded: boolean;
  readonly monthlyInvitationsExceeded: boolean;
  readonly dailyDiscoveryExceeded: boolean;
  readonly dailyInvitationsExceeded: boolean;
  readonly baseWarnings: readonly AcquisitionGovernanceWarning[];
}

const capabilityMessages: Readonly<Record<AcquisitionGovernanceCapability, string>> = {
  DISCOVERY: "Discovery may run.",
  QUALIFICATION: "Qualification may run.",
  INVITATION: "Invitations may be sent.",
  CLAIM: "Claim recovery may run.",
  CRM_CONVERSION: "CRM conversion may run.",
  REVENUE_ATTRIBUTION: "Revenue attribution may run.",
  GROWTH_LOOP: "Growth loop evaluation may run.",
  COMMAND_CENTER: "Command center is available.",
  RUNTIME_HEALTH: "Runtime health is available.",
};

/**
 * Centralized, tenant-scoped decision layer that gates autonomous acquisition
 * runtime work (CS-018/019/020/021) behind feature, plan, quota, rate-limit,
 * and provider checks. Services own this logic; API routes and workers call
 * it before executing -- it never mutates campaign/execution/deal state
 * itself.
 */
export class AcquisitionGovernanceService {
  constructor(private readonly deps: AcquisitionGovernanceDependencies) {}

  async getGovernanceSnapshot(scopeInput: TenantScoped): Promise<AcquisitionGovernanceSnapshot> {
    const scope = scopeSchema.parse(scopeInput) as TenantScoped;
    const now = this.deps.clock?.() ?? new Date();
    const state = await this.loadState(scope, now);

    const capabilities = Object.fromEntries(
      capabilityValues.map((capability) => [capability, this.capabilitySnapshot(capability, state)]),
    ) as Record<AcquisitionGovernanceCapability, AcquisitionGovernanceCapabilitySnapshot>;

    return {
      tenantId: scope.tenantId,
      generatedAt: now.toISOString(),
      overallStatus: this.overallStatus(state),
      featureEnabled: state.featureEnabled,
      planName: state.planName,
      capabilities,
      limits: state.limits,
      warnings: state.baseWarnings,
    };
  }

  async authorizeAcquisitionAction(scopeInput: TenantScoped, input: AcquisitionGovernanceAuthorizationInput): Promise<AcquisitionGovernanceDecision> {
    const scope = scopeSchema.parse(scopeInput) as TenantScoped;
    const data = authorizationInputSchema.parse(input);
    const now = this.deps.clock?.() ?? new Date();
    const state = await this.loadState(scope, now);

    let campaign: SellerAcquisitionCampaignRecord | null = null;
    if (data.campaignId !== undefined && this.deps.campaigns !== undefined) {
      campaign = await this.deps.campaigns.findById(scope, data.campaignId);
      if (campaign === null) {
        return this.decide(scope, data, state, now, "DENY", "TENANT_MISMATCH", "This campaign does not belong to your workspace.", []);
      }
    }

    if (!state.featureEnabled) {
      return this.decide(scope, data, state, now, "DENY", "FEATURE_DISABLED", "Seller acquisition is not enabled for this workspace.", []);
    }
    if (!state.tenantActive) {
      return this.decide(scope, data, state, now, "DENY", "TENANT_INACTIVE", "This workspace's subscription is not active.", []);
    }

    const campaignInactive = campaign !== null && campaign.status !== "ACTIVE";
    const warnings = [...state.baseWarnings];

    switch (data.capability) {
      case "DISCOVERY": {
        if (!state.discoveryFeatureEnabled) return this.decide(scope, data, state, now, "DENY", "PLAN_LIMIT_EXCEEDED", "Discovery is not included in the current plan. Upgrade to enable automated seller discovery.", []);
        if (!state.discoveryConfigured) return this.decide(scope, data, state, now, "DENY", "PROVIDER_REQUIRED", "Connect an active discovery source before running discovery.", []);
        if (campaignInactive) return this.decide(scope, data, state, now, "DENY", "CAMPAIGN_NOT_ACTIVE", "Discovery can only run for an active campaign.", []);
        if (state.monthlyDiscoveryExceeded) return this.decide(scope, data, state, now, "DENY", "MONTHLY_QUOTA_EXCEEDED", "Monthly discovery quota has been reached for this workspace.", []);
        if (state.dailyDiscoveryExceeded) return this.decide(scope, data, state, now, "DENY", "DAILY_RATE_LIMIT_EXCEEDED", "Daily discovery limit reached. Try again tomorrow.", []);
        return this.decide(scope, data, state, now, "ALLOW", null, capabilityMessages.DISCOVERY, warnings);
      }
      case "INVITATION": {
        const provider = data.provider ?? "WHATSAPP";
        if (provider === "WHATSAPP" && !state.whatsappConfigured) return this.decide(scope, data, state, now, "DENY", "PROVIDER_REQUIRED", "Connect WhatsApp before sending WhatsApp invitations.", []);
        if (campaignInactive) return this.decide(scope, data, state, now, "DENY", "CAMPAIGN_NOT_ACTIVE", "Invitations can only be sent for an active campaign.", []);
        if (state.monthlyInvitationsExceeded) return this.decide(scope, data, state, now, "DENY", "MONTHLY_QUOTA_EXCEEDED", "Monthly invitation quota has been reached for this workspace.", []);
        if (state.dailyInvitationsExceeded) return this.decide(scope, data, state, now, "DENY", "DAILY_RATE_LIMIT_EXCEEDED", "Daily invitation limit reached. Try again tomorrow.", []);
        return this.decide(scope, data, state, now, "ALLOW", null, capabilityMessages.INVITATION, warnings);
      }
      case "QUALIFICATION": {
        if (campaignInactive) return this.decide(scope, data, state, now, "DENY", "CAMPAIGN_NOT_ACTIVE", "Qualification can only run for an active campaign.", []);
        if (state.dailyDiscoveryExceeded || state.dailyInvitationsExceeded) {
          if (data.hasCapturedData === true) return this.decide(scope, data, state, now, "DEGRADE", "DAILY_RATE_LIMIT_EXCEEDED", "Daily rate limit reached; qualification is running in degraded mode against previously captured data.", warnings);
          return this.decide(scope, data, state, now, "DENY", "DAILY_RATE_LIMIT_EXCEEDED", "Daily rate limit reached and no previously captured data is available to qualify.", []);
        }
        return this.decide(scope, data, state, now, "ALLOW", null, capabilityMessages.QUALIFICATION, warnings);
      }
      case "CLAIM":
      case "CRM_CONVERSION":
      case "REVENUE_ATTRIBUTION":
      case "GROWTH_LOOP": {
        if (campaignInactive) return this.decide(scope, data, state, now, "DENY", "CAMPAIGN_NOT_ACTIVE", `${capabilityMessages[data.capability].replace(" may run.", "")} can only run for an active campaign.`, []);
        return this.decide(scope, data, state, now, "ALLOW", null, capabilityMessages[data.capability], warnings);
      }
      case "COMMAND_CENTER":
      case "RUNTIME_HEALTH": {
        return this.decide(scope, data, state, now, "ALLOW", null, capabilityMessages[data.capability], warnings);
      }
      default:
        return this.decide(scope, data, state, now, "DENY", "UNKNOWN", "Unrecognized acquisition capability.", []);
    }
  }

  private async loadState(scope: TenantScoped, now: Date): Promise<TenantGovernanceState> {
    const [status, whatsappConfigured, discoveryConfigured, monthUsage, dayUsage] = await Promise.all([
      this.deps.governance.getTenantStatus(scope),
      this.deps.governance.hasActiveProvider(scope, "WHATSAPP"),
      this.deps.governance.hasActiveDiscoverySource(scope),
      this.deps.governance.countUsageSince(scope, startOfUtcMonth(now)),
      this.deps.governance.countUsageSince(scope, startOfUtcDay(now)),
    ]);

    const planLimits = planLimitsFor(status.planName);
    const discoveryMonthly = buildLimit("discovery.monthly", monthUsage.discoveryRuns, planLimits.monthlyDiscovery, "MONTH");
    const discoveryDaily = buildLimit("discovery.daily", dayUsage.discoveryRuns, planLimits.dailyDiscovery, "DAY");
    const invitationMonthly = buildLimit("invitation.monthly", monthUsage.invitationsSent, planLimits.monthlyInvitations, "MONTH");
    const invitationDaily = buildLimit("invitation.daily", dayUsage.invitationsSent, planLimits.dailyInvitations, "DAY");
    const limits: readonly AcquisitionGovernanceLimit[] = [discoveryMonthly, discoveryDaily, invitationMonthly, invitationDaily];

    const tenantActive = isTenantActive(status.subscriptionStatus);

    const baseWarnings: AcquisitionGovernanceWarning[] = [];
    if (!whatsappConfigured) baseWarnings.push({ code: "WHATSAPP_NOT_CONFIGURED", message: "WhatsApp is not connected. Connect it to send seller invitations.", severity: "MEDIUM" });
    if (!discoveryConfigured) baseWarnings.push({ code: "DISCOVERY_SOURCE_NOT_CONFIGURED", message: "No active discovery source is configured. Connect a marketplace source to run discovery.", severity: "MEDIUM" });
    if (status.subscriptionStatus === "PAST_DUE") baseWarnings.push({ code: "SUBSCRIPTION_PAST_DUE", message: "Billing is past due. Resolve payment to avoid an interruption in service.", severity: "HIGH" });
    for (const limit of limits) {
      if (limit.status === "NEAR_LIMIT") baseWarnings.push({ code: `${limit.key.toUpperCase()}_NEAR_LIMIT`, message: `Usage for ${limit.key} is approaching its ${limit.period.toLowerCase()} limit.`, severity: "LOW" });
    }

    return {
      featureEnabled: status.featureEnabled,
      discoveryFeatureEnabled: status.discoveryFeatureEnabled,
      planName: status.planName,
      subscriptionStatus: status.subscriptionStatus,
      tenantActive,
      whatsappConfigured,
      discoveryConfigured,
      limits,
      monthlyDiscoveryExceeded: discoveryMonthly.status === "EXCEEDED",
      dailyDiscoveryExceeded: discoveryDaily.status === "EXCEEDED",
      monthlyInvitationsExceeded: invitationMonthly.status === "EXCEEDED",
      dailyInvitationsExceeded: invitationDaily.status === "EXCEEDED",
      baseWarnings,
    };
  }

  private capabilitySnapshot(capability: AcquisitionGovernanceCapability, state: TenantGovernanceState): AcquisitionGovernanceCapabilitySnapshot {
    if (!state.featureEnabled) return { enabled: false, status: "BLOCKED", message: "Seller acquisition is not enabled for this workspace." };
    if (!state.tenantActive) return { enabled: false, status: "BLOCKED", message: "This workspace's subscription is not active." };

    if (capability === "DISCOVERY") {
      if (!state.discoveryFeatureEnabled) return { enabled: false, status: "BLOCKED", message: "Discovery requires a plan upgrade." };
      if (!state.discoveryConfigured) return { enabled: false, status: "BLOCKED", message: "Connect a discovery source to enable this capability." };
      if (state.monthlyDiscoveryExceeded) return { enabled: true, status: "BLOCKED", message: "Monthly discovery quota reached." };
      if (state.dailyDiscoveryExceeded) return { enabled: true, status: "DEGRADED", message: "Daily discovery limit reached; resumes tomorrow." };
      return { enabled: true, status: "AVAILABLE", message: null };
    }
    if (capability === "INVITATION") {
      if (!state.whatsappConfigured) return { enabled: false, status: "BLOCKED", message: "Connect WhatsApp to enable invitations." };
      if (state.monthlyInvitationsExceeded) return { enabled: true, status: "BLOCKED", message: "Monthly invitation quota reached." };
      if (state.dailyInvitationsExceeded) return { enabled: true, status: "DEGRADED", message: "Daily invitation limit reached; resumes tomorrow." };
      return { enabled: true, status: "AVAILABLE", message: null };
    }
    if (capability === "QUALIFICATION") {
      if (state.dailyDiscoveryExceeded || state.dailyInvitationsExceeded) return { enabled: true, status: "DEGRADED", message: "Running in degraded mode against previously captured data while the daily limit resets." };
      return { enabled: true, status: "AVAILABLE", message: null };
    }
    return { enabled: true, status: "AVAILABLE", message: null };
  }

  private overallStatus(state: TenantGovernanceState): AcquisitionGovernanceOverallStatus {
    if (!state.featureEnabled) return "DISABLED";
    if (!state.tenantActive) return "ACTION_REQUIRED";
    if (state.monthlyDiscoveryExceeded || state.monthlyInvitationsExceeded) return "ACTION_REQUIRED";
    if (!state.whatsappConfigured || !state.discoveryConfigured) return "ACTION_REQUIRED";
    if (state.dailyDiscoveryExceeded || state.dailyInvitationsExceeded) return "DEGRADED";
    if (state.baseWarnings.length > 0) return "DEGRADED";
    return "ACTIVE";
  }

  private async decide(
    scope: TenantScoped,
    data: z.output<typeof authorizationInputSchema>,
    state: TenantGovernanceState,
    now: Date,
    status: AcquisitionGovernanceDecisionStatus,
    reason: AcquisitionGovernanceDenialReason | null,
    message: string,
    warnings: readonly AcquisitionGovernanceWarning[],
  ): Promise<AcquisitionGovernanceDecision> {
    const auditEvent = this.buildAuditEvent(data.capability, status, reason, now);
    if (status !== "ALLOW" && this.deps.auditLogs !== undefined) {
      const auditInput: CreateAuditLogInput = {
        tenantId: scope.tenantId,
        action: auditEvent.action,
        targetType: "ACQUISITION_GOVERNANCE",
        targetId: data.campaignId,
        actorId: data.actorId,
        correlationId: `acquisition-governance:${scope.tenantId}:${data.capability}:${now.getTime()}`,
        metadata: { capability: data.capability, status, reason, source: data.source ?? null },
      };
      try {
        await this.deps.auditLogs.append(scope, auditInput);
      } catch {
        // Audit trail is best-effort; a logging failure must never block a governance decision.
      }
    }
    return { status, capability: data.capability, reason, message, limits: state.limits, warnings, auditEvent };
  }

  private buildAuditEvent(capability: AcquisitionGovernanceCapability, status: AcquisitionGovernanceDecisionStatus, reason: AcquisitionGovernanceDenialReason | null, now: Date): AcquisitionGovernanceAuditEvent {
    return {
      action: `ACQUISITION_GOVERNANCE_${status}`,
      capability,
      status,
      reason,
      recordedAt: now.toISOString(),
      persisted: status !== "ALLOW" && this.deps.auditLogs !== undefined,
    };
  }
}
