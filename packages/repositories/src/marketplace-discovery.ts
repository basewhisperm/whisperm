import { z } from "zod";
import { PersistenceError, assertTenantScope, type TenantScoped } from "@whisperm/types";
import type { PrismaPersistenceClient } from "./index.js";

const isoDateSchema = z.string().datetime();
const metadataSchema = z.record(z.string(), z.unknown()).default({});

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const discoveryRunRecordSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  campaignId: z.string().min(1),
  marketplaceSourceId: z.string().min(1),
  status: z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED"]),
  mode: z.enum(["MANUAL_SEED", "CSV_IMPORT", "JIJI_SITEMAP", "TONATON_SITEMAP"]),
  sellersFound: z.number().int().default(0),
  sellersQualified: z.number().int().default(0),
  sellersRejected: z.number().int().default(0),
  sellersDuplicate: z.number().int().default(0),
  startedAt: isoDateSchema.nullable().optional(),
  completedAt: isoDateSchema.nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  config: metadataSchema.nullable().optional(),
  metadata: metadataSchema.nullable().optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
}).strict();

export type DiscoveryRunRecord = z.output<typeof discoveryRunRecordSchema>;

export const discoveredSellerRecordSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  discoveryRunId: z.string().min(1),
  campaignId: z.string().min(1),
  marketplaceSourceId: z.string().min(1),
  sellerIdentityKey: z.string().nullable().optional(),
  status: z.enum(["NEW", "QUALIFYING", "PENDING", "QUALIFIED", "NEEDS_REVIEW", "REJECTED", "DUPLICATE", "PROMOTED"]),
  qualificationScore: z.number().int().min(0).max(100).default(0),
  qualificationPolicy: metadataSchema.nullable().optional(),
  sellerName: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  sellerProfileUrl: z.string().nullable().optional(),
  listingUrl: z.string().min(1),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  price: z.union([z.number(), z.string()]).nullable().optional(),
  currency: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  images: z.array(z.string()).nullable().optional(),
  rawData: metadataSchema.nullable().optional(),
  duplicateOfId: z.string().nullable().optional(),
  promotedCaptureId: z.string().nullable().optional(),
  reviewedAt: isoDateSchema.nullable().optional(),
  reviewedBy: z.string().nullable().optional(),
  metadata: metadataSchema.nullable().optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
}).strict();

export type DiscoveredSellerRecord = z.output<typeof discoveredSellerRecordSchema>;

export type CreateDiscoveryRunInput = TenantScoped & {
  readonly campaignId: string;
  readonly marketplaceSourceId: string;
  readonly mode: DiscoveryRunRecord["mode"];
  readonly config?: Readonly<Record<string, unknown>>;
};

export type UpdateDiscoveryRunInput = Partial<{
  readonly status: DiscoveryRunRecord["status"];
  readonly sellersFound: number;
  readonly sellersQualified: number;
  readonly sellersRejected: number;
  readonly sellersDuplicate: number;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly errorMessage: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}>;

