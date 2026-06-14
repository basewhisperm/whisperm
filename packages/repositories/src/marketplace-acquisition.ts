import { z } from "zod";

import { PersistenceError, assertTenantScope, type TenantScoped } from "@whisperm/types";
import type { Page, PageRequest, PrismaPersistenceClient } from "./index.js";

const isoDateSchema = z.string().datetime();
const metadataSchema = z.record(z.string(), z.unknown()).default({});
const decimalLikeSchema = z.preprocess((value) => (typeof value === "object" && value !== null && "toString" in value) ? String(value) : value, z.union([z.number(), z.string()]));
const pageRequestSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).optional(),
}).strict();

const marketplaceCaptureStatusSchema = z.enum(["CAPTURED", "INVITED", "CLAIM_STARTED", "CLAIMED", "CONVERTED", "EXPIRED"]);

export const marketplaceCaptureRecordSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  marketplaceSourceId: z.string().min(1).nullable().optional(),
  contactId: z.string().min(1).nullable().optional(),
  dealId: z.string().min(1).nullable().optional(),
  externalId: z.string().min(1).nullable().optional(),
  listingUrl: z.string().url(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  price: decimalLikeSchema.nullable().optional(),
  currency: z.string().min(3).max(3).nullable().optional(),
  sellerName: z.string().min(1).nullable().optional(),
  sellerProfileUrl: z.string().url().nullable().optional(),
  status: marketplaceCaptureStatusSchema,
  capturedAt: isoDateSchema,
  metadata: metadataSchema.nullable().optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
}).strict();
export type MarketplaceCaptureRecord = z.output<typeof marketplaceCaptureRecordSchema>;
export type CreateMarketplaceCaptureInput = TenantScoped & Pick<MarketplaceCaptureRecord, "listingUrl" | "title" | "status"> & Partial<Pick<MarketplaceCaptureRecord, "marketplaceSourceId" | "contactId" | "dealId" | "externalId" | "description" | "price" | "currency" | "sellerName" | "sellerProfileUrl" | "metadata">>;

export interface MarketplaceAcquisitionRepository {
  createMarketplaceCapture(context: TenantScoped, input: CreateMarketplaceCaptureInput): Promise<MarketplaceCaptureRecord>;
  findMarketplaceCaptureByListingUrl(context: TenantScoped, listingUrl: string): Promise<MarketplaceCaptureRecord | null>;
  findMarketplaceCaptureByExternalId(context: TenantScoped, externalId: string): Promise<MarketplaceCaptureRecord | null>;
  findMarketplaceCaptureByDealId(context: TenantScoped, dealId: string): Promise<MarketplaceCaptureRecord | null>;
  updateMarketplaceCaptureMetadata(context: TenantScoped, id: string, metadata: Readonly<Record<string, unknown>>): Promise<MarketplaceCaptureRecord>;
  listMarketplaceCaptures(context: TenantScoped, pagination?: PageRequest): Promise<Page<MarketplaceCaptureRecord>>;
}

type SortDirection = "asc" | "desc";
type PrismaWhere = Readonly<Record<string, unknown>>;
type PrismaData = Readonly<Record<string, unknown>>;
interface MarketplaceCaptureDelegate {
  create(args: { readonly data: PrismaData }): Promise<unknown>;
  findFirst(args: { readonly where: PrismaWhere; readonly take?: number; readonly orderBy?: Readonly<Record<string, SortDirection>> }): Promise<unknown | null>;
  findMany(args: { readonly where: PrismaWhere; readonly take?: number; readonly orderBy?: Readonly<Record<string, SortDirection>> }): Promise<readonly unknown[]>;
  update(args: { readonly where: PrismaWhere; readonly data: PrismaData }): Promise<unknown>;
}

const normalizeRecord = (value: unknown): unknown => {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeRecord);
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, normalizeRecord(nested)]));
};

