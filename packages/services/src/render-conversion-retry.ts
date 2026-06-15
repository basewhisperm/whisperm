import type { CreateRenderSellerInput, RenderSellerConnector } from "@whisperm/provider-adapters";
import type { AuditLogRepository, ContactRepository, DraftInventoryRepository, MarketplaceCaptureRecord, MarketplaceCaptureRepository, MarketplaceSellerVerificationRepository, RenderConversionRecord, RenderConversionRepository } from "@whisperm/repositories";
import type { PersistenceCorrelationMetadata, TenantScoped } from "@whisperm/types";

export type RenderConversionRetryStatus = "RETRYING" | "SUCCESS" | "FAILED" | "DEAD_LETTERED";
type RetryErrorCode = "SERVICE_TENANT_MISMATCH" | "SERVICE_NOT_FOUND" | "SERVICE_INVALID_STATE_TRANSITION" | "SERVICE_REPOSITORY_FAILED";

export class RenderConversionRetryError extends Error { readonly code: RetryErrorCode; readonly status: number; readonly details?: Readonly<Record<string, unknown>> | undefined; constructor(input: { code: RetryErrorCode; message: string; status: number; details?: Readonly<Record<string, unknown>> }) { super(input.message); this.name = "RenderConversionRetryError"; this.code = input.code; this.status = input.status; if (input.details !== undefined) this.details = input.details; } }

export interface RenderInventoryConnector { createRenderInventory(input: Readonly<Record<string, unknown>> & { readonly idempotencyKey: string }): Promise<{ readonly renderInventoryId: string; readonly status: "CREATED" | "EXISTS" }>; }
export interface RenderConversionRetryContext { readonly tenantId: string; readonly actorId?: string | undefined; readonly correlation: PersistenceCorrelationMetadata; }
export interface RenderConversionRetryDependencies { readonly renderConversions: RenderConversionRepository; readonly marketplaceCaptures: MarketplaceCaptureRepository; readonly draftInventories: DraftInventoryRepository; readonly marketplaceSellerVerifications: MarketplaceSellerVerificationRepository; readonly contacts: ContactRepository; readonly auditLogs: AuditLogRepository; readonly sellerConnector: RenderSellerConnector; readonly inventoryConnector?: RenderInventoryConnector | undefined; readonly clock?: (() => Date) | undefined; }
export interface RenderConversionRetryResult { readonly conversionId: string; readonly status: RenderConversionRetryStatus; readonly attemptCount: number; readonly nextAttemptAt: string | null; }

const retryableStatuses = new Set(["FAILED", "RETRYING"]);
const retryableKinds = new Set(["SELLER", "INVENTORY"]);
const backoffMs = [5 * 60_000, 30 * 60_000, 2 * 60 * 60_000] as const;
const stringMeta = (metadata: Readonly<Record<string, unknown>> | null | undefined, key: string): string | null => { const value = metadata?.[key]; return typeof value === "string" && value.trim().length > 0 ? value : null; };
export const nextRenderConversionRetryAt = (attemptCount: number, now: Date): string => { const index = Math.max(0, Math.min(attemptCount - 1, backoffMs.length - 1)); const delayMs = backoffMs[index] ?? 7_200_000; return new Date(now.getTime() + delayMs).toISOString(); };

export class RenderConversionRetryService {
  constructor(private readonly deps: RenderConversionRetryDependencies) {}

  async scheduleFailedConversionRetry(context: RenderConversionRetryContext, input: { readonly tenantId: string; readonly conversionId: string }): Promise<RenderConversionRetryResult> {
    this.assertTenant(context, input.tenantId); const scope = { tenantId: context.tenantId }; const conversion = await this.requireConversion(scope, input.conversionId);
    await this.assertRetryable(scope, conversion, false);
    const scheduled = await this.deps.renderConversions.update(scope, conversion.id, { status: "RETRYING", nextAttemptAt: nextRenderConversionRetryAt(conversion.attemptCount + 1, this.now()) });
    await this.audit(scope, context.correlation, "RENDER_CONVERSION_RETRY_SCHEDULED", scheduled, {});
    return this.result(scheduled);
  }

