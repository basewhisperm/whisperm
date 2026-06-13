import { z } from "zod";

import type {
  CreateMarketplaceCaptureInput,
  MarketplaceAcquisitionRepository,
  MarketplaceCaptureRecord,
} from "@whisperm/repositories";
import {
  marketplaceCaptureCreateRequestSchema,
  marketplaceCaptureResponseSchema,
  type MarketplaceCaptureCreateRequest,
  type MarketplaceCaptureResponse,
  type PersistenceCorrelationMetadata,
  type TenantScoped,
} from "@whisperm/types";

const serviceContextSchema = z.object({
  tenantId: z.string().min(1),
  actorId: z.string().min(1).optional(),
  correlation: z.object({
    correlationId: z.string().min(1),
    requestId: z.string().min(1).optional(),
    causationId: z.string().min(1).optional(),
  }).strict(),
}).strict();

export interface MarketplaceCaptureServiceContext {
  readonly tenantId: string;
  readonly actorId?: string | undefined;
  readonly correlation: PersistenceCorrelationMetadata;
}

export interface MarketplaceCaptureServiceResult {
  readonly capture: MarketplaceCaptureResponse;
  readonly isNew: boolean;
}

export interface MarketplaceCaptureRepositoryPort {
  createMarketplaceCapture(context: TenantScoped, input: CreateMarketplaceCaptureInput): Promise<MarketplaceCaptureRecord>;
  findMarketplaceCaptureBySourceUrl(context: TenantScoped, sourceUrl: string): Promise<MarketplaceCaptureRecord | null>;
}

export interface MarketplaceCaptureAuditPort {
  append?(context: TenantScoped, input: {
    readonly tenantId: string;
    readonly actorId?: string | undefined;
    readonly action: string;
    readonly targetType: string;
    readonly targetId: string;
    readonly correlationId: string;
    readonly requestId?: string | undefined;
    readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  }): Promise<unknown>;
}

export interface MarketplaceCaptureServiceDependencies {
  readonly marketplaceAcquisition: MarketplaceCaptureRepositoryPort | MarketplaceAcquisitionRepository;
  readonly auditLogs?: MarketplaceCaptureAuditPort | undefined;
}

export class MarketplaceCaptureServiceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
  override readonly cause?: unknown;

  constructor(input: {
    readonly code: string;
    readonly message: string;
    readonly status: number;
    readonly details?: Readonly<Record<string, unknown>> | undefined;
    readonly cause?: unknown;
  }) {
    super(input.message);
    this.name = "MarketplaceCaptureServiceError";
    this.code = input.code;
    this.status = input.status;
    this.details = input.details;
    this.cause = input.cause;
  }
}

const normalizeSourceUrl = (sourceUrl: string): string => new URL(sourceUrl).toString();

const tenantScope = (context: MarketplaceCaptureServiceContext): TenantScoped => ({
  tenantId: context.tenantId,
});

const truncateDescription = (description: string | undefined): string | undefined =>
  description === undefined ? undefined : description.slice(0, 5000);

const parsePriceText = (
  priceText: string | undefined,
): { readonly price?: string | undefined; readonly currency?: string | undefined } => {
  if (priceText === undefined) return {};

  const normalized = priceText.trim();
  const match = /^(?<currencyCode>[A-Z]{3})\s?(?<amount>\d{1,9}(?:,\d{3})*(?:\.\d{1,2})?|\d{1,9}(?:\.\d{1,2})?)$/u.exec(normalized);

  if (match?.groups === undefined) return {};

  const currency = match.groups.currencyCode;
  const amount = match.groups.amount;

  if (currency === undefined || amount === undefined) return {};

  return {
    price: amount.replace(/,/gu, ""),
    currency,
  };
};

const toResponse = (record: MarketplaceCaptureRecord): MarketplaceCaptureResponse =>
  marketplaceCaptureResponseSchema.parse({
    id: record.id,
    tenantId: record.tenantId,
    sourceListingUrl: record.listingUrl,
    title: record.title,
    status: record.status,
    createdAt: record.createdAt,
  });

export class MarketplaceCaptureService {
  constructor(private readonly dependencies: MarketplaceCaptureServiceDependencies) {}

  async createCapture(
    contextInput: MarketplaceCaptureServiceContext,
    requestInput: MarketplaceCaptureCreateRequest,
  ): Promise<MarketplaceCaptureServiceResult> {
    const context = serviceContextSchema.parse(contextInput);
    const request = marketplaceCaptureCreateRequestSchema.parse(requestInput);
    const listingUrl = normalizeSourceUrl(request.sourceUrl);
    const sourceHost = request.sourceHost ?? new URL(listingUrl).host.toLowerCase();

    const existing = await this.dependencies.marketplaceAcquisition.findMarketplaceCaptureBySourceUrl(
      tenantScope(context),
      listingUrl,
    );

    if (existing !== null) {
      return { capture: toResponse(existing), isNew: false };
    }

    const price = parsePriceText(request.priceText);

    const input: CreateMarketplaceCaptureInput = {
      tenantId: context.tenantId,
      listingUrl,
      title: request.title,
      description: truncateDescription(request.description),
      price: price.price,
      currency: price.currency,
      status: "CAPTURED",
      capturedAt: new Date().toISOString(),
      metadata: {
        sourceHost,
        priceText: request.priceText,
        imageUrls: request.imageUrls,
        rawExtract: request.rawExtract,
      },
    };

    const created = await this.dependencies.marketplaceAcquisition.createMarketplaceCapture(
      tenantScope(context),
      input,
    );

    await this.dependencies.auditLogs?.append?.(tenantScope(context), {
      tenantId: context.tenantId,
      actorId: context.actorId,
      action: "MARKETPLACE_CAPTURE_CREATED",
      targetType: "MARKETPLACE_CAPTURE",
      targetId: created.id,
      correlationId: context.correlation.correlationId,
      requestId: context.correlation.requestId,
      metadata: { sourceHost },
    });

    return { capture: toResponse(created), isNew: true };
  }
}