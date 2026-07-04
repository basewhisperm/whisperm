import { z } from "zod";

import type { ActivityRepository, AuditLogRepository, BusinessGrowthOpportunityRecord, BusinessGrowthOpportunityRepository, ContactRepository, DealsRepository, DraftInventoryRepository, MarketplaceCaptureRecord, MarketplaceCaptureRepository, MarketplaceClaimTokenRepository, PipelineRepository, PipelineStageRecord } from "@whisperm/repositories";
import { MARKETPLACE_ACQUISITION_PIPELINE_KEY, type PersistenceCorrelationMetadata, type TenantScoped } from "@whisperm/types";
import { recordUsageEventBestEffort, type AcquisitionUsageMeteringService } from "./acquisition-usage-metering.js";
import { BusinessGrowthOpportunityService } from "./business-growth-opportunity.js";
import type { RevenueAttributionTriggerPort } from "./revenue-attribution.js";

const idSchema = z.string().min(1);
const completedCaptureStatuses = new Set(["CLAIMED", "CONVERTED"]);
const terminalFailureCodes = new Set<CrmConversionFailureCode>(["CLAIM_NOT_COMPLETED", "SELLER_RECORD_NOT_FOUND", "CONTACT_DATA_INSUFFICIENT", "DUPLICATE_CONVERSION", "TENANT_ISOLATION_VIOLATION"]);

export const crmConversionJobType = "marketplace.crm.conversion.execute" as const;
export const crmConversionQueueName = "marketplace.crm.conversion" as const;

export type CrmConversionStatus = "NOT_READY" | "CONVERSION_READY" | "CONVERTING" | "CONVERTED" | "CONVERSION_FAILED" | "NEEDS_MANUAL_REVIEW" | "SKIPPED_ALREADY_CONVERTED";
export type CrmConversionFailureCode = "CLAIM_NOT_COMPLETED" | "SELLER_RECORD_NOT_FOUND" | "CONTACT_DATA_INSUFFICIENT" | "DUPLICATE_CONVERSION" | "CONTACT_CREATE_FAILED" | "DEAL_CREATE_FAILED" | "OPPORTUNITY_UPDATE_FAILED" | "TENANT_ISOLATION_VIOLATION" | "TRANSIENT_PERSISTENCE_FAILURE";

export interface CrmConversionContext { readonly tenantId: string; readonly actorId?: string | undefined; readonly correlation: PersistenceCorrelationMetadata; }
export interface CrmConversionJob { readonly tenantId: string; readonly claimTokenId: string; readonly marketplaceCaptureId: string; readonly jobType: typeof crmConversionJobType; readonly dedupeKey: string; readonly correlation: PersistenceCorrelationMetadata; }
export interface CrmConversionScheduler { schedule(job: CrmConversionJob): Promise<void>; }

export interface CrmConversionRuntimeDependencies {
  readonly marketplaceCaptures: MarketplaceCaptureRepository;
  readonly draftInventories: DraftInventoryRepository;
  readonly claimTokens: Pick<MarketplaceClaimTokenRepository, "listClaimTokensByMarketplaceCaptureId">;
  readonly contacts: ContactRepository;
  readonly pipelines: PipelineRepository;
  readonly deals: DealsRepository;
  readonly businessGrowthOpportunities: BusinessGrowthOpportunityRepository;
  readonly auditLogs: AuditLogRepository;
  readonly activities?: ActivityRepository | undefined;
  readonly scheduler?: CrmConversionScheduler | undefined;
  readonly revenueAttribution?: RevenueAttributionTriggerPort | undefined;
  /** CS-023: best-effort billable-usage recording; never blocks conversion on failure. */
  readonly usageMetering?: Pick<AcquisitionUsageMeteringService, "recordUsageEvent"> | undefined;
  readonly clock?: (() => Date) | undefined;
}