  async retryRenderConversion(context: RenderConversionRetryContext, input: { readonly tenantId: string; readonly conversionId: string }): Promise<RenderConversionRetryResult> {
    this.assertTenant(context, input.tenantId); const scope = { tenantId: context.tenantId }; const conversion = await this.requireConversion(scope, input.conversionId);
    await this.assertRetryable(scope, conversion, true);
    const attemptCount = conversion.attemptCount + 1; const started = await this.deps.renderConversions.update(scope, conversion.id, { status: "RETRYING", attemptCount, lastAttemptAt: this.now().toISOString(), nextAttemptAt: null });
    await this.audit(scope, context.correlation, "RENDER_CONVERSION_RETRY_STARTED", started, {});
    try {
      const duplicate = await this.findDuplicateSuccess(scope, started);
      if (duplicate !== null) return this.markConversionDeadLettered(context, { tenantId: scope.tenantId, conversionId: started.id, reason: "Duplicate successful conversion already exists" });
      const providerId = started.conversionKind === "INVENTORY" ? await this.retryInventory(scope, started) : await this.retrySeller(scope, started);
      const completedAt = this.now().toISOString();
      const updated = await this.deps.renderConversions.update(scope, started.id, { status: "SUCCESS", completedAt, convertedAt: completedAt, failedAt: null, failureReason: null, failureCode: null, nextAttemptAt: null, deadLetteredAt: null, ...(started.conversionKind === "INVENTORY" ? { externalId: providerId } : { renderSellerId: providerId }) });
      await this.audit(scope, context.correlation, "RENDER_CONVERSION_RETRY_SUCCEEDED", updated, {});
      return this.result(updated);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : "Render conversion retry failed"; const code = cause instanceof RenderConversionRetryError ? cause.code : "PROVIDER_ERROR";
      if (attemptCount >= started.maxAttempts) return this.markConversionDeadLettered(context, { tenantId: scope.tenantId, conversionId: started.id, reason, failureCode: code });
      const failed = await this.deps.renderConversions.update(scope, started.id, { status: "FAILED", failedAt: this.now().toISOString(), failureReason: reason, failureCode: code, nextAttemptAt: nextRenderConversionRetryAt(attemptCount, this.now()) });
      await this.audit(scope, context.correlation, "RENDER_CONVERSION_RETRY_FAILED", failed, { failureReason: reason, failureCode: code });
      return this.result(failed);
    }
  }

  async markConversionDeadLettered(context: RenderConversionRetryContext, input: { readonly tenantId: string; readonly conversionId: string; readonly reason: string; readonly failureCode?: string | undefined }): Promise<RenderConversionRetryResult> {
    this.assertTenant(context, input.tenantId); const scope = { tenantId: context.tenantId }; const conversion = await this.requireConversion(scope, input.conversionId);
    const updated = await this.deps.renderConversions.update(scope, conversion.id, { status: "DEAD_LETTERED", deadLetteredAt: this.now().toISOString(), failedAt: this.now().toISOString(), failureReason: input.reason, failureCode: input.failureCode ?? "DEAD_LETTERED", nextAttemptAt: null });
    await this.audit(scope, context.correlation, "RENDER_CONVERSION_DEAD_LETTERED", updated, { failureReason: input.reason, failureCode: input.failureCode ?? "DEAD_LETTERED" });
    return this.result(updated);
  }

