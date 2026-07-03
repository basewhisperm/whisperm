import { z } from "zod";

import { PersistenceError, assertTenantScope, type TenantScoped } from "@whisperm/types";
import type { Page, PageRequest, PrismaPersistenceClient } from "./index.js";

const isoDateSchema = z.string().datetime();
const metadataSchema = z.record(z.string(), z.unknown()).default({});
const decimalLikeSchema = z.preprocess((value) => (typeof value === "object" && value !== null && typeof (value as { toNumber?: unknown }).toNumber === "function") ? String(value) : value, z.union([z.number(), z.string()]));
const pageRequestSchema = z.object({ limit: z.number().int().min(1).max(100).optional(), cursor: z.string().min(1).optional() }).strict();

export const businessGrowthOpportunityStatusSchema = z.enum(["IDENTIFIED", "QUALIFIED", "NEEDS_REVIEW", "REJECTED", "INVITED", "CLAIMED", "CONVERTED", "ARCHIVED"]);
export type BusinessGrowthOpportunityStatus = z.output<typeof businessGrowthOpportunityStatusSchema>;

export const businessGrowthOpportunityRecordSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  marketplaceCaptureId: z.string().min(1).nullable().optional(),
  discoveredSellerId: z.string().min(1).nullable().optional(),
  campaignId: z.string().min(1).nullable().optional(),
  contactId: z.string().min(1).nullable().optional(),
  dealId: z.string().min(1).nullable().optional(),
  draftInventoryId: z.string().min(1).nullable().optional(),
  status: businessGrowthOpportunityStatusSchema,
  qualificationStatus: z.string().min(1).nullable().optional(),
  qualificationScore: decimalLikeSchema.nullable().optional(),
  qualificationReasons: metadataSchema.nullable().optional(),
  sourceType: z.string().min(1).nullable().optional(),
  sourceUrl: z.string().min(1).nullable().optional(),
  sourceKey: z.string().min(1).nullable().optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
}).strict();
export type BusinessGrowthOpportunityRecord = z.output<typeof businessGrowthOpportunityRecordSchema>;

export interface OpportunityQualificationInput {
  readonly status: string;
  readonly score?: number | string | undefined;
  readonly reasons?: Readonly<Record<string, unknown>> | readonly string[] | undefined;
}

export type CreateOrUpdateBusinessGrowthOpportunityInput = TenantScoped & {
  readonly marketplaceCaptureId?: string | undefined;
  readonly discoveredSellerId?: string | undefined;
  readonly campaignId?: string | undefined;
  readonly contactId?: string | undefined;
  readonly dealId?: string | undefined;
  readonly draftInventoryId?: string | undefined;
  readonly status?: BusinessGrowthOpportunityStatus | undefined;
  readonly qualificationStatus?: string | undefined;
  readonly qualificationScore?: number | string | undefined;
  readonly qualificationReasons?: Readonly<Record<string, unknown>> | readonly string[] | undefined;
  readonly sourceType?: string | undefined;
  readonly sourceUrl?: string | undefined;
  readonly sourceKey?: string | undefined;
};

export interface BusinessGrowthOpportunityRepository {
  createOrUpdateFromMarketplaceCapture(context: TenantScoped, input: CreateOrUpdateBusinessGrowthOpportunityInput & { readonly marketplaceCaptureId: string }): Promise<BusinessGrowthOpportunityRecord>;
  createOrUpdateFromDiscoveredSeller(context: TenantScoped, input: CreateOrUpdateBusinessGrowthOpportunityInput & { readonly discoveredSellerId: string }): Promise<BusinessGrowthOpportunityRecord>;
  findByMarketplaceCaptureId(context: TenantScoped, marketplaceCaptureId: string): Promise<BusinessGrowthOpportunityRecord | null>;
  findByDiscoveredSellerId(context: TenantScoped, discoveredSellerId: string): Promise<BusinessGrowthOpportunityRecord | null>;
  findByCampaignId(context: TenantScoped, campaignId: string, page?: PageRequest): Promise<Page<BusinessGrowthOpportunityRecord>>;
  linkContact(context: TenantScoped, opportunityId: string, contactId: string): Promise<BusinessGrowthOpportunityRecord>;
  linkDeal(context: TenantScoped, opportunityId: string, dealId: string): Promise<BusinessGrowthOpportunityRecord>;
  linkDraftInventory(context: TenantScoped, opportunityId: string, draftInventoryId: string): Promise<BusinessGrowthOpportunityRecord>;
  updateQualification(context: TenantScoped, opportunityId: string, qualification: OpportunityQualificationInput): Promise<BusinessGrowthOpportunityRecord>;
  updateConversionStatus?(context: TenantScoped, opportunityId: string, status: BusinessGrowthOpportunityStatus): Promise<BusinessGrowthOpportunityRecord>;
}