export interface CrmConversionResult {
  readonly status: CrmConversionStatus;
  readonly claimTokenId: string;
  readonly marketplaceCaptureId: string;
  readonly contactId?: string | undefined;
  readonly dealId?: string | undefined;
  readonly opportunityId?: string | undefined;
  readonly campaignId?: string | undefined;
  readonly idempotencyKey: string;
  readonly idempotent: boolean;
  readonly failureCode?: CrmConversionFailureCode | undefined;
  readonly failureMessage?: string | undefined;
}

export class CrmConversionRuntimeError extends Error {
  readonly code: CrmConversionFailureCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly correlation?: PersistenceCorrelationMetadata | undefined;
  constructor(input: { readonly code: CrmConversionFailureCode; readonly message: string; readonly status: number; readonly retryable?: boolean | undefined; readonly correlation?: PersistenceCorrelationMetadata | undefined }) {
    super(input.message);
    this.name = "CrmConversionRuntimeError";
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable ?? !terminalFailureCodes.has(input.code);
    this.correlation = input.correlation;
  }
}

const contextSchema = z.object({ tenantId: idSchema, actorId: idSchema.optional(), correlation: z.object({ correlationId: idSchema, requestId: idSchema.optional(), causationId: idSchema.optional() }).passthrough() }).strict();
const executeInputSchema = z.object({ tenantId: idSchema, claimTokenId: idSchema, marketplaceCaptureId: idSchema }).strict();
const defined = <T extends Readonly<Record<string, unknown>>>(input: T): Readonly<Record<string, unknown>> => Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
const stringMeta = (metadata: Readonly<Record<string, unknown>> | null | undefined, key: string): string | null => { const value = metadata?.[key]; return typeof value === "string" && value.trim().length > 0 ? value.trim() : null; };
const splitName = (name: string | null): { readonly firstName?: string; readonly lastName?: string } => {
  if (name === null) return {};
  const parts = name.trim().split(/\s+/u);
  const firstName = parts[0];
  const lastName = parts.slice(1).join(" ");
  return { ...(firstName === undefined ? {} : { firstName }), ...(lastName.length === 0 ? {} : { lastName }) };
};

export class CrmConversionRuntimeService {
  private readonly opportunities: BusinessGrowthOpportunityService;
  constructor(private readonly deps: CrmConversionRuntimeDependencies) { this.opportunities = new BusinessGrowthOpportunityService({ opportunities: deps.businessGrowthOpportunities }); }

  async enqueueForCompletedClaim(contextInput: CrmConversionContext, input: { readonly tenantId: string; readonly claimTokenId: string; readonly marketplaceCaptureId: string }): Promise<CrmConversionResult> {
    const context = contextSchema.parse(contextInput) as CrmConversionContext;
    const parsed = executeInputSchema.parse(input);
    if (context.tenantId !== parsed.tenantId) throw this.error(context, "TENANT_ISOLATION_VIOLATION", "CRM conversion enqueue tenant mismatch", 403);
    const scope = { tenantId: context.tenantId };
    const capture = await this.requireCapture(scope, parsed.marketplaceCaptureId, context);
    const readiness = await this.evaluateReadiness(scope, capture, parsed.claimTokenId, context);
    if (readiness.status !== "CONVERSION_READY" || this.deps.scheduler === undefined) return readiness;
    await this.deps.scheduler.schedule({ tenantId: context.tenantId, claimTokenId: parsed.claimTokenId, marketplaceCaptureId: capture.id, jobType: crmConversionJobType, dedupeKey: readiness.idempotencyKey, correlation: context.correlation });
    await this.record(scope, context, capture, { crmConversionStatus: "CONVERSION_READY", crmConversionReadyAt: this.nowIso(), crmConversionClaimTokenId: parsed.claimTokenId, crmConversionIdempotencyKey: readiness.idempotencyKey });
    return readiness;
  }