const parseRecord = (value: unknown): MarketplaceCaptureRecord => marketplaceCaptureRecordSchema.parse(normalizeRecord(value));
const dataWithDefined = (input: Readonly<Record<string, unknown>>): PrismaData => Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
const ensureContext = (context: TenantScoped): void => { z.object({ tenantId: z.string().min(1) }).strict().parse(context); };
const ensureTenantInput = (context: TenantScoped, input: TenantScoped): void => { ensureContext(context); assertTenantScope(context, input); };
const byTenantListingUrl = (context: TenantScoped, listingUrl: string): PrismaWhere => ({ tenantId: context.tenantId, listingUrl });
const byTenantExternalId = (context: TenantScoped, externalId: string): PrismaWhere => ({ tenantId: context.tenantId, externalId });
const byTenantDealId = (context: TenantScoped, dealId: string): PrismaWhere => ({ tenantId: context.tenantId, dealId });
const byTenantId = (context: TenantScoped, id: string): PrismaWhere => ({ tenantId: context.tenantId, id });
const cursorWhere = (context: TenantScoped, cursor?: string): PrismaWhere => cursor === undefined ? { tenantId: context.tenantId } : { tenantId: context.tenantId, id: { gt: cursor } };

const pageArgs = (page?: PageRequest): { readonly take: number; readonly cursor?: string } => {
  const parsed = pageRequestSchema.parse(page ?? {});
  return parsed.cursor === undefined ? { take: (parsed.limit ?? 25) + 1 } : { take: (parsed.limit ?? 25) + 1, cursor: parsed.cursor };
};

const paginate = (items: readonly MarketplaceCaptureRecord[], limit: number): Page<MarketplaceCaptureRecord> => {
  const pageItems = items.slice(0, limit);
  const extra = items.length > limit;
  const last = pageItems[pageItems.length - 1];
  return extra && last !== undefined ? { items: pageItems, nextCursor: last.id } : { items: pageItems };
};

const mapPrismaError = (error: unknown): never => {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
  if (code === "P2002") throw new PersistenceError({ code: "PERSISTENCE_CONFLICT", message: "Marketplace capture already exists", status: 409 });
  if (error instanceof PersistenceError) throw error;
  throw new PersistenceError({ code: "PERSISTENCE_TRANSIENT", message: "Marketplace acquisition repository operation failed", status: 503 });
};

export class PrismaMarketplaceAcquisitionRepository implements MarketplaceAcquisitionRepository {
  private readonly captures: MarketplaceCaptureDelegate;

  constructor(prisma: PrismaPersistenceClient) {
    this.captures = prisma.marketplaceCapture as MarketplaceCaptureDelegate;
  }

  async createMarketplaceCapture(context: TenantScoped, input: CreateMarketplaceCaptureInput): Promise<MarketplaceCaptureRecord> {
    ensureTenantInput(context, input);
    try {
      return parseRecord(await this.captures.create({ data: dataWithDefined(input) }));
    } catch (error) {
      return mapPrismaError(error);
    }
  }

  async findMarketplaceCaptureByListingUrl(context: TenantScoped, listingUrl: string): Promise<MarketplaceCaptureRecord | null> {
    ensureContext(context);
    const result = await this.captures.findFirst({ where: byTenantListingUrl(context, listingUrl) });
    return result === null ? null : parseRecord(result);
  }

  async findMarketplaceCaptureByExternalId(context: TenantScoped, externalId: string): Promise<MarketplaceCaptureRecord | null> {
    ensureContext(context);
    const result = await this.captures.findFirst({ where: byTenantExternalId(context, externalId) });
    return result === null ? null : parseRecord(result);
  }

  async findMarketplaceCaptureByDealId(context: TenantScoped, dealId: string): Promise<MarketplaceCaptureRecord | null> {
    ensureContext(context);
    const result = await this.captures.findFirst({ where: byTenantDealId(context, dealId) });
    return result === null ? null : parseRecord(result);
  }

  async updateMarketplaceCaptureMetadata(context: TenantScoped, id: string, metadata: Readonly<Record<string, unknown>>): Promise<MarketplaceCaptureRecord> {
    ensureContext(context);
    try {
      return parseRecord(await this.captures.update({ where: byTenantId(context, id), data: { metadata } }));
    } catch (error) {
      return mapPrismaError(error);
    }
  }

  async listMarketplaceCaptures(context: TenantScoped, pagination?: PageRequest): Promise<Page<MarketplaceCaptureRecord>> {
    ensureContext(context);
    const args = pageArgs(pagination);
    const rows = await this.captures.findMany({ where: cursorWhere(context, args.cursor), take: args.take, orderBy: { id: "asc" } });
    return paginate(rows.map(parseRecord), args.take - 1);
  }
}