type PrismaWhere = Readonly<Record<string, unknown>>;
type PrismaData = Readonly<Record<string, unknown>>;
type SortDirection = "asc" | "desc";
interface OpportunityDelegate {
  create(args: { readonly data: PrismaData }): Promise<unknown>;
  findFirst(args: { readonly where: PrismaWhere; readonly take?: number; readonly orderBy?: Readonly<Record<string, SortDirection>> }): Promise<unknown | null>;
  findMany(args: { readonly where: PrismaWhere; readonly take?: number; readonly orderBy?: Readonly<Record<string, SortDirection>> }): Promise<readonly unknown[]>;
  update(args: { readonly where: PrismaWhere; readonly data: PrismaData }): Promise<unknown>;
}

const normalizeRecord = (value: unknown): unknown => {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof (value as { toNumber?: unknown }).toNumber === "function") return (value as { toString(): string }).toString();
  if (Array.isArray(value)) return value.map(normalizeRecord);
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, normalizeRecord(nested)]));
};
const parseRecord = (value: unknown): BusinessGrowthOpportunityRecord => businessGrowthOpportunityRecordSchema.parse(normalizeRecord(value));
const dataWithDefined = (input: Readonly<Record<string, unknown>>): PrismaData => Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
const ensureContext = (context: TenantScoped): void => { z.object({ tenantId: z.string().min(1) }).strict().parse(context); };
const ensureTenantInput = (context: TenantScoped, input: TenantScoped): void => { ensureContext(context); assertTenantScope(context, input); };
const toReasons = (reasons: CreateOrUpdateBusinessGrowthOpportunityInput["qualificationReasons"]): unknown => Array.isArray(reasons) ? { reasons } : reasons;
const toQualificationScore = (score: number | string | undefined): string | undefined => {
  if (score === undefined) return undefined;
  const numeric = typeof score === "number" ? score : Number(score);
  if (!Number.isFinite(numeric)) return String(score);
  return (numeric > 1 ? numeric / 100 : numeric).toFixed(4);
};
const statusFromQualification = (qualificationStatus: string | undefined, fallback: BusinessGrowthOpportunityStatus | undefined): BusinessGrowthOpportunityStatus | undefined => {
  if (qualificationStatus === "QUALIFIED") return "QUALIFIED";
  if (qualificationStatus === "NEEDS_REVIEW") return "NEEDS_REVIEW";
  if (qualificationStatus === "REJECTED") return "REJECTED";
  return fallback;
};
const pageArgs = (page?: PageRequest): { readonly take: number; readonly cursor?: string } => {
  const parsed = pageRequestSchema.parse(page ?? {});
  return parsed.cursor === undefined ? { take: (parsed.limit ?? 25) + 1 } : { take: (parsed.limit ?? 25) + 1, cursor: parsed.cursor };
};
const paginate = <T extends { readonly id: string }>(items: readonly T[], limit: number): Page<T> => {
  const page = items.slice(0, limit);
  if (items.length <= limit) return { items: page };
  const last = page[page.length - 1];
  return last === undefined ? { items: page } : { items: page, nextCursor: last.id };
};
const mapError = (error: unknown): never => {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : undefined;
  if (code === "P2002") throw new PersistenceError({ code: "PERSISTENCE_CONFLICT", message: "Business growth opportunity already exists", status: 409 });
  if (error instanceof PersistenceError) throw error;
  throw new PersistenceError({ code: "PERSISTENCE_TRANSIENT", message: "Business growth opportunity operation failed", status: 503 });
};

export class PrismaBusinessGrowthOpportunityRepository implements BusinessGrowthOpportunityRepository {
  private readonly opportunities: OpportunityDelegate;
  constructor(prisma: PrismaPersistenceClient) {
    this.opportunities = (prisma as unknown as { businessGrowthOpportunity: OpportunityDelegate }).businessGrowthOpportunity;
  }

  async createOrUpdateFromMarketplaceCapture(context: TenantScoped, input: CreateOrUpdateBusinessGrowthOpportunityInput & { readonly marketplaceCaptureId: string }): Promise<BusinessGrowthOpportunityRecord> {
    ensureTenantInput(context, input);
    const existing = await this.findByMarketplaceCaptureId(context, input.marketplaceCaptureId);
    return existing === null ? this.create(input) : this.update(context, existing.id, input);
  }

