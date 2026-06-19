import type { ActivityRepository, AuditLogRepository, DealsRepository, DraftInventoryRepository, MarketplaceCaptureRepository, PipelineRepository, RenderConversionRepository } from "@whisperm/repositories";
import { MARKETPLACE_ACQUISITION_PIPELINE_KEY } from "@whisperm/types";
import type { PersistenceCorrelationMetadata, TenantScoped } from "@whisperm/types";

export interface MarketplaceCaptureCompletionContext {
  readonly tenantId: string;
  readonly actorId?: string | undefined;
  readonly correlation: PersistenceCorrelationMetadata;
}

export interface MarketplaceCaptureCompletionDependencies {
  readonly marketplaceCaptures: MarketplaceCaptureRepository;
  readonly draftInventories: DraftInventoryRepository;
  readonly renderConversions: RenderConversionRepository;
  readonly pipelines?: PipelineRepository | undefined;
  readonly deals?: DealsRepository | undefined;
  readonly auditLogs: AuditLogRepository;
  readonly activities: ActivityRepository;
  readonly clock?: (() => Date) | undefined;
}

export interface MarketplaceCaptureCompletionResult {
  readonly captureId: string;
  readonly draftInventoryId: string;
  readonly sellerConversionId: string;
  readonly inventoryConversionId: string;
  readonly status: "CONVERTED";
  readonly idempotent: boolean;
}

type CompletionErrorCode = "SERVICE_TENANT_MISMATCH" | "SERVICE_NOT_FOUND" | "SERVICE_INVALID_STATE_TRANSITION";

export class MarketplaceCaptureCompletionError extends Error {
  readonly code: CompletionErrorCode;
  readonly status: number;
  readonly correlation?: PersistenceCorrelationMetadata | undefined;

  constructor(input: { readonly code: CompletionErrorCode; readonly message: string; readonly status: number; readonly correlation?: PersistenceCorrelationMetadata | undefined }) {
    super(input.message);
    this.name = "MarketplaceCaptureCompletionError";
    this.code = input.code;
    this.status = input.status;
    this.correlation = input.correlation;
  }
}

const pipelineKey = MARKETPLACE_ACQUISITION_PIPELINE_KEY;
const convertedStageName = "Converted";

export class MarketplaceCaptureCompletionService {
  constructor(private readonly deps: MarketplaceCaptureCompletionDependencies) {}

  async completeCapture(context: MarketplaceCaptureCompletionContext, input: { readonly tenantId: string; readonly marketplaceCaptureId: string }): Promise<MarketplaceCaptureCompletionResult> {
    if (context.tenantId !== input.tenantId) throw this.error(context.correlation, "SERVICE_TENANT_MISMATCH", "Completion tenant does not match request tenant", 403);

    const scope = { tenantId: context.tenantId };
    const capture = await this.deps.marketplaceCaptures.findById(scope, input.marketplaceCaptureId);
    if (capture === null) throw this.error(context.correlation, "SERVICE_NOT_FOUND", "Marketplace capture was not found for this tenant", 404);

    const draft = await this.deps.draftInventories.findByMarketplaceCaptureId(scope, capture.id);
    if (draft === null) throw this.error(context.correlation, "SERVICE_NOT_FOUND", "Draft inventory is required before capture completion", 404);

    const contactId = capture.contactId ?? draft.contactId ?? null;
    const seller = await this.deps.renderConversions.findSuccessfulSellerConversion(scope, capture.id, contactId);
    if (seller?.renderSellerId == null) throw this.error(context.correlation, "SERVICE_INVALID_STATE_TRANSITION", "Seller conversion must succeed before capture completion", 422);

    const inventory = await this.deps.renderConversions.findSuccessfulInventoryConversion(scope, capture.id, draft.id);
    if (inventory?.externalId == null) throw this.error(context.correlation, "SERVICE_INVALID_STATE_TRANSITION", "Inventory conversion must succeed before capture completion", 422);

    if (capture.status === "CONVERTED" && draft.status === "CONVERTED") {
      return { captureId: capture.id, draftInventoryId: draft.id, sellerConversionId: seller.id, inventoryConversionId: inventory.id, status: "CONVERTED", idempotent: true };
    }

    if (capture.status !== "CLAIMED" && capture.status !== "CONVERTED") {
      throw this.error(context.correlation, "SERVICE_INVALID_STATE_TRANSITION", "Only claimed captures can be completed", capture.status === "EXPIRED" ? 410 : 422);
    }

    if (draft.status !== "CONVERTED") {
      throw this.error(context.correlation, "SERVICE_INVALID_STATE_TRANSITION", "Draft inventory must be converted before capture completion", draft.status === "EXPIRED" ? 410 : 422);
    }

    await this.deps.marketplaceCaptures.update(scope, capture.id, { status: "CONVERTED" });

    if (capture.dealId != null && this.deps.pipelines !== undefined && this.deps.deals !== undefined) {
      const pipeline = await this.deps.pipelines.findByDefaultKey(context.tenantId, pipelineKey);
      const convertedStage = pipeline?.stages.find((stage) => stage.name === convertedStageName);
      if (convertedStage !== undefined) await this.deps.deals.updateStage(context.tenantId, capture.dealId, convertedStage.id);
    }

    const completedAt = this.now().toISOString();
    const completionMetadata = { marketplaceCaptureId: capture.id, draftInventoryId: draft.id, sellerConversionId: seller.id, inventoryConversionId: inventory.id, completedAt };

    await this.deps.auditLogs.append(scope, {
      tenantId: scope.tenantId,
      action: "MARKETPLACE_CAPTURE_COMPLETED",
      targetType: "MARKETPLACE_CAPTURE",
      targetId: capture.id,
      correlationId: context.correlation.correlationId,
      requestId: context.correlation.requestId,
      metadata: completionMetadata,
    });
    await this.appendActivity(context, capture, "Marketplace capture completed", completedAt, { eventType: "MARKETPLACE_CAPTURE_COMPLETED", ...completionMetadata });

    return { captureId: capture.id, draftInventoryId: draft.id, sellerConversionId: seller.id, inventoryConversionId: inventory.id, status: "CONVERTED", idempotent: false };
  }

  private async appendActivity(context: MarketplaceCaptureCompletionContext, capture: { readonly contactId?: string | null | undefined; readonly dealId?: string | null | undefined }, note: string, occurredAt: string, metadata: Readonly<Record<string, unknown>>): Promise<void> {
    // Activity records are deal-scoped in CRM; captures without a deal intentionally have no activity target.
    if (capture.dealId == null || context.actorId === undefined) return;
    await this.deps.activities.create({ tenantId: context.tenantId, actorId: context.actorId, correlation: context.correlation }, {
      tenantId: context.tenantId,
      contactId: capture.contactId ?? null,
      dealId: capture.dealId,
      createdById: context.actorId,
      type: "NOTE",
      note,
      occurredAt,
      metadata,
    });
  }

  private now(): Date { return this.deps.clock?.() ?? new Date(); }

  private error(correlation: PersistenceCorrelationMetadata, code: CompletionErrorCode, message: string, status: number): MarketplaceCaptureCompletionError {
    return new MarketplaceCaptureCompletionError({ code, message, status, correlation });
  }
}
