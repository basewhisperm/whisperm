import type { CreateRenderSellerInput, RenderSellerConnector } from "@whisperm/provider-adapters";
import type { AuditLogRepository, ContactRepository, DraftInventoryRepository, MarketplaceCaptureRecord, MarketplaceCaptureRepository, MarketplaceOwnershipAttestationRepository, RenderConversionRepository } from "@whisperm/repositories";
import type { PersistenceCorrelationMetadata, TenantScoped } from "@whisperm/types";

export interface RenderSellerConversionContext { readonly tenantId: string; readonly actorId?: string | undefined; readonly correlation: PersistenceCorrelationMetadata; }

type RenderSellerConversionErrorCode = "SERVICE_VALIDATION_FAILED" | "SERVICE_TENANT_MISMATCH" | "SERVICE_NOT_FOUND" | "SERVICE_INVALID_STATE_TRANSITION" | "SERVICE_REPOSITORY_FAILED";
export class RenderSellerConversionError extends Error { readonly code: RenderSellerConversionErrorCode; readonly status: number; readonly details?: Readonly<Record<string, unknown>> | undefined; readonly correlation?: PersistenceCorrelationMetadata | undefined; override readonly cause?: unknown; constructor(input: { readonly code: RenderSellerConversionErrorCode; readonly message: string; readonly status: number; readonly details?: Readonly<Record<string, unknown>> | undefined; readonly correlation?: PersistenceCorrelationMetadata | undefined; readonly cause?: unknown }) { super(input.message); this.name = "RenderSellerConversionError"; this.code = input.code; this.status = input.status; this.details = input.details; this.correlation = input.correlation; this.cause = input.cause; } }

export interface RenderSellerConversionDependencies {
  readonly marketplaceCaptures: MarketplaceCaptureRepository;
  readonly draftInventories: DraftInventoryRepository;
  readonly ownershipAttestations: MarketplaceOwnershipAttestationRepository;
  readonly renderConversions: RenderConversionRepository;
  readonly contacts: ContactRepository;
  readonly auditLogs: AuditLogRepository;
  readonly connector: RenderSellerConnector;
  readonly clock?: (() => Date) | undefined;
}

export interface RenderSellerConversionResult {
  readonly captureId: string;
  readonly contactId: string;
  readonly attestationId: string;
  readonly renderSellerId: string;
  readonly conversionStatus: "SUCCESS";
  readonly conversionId: string;
  readonly idempotent: boolean;
}

const stringMeta = (metadata: Readonly<Record<string, unknown>> | null | undefined, key: string): string | null => { const value = metadata?.[key]; return typeof value === "string" && value.trim().length > 0 ? value : null; };
const claimedStatuses = new Set(["CLAIMED"]);

export class RenderSellerConversionService {
  constructor(private readonly deps: RenderSellerConversionDependencies) {}