export type CreateDiscoveredSellerInput = TenantScoped & {
  readonly discoveryRunId: string;
  readonly campaignId: string;
  readonly marketplaceSourceId: string;
  readonly listingUrl: string;
  readonly sellerIdentityKey?: string;
  readonly status?: DiscoveredSellerRecord["status"];
  readonly qualificationScore?: number;
  readonly qualificationPolicy?: Readonly<Record<string, unknown>>;
  readonly sellerName?: string;
  readonly phone?: string;
  readonly email?: string;
  readonly sellerProfileUrl?: string;
  readonly title?: string;
  readonly description?: string;
  readonly price?: string | number;
  readonly currency?: string;
  readonly category?: string;
  readonly location?: string;
  readonly images?: readonly string[];
  readonly rawData?: Readonly<Record<string, unknown>>;
  readonly duplicateOfId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface MarketplaceDiscoveryRepository {
  createDiscoveryRun(context: TenantScoped, input: CreateDiscoveryRunInput): Promise<DiscoveryRunRecord>;
  updateDiscoveryRun(context: TenantScoped, runId: string, input: UpdateDiscoveryRunInput): Promise<DiscoveryRunRecord>;
  findDiscoveryRunById(context: TenantScoped, runId: string): Promise<DiscoveryRunRecord | null>;
  listDiscoveryRunsByCampaign(context: TenantScoped, campaignId: string): Promise<readonly DiscoveryRunRecord[]>;
  createDiscoveredSeller(context: TenantScoped, input: CreateDiscoveredSellerInput): Promise<DiscoveredSellerRecord>;
  updateDiscoveredSellerStatus(context: TenantScoped, sellerId: string, status: DiscoveredSellerRecord["status"], extra?: { promotedCaptureId?: string; reviewedBy?: string }): Promise<DiscoveredSellerRecord>;
  updateDiscoveredSellerQualification(context: TenantScoped, sellerId: string, input: { readonly status: DiscoveredSellerRecord["status"]; readonly qualificationScore: number; readonly qualificationPolicy?: Readonly<Record<string, unknown>>; readonly metadata?: Readonly<Record<string, unknown>> }): Promise<DiscoveredSellerRecord>;
  findDiscoveredSellerByListingUrl(context: TenantScoped, runId: string, listingUrl: string): Promise<DiscoveredSellerRecord | null>;
  findDiscoveredSellerByIdentityKey(context: TenantScoped, campaignId: string, sellerIdentityKey: string): Promise<DiscoveredSellerRecord | null>;
  listDiscoveredSellersByRun(context: TenantScoped, runId: string, status?: DiscoveredSellerRecord["status"]): Promise<readonly DiscoveredSellerRecord[]>;
  listDiscoveredSellersByCampaign(context: TenantScoped, campaignId: string, status?: DiscoveredSellerRecord["status"]): Promise<readonly DiscoveredSellerRecord[]>;
  countDiscoveredSellersByCampaign(context: TenantScoped, campaignId: string, status?: DiscoveredSellerRecord["status"]): Promise<number>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type PrismaWhere = Readonly<Record<string, unknown>>;
type PrismaData = Readonly<Record<string, unknown>>;

interface DiscoveryRunDelegate {
  create(args: { readonly data: PrismaData }): Promise<unknown>;
  findFirst(args: { readonly where: PrismaWhere }): Promise<unknown | null>;
  findMany(args: { readonly where: PrismaWhere; readonly orderBy?: PrismaData }): Promise<readonly unknown[]>;
  update(args: { readonly where: PrismaWhere; readonly data: PrismaData }): Promise<unknown>;
}

interface DiscoveredSellerDelegate {
  create(args: { readonly data: PrismaData }): Promise<unknown>;
  findFirst(args: { readonly where: PrismaWhere }): Promise<unknown | null>;
  findMany(args: { readonly where: PrismaWhere; readonly orderBy?: PrismaData }): Promise<readonly unknown[]>;
  update(args: { readonly where: PrismaWhere; readonly data: PrismaData }): Promise<unknown>;
  count(args: { readonly where: PrismaWhere }): Promise<number>;
}

const normalizeRecord = (value: unknown): unknown => {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof (value as { toNumber?: unknown }).toNumber === "function") {
    return (value as { toString(): string }).toString();
  }
  if (Array.isArray(value)) return value.map(normalizeRecord);
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalizeRecord(v)]));
};

const parseRun = (value: unknown): DiscoveryRunRecord =>
  discoveryRunRecordSchema.parse(normalizeRecord(value));

const parseSeller = (value: unknown): DiscoveredSellerRecord =>
  discoveredSellerRecordSchema.parse(normalizeRecord(value));

const dataWithDefined = (input: Readonly<Record<string, unknown>>): PrismaData =>
  Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));

const ensureContext = (context: TenantScoped): void => {
  z.object({ tenantId: z.string().min(1) }).strict().parse(context);
};

const ensureTenantInput = (context: TenantScoped, input: TenantScoped): void => {
  ensureContext(context);
  assertTenantScope(context, input);
};

