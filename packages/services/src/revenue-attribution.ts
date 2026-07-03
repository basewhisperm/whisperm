import { z } from "zod";

import type {
  BusinessGrowthOpportunityRecord,
  BusinessGrowthOpportunityRepository,
  CampaignRuntimeExecutionRepository,
  DealRecord,
  DealsRepository,
  MarketplaceCaptureRecord,
  MarketplaceCaptureRepository,
  MarketplaceClaimTokenRepository,
  MarketplaceDiscoveryRepository,
  SellerInvitationRepository,
} from "@whisperm/repositories";
import type { PersistenceCorrelationMetadata } from "@whisperm/types";

const idSchema = z.string().min(1);

export const revenueAttributionJobType = "marketplace.revenue.attribution.evaluate" as const;
export const revenueAttributionQueueName = "marketplace.revenue.attribution" as const;

export type AttributionCompleteness = "COMPLETE" | "PARTIAL" | "FAILED";
export type RevenueAttributionStatus = "NOT_ELIGIBLE" | "ATTRIBUTION_READY" | "ATTRIBUTED" | "ATTRIBUTION_FAILED";
export type RevenueAttributionFailureCode = "DEAL_NOT_FOUND" | "TENANT_ISOLATION_VIOLATION" | "TRANSIENT_PERSISTENCE_FAILURE";

const terminalFailureCodes = new Set<RevenueAttributionFailureCode>(["DEAL_NOT_FOUND", "TENANT_ISOLATION_VIOLATION"]);

/**
 * The "core" acquisition-chain links a deterministic attribution can never be
 * COMPLETE without. Missing anything else (invitation/claim/discovery run/etc.)
 * still yields a usable PARTIAL snapshot rather than a failure.
 */
const coreLinkKeys = new Set(["CONTACT", "OPPORTUNITY", "MARKETPLACE_CAPTURE", "CAMPAIGN"]);

export interface RevenueAttributionSnapshot {
  readonly attributionStatus: RevenueAttributionStatus;
  readonly attributedAt?: string | undefined;
  readonly evaluatedAt: string;
  readonly revenueAmount?: string | undefined;
  readonly revenueCurrency?: string | undefined;
  readonly dealId: string;
  readonly contactId?: string | undefined;
  readonly opportunityId?: string | undefined;
  readonly captureId?: string | undefined;
  readonly sellerAcquisitionRecordId?: string | undefined;
  readonly claimId?: string | undefined;
  readonly invitationId?: string | undefined;
  readonly discoveryRunId?: string | undefined;
  readonly campaignId?: string | undefined;
  readonly campaignRuntimeExecutionId?: string | undefined;
  readonly providerKey?: string | undefined;
  readonly marketplaceSource?: string | undefined;
  readonly targetingSnapshot?: unknown;
  readonly qualificationScore?: string | undefined;
  readonly qualificationStatus?: string | undefined;
  readonly conversionExecutionId?: string | undefined;
  readonly attributionCompleteness: AttributionCompleteness;
  readonly missingLinks: readonly string[];
  readonly failureCode?: RevenueAttributionFailureCode | undefined;
  readonly failureMessage?: string | undefined;
  readonly recomputeCount: number;
  readonly lastRecomputedAt?: string | undefined;
  readonly idempotencyKey: string;
}

export interface RevenueAttributionResult {
  readonly status: RevenueAttributionStatus;
  readonly dealId: string;
  readonly snapshot?: RevenueAttributionSnapshot | undefined;
  readonly idempotent: boolean;
}

export interface RevenueAttributionContext {
  readonly tenantId: string;
  readonly actorId?: string | undefined;
  readonly correlation: PersistenceCorrelationMetadata;
}

export interface RevenueAttributionJob {
  readonly tenantId: string;
  readonly dealId: string;
  readonly jobType: typeof revenueAttributionJobType;
  readonly dedupeKey: string;
  readonly correlation: PersistenceCorrelationMetadata;
}

