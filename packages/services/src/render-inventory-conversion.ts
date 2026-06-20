import type {
  ActivityRepository,
  AuditLogRepository,
  DealsRepository,
  DraftInventoryRecord,
  DraftInventoryRepository,
  MarketplaceCaptureRecord,
  MarketplaceCaptureRepository,
  RenderConversionRecord,
  RenderConversionRepository,
} from "@whisperm/repositories";
import type { PersistenceCorrelationMetadata, TenantScoped } from "@whisperm/types";

export interface RenderInventoryConnector {
  createRenderInventory(
    input: Readonly<Record<string, unknown>> & { readonly idempotencyKey: string },
  ): Promise<{ readonly renderInventoryId: string; readonly status: "CREATED" | "EXISTS" }>;
}

export interface RenderInventoryConversionContext {
  readonly tenantId: string;
  readonly actorId?: string | undefined;
  readonly correlation: PersistenceCorrelationMetadata;
}

type RenderInventoryConversionErrorCode =
  | "SERVICE_TENANT_MISMATCH"
  | "SERVICE_NOT_FOUND"
  | "SERVICE_INVALID_STATE_TRANSITION"
  | "SERVICE_REPOSITORY_FAILED";

export class RenderInventoryConversionError extends Error {
  readonly code: RenderInventoryConversionErrorCode;
  readonly status: number;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
  readonly correlation?: PersistenceCorrelationMetadata | undefined;
  override readonly cause?: unknown;

  constructor(input: {
    readonly code: RenderInventoryConversionErrorCode;
    readonly message: string;
    readonly status: number;
    readonly details?: Readonly<Record<string, unknown>> | undefined;
    readonly correlation?: PersistenceCorrelationMetadata | undefined;
    readonly cause?: unknown;
  }) {
    super(input.message);
    this.name = "RenderInventoryConversionError";
    this.code = input.code;
    this.status = input.status;
    this.details = input.details;
    this.correlation = input.correlation;
    this.cause = input.cause;
  }
}

export interface RenderInventoryConversionDependencies {
  readonly marketplaceCaptures: MarketplaceCaptureRepository;
  readonly draftInventories: DraftInventoryRepository;
  readonly renderConversions: RenderConversionRepository;
  readonly deals?: DealsRepository | undefined;
  readonly auditLogs: AuditLogRepository;
  readonly activities: ActivityRepository;
  readonly connector: RenderInventoryConnector;
  readonly clock?: (() => Date) | undefined;
}

export interface RenderInventoryConversionResult {
  readonly captureId: string;
  readonly draftInventoryId: string;
  readonly renderSellerId?: string | undefined;
  readonly renderInventoryId: string;
  readonly conversionStatus: "SUCCESS";
  readonly conversionId: string;
  readonly idempotent: boolean;
  readonly acquisitionConverted: boolean;
}

const eligibleCaptureStatuses = new Set(["CLAIMED", "CONVERTED"]);
const eligibleDraftStatuses = new Set(["CLAIMED", "CONVERTED"]);