  async executeConversion(contextInput: CrmConversionContext, input: { readonly tenantId: string; readonly claimTokenId: string; readonly marketplaceCaptureId: string }): Promise<CrmConversionResult> {
    const context = contextSchema.parse(contextInput) as CrmConversionContext;
    const parsed = executeInputSchema.parse(input);
    if (context.tenantId !== parsed.tenantId) throw this.error(context, "TENANT_ISOLATION_VIOLATION", "CRM conversion execution tenant mismatch", 403);
    const scope = { tenantId: context.tenantId };
    const capture = await this.requireCapture(scope, parsed.marketplaceCaptureId, context);
    const ready = await this.evaluateReadiness(scope, capture, parsed.claimTokenId, context);
    if (ready.status === "CONVERTED" || ready.status === "SKIPPED_ALREADY_CONVERTED") return ready;
    if (ready.status !== "CONVERSION_READY") return ready;
    await this.record(scope, context, capture, { crmConversionStatus: "CONVERTING", crmConversionStartedAt: this.nowIso(), crmConversionClaimTokenId: parsed.claimTokenId, crmConversionIdempotencyKey: ready.idempotencyKey });
    try {
      const contactId = await this.createOrLinkContact(scope, capture);
      const opportunity = await this.ensureOpportunity(scope, { ...capture, contactId });
      const dealId = await this.createOrLinkDeal(scope, { ...capture, contactId }, opportunity);
      await this.deps.businessGrowthOpportunities.linkContact(scope, opportunity.id, contactId);
      await this.deps.businessGrowthOpportunities.linkDeal(scope, opportunity.id, dealId);
      await this.deps.businessGrowthOpportunities.updateConversionStatus?.(scope, opportunity.id, "CONVERTED");
      await this.record(scope, context, capture, { status: "CONVERTED", contactId, dealId, crmConversionStatus: "CONVERTED", crmConversionCompletedAt: this.nowIso(), crmConversionOpportunityId: opportunity.id, crmConversionContactId: contactId, crmConversionDealId: dealId });
      if (this.deps.usageMetering !== undefined) {
        await recordUsageEventBestEffort(this.deps.usageMetering, scope, {
          eventType: "CRM_CONVERSION_CREATED",
          campaignId: opportunity.campaignId ?? undefined,
          captureId: capture.id,
          contactId,
          dealId,
          idempotencyKey: `usage:CRM_CONVERSION_CREATED:${ready.idempotencyKey}`,
        });
      }
      await this.deps.revenueAttribution?.evaluateForDeal(context, { tenantId: scope.tenantId, dealId });
      await this.audit(scope, context, "MARKETPLACE_CRM_CONVERSION_COMPLETED", capture.id, { claimTokenId: parsed.claimTokenId, contactId, dealId, opportunityId: opportunity.id, idempotencyKey: ready.idempotencyKey });
      await this.activity(context, contactId, dealId, "Marketplace seller converted to CRM", { eventType: "MARKETPLACE_CRM_CONVERSION_COMPLETED", marketplaceCaptureId: capture.id, claimTokenId: parsed.claimTokenId, contactId, dealId, opportunityId: opportunity.id });
      return { status: "CONVERTED", claimTokenId: parsed.claimTokenId, marketplaceCaptureId: capture.id, contactId, dealId, opportunityId: opportunity.id, ...(opportunity.campaignId == null ? {} : { campaignId: opportunity.campaignId }), idempotencyKey: ready.idempotencyKey, idempotent: false };
    } catch (cause) {
      const mapped = cause instanceof CrmConversionRuntimeError ? cause : this.error(context, "TRANSIENT_PERSISTENCE_FAILURE", cause instanceof Error ? cause.message : "CRM conversion failed", 503, true);
      await this.record(scope, context, capture, { crmConversionStatus: mapped.retryable ? "CONVERSION_FAILED" : "NEEDS_MANUAL_REVIEW", crmConversionFailedAt: this.nowIso(), crmConversionFailureCode: mapped.code, crmConversionFailureMessage: mapped.message });
      await this.audit(scope, context, "MARKETPLACE_CRM_CONVERSION_FAILED", capture.id, { claimTokenId: parsed.claimTokenId, failureCode: mapped.code, retryable: mapped.retryable });
      throw mapped;
    }
  }