export interface RevenueAttributionScheduler {
  schedule(job: RevenueAttributionJob): Promise<void>;
}

/** Minimal port DealService/CrmConversionRuntimeService depend on to trigger evaluation without importing the concrete runtime. */
export interface RevenueAttributionTriggerPort {
  evaluateForDeal(context: RevenueAttributionContext, input: { readonly tenantId: string; readonly dealId: string }): Promise<RevenueAttributionResult>;
}

export interface RevenueAttributionRuntimeDependencies {
  readonly deals: Pick<DealsRepository, "findById" | "update">;
  readonly businessGrowthOpportunities: BusinessGrowthOpportunityRepository;
  readonly marketplaceCaptures?: Pick<MarketplaceCaptureRepository, "findByDealId" | "findById"> | undefined;
  readonly campaignRuntimeExecutions?: Pick<CampaignRuntimeExecutionRepository, "listByCampaignId"> | undefined;
  readonly marketplaceDiscovery?: Pick<MarketplaceDiscoveryRepository, "findDiscoveredSellerById"> | undefined;
  readonly sellerInvitations?: Pick<SellerInvitationRepository, "listSellerInvitationsByMarketplaceCaptureId"> | undefined;
  readonly claimTokens?: Pick<MarketplaceClaimTokenRepository, "listClaimTokensByMarketplaceCaptureId"> | undefined;
  readonly scheduler?: RevenueAttributionScheduler | undefined;
  readonly clock?: (() => Date) | undefined;
}

export class RevenueAttributionRuntimeError extends Error {
  readonly code: RevenueAttributionFailureCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly correlation?: PersistenceCorrelationMetadata | undefined;
  constructor(input: { readonly code: RevenueAttributionFailureCode; readonly message: string; readonly status: number; readonly retryable?: boolean | undefined; readonly correlation?: PersistenceCorrelationMetadata | undefined }) {
    super(input.message);
    this.name = "RevenueAttributionRuntimeError";
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable ?? !terminalFailureCodes.has(input.code);
    this.correlation = input.correlation;
  }
}

const contextSchema = z.object({ tenantId: idSchema, actorId: idSchema.optional(), correlation: z.object({ correlationId: idSchema, requestId: idSchema.optional(), causationId: idSchema.optional() }).passthrough() }).strict();
const evaluateInputSchema = z.object({ tenantId: idSchema, dealId: idSchema }).strict();
const computeInputSchema = z.object({ tenantId: idSchema, dealId: idSchema, force: z.boolean().optional() }).strict();

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);
const textValue = (value: unknown): string | undefined => typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

interface ResolvedAttribution {
  readonly contactId?: string | undefined;
  readonly opportunity?: BusinessGrowthOpportunityRecord | undefined;
  readonly capture?: MarketplaceCaptureRecord | undefined;
  readonly campaignId?: string | undefined;
  readonly campaignRuntimeExecutionId?: string | undefined;
  readonly targetingSnapshot?: unknown;
  readonly providerKey?: string | undefined;
  readonly marketplaceSource?: string | undefined;
  readonly discoveryRunId?: string | undefined;
  readonly invitationId?: string | undefined;
  readonly claimId?: string | undefined;
  readonly conversionExecutionId?: string | undefined;
  readonly missingLinks: readonly string[];
}

export class RevenueAttributionRuntimeService {
  constructor(private readonly deps: RevenueAttributionRuntimeDependencies) {}