const metadataString = (metadata: unknown, key: string): string | undefined => {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return undefined;
  const value = (metadata as Readonly<Record<string, unknown>>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
};

const supportsSellerConversionLookup = (
  renderConversions: RenderConversionRepository,
): renderConversions is RenderConversionRepository & {
  readonly findSuccessfulSellerConversion: (
    context: TenantScoped,
    marketplaceCaptureId: string,
    contactId: string | null,
  ) => Promise<RenderConversionRecord | null>;
} =>
  typeof (renderConversions as { readonly findSuccessfulSellerConversion?: unknown }).findSuccessfulSellerConversion === "function";

export class RenderInventoryConversionService {
  constructor(private readonly deps: RenderInventoryConversionDependencies) {}

  async convertClaimedInventoryToRender(
    context: RenderInventoryConversionContext,
    input: { readonly tenantId: string; readonly marketplaceCaptureId: string },
  ): Promise<RenderInventoryConversionResult> {
    if (context.tenantId !== input.tenantId) {
      throw this.error(
        context.correlation,
        "SERVICE_TENANT_MISMATCH",
        "Conversion tenant does not match request tenant",
        403,
      );
    }

    const scope = { tenantId: context.tenantId };
    const capture = await this.requireCapture(scope, input.marketplaceCaptureId, context.correlation);
    if (capture.contactId === undefined || capture.contactId === null) {
      throw this.error(
        context.correlation,
        "SERVICE_INVALID_STATE_TRANSITION",
        "Seller phone-qualified contact is required before inventory conversion",
        422,
        { missingRequirements: ["PHONE_REQUIRED"] },
      );
    }

    if (!eligibleCaptureStatuses.has(capture.status)) {
      throw this.error(
        context.correlation,
        "SERVICE_INVALID_STATE_TRANSITION",
        "Only claimed marketplace captures can be converted to Render inventory",
        capture.status === "EXPIRED" ? 410 : 422,
        { status: capture.status },
      );
    }

    const draft = await this.deps.draftInventories.findByMarketplaceCaptureId(scope, capture.id);
    if (draft === null) {
      throw this.error(
        context.correlation,
        "SERVICE_NOT_FOUND",
        "Draft inventory is required before inventory conversion",
        404,
      );
    }

    if (!eligibleDraftStatuses.has(draft.status)) {
      throw this.error(
        context.correlation,
        "SERVICE_INVALID_STATE_TRANSITION",
        "Draft inventory must be claimed before inventory conversion",
        draft.status === "EXPIRED" ? 410 : 422,
        { draftInventoryStatus: draft.status },
      );
    }

    const sellerConversion = await this.findSellerConversion(scope, capture, draft, context.correlation);

    const existing = await this.deps.renderConversions.findSuccessfulInventoryConversion(scope, capture.id, draft.id);
    if (existing !== null) {
      const renderInventoryId = metadataString(existing.metadata, "renderInventoryId") ?? existing.externalId;
      if (renderInventoryId !== undefined && renderInventoryId !== null) {
        return {
          captureId: capture.id,
          draftInventoryId: draft.id,
          renderSellerId: sellerConversion?.renderSellerId ?? metadataString(existing.metadata, "renderSellerId"),
          renderInventoryId,
          conversionStatus: "SUCCESS",
          conversionId: existing.id,
          idempotent: true,
          acquisitionConverted: capture.status === "CONVERTED" && draft.status === "CONVERTED",
        };
      }
    }

    const startedAt = this.now().toISOString();
    const conversion = await this.deps.renderConversions.create(scope, {
      tenantId: scope.tenantId,
      marketplaceCaptureId: capture.id,
      contactId: capture.contactId ?? draft.contactId ?? null,
      dealId: capture.dealId ?? draft.dealId ?? null,
      externalId: draft.id,
      status: "PROCESSING",
      conversionKind: "INVENTORY",
      startedAt,
      metadata: {
        source: "DRAFT_INVENTORY",
        draftInventoryId: draft.id,
        renderSellerId: sellerConversion?.renderSellerId ?? null,
        sellerConversionId: sellerConversion?.id ?? null,
      },
    });

    await this.audit(scope, context.correlation, "RENDER_INVENTORY_CONVERSION_STARTED", conversion.id, {
      marketplaceCaptureId: capture.id,
      draftInventoryId: draft.id,
      conversionId: conversion.id,
      renderSellerId: sellerConversion?.renderSellerId ?? null,
    });

    try {
      const providerResult = await this.deps.connector.createRenderInventory({
        ...this.buildPayload(scope, capture, draft, sellerConversion?.renderSellerId),
        idempotencyKey: `render-inventory:${scope.tenantId}:${draft.id}`,
      });

      const completedAt = this.now().toISOString();
      const updated = await this.deps.renderConversions.update(scope, conversion.id, {
        status: "SUCCESS",
        externalId: draft.id,
        completedAt,
        convertedAt: completedAt,
        metadata: {
          source: "DRAFT_INVENTORY",
          draftInventoryId: draft.id,
          renderSellerId: sellerConversion?.renderSellerId ?? null,
          sellerConversionId: sellerConversion?.id ?? null,
          renderInventoryId: providerResult.renderInventoryId,
          providerStatus: providerResult.status,
        },
      });

      await this.deps.draftInventories.update(scope, draft.id, { status: "CONVERTED" });

      await this.audit(scope, context.correlation, "RENDER_INVENTORY_CONVERSION_SUCCEEDED", conversion.id, {
        marketplaceCaptureId: capture.id,
        draftInventoryId: draft.id,
        conversionId: conversion.id,
        renderSellerId: sellerConversion?.renderSellerId ?? null,
        renderInventoryId: providerResult.renderInventoryId,
      });
      await this.appendActivity(scope, context, capture, draft, "Render inventory conversion succeeded", completedAt, { eventType: "RENDER_INVENTORY_CONVERSION_SUCCEEDED", marketplaceCaptureId: capture.id, draftInventoryId: draft.id, conversionId: conversion.id, renderSellerId: sellerConversion?.renderSellerId ?? null, renderInventoryId: providerResult.renderInventoryId });

      return {
        captureId: capture.id,
        draftInventoryId: draft.id,
        renderSellerId: sellerConversion?.renderSellerId,
        renderInventoryId: providerResult.renderInventoryId,
        conversionStatus: "SUCCESS",
        conversionId: updated.id,
        idempotent: false,
        acquisitionConverted: false,
      };
    } catch (cause) {
      const failureReason = cause instanceof Error ? cause.message : "Render inventory connector failed";
      await this.deps.renderConversions.update(scope, conversion.id, {
        status: "FAILED",
        failedAt: this.now().toISOString(),
        failureReason,
      });
      await this.audit(scope, context.correlation, "RENDER_INVENTORY_CONVERSION_FAILED", conversion.id, {
        marketplaceCaptureId: capture.id,
        draftInventoryId: draft.id,
        conversionId: conversion.id,
        renderSellerId: sellerConversion?.renderSellerId ?? null,
        failureReason,
      });
      await this.appendActivity(scope, context, capture, draft, "Render inventory conversion failed", this.now().toISOString(), { eventType: "RENDER_INVENTORY_CONVERSION_FAILED", marketplaceCaptureId: capture.id, draftInventoryId: draft.id, conversionId: conversion.id, renderSellerId: sellerConversion?.renderSellerId ?? null, failureReason });
      throw this.error(
        context.correlation,
        "SERVICE_REPOSITORY_FAILED",
        `Render inventory conversion failed: ${failureReason}`,
        502,
        { conversionId: conversion.id },
        cause,
      );
    }
  }

  private async appendActivity(scope: TenantScoped, context: RenderInventoryConversionContext, capture: MarketplaceCaptureRecord, draft: DraftInventoryRecord, note: string, occurredAt: string, metadata: Readonly<Record<string, unknown>>): Promise<void> {
    const dealId = capture.dealId ?? draft.dealId ?? null;
    // Activity records are deal-scoped in CRM; captures/drafts without a deal intentionally have no activity target.
    if (dealId == null || context.actorId === undefined) return;
    await this.deps.activities.create({ ...scope, actorId: context.actorId, correlation: context.correlation }, {
      tenantId: scope.tenantId,
      contactId: capture.contactId ?? draft.contactId ?? null,
      dealId,
      createdById: context.actorId,
      type: "NOTE",
      note,
      occurredAt,
      metadata,
    });
  }
  private async findSellerConversion(
    scope: TenantScoped,
    capture: MarketplaceCaptureRecord,
    draft: DraftInventoryRecord,
    correlation: PersistenceCorrelationMetadata,
  ): Promise<(RenderConversionRecord & { readonly renderSellerId: string }) | null> {
    if (!supportsSellerConversionLookup(this.deps.renderConversions)) return null;

    const sellerConversion = await this.deps.renderConversions.findSuccessfulSellerConversion(
      scope,
      capture.id,
      capture.contactId ?? draft.contactId ?? null,
    );

    if (sellerConversion === null || sellerConversion.renderSellerId === undefined || sellerConversion.renderSellerId === null) {
      throw this.error(
        correlation,
        "SERVICE_INVALID_STATE_TRANSITION",
        "Render seller conversion must succeed before inventory conversion",
        422,
        { marketplaceCaptureId: capture.id, draftInventoryId: draft.id },
      );
    }

    return sellerConversion as RenderConversionRecord & { readonly renderSellerId: string };
  }

  private buildPayload(
    scope: TenantScoped,
    capture: MarketplaceCaptureRecord,
    draft: DraftInventoryRecord,
    renderSellerId?: string | undefined,
  ): Readonly<Record<string, unknown>> {
    return {
      tenantId: scope.tenantId,
      renderSellerId,
      marketplaceCaptureId: capture.id,
      draftInventoryId: draft.id,
      title: draft.title,
      description: draft.description ?? capture.description ?? null,
      price: draft.price ?? capture.price ?? null,
      currency: draft.currency ?? capture.currency ?? null,
      category: draft.category ?? null,
      images: draft.images ?? null,
      listingUrl: draft.listingUrl ?? capture.listingUrl,
      marketplaceSource: draft.marketplaceSource ?? (typeof capture.metadata?.marketplaceSource === "string" ? capture.metadata.marketplaceSource : null),
      marketplaceListingId: draft.marketplaceListingId ?? capture.externalId ?? null,
      sellerName: capture.sellerName ?? null,
      sellerProfileUrl: capture.sellerProfileUrl ?? null,
      contactId: capture.contactId ?? draft.contactId ?? null,
      dealId: capture.dealId ?? draft.dealId ?? null,
    };
  }

  private async requireCapture(
    scope: TenantScoped,
    captureId: string,
    correlation: PersistenceCorrelationMetadata,
  ): Promise<MarketplaceCaptureRecord> {
    const capture = await this.deps.marketplaceCaptures.findById(scope, captureId);
    if (capture === null) {
      throw this.error(correlation, "SERVICE_NOT_FOUND", "Marketplace capture was not found for this tenant", 404);
    }
    return capture;
  }

  private now(): Date {
    return this.deps.clock?.() ?? new Date();
  }

  private async audit(
    scope: TenantScoped,
    correlation: PersistenceCorrelationMetadata,
    action: string,
    targetId: string,
    metadata: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await this.deps.auditLogs.append(scope, {
      tenantId: scope.tenantId,
      action,
      targetType: "RENDER_CONVERSION",
      targetId,
      correlationId: correlation.correlationId,
      requestId: correlation.requestId,
      metadata,
    });
  }

  private error(
    correlation: PersistenceCorrelationMetadata | undefined,
    code: RenderInventoryConversionErrorCode,
    message: string,
    status: number,
    details?: Readonly<Record<string, unknown>>,
    cause?: unknown,
  ): RenderInventoryConversionError {
    return new RenderInventoryConversionError({ code, message, status, correlation, details, cause });
  }
}
