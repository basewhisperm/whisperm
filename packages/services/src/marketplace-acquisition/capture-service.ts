import { z } from "zod";

import type { ContactRecord, MarketplaceAcquisitionRepository, MarketplaceCaptureRecord, CreateMarketplaceCaptureInput } from "@whisperm/repositories";
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
  correlation: z.object({ correlationId: z.string().min(1), requestId: z.string().min(1).optional(), causationId: z.string().min(1).optional() }).strict(),
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

export interface MarketplaceCaptureContactMatchingPort {
  findByEmails?(context: TenantScoped, emails: readonly string[]): Promise<readonly ContactRecord[]>;
  list?(context: TenantScoped, pagination?: { readonly limit?: number | undefined }): Promise<{ readonly items: readonly ContactRecord[] }>;
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
  readonly contacts?: MarketplaceCaptureContactMatchingPort | undefined;
  readonly auditLogs?: MarketplaceCaptureAuditPort | undefined;
}

export class MarketplaceCaptureServiceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Readonly<Record<string, unknown>> | undefined;

  constructor(input: { readonly code: string; readonly message: string; readonly status: number; readonly details?: Readonly<Record<string, unknown>> | undefined; readonly cause?: unknown }) {
    super(input.message);
    this.name = "MarketplaceCaptureServiceError";
    this.code = input.code;
    this.status = input.status;
    this.details = input.details;
    this.cause = input.cause;
  }
}

const normalizeSourceUrl = (sourceUrl: string): string => new URL(sourceUrl).toString();
const tenantScope = (context: MarketplaceCaptureServiceContext): TenantScoped => ({ tenantId: context.tenantId });
const truncateDescription = (description: string | undefined): string | undefined => description === undefined ? undefined : description.slice(0, 5000);

const parsePriceText = (priceText: string | undefined): { readonly priceAmount?: string | undefined; readonly currency?: string | undefined } => {
  if (priceText === undefined) return {};
  const normalized = priceText.trim();
  const match = /^(?<symbol>[$€£])\s?(?<amount>\d{1,9}(?:,\d{3})*(?:\.\d{1,2})?|\d{1,9}(?:\.\d{1,2})?)$/u.exec(normalized);
  if (match?.groups === undefined) return {};
  const currencyBySymbol: Readonly<Record<string, string>> = { "$": "USD", "€": "EUR", "£": "GBP" };
  const symbol = match.groups.symbol;
  const amount = match.groups.amount;
  if (symbol === undefined || amount === undefined) return {};
  const currency = currencyBySymbol[symbol];
  if (currency === undefined) return {};
  return { priceAmount: amount.replace(/,/gu, ""), currency };
};

const toResponse = (record: MarketplaceCaptureRecord): MarketplaceCaptureResponse => marketplaceCaptureResponseSchema.parse({
  id: record.id,
  tenantId: record.tenantId,
  sourceListingUrl: record.sourceListingUrl,
  contactId: record.contactId,
  sellerName: record.sellerName,
  sellerProfileUrl: record.sellerProfileUrl,
  title: record.title,
  status: record.status,
  createdAt: record.createdAt,
});

const readText = (value: unknown): string | undefined => typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const rawText = (rawExtract: Readonly<Record<string, unknown>>, keys: readonly string[]): string | undefined => {
  for (const key of keys) {
    const value = readText(rawExtract[key]);
    if (value !== undefined) return value;
  }
  return undefined;
};

const normalizeEmail = (email: string | undefined): string | undefined => email === undefined ? undefined : email.trim().toLowerCase();
const normalizeName = (name: string | undefined): string | undefined => name === undefined ? undefined : name.toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim().replace(/\s+/gu, " ");

const contactDisplayName = (contact: ContactRecord): string | undefined => {
  const parts = [contact.firstName, contact.lastName].flatMap((part) => part === undefined || part === null ? [] : [part]);
  return parts.length === 0 ? undefined : parts.join(" ");
};