  async convertClaimedSellerToRender(context: RenderSellerConversionContext, input: { readonly tenantId: string; readonly marketplaceCaptureId: string }): Promise<RenderSellerConversionResult> {
    if (context.tenantId !== input.tenantId) throw this.error(context.correlation, "SERVICE_TENANT_MISMATCH", "Conversion tenant does not match request tenant", 403);
    const scope = { tenantId: context.tenantId };
    const capture = await this.requireCapture(scope, input.marketplaceCaptureId, context.correlation);
    if (!claimedStatuses.has(capture.status)) throw this.error(context.correlation, "SERVICE_INVALID_STATE_TRANSITION", "Only claimed marketplace captures can be converted to Render sellers", capture.status === "EXPIRED" ? 410 : 422, { status: capture.status });

    const draft = await this.deps.draftInventories.findByMarketplaceCaptureId(scope, capture.id);
    if (draft === null) throw this.error(context.correlation, "SERVICE_NOT_FOUND", "Draft inventory is required before seller conversion", 404);
    if (draft.status !== "CLAIMED" && capture.status !== "CLAIMED") throw this.error(context.correlation, "SERVICE_INVALID_STATE_TRANSITION", "Draft inventory must be claimed before seller conversion", 422, { draftInventoryStatus: draft.status });

    const attestation = await this.deps.ownershipAttestations.findByMarketplaceCaptureId(scope, capture.id);
    if (attestation === null) throw this.error(context.correlation, "SERVICE_NOT_FOUND", "Ownership attestation is required before seller conversion", 404);

    const contactId = capture.contactId ?? draft.contactId ?? attestation.contactId;
    if (contactId === null || contactId === undefined) throw this.error(context.correlation, "SERVICE_NOT_FOUND", "Claimed capture must be linked to a contact before seller conversion", 404);
    const contact = await this.deps.contacts.findById(scope, contactId);
    if (contact === null) throw this.error(context.correlation, "SERVICE_NOT_FOUND", "Seller contact was not found for this tenant", 404);

    const existing = await this.deps.renderConversions.findSuccessfulSellerConversion(scope, capture.id, contactId);
    if (existing?.renderSellerId != null) return { captureId: capture.id, contactId, attestationId: attestation.id, renderSellerId: existing.renderSellerId, conversionStatus: "SUCCESS", conversionId: existing.id, idempotent: true };

    const startedAt = this.now().toISOString();
    const conversion = await this.deps.renderConversions.create(scope, { tenantId: scope.tenantId, marketplaceCaptureId: capture.id, sellerVerificationId: attestation.id, contactId, dealId: capture.dealId ?? draft.dealId, status: "PROCESSING", conversionKind: "SELLER", startedAt, metadata: { source: "MARKETPLACE_CAPTURE" } });
    await this.audit(scope, context.correlation, "RENDER_SELLER_CONVERSION_STARTED", conversion.id, { marketplaceCaptureId: capture.id, contactId, attestationId: attestation.id, conversionId: conversion.id });

    try {
      const payload = this.buildPayload(capture, contact, contactId);
      const providerResult = await this.deps.connector.createRenderSeller({ ...payload, idempotencyKey: `render-seller:${scope.tenantId}:${capture.id}:${contactId}` });
      const completedAt = this.now().toISOString();
      const updated = await this.deps.renderConversions.update(scope, conversion.id, { status: "SUCCESS", renderSellerId: providerResult.renderSellerId, completedAt, convertedAt: completedAt, metadata: { source: "MARKETPLACE_CAPTURE", providerStatus: providerResult.status } });
      await this.audit(scope, context.correlation, "RENDER_SELLER_CONVERSION_SUCCEEDED", conversion.id, { marketplaceCaptureId: capture.id, contactId, attestationId: attestation.id, conversionId: conversion.id, renderSellerId: providerResult.renderSellerId });
      return { captureId: capture.id, contactId, attestationId: attestation.id, renderSellerId: providerResult.renderSellerId, conversionStatus: "SUCCESS", conversionId: updated.id, idempotent: false };
    } catch (cause) {
      const failureReason = cause instanceof Error ? cause.message : "Render seller connector failed";
      await this.deps.renderConversions.update(scope, conversion.id, { status: "FAILED", failedAt: this.now().toISOString(), failureReason });
      await this.audit(scope, context.correlation, "RENDER_SELLER_CONVERSION_FAILED", conversion.id, { marketplaceCaptureId: capture.id, contactId, attestationId: attestation.id, conversionId: conversion.id, failureReason });
      throw this.error(context.correlation, "SERVICE_REPOSITORY_FAILED", `Render seller conversion failed: ${failureReason}`, 502, { conversionId: conversion.id }, cause);
    }
  }

  private buildPayload(capture: MarketplaceCaptureRecord, contact: { readonly firstName?: string | null | undefined; readonly lastName?: string | null | undefined; readonly email?: string | null | undefined; readonly phone?: string | null | undefined }, contactId: string): Omit<CreateRenderSellerInput, "idempotencyKey"> {
    const metadata = capture.metadata ?? {};
    const name = capture.sellerName ?? [contact.firstName, contact.lastName].filter((value) => value != null).join(" ").trim();
    if (name.length === 0) throw this.error(undefined, "SERVICE_VALIDATION_FAILED", "Captured seller name is required for Render seller conversion", 400);
    const phone = stringMeta(metadata, "sellerPhone") ?? contact.phone ?? null;
    const email = stringMeta(metadata, "sellerEmail") ?? contact.email ?? null;
    if (phone === null && email === null) throw this.error(undefined, "SERVICE_VALIDATION_FAILED", "At least one captured contact method is required for Render seller conversion", 400);
    return { name, phone, email, location: stringMeta(metadata, "sellerLocation"), marketplaceProfileUrl: capture.sellerProfileUrl ?? null, marketplaceIdentifier: capture.externalId ?? contactId, marketplaceSource: stringMeta(metadata, "marketplaceSource") ?? "UNKNOWN", sourceCaptureId: capture.id, sourceTenantId: capture.tenantId };
  }

  private async requireCapture(scope: TenantScoped, captureId: string, correlation: PersistenceCorrelationMetadata): Promise<MarketplaceCaptureRecord> { const capture = await this.deps.marketplaceCaptures.findById(scope, captureId); if (capture === null) throw this.error(correlation, "SERVICE_NOT_FOUND", "Marketplace capture was not found for this tenant", 404); return capture; }
  private now(): Date { return this.deps.clock?.() ?? new Date(); }
  private async audit(scope: TenantScoped, correlation: PersistenceCorrelationMetadata, action: string, targetId: string, metadata: Readonly<Record<string, unknown>>): Promise<void> { await this.deps.auditLogs.append(scope, { tenantId: scope.tenantId, action, targetType: "RENDER_CONVERSION", targetId, correlationId: correlation.correlationId, requestId: correlation.requestId, metadata }); }
  private error(correlation: PersistenceCorrelationMetadata | undefined, code: RenderSellerConversionErrorCode, message: string, status: number, details?: Readonly<Record<string, unknown>>, cause?: unknown): RenderSellerConversionError { return new RenderSellerConversionError({ code, message, status, correlation, details, cause }); }
}