  private async evaluateReadiness(scope: TenantScoped, capture: MarketplaceCaptureRecord, claimTokenId: string, context: CrmConversionContext): Promise<CrmConversionResult> {
    const idempotencyKey = `marketplace-crm-conversion:${scope.tenantId}:${claimTokenId}:${capture.id}`;
    if (capture.tenantId !== scope.tenantId) throw this.error(context, "TENANT_ISOLATION_VIOLATION", "Capture tenant mismatch", 403);
    if (capture.status === "CONVERTED" && capture.contactId != null && capture.dealId != null) return { status: "SKIPPED_ALREADY_CONVERTED", claimTokenId, marketplaceCaptureId: capture.id, contactId: capture.contactId, dealId: capture.dealId, idempotencyKey, idempotent: true };
    if (!completedCaptureStatuses.has(capture.status)) return this.notReady(context, capture, claimTokenId, idempotencyKey, "CLAIM_NOT_COMPLETED", "Seller claim is not completed");
    const draft = await this.deps.draftInventories.findByMarketplaceCaptureId(scope, capture.id);
    if (draft === null) return this.notReady(context, capture, claimTokenId, idempotencyKey, "SELLER_RECORD_NOT_FOUND", "Seller acquisition record or draft inventory was not found");
    if (this.contactData(capture).phone === null && this.contactData(capture).email === null) return this.notReady(context, capture, claimTokenId, idempotencyKey, "CONTACT_DATA_INSUFFICIENT", "Seller contact data is insufficient");
    if (capture.contactId != null && capture.dealId != null) return { status: "CONVERTED", claimTokenId, marketplaceCaptureId: capture.id, contactId: capture.contactId, dealId: capture.dealId, idempotencyKey, idempotent: true };
    return { status: "CONVERSION_READY", claimTokenId, marketplaceCaptureId: capture.id, idempotencyKey, idempotent: false };
  }

  private async createOrLinkContact(scope: TenantScoped, capture: MarketplaceCaptureRecord): Promise<string> {
    if (capture.contactId != null) return capture.contactId;
    const data = this.contactData(capture);
    const byPhone = data.phone === null ? null : await this.deps.contacts.findByPhone(scope, data.phone);
    const byEmail = byPhone === null && data.email !== null ? (await this.deps.contacts.findByEmails(scope, [data.email]))[0] ?? null : null;
    const existing = byPhone ?? byEmail;
    const contact = existing ?? await this.deps.contacts.create(scope, { tenantId: scope.tenantId, email: data.email ?? undefined, phone: data.phone ?? undefined, ...splitName(capture.sellerName ?? data.name), stage: "PROSPECT", metadata: { source: "MARKETPLACE_ACQUISITION", marketplaceCaptureId: capture.id, marketplaceIdentity: capture.externalId ?? capture.marketplaceSourceId ?? null } });
    await this.deps.marketplaceCaptures.update(scope, capture.id, { contactId: contact.id, metadata: { ...(capture.metadata ?? {}), crmConversionContactId: contact.id } });
    return contact.id;
  }

  private async createOrLinkDeal(scope: TenantScoped, capture: MarketplaceCaptureRecord, opportunity: BusinessGrowthOpportunityRecord): Promise<string> {
    if (capture.dealId != null) return capture.dealId;
    const externalId = `marketplace-acquisition:${scope.tenantId}:${capture.id}`;
    const existing = await this.deps.deals.findByExternalId(scope.tenantId, externalId);
    if (existing !== null) { await this.deps.marketplaceCaptures.update(scope, capture.id, { dealId: existing.id }); return existing.id; }
    const pipeline = await this.deps.pipelines.findByDefaultKey(scope.tenantId, MARKETPLACE_ACQUISITION_PIPELINE_KEY) ?? await this.deps.pipelines.findByWorkspace(scope.tenantId);
    const stage = pipeline?.stages.find((item: PipelineStageRecord) => item.name === "Claimed") ?? pipeline?.stages[0];
    if (stage === undefined) throw new CrmConversionRuntimeError({ code: "DEAL_CREATE_FAILED", message: "Default pipeline stage was not found", status: 409, retryable: false });
    const dealInput = defined({ tenantId: scope.tenantId, contactId: capture.contactId ?? undefined, externalId, title: capture.title, value: capture.price ?? undefined, currency: capture.currency ?? undefined, pipelineStageId: stage.id, metadata: { source: "MARKETPLACE_ACQUISITION", marketplaceCaptureId: capture.id, opportunityId: opportunity.id, listingUrl: capture.listingUrl } });
    const deal = await this.deps.deals.create(scope.tenantId, dealInput as Parameters<DealsRepository["create"]>[1]);
    await this.deps.marketplaceCaptures.update(scope, capture.id, { dealId: deal.id });
    return deal.id;
  }

  private async ensureOpportunity(scope: TenantScoped, capture: MarketplaceCaptureRecord): Promise<BusinessGrowthOpportunityRecord> { return this.opportunities.createFromMarketplaceCapture(scope, capture); }
  private contactData(capture: MarketplaceCaptureRecord): { readonly name: string | null; readonly phone: string | null; readonly email: string | null } { return { name: capture.sellerName ?? null, phone: stringMeta(capture.metadata, "sellerPhone") ?? stringMeta(capture.metadata, "phone"), email: stringMeta(capture.metadata, "sellerEmail") ?? stringMeta(capture.metadata, "email") }; }
  private async requireCapture(scope: TenantScoped, captureId: string, context: CrmConversionContext): Promise<MarketplaceCaptureRecord> { const capture = await this.deps.marketplaceCaptures.findById(scope, captureId); if (capture === null) throw this.error(context, "SELLER_RECORD_NOT_FOUND", "Marketplace capture was not found", 404, false); return capture; }
  private notReady(context: CrmConversionContext, capture: MarketplaceCaptureRecord, claimTokenId: string, idempotencyKey: string, code: CrmConversionFailureCode, message: string): CrmConversionResult { return { status: code === "CLAIM_NOT_COMPLETED" ? "NOT_READY" : "NEEDS_MANUAL_REVIEW", claimTokenId, marketplaceCaptureId: capture.id, idempotencyKey, idempotent: true, failureCode: code, failureMessage: message }; }
  private async record(scope: TenantScoped, context: CrmConversionContext, capture: MarketplaceCaptureRecord, metadata: Readonly<Record<string, unknown>>): Promise<void> { const update = defined({ status: typeof metadata.status === "string" ? metadata.status : undefined, contactId: typeof metadata.contactId === "string" ? metadata.contactId : undefined, dealId: typeof metadata.dealId === "string" ? metadata.dealId : undefined, metadata: { ...(capture.metadata ?? {}), ...metadata } });
    await this.deps.marketplaceCaptures.update(scope, capture.id, update); }
  private async audit(scope: TenantScoped, context: CrmConversionContext, action: string, targetId: string, metadata: Readonly<Record<string, unknown>>): Promise<void> { await this.deps.auditLogs.append(scope, { tenantId: scope.tenantId, action, targetType: "MARKETPLACE_CRM_CONVERSION", targetId, correlationId: context.correlation.correlationId, requestId: context.correlation.requestId, metadata }); }
  private async activity(context: CrmConversionContext, contactId: string, dealId: string, note: string, metadata: Readonly<Record<string, unknown>>): Promise<void> { if (this.deps.activities === undefined || context.actorId === undefined) return; await this.deps.activities.create(context, { tenantId: context.tenantId, contactId, dealId, createdById: context.actorId, type: "NOTE", note, occurredAt: this.nowIso(), metadata }); }
  private nowIso(): string { return (this.deps.clock?.() ?? new Date()).toISOString(); }
  private error(context: CrmConversionContext, code: CrmConversionFailureCode, message: string, status: number, retryable?: boolean): CrmConversionRuntimeError { return new CrmConversionRuntimeError({ code, message, status, retryable, correlation: context.correlation }); }
}