const extractSellerProfileUrl = (rawExtract: Readonly<Record<string, unknown>>): string | undefined => {
  const url = rawText(rawExtract, ["sellerProfileUrl", "sellerUrl", "profileUrl"]);
  if (url === undefined) return undefined;
  try {
    return new URL(url).toString();
  } catch {
    return undefined;
  }
};

const extractSeller = (request: MarketplaceCaptureCreateRequest): { readonly name?: string | undefined; readonly email?: string | undefined; readonly profileUrl?: string | undefined } => {
  const rawExtract = request.rawExtract;
  const name = rawText(rawExtract, ["sellerName", "seller", "dealerName", "contactName"]);
  const email = normalizeEmail(rawText(rawExtract, ["sellerEmail", "contactEmail", "email"]));
  return { name, email, profileUrl: extractSellerProfileUrl(rawExtract) };
};

const findBestContactMatch = async (contacts: MarketplaceCaptureContactMatchingPort | undefined, context: TenantScoped, seller: ReturnType<typeof extractSeller>): Promise<ContactRecord | undefined> => {
  if (contacts === undefined) return undefined;
  if (seller.email !== undefined && contacts.findByEmails !== undefined) {
    const emailMatches = await contacts.findByEmails(context, [seller.email]);
    const exactEmailMatch = emailMatches.find((contact) => normalizeEmail(contact.email ?? undefined) === seller.email);
    if (exactEmailMatch !== undefined) return exactEmailMatch;
  }

  const sellerName = normalizeName(seller.name);
  if (sellerName === undefined || contacts.list === undefined) return undefined;
  const listed = await contacts.list(context, { limit: 100 });
  return listed.items.find((contact) => normalizeName(contactDisplayName(contact)) === sellerName);
};

export class MarketplaceCaptureService {
  constructor(private readonly dependencies: MarketplaceCaptureServiceDependencies) {}

  async createCapture(contextInput: MarketplaceCaptureServiceContext, requestInput: MarketplaceCaptureCreateRequest): Promise<MarketplaceCaptureServiceResult> {
    const context = serviceContextSchema.parse(contextInput);
    const request = marketplaceCaptureCreateRequestSchema.parse(requestInput);
    const sourceListingUrl = normalizeSourceUrl(request.sourceUrl);
    const sourceHost = request.sourceHost ?? new URL(sourceListingUrl).host.toLowerCase();
    const existing = await this.dependencies.marketplaceAcquisition.findMarketplaceCaptureBySourceUrl(tenantScope(context), sourceListingUrl);
    if (existing !== null) {
      return { capture: toResponse(existing), isNew: false };
    }

    const price = parsePriceText(request.priceText);
    const seller = extractSeller(request);
    const contactMatch = await findBestContactMatch(this.dependencies.contacts, tenantScope(context), seller);
    const input: CreateMarketplaceCaptureInput = {
      tenantId: context.tenantId,
      sourceListingUrl,
      sourceHost,
      contactId: contactMatch?.id,
      sellerName: seller.name,
      sellerProfileUrl: seller.profileUrl,
      title: request.title,
      description: truncateDescription(request.description),
      priceText: request.priceText,
      priceAmount: price.priceAmount,
      currency: price.currency,
      imageUrls: request.imageUrls,
      rawExtract: request.rawExtract,
      status: "CAPTURED",
    };

    const created = await this.dependencies.marketplaceAcquisition.createMarketplaceCapture(tenantScope(context), input);
    await this.dependencies.auditLogs?.append?.(tenantScope(context), {
      tenantId: context.tenantId,
      actorId: context.actorId,
      action: "MARKETPLACE_CAPTURE_CREATED",
      targetType: "MARKETPLACE_CAPTURE",
      targetId: created.id,
      correlationId: context.correlation.correlationId,
      requestId: context.correlation.requestId,
      metadata: { sourceHost: created.sourceHost, contactId: created.contactId ?? null },
    });
    return { capture: toResponse(created), isNew: true };
  }
}