  async evaluateForDeal(contextInput: RevenueAttributionContext, input: { readonly tenantId: string; readonly dealId: string }): Promise<RevenueAttributionResult> {
    const context = this.parseContext(contextInput);
    const parsed = evaluateInputSchema.parse(input);
    if (context.tenantId !== parsed.tenantId) throw this.error(context, "TENANT_ISOLATION_VIOLATION", "Revenue attribution evaluate tenant mismatch", 403);
    const deal = await this.requireDeal(context, parsed.dealId);
    if (!this.isRevenueEligible(deal)) return { status: "NOT_ELIGIBLE", dealId: deal.id, idempotent: true };

    const idempotencyKey = this.idempotencyKeyFor(deal);
    const existing = this.readSnapshot(deal);
    if (existing !== undefined && existing.idempotencyKey === idempotencyKey) {
      return { status: existing.attributionStatus, dealId: deal.id, snapshot: existing, idempotent: true };
    }

    if (this.deps.scheduler !== undefined) {
      await this.deps.scheduler.schedule({ tenantId: context.tenantId, dealId: deal.id, jobType: revenueAttributionJobType, dedupeKey: idempotencyKey, correlation: context.correlation });
      return { status: "ATTRIBUTION_READY", dealId: deal.id, idempotent: false };
    }

    return this.computeAttribution(context, { tenantId: context.tenantId, dealId: deal.id });
  }

  async computeAttribution(contextInput: RevenueAttributionContext, input: { readonly tenantId: string; readonly dealId: string; readonly force?: boolean | undefined }): Promise<RevenueAttributionResult> {
    const context = this.parseContext(contextInput);
    const parsed = computeInputSchema.parse(input);
    if (context.tenantId !== parsed.tenantId) throw this.error(context, "TENANT_ISOLATION_VIOLATION", "Revenue attribution execution tenant mismatch", 403);
    const deal = await this.requireDeal(context, parsed.dealId);
    if (!this.isRevenueEligible(deal)) return { status: "NOT_ELIGIBLE", dealId: deal.id, idempotent: true };

    const idempotencyKey = this.idempotencyKeyFor(deal);
    const existing = this.readSnapshot(deal);
    if (!input.force && existing !== undefined && existing.idempotencyKey === idempotencyKey) {
      return { status: existing.attributionStatus, dealId: deal.id, snapshot: existing, idempotent: true };
    }

    try {
      const resolution = await this.resolve(context, deal);
      const completeness: AttributionCompleteness = resolution.missingLinks.some((link) => coreLinkKeys.has(link)) ? "PARTIAL" : "COMPLETE";
      const now = this.nowIso();
      const snapshot: RevenueAttributionSnapshot = {
        attributionStatus: "ATTRIBUTED",
        attributedAt: now,
        evaluatedAt: now,
        revenueAmount: deal.value === null || deal.value === undefined ? undefined : String(deal.value),
        revenueCurrency: deal.currency,
        dealId: deal.id,
        contactId: resolution.contactId,
        opportunityId: resolution.opportunity?.id,
        captureId: resolution.capture?.id,
        sellerAcquisitionRecordId: resolution.capture?.id,
        claimId: resolution.claimId,
        invitationId: resolution.invitationId,
        discoveryRunId: resolution.discoveryRunId,
        campaignId: resolution.campaignId,
        campaignRuntimeExecutionId: resolution.campaignRuntimeExecutionId,
        providerKey: resolution.providerKey,
        marketplaceSource: resolution.marketplaceSource,
        targetingSnapshot: resolution.targetingSnapshot,
        qualificationScore: resolution.opportunity?.qualificationScore === undefined || resolution.opportunity?.qualificationScore === null ? undefined : String(resolution.opportunity.qualificationScore),
        qualificationStatus: resolution.opportunity?.qualificationStatus ?? undefined,
        conversionExecutionId: resolution.conversionExecutionId,
        attributionCompleteness: completeness,
        missingLinks: resolution.missingLinks,
        recomputeCount: existing === undefined ? 0 : existing.recomputeCount + 1,
        lastRecomputedAt: existing === undefined ? undefined : now,
        idempotencyKey,
      };
      await this.persist(context, deal, snapshot);
      return { status: snapshot.attributionStatus, dealId: deal.id, snapshot, idempotent: false };
    } catch (cause) {
      if (cause instanceof RevenueAttributionRuntimeError) throw cause;
      throw this.error(context, "TRANSIENT_PERSISTENCE_FAILURE", cause instanceof Error ? cause.message : "Revenue attribution evaluation failed", 503, true);
    }
  }

  async recompute(contextInput: RevenueAttributionContext, input: { readonly tenantId: string; readonly dealId: string }): Promise<RevenueAttributionResult> {
    return this.computeAttribution(contextInput, { ...input, force: true });
  }

  async getAttributionState(contextInput: RevenueAttributionContext, input: { readonly tenantId: string; readonly dealId: string }): Promise<RevenueAttributionSnapshot | null> {
    const context = this.parseContext(contextInput);
    const parsed = evaluateInputSchema.parse(input);
    if (context.tenantId !== parsed.tenantId) throw this.error(context, "TENANT_ISOLATION_VIOLATION", "Revenue attribution read tenant mismatch", 403);
    const deal = await this.requireDeal(context, parsed.dealId);
    return this.readSnapshot(deal) ?? null;
  }

  private async resolve(context: RevenueAttributionContext, deal: DealRecord): Promise<ResolvedAttribution> {
    const missingLinks: string[] = [];
    const contactId = deal.contactId ?? undefined;
    if (contactId === undefined) missingLinks.push("CONTACT");

    let opportunity = await this.deps.businessGrowthOpportunities.findByDealId({ tenantId: context.tenantId }, deal.id);
    let capture: MarketplaceCaptureRecord | null = null;

    if (opportunity?.marketplaceCaptureId != null) {
      capture = (await this.deps.marketplaceCaptures?.findById({ tenantId: context.tenantId }, opportunity.marketplaceCaptureId)) ?? null;
    }
    if (capture === null) {
      capture = (await this.deps.marketplaceCaptures?.findByDealId({ tenantId: context.tenantId }, deal.id)) ?? null;
    }
    if (opportunity === null && capture !== null) {
      opportunity = await this.deps.businessGrowthOpportunities.findByMarketplaceCaptureId({ tenantId: context.tenantId }, capture.id);
    }
    if (opportunity === null) missingLinks.push("OPPORTUNITY");
    if (capture === null) missingLinks.push("MARKETPLACE_CAPTURE");

    const manualMetadata = isRecord(deal.metadata) ? deal.metadata : {};
    const campaignId = opportunity?.campaignId ?? textValue(manualMetadata.campaignId);
    if (campaignId === undefined) missingLinks.push("CAMPAIGN");

    let discoveryRunId: string | undefined;
    if (opportunity?.discoveredSellerId != null) {
      const seller = await this.deps.marketplaceDiscovery?.findDiscoveredSellerById({ tenantId: context.tenantId }, opportunity.discoveredSellerId);
      discoveryRunId = seller?.discoveryRunId;
    }
    if (discoveryRunId === undefined) missingLinks.push("DISCOVERY_RUN");

    let invitationId: string | undefined;
    let claimId: string | undefined;
    if (capture !== null) {
      const invitations = await this.deps.sellerInvitations?.listSellerInvitationsByMarketplaceCaptureId({ tenantId: context.tenantId }, capture.id) ?? [];
      invitationId = invitations[0]?.id;
      const claims = await this.deps.claimTokens?.listClaimTokensByMarketplaceCaptureId({ tenantId: context.tenantId }, capture.id) ?? [];
      claimId = claims[0]?.id;
    }
    if (invitationId === undefined) missingLinks.push("INVITATION");
    if (claimId === undefined) missingLinks.push("CLAIM");

    let campaignRuntimeExecutionId: string | undefined;
    let targetingSnapshot: unknown;
    let providerKey: string | undefined;
    if (campaignId !== undefined) {
      const executions = await this.deps.campaignRuntimeExecutions?.listByCampaignId({ tenantId: context.tenantId }, campaignId, { limit: 1 });
      const latest = executions?.items[0];
      campaignRuntimeExecutionId = latest?.id;
      const metrics = isRecord(latest?.metrics) ? latest.metrics : {};
      targetingSnapshot = metrics.targetingSnapshot;
      providerKey = textValue(isRecord(targetingSnapshot) ? targetingSnapshot.marketplaceSourceKey : undefined);
    }
    if (campaignRuntimeExecutionId === undefined) missingLinks.push("CAMPAIGN_RUNTIME_EXECUTION");

    const captureMetadata = isRecord(capture?.metadata) ? capture.metadata : {};
    const marketplaceSource = textValue(captureMetadata.marketplace) ?? textValue(captureMetadata.sourceMarketplace) ?? capture?.marketplaceSourceId ?? undefined;
    const conversionExecutionId = textValue(captureMetadata.crmConversionIdempotencyKey);

    return {
      contactId,
      opportunity: opportunity ?? undefined,
      capture: capture ?? undefined,
      campaignId,
      campaignRuntimeExecutionId,
      targetingSnapshot,
      providerKey: providerKey ?? marketplaceSource,
      marketplaceSource,
      discoveryRunId,
      invitationId,
      claimId,
      conversionExecutionId,
      missingLinks,
    };
  }