  private async assertRetryable(scope: TenantScoped, conversion: RenderConversionRecord, dueOnly: boolean): Promise<void> {
    if (!retryableStatuses.has(conversion.status)) throw new RenderConversionRetryError({ code: "SERVICE_INVALID_STATE_TRANSITION", message: "Only failed or retrying conversions can be retried", status: 409 });
    if (!retryableKinds.has(conversion.conversionKind ?? "")) throw new RenderConversionRetryError({ code: "SERVICE_INVALID_STATE_TRANSITION", message: "Unsupported conversion kind", status: 422 });
    if (conversion.attemptCount >= conversion.maxAttempts) throw new RenderConversionRetryError({ code: "SERVICE_INVALID_STATE_TRANSITION", message: "Render conversion has exhausted retry attempts", status: 409 });
    if (dueOnly && conversion.nextAttemptAt != null && Date.parse(conversion.nextAttemptAt) > this.now().getTime()) throw new RenderConversionRetryError({ code: "SERVICE_INVALID_STATE_TRANSITION", message: "Render conversion retry is not due yet", status: 409 });
    if (conversion.marketplaceCaptureId == null) throw new RenderConversionRetryError({ code: "SERVICE_NOT_FOUND", message: "Render conversion is missing marketplace capture", status: 404 });
    const capture = await this.deps.marketplaceCaptures.findById(scope, conversion.marketplaceCaptureId); if (capture === null) throw new RenderConversionRetryError({ code: "SERVICE_NOT_FOUND", message: "Marketplace capture was not found", status: 404 });
    if (capture.status === "EXPIRED" || capture.status === "CONVERTED" || capture.status !== "CLAIMED") throw new RenderConversionRetryError({ code: "SERVICE_INVALID_STATE_TRANSITION", message: "Acquisition is not eligible for conversion retry", status: capture.status === "EXPIRED" ? 410 : 422 });
    if (await this.findDuplicateSuccess(scope, conversion) !== null) throw new RenderConversionRetryError({ code: "SERVICE_INVALID_STATE_TRANSITION", message: "Successful conversion already exists", status: 409 });
  }
  private async findDuplicateSuccess(scope: TenantScoped, conversion: RenderConversionRecord): Promise<RenderConversionRecord | null> { if (conversion.marketplaceCaptureId == null) return null; return conversion.conversionKind === "INVENTORY" ? this.deps.renderConversions.findSuccessfulInventoryConversion(scope, conversion.marketplaceCaptureId, conversion.externalId ?? null) : this.deps.renderConversions.findSuccessfulSellerConversion(scope, conversion.marketplaceCaptureId, conversion.contactId ?? null); }
  private async retrySeller(scope: TenantScoped, conversion: RenderConversionRecord): Promise<string> { const capture = await this.requireCapture(scope, conversion.marketplaceCaptureId); const contactId = conversion.contactId ?? capture.contactId; if (contactId == null) throw new RenderConversionRetryError({ code: "SERVICE_NOT_FOUND", message: "Seller conversion is missing contact", status: 404 }); const contact = await this.deps.contacts.findById(scope, contactId); if (contact === null) throw new RenderConversionRetryError({ code: "SERVICE_NOT_FOUND", message: "Seller contact was not found", status: 404 }); const payload = this.buildSellerPayload(capture, contact, contactId); const result = await this.deps.sellerConnector.createRenderSeller({ ...payload, idempotencyKey: `render-seller:${scope.tenantId}:${capture.id}:${contactId}` }); return result.renderSellerId; }
  private async retryInventory(scope: TenantScoped, conversion: RenderConversionRecord): Promise<string> { if (this.deps.inventoryConnector === undefined) throw new RenderConversionRetryError({ code: "SERVICE_REPOSITORY_FAILED", message: "Render inventory connector is not configured", status: 503 }); const draft = await this.deps.draftInventories.findByMarketplaceCaptureId(scope, this.requireCaptureId(conversion)); if (draft === null) throw new RenderConversionRetryError({ code: "SERVICE_NOT_FOUND", message: "Draft inventory was not found", status: 404 }); const result = await this.deps.inventoryConnector.createRenderInventory({ idempotencyKey: `render-inventory:${scope.tenantId}:${draft.id}`, tenantId: scope.tenantId, draftInventoryId: draft.id, marketplaceCaptureId: draft.marketplaceCaptureId, title: draft.title }); return result.renderInventoryId; }
  private buildSellerPayload(capture: MarketplaceCaptureRecord, contact: { readonly firstName?: string | null | undefined; readonly lastName?: string | null | undefined; readonly email?: string | null | undefined; readonly phone?: string | null | undefined }, contactId: string): Omit<CreateRenderSellerInput, "idempotencyKey"> { const metadata = capture.metadata ?? {}; const name = capture.sellerName ?? [contact.firstName, contact.lastName].filter((value) => value != null).join(" ").trim(); if (name.length === 0) throw new RenderConversionRetryError({ code: "SERVICE_INVALID_STATE_TRANSITION", message: "Captured seller name is required for retry", status: 400 }); return { name, phone: stringMeta(metadata, "sellerPhone") ?? contact.phone ?? null, email: stringMeta(metadata, "sellerEmail") ?? contact.email ?? null, location: stringMeta(metadata, "sellerLocation"), marketplaceProfileUrl: capture.sellerProfileUrl ?? null, marketplaceIdentifier: capture.externalId ?? contactId, marketplaceSource: stringMeta(metadata, "marketplaceSource") ?? "UNKNOWN", sourceCaptureId: capture.id, sourceTenantId: capture.tenantId }; }
  private requireCaptureId(conversion: RenderConversionRecord): string { if (conversion.marketplaceCaptureId == null) throw new RenderConversionRetryError({ code: "SERVICE_NOT_FOUND", message: "Conversion is missing capture", status: 404 }); return conversion.marketplaceCaptureId; }
  private async requireCapture(scope: TenantScoped, captureId: string | null | undefined): Promise<MarketplaceCaptureRecord> { if (captureId == null) throw new RenderConversionRetryError({ code: "SERVICE_NOT_FOUND", message: "Conversion is missing capture", status: 404 }); const capture = await this.deps.marketplaceCaptures.findById(scope, captureId); if (capture === null) throw new RenderConversionRetryError({ code: "SERVICE_NOT_FOUND", message: "Marketplace capture was not found", status: 404 }); return capture; }
  private async requireConversion(scope: TenantScoped, conversionId: string): Promise<RenderConversionRecord> { const conversion = await this.deps.renderConversions.findById(scope, conversionId); if (conversion === null) throw new RenderConversionRetryError({ code: "SERVICE_NOT_FOUND", message: "Render conversion was not found", status: 404 }); return conversion; }
  private assertTenant(context: RenderConversionRetryContext, tenantId: string): void { if (context.tenantId !== tenantId) throw new RenderConversionRetryError({ code: "SERVICE_TENANT_MISMATCH", message: "Retry tenant does not match request tenant", status: 403 }); }
  private now(): Date { return this.deps.clock?.() ?? new Date(); }
  private result(conversion: RenderConversionRecord): RenderConversionRetryResult { return { conversionId: conversion.id, status: conversion.status as RenderConversionRetryStatus, attemptCount: conversion.attemptCount, nextAttemptAt: conversion.nextAttemptAt ?? null }; }
  private async audit(scope: TenantScoped, correlation: PersistenceCorrelationMetadata, action: string, conversion: RenderConversionRecord, metadata: Readonly<Record<string, unknown>>): Promise<void> { await this.deps.auditLogs.append(scope, { tenantId: scope.tenantId, action, targetType: "RENDER_CONVERSION", targetId: conversion.id, correlationId: correlation.correlationId, requestId: correlation.requestId, metadata: { conversionId: conversion.id, conversionKind: conversion.conversionKind, marketplaceCaptureId: conversion.marketplaceCaptureId, draftInventoryId: conversion.conversionKind === "INVENTORY" ? conversion.externalId : undefined, attemptCount: conversion.attemptCount, ...metadata } }); }
}
