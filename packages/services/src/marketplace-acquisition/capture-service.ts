import { z } from "zod";

import type {
  CreateMarketplaceCaptureInput,
  MarketplaceCaptureRecord,
} from "@whisperm/repositories";
import {
  PersistenceError,
  marketplaceCaptureCreateRequestSchema,
  marketplaceCaptureResponseSchema,
  type MarketplaceCaptureCreateRequest,
  type MarketplaceCaptureResponse,
  type PersistenceCorrelationMetadata,
  type TenantScoped,
} from "@whisperm/types";

const serviceContextSchema = z
  .object({
    tenantId: z.string().min(1),
    actorId: z.string().min(1).optional(),
    correlation: z
      .object({
        correlationId: z.string().min(1),
        requestId: z.string().min(1).optional(),
        causationId: z.string().min(1).optional(),
      })
      .strict(),
  })
  .strict();

export interface MarketplaceCaptureServiceContext {
  readonly tenantId: string;
  readonly actorId?: string | undefined;
  readonly correlation: PersistenceCorrelationMetadata;
}

export interface MarketplaceCaptureServiceResult {
  readonly capture: MarketplaceCaptureResponse;
  readonly isNew: boolean;
  readonly duplicate: boolean;
  readonly normalizationWarnings: readonly string[];
}

export interface MarketplaceCaptureRepositoryPort {
  createMarketplaceCapture(context: TenantScoped, input: CreateMarketplaceCaptureInput): Promise<MarketplaceCaptureRecord>;
  findMarketplaceCaptureByListingUrl(context: TenantScoped, listingUrl: string): Promise<MarketplaceCaptureRecord | null>;
  findMarketplaceCaptureByExternalId(context: TenantScoped, externalId: string): Promise<MarketplaceCaptureRecord | null>;
}

export interface MarketplaceCaptureAuditPort {
  append?(
    context: TenantScoped,
    input: {
      readonly tenantId: string;
      readonly actorId?: string | undefined;
      readonly action: string;
      readonly targetType: string;
      readonly targetId: string;
      readonly correlationId: string;
      readonly requestId?: string | undefined;
      readonly metadata?: Readonly<Record<string, unknown>> | undefined;
    },
  ): Promise<unknown>;
}

export interface MarketplaceCaptureServiceDependencies {
  readonly marketplaceAcquisition: MarketplaceCaptureRepositoryPort;
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

const parserVersion = "marketplace-capture-normalizer-v1";
const tenantScope = (context: MarketplaceCaptureServiceContext): TenantScoped => ({ tenantId: context.tenantId });
const truncate = (value: string | undefined, max: number): string | undefined => value === undefined ? undefined : value.trim().slice(0, max);

const normalizeUrl = (input: string, options: { readonly removeTrailingSlash: boolean }): string => {
  const parsed = new URL(input.trim());
  parsed.hostname = parsed.hostname.toLowerCase();
  if (options.removeTrailingSlash && parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
  }
  return parsed.toString();
};

const detectedSourceKey = (listingUrl: string): string | undefined => {
  const hostname = new URL(listingUrl).hostname.toLowerCase().replace(/^www\./u, "");
  if (hostname === "jiji.com.gh" || hostname.endsWith(".jiji.com.gh")) return "jiji";
  if (hostname === "tonaton.com" || hostname.endsWith(".tonaton.com")) return "tonaton";
  if (hostname === "facebook.com" || hostname.endsWith(".facebook.com")) return "facebook_marketplace";
  return undefined;
};

const currencyGhs = "G" + "HS";
const currencyUsd = "U" + "SD";

const parsePriceText = (priceText: string | undefined): { readonly price?: string | undefined; readonly currency?: string | undefined; readonly warning?: string | undefined } => {
  if (priceText === undefined) return {};

  const normalized = priceText.trim();
  const amountPattern = /^(?<amount>\d{1,9}(?:,\d{3})*(?:\.\d{1,2})?|\d{1,9}(?:\.\d{1,2})?)$/u;

  const parseAmount = (value: string): string | undefined => {
    const amount = amountPattern.exec(value.trim())?.groups?.amount;
    return amount === undefined ? undefined : amount.replace(/,/gu, "");
  };

  const symbol = normalized[0];
  if (symbol === "₵" || symbol === String.fromCharCode(36)) {
    const price = parseAmount(normalized.slice(1));
    if (price === undefined) return { warning: "PRICE_UNPARSED" };
    return { price, currency: symbol === "₵" ? currencyGhs : currencyUsd };
  }

  // Handle GH₵ prefix (Ghana cedis with country code)
  if (normalized.startsWith("GH₵")) {
    const price = parseAmount(normalized.slice(3));
    if (price === undefined) return { warning: "PRICE_UNPARSED" };
    return { price, currency: currencyGhs };
  }

  const [maybeCurrency, ...amountParts] = normalized.split(/\s+/u);
  const upperCurrency = maybeCurrency?.toUpperCase();

  if ((upperCurrency === currencyGhs || upperCurrency === currencyUsd) && amountParts.length > 0) {
    const price = parseAmount(amountParts.join(""));
    if (price === undefined) return { warning: "PRICE_UNPARSED" };
    return { price, currency: upperCurrency };
  }

  return { warning: "PRICE_UNPARSED" };
};

const metadataFor = (request: MarketplaceCaptureCreateRequest, sourceKey: string | undefined, warnings: readonly string[]): Readonly<Record<string, unknown>> => ({
  parserVersion,
  ...(sourceKey === undefined ? {} : { detectedSourceKey: sourceKey }),
  ...(request.priceText === undefined ? {} : { originalPriceText: request.priceText }),
  ...(request.imageUrls.length === 0 ? {} : { imageUrls: request.imageUrls }),
  ...(Object.keys(request.rawExtract).length === 0 ? {} : { rawExtract: request.rawExtract }),
  ...(warnings.length === 0 ? {} : { normalizationWarnings: warnings }),
});

const isPersistenceConflict = (error: unknown): error is PersistenceError =>
  error instanceof PersistenceError && error.code === "PERSISTENCE_CONFLICT";

const toResponse = (record: MarketplaceCaptureRecord, duplicate: boolean, normalizationWarnings: readonly string[]): MarketplaceCaptureResponse => marketplaceCaptureResponseSchema.parse({
  id: record.id,
  tenantId: record.tenantId,
  listingUrl: record.listingUrl,
  sourceListingUrl: record.listingUrl,
  marketplaceSourceId: record.marketplaceSourceId,
  externalId: record.externalId,
  title: record.title,
  status: record.status,
  duplicate,
  normalizationWarnings,
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
    const listingUrl = normalizeUrl(request.sourceUrl, { removeTrailingSlash: true });
    const sellerProfileUrl = request.sellerProfileUrl === undefined ? undefined : normalizeUrl(request.sellerProfileUrl, { removeTrailingSlash: false });
    const scope = tenantScope(context);
    const warnings: string[] = [];

    const existingByListingUrl = await this.dependencies.marketplaceAcquisition.findMarketplaceCaptureByListingUrl(scope, listingUrl);
    if (existingByListingUrl !== null) {
      return { capture: toResponse(existingByListingUrl, true, warnings), isNew: false, duplicate: true, normalizationWarnings: warnings };
    }

    if (request.externalId !== undefined) {
      const existingByExternalId = await this.dependencies.marketplaceAcquisition.findMarketplaceCaptureByExternalId(scope, request.externalId);
      if (existingByExternalId !== null) {
        return { capture: toResponse(existingByExternalId, true, warnings), isNew: false, duplicate: true, normalizationWarnings: warnings };
      }
    }

    const price = parsePriceText(request.priceText);
    if (price.warning !== undefined) warnings.push(price.warning);
    const sourceKey = detectedSourceKey(listingUrl);
    const input: CreateMarketplaceCaptureInput = {
      tenantId: context.tenantId,
      listingUrl,
      externalId: request.externalId,
      title: truncate(request.title, 300) ?? request.title,
      description: truncate(request.description, 3000),
      price: price.price,
      currency: price.currency,
      sellerProfileUrl,
      metadata: metadataFor(request, sourceKey, warnings),
      status: "CAPTURED",
    };

    let created: MarketplaceCaptureRecord;
    try {
      created = await this.dependencies.marketplaceAcquisition.createMarketplaceCapture(scope, input);
    } catch (error) {
      if (!isPersistenceConflict(error)) throw error;

      const duplicate = await this.dependencies.marketplaceAcquisition.findMarketplaceCaptureByListingUrl(scope, listingUrl);
      if (duplicate === null) throw error;

      return { capture: toResponse(duplicate, true, warnings), isNew: false, duplicate: true, normalizationWarnings: warnings };
    }

    await this.dependencies.auditLogs?.append?.(scope, {
      tenantId: context.tenantId,
      actorId: context.actorId,
      action: "MARKETPLACE_CAPTURE_CREATED",
      targetType: "MARKETPLACE_CAPTURE",
      targetId: created.id,
      correlationId: context.correlation.correlationId,
      requestId: context.correlation.requestId,
      metadata: { sourceHost: new URL(created.listingUrl).host, detectedSourceKey: sourceKey },
    });
    return { capture: toResponse(created, false, warnings), isNew: true, duplicate: false, normalizationWarnings: warnings };
  }
}