const mapError = (error: unknown, entity: string): never => {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
  if (code === "P2002") throw new PersistenceError({ code: "PERSISTENCE_CONFLICT", message: `${entity} already exists`, status: 409 });
  if (error instanceof PersistenceError) throw error;
  throw new PersistenceError({ code: "PERSISTENCE_TRANSIENT", message: `${entity} operation failed`, status: 503 });
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class PrismaMarketplaceDiscoveryRepository implements MarketplaceDiscoveryRepository {
  private readonly runs: DiscoveryRunDelegate;
  private readonly sellers: DiscoveredSellerDelegate;

  constructor(prisma: PrismaPersistenceClient) {
    this.runs = (prisma as unknown as { marketplaceDiscoveryRun: DiscoveryRunDelegate }).marketplaceDiscoveryRun;
    this.sellers = (prisma as unknown as { discoveredMarketplaceSeller: DiscoveredSellerDelegate }).discoveredMarketplaceSeller;
  }

  async createDiscoveryRun(context: TenantScoped, input: CreateDiscoveryRunInput): Promise<DiscoveryRunRecord> {
    ensureTenantInput(context, input);
    try {
      return parseRun(await this.runs.create({
        data: dataWithDefined({
          tenantId: input.tenantId,
          campaignId: input.campaignId,
          marketplaceSourceId: input.marketplaceSourceId,
          mode: input.mode,
          status: "PENDING",
          config: input.config,
        }),
      }));
    } catch (error) { return mapError(error, "Discovery run"); }
  }

  async updateDiscoveryRun(context: TenantScoped, runId: string, input: UpdateDiscoveryRunInput): Promise<DiscoveryRunRecord> {
    ensureContext(context);
    try {
      return parseRun(await this.runs.update({
        where: { tenantId: context.tenantId, id: runId },
        data: dataWithDefined(input as Readonly<Record<string, unknown>>),
      }));
    } catch (error) { return mapError(error, "Discovery run"); }
  }

  async findDiscoveryRunById(context: TenantScoped, runId: string): Promise<DiscoveryRunRecord | null> {
    ensureContext(context);
    const result = await this.runs.findFirst({ where: { tenantId: context.tenantId, id: runId } });
    return result === null ? null : parseRun(result);
  }

  async listDiscoveryRunsByCampaign(context: TenantScoped, campaignId: string): Promise<readonly DiscoveryRunRecord[]> {
    ensureContext(context);
    const rows = await this.runs.findMany({
      where: { tenantId: context.tenantId, campaignId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(parseRun);
  }

  async createDiscoveredSeller(context: TenantScoped, input: CreateDiscoveredSellerInput): Promise<DiscoveredSellerRecord> {
    ensureTenantInput(context, input);
    try {
      return parseSeller(await this.sellers.create({
        data: dataWithDefined({
          tenantId: input.tenantId,
          discoveryRunId: input.discoveryRunId,
          campaignId: input.campaignId,
          marketplaceSourceId: input.marketplaceSourceId,
          listingUrl: input.listingUrl,
          sellerIdentityKey: input.sellerIdentityKey,
          status: input.status ?? "PENDING",
          qualificationScore: input.qualificationScore ?? 0,
          qualificationPolicy: input.qualificationPolicy,
          sellerName: input.sellerName,
          phone: input.phone,
          email: input.email,
          sellerProfileUrl: input.sellerProfileUrl,
          title: input.title,
          description: input.description,
          price: input.price,
          currency: input.currency,
          category: input.category,
          location: input.location,
          images: input.images,
          rawData: input.rawData,
          duplicateOfId: input.duplicateOfId,
          metadata: input.metadata,
        }),
      }));
    } catch (error) { return mapError(error, "Discovered seller"); }
  }

  async updateDiscoveredSellerStatus(
    context: TenantScoped,
    sellerId: string,
    status: DiscoveredSellerRecord["status"],
    extra?: { promotedCaptureId?: string; reviewedBy?: string },
  ): Promise<DiscoveredSellerRecord> {
    ensureContext(context);
    try {
      return parseSeller(await this.sellers.update({
        where: { tenantId: context.tenantId, id: sellerId },
        data: dataWithDefined({
          status,
          promotedCaptureId: extra?.promotedCaptureId,
          reviewedBy: extra?.reviewedBy,
          reviewedAt: extra?.reviewedBy !== undefined ? new Date().toISOString() : undefined,
        }),
      }));
    } catch (error) { return mapError(error, "Discovered seller"); }
  }

  async updateDiscoveredSellerQualification(
    context: TenantScoped,
    sellerId: string,
    input: { readonly status: DiscoveredSellerRecord["status"]; readonly qualificationScore: number; readonly qualificationPolicy?: Readonly<Record<string, unknown>>; readonly metadata?: Readonly<Record<string, unknown>> },
  ): Promise<DiscoveredSellerRecord> {
    ensureContext(context);
    try {
      return parseSeller(await this.sellers.update({
        where: { tenantId: context.tenantId, id: sellerId },
        data: dataWithDefined({
          status: input.status,
          qualificationScore: input.qualificationScore,
          qualificationPolicy: input.qualificationPolicy,
          metadata: input.metadata,
        }),
      }));
    } catch (error) { return mapError(error, "Discovered seller"); }
  }

  async findDiscoveredSellerByListingUrl(context: TenantScoped, runId: string, listingUrl: string): Promise<DiscoveredSellerRecord | null> {
    ensureContext(context);
    const result = await this.sellers.findFirst({ where: { tenantId: context.tenantId, discoveryRunId: runId, listingUrl } });
    return result === null ? null : parseSeller(result);
  }

  async findDiscoveredSellerByIdentityKey(context: TenantScoped, campaignId: string, sellerIdentityKey: string): Promise<DiscoveredSellerRecord | null> {
    ensureContext(context);
    const result = await this.sellers.findFirst({
      where: { tenantId: context.tenantId, campaignId, sellerIdentityKey },
    });
    return result === null ? null : parseSeller(result);
  }

  async listDiscoveredSellersByRun(context: TenantScoped, runId: string, status?: DiscoveredSellerRecord["status"]): Promise<readonly DiscoveredSellerRecord[]> {
    ensureContext(context);
    const rows = await this.sellers.findMany({
      where: dataWithDefined({ tenantId: context.tenantId, discoveryRunId: runId, status }),
      orderBy: { qualificationScore: "desc" },
    });
    return rows.map(parseSeller);
  }

  async listDiscoveredSellersByCampaign(context: TenantScoped, campaignId: string, status?: DiscoveredSellerRecord["status"]): Promise<readonly DiscoveredSellerRecord[]> {
    ensureContext(context);
    const rows = await this.sellers.findMany({
      where: dataWithDefined({ tenantId: context.tenantId, campaignId, status }),
      orderBy: { qualificationScore: "desc" },
    });
    return rows.map(parseSeller);
  }

  async countDiscoveredSellersByCampaign(context: TenantScoped, campaignId: string, status?: DiscoveredSellerRecord["status"]): Promise<number> {
    ensureContext(context);
    return this.sellers.count({
      where: dataWithDefined({ tenantId: context.tenantId, campaignId, status }),
    });
  }
}