  async createOrUpdateFromDiscoveredSeller(context: TenantScoped, input: CreateOrUpdateBusinessGrowthOpportunityInput & { readonly discoveredSellerId: string }): Promise<BusinessGrowthOpportunityRecord> {
    ensureTenantInput(context, input);
    const existing = await this.findByDiscoveredSellerId(context, input.discoveredSellerId);
    return existing === null ? this.create(input) : this.update(context, existing.id, input);
  }

  async findByMarketplaceCaptureId(context: TenantScoped, marketplaceCaptureId: string): Promise<BusinessGrowthOpportunityRecord | null> {
    ensureContext(context);
    const result = await this.opportunities.findFirst({ where: { tenantId: context.tenantId, marketplaceCaptureId } });
    return result === null ? null : parseRecord(result);
  }

  async findByDiscoveredSellerId(context: TenantScoped, discoveredSellerId: string): Promise<BusinessGrowthOpportunityRecord | null> {
    ensureContext(context);
    const result = await this.opportunities.findFirst({ where: { tenantId: context.tenantId, discoveredSellerId } });
    return result === null ? null : parseRecord(result);
  }

  async findByCampaignId(context: TenantScoped, campaignId: string, page?: PageRequest): Promise<Page<BusinessGrowthOpportunityRecord>> {
    ensureContext(context);
    const args = pageArgs(page);
    const where = args.cursor === undefined ? { tenantId: context.tenantId, campaignId } : { tenantId: context.tenantId, campaignId, id: { gt: args.cursor } };
    const rows = await this.opportunities.findMany({ where, take: args.take, orderBy: { id: "asc" } });
    return paginate(rows.map(parseRecord), args.take - 1);
  }

  async linkContact(context: TenantScoped, opportunityId: string, contactId: string): Promise<BusinessGrowthOpportunityRecord> {
    return this.update(context, opportunityId, { tenantId: context.tenantId, contactId });
  }

  async linkDeal(context: TenantScoped, opportunityId: string, dealId: string): Promise<BusinessGrowthOpportunityRecord> {
    return this.update(context, opportunityId, { tenantId: context.tenantId, dealId });
  }

  async linkDraftInventory(context: TenantScoped, opportunityId: string, draftInventoryId: string): Promise<BusinessGrowthOpportunityRecord> {
    return this.update(context, opportunityId, { tenantId: context.tenantId, draftInventoryId });
  }

  async updateQualification(context: TenantScoped, opportunityId: string, qualification: OpportunityQualificationInput): Promise<BusinessGrowthOpportunityRecord> {
    ensureContext(context);
    return this.update(context, opportunityId, { tenantId: context.tenantId, qualificationStatus: qualification.status, qualificationScore: qualification.score, qualificationReasons: qualification.reasons, status: statusFromQualification(qualification.status, undefined) });
  }

  async updateConversionStatus(context: TenantScoped, opportunityId: string, status: BusinessGrowthOpportunityStatus): Promise<BusinessGrowthOpportunityRecord> {
    ensureContext(context);
    return this.update(context, opportunityId, { tenantId: context.tenantId, status });
  }

  private async create(input: CreateOrUpdateBusinessGrowthOpportunityInput): Promise<BusinessGrowthOpportunityRecord> {
    try {
      return parseRecord(await this.opportunities.create({ data: this.data(input) }));
    } catch (error) { return mapError(error); }
  }

  private async update(context: TenantScoped, opportunityId: string, input: CreateOrUpdateBusinessGrowthOpportunityInput): Promise<BusinessGrowthOpportunityRecord> {
    ensureTenantInput(context, input);
    try {
      return parseRecord(await this.opportunities.update({ where: { tenantId: context.tenantId, id: opportunityId }, data: this.data(input) }));
    } catch (error) { return mapError(error); }
  }

  private data(input: CreateOrUpdateBusinessGrowthOpportunityInput): PrismaData {
    return dataWithDefined({
      tenantId: input.tenantId,
      marketplaceCaptureId: input.marketplaceCaptureId,
      discoveredSellerId: input.discoveredSellerId,
      campaignId: input.campaignId,
      contactId: input.contactId,
      dealId: input.dealId,
      draftInventoryId: input.draftInventoryId,
      status: statusFromQualification(input.qualificationStatus, input.status) ?? input.status,
      qualificationStatus: input.qualificationStatus,
      qualificationScore: toQualificationScore(input.qualificationScore),
      qualificationReasons: toReasons(input.qualificationReasons),
      sourceType: input.sourceType,
      sourceUrl: input.sourceUrl,
      sourceKey: input.sourceKey,
    });
  }
}