  private async persist(context: RevenueAttributionContext, deal: DealRecord, snapshot: RevenueAttributionSnapshot): Promise<void> {
    await this.deps.deals.update(context.tenantId, deal.id, {
      metadata: { ...(deal.metadata ?? {}), revenueAttribution: snapshot },
      expectedUpdatedAt: deal.updatedAt,
    });
    if (snapshot.opportunityId !== undefined) {
      await this.deps.businessGrowthOpportunities.recordRevenueAttribution({ tenantId: context.tenantId }, snapshot.opportunityId, {
        attributedAt: snapshot.attributedAt ?? snapshot.evaluatedAt,
        revenueAmount: snapshot.revenueAmount,
        revenueCurrency: snapshot.revenueCurrency,
        completeness: snapshot.attributionCompleteness,
        missingLinks: snapshot.missingLinks,
      });
    }
  }

  private isRevenueEligible(deal: DealRecord): boolean {
    return deal.closedAt != null || deal.value != null;
  }

  /**
   * Keyed on the revenue-relevant fields only (not deal.updatedAt): persisting
   * the attribution snapshot itself writes to deal.metadata, which would bump
   * updatedAt and defeat idempotency detection on the very next read.
   */
  private idempotencyKeyFor(deal: DealRecord): string {
    return `${revenueAttributionJobType}:${deal.tenantId}:${deal.id}:${String(deal.value)}:${deal.currency}:${String(deal.closedAt)}`;
  }

  private readSnapshot(deal: DealRecord): RevenueAttributionSnapshot | undefined {
    const metadata = isRecord(deal.metadata) ? deal.metadata : {};
    const snapshot = metadata.revenueAttribution;
    return isRecord(snapshot) && typeof snapshot.idempotencyKey === "string" ? snapshot as unknown as RevenueAttributionSnapshot : undefined;
  }

  private async requireDeal(context: RevenueAttributionContext, dealId: string): Promise<DealRecord> {
    const deal = await this.deps.deals.findById(context.tenantId, dealId);
    if (deal === null) throw this.error(context, "DEAL_NOT_FOUND", "Deal was not found", 404, false);
    return deal;
  }

  private parseContext(contextInput: RevenueAttributionContext): RevenueAttributionContext {
    return contextSchema.parse(contextInput) as RevenueAttributionContext;
  }

  private nowIso(): string {
    return (this.deps.clock?.() ?? new Date()).toISOString();
  }

  private error(context: RevenueAttributionContext, code: RevenueAttributionFailureCode, message: string, status: number, retryable?: boolean): RevenueAttributionRuntimeError {
    return new RevenueAttributionRuntimeError({ code, message, status, retryable, correlation: context.correlation });
  }
}
