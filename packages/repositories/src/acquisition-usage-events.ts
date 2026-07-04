import { z } from "zod";

import { PersistenceError, assertTenantScope, type TenantScoped } from "@whisperm/types";
import type { Page, PageRequest, PrismaPersistenceClient } from "./index.js";

const isoDateSchema = z.string().datetime();
const metadataSchema = z.record(z.string(), z.unknown()).default({});
const pageRequestSchema = z.object({ limit: z.number().int().min(1).max(200).optional(), cursor: z.string().min(1).optional() }).strict();

export const acquisitionUsageEventTypeSchema = z.enum([
  "SELLER_DISCOVERED",
  "SELLER_QUALIFIED",
  "INVITATION_SENT",
  "SELLER_CLAIMED",
  "CRM_CONVERSION_CREATED",
  "REVENUE_ATTRIBUTED",
  "GROWTH_LOOP_EVALUATED",
  "GROWTH_RECOMMENDATION_APPLIED",
]);
export type AcquisitionUsageEventType = z.output<typeof acquisitionUsageEventTypeSchema>;

export const acquisitionUsageEventRecordSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  eventType: acquisitionUsageEventTypeSchema,
  quantity: z.number().int().positive(),
  billable: z.boolean(),
  campaignId: z.string().min(1).nullable().optional(),
  captureId: z.string().min(1).nullable().optional(),
  contactId: z.string().min(1).nullable().optional(),
  dealId: z.string().min(1).nullable().optional(),
  runtimeExecutionId: z.string().min(1).nullable().optional(),
  idempotencyKey: z.string().min(1),
  occurredAt: isoDateSchema,
  metadata: metadataSchema.nullable().optional(),
  createdAt: isoDateSchema,
}).strict();
export type AcquisitionUsageEventRecord = z.output<typeof acquisitionUsageEventRecordSchema>;

export type CreateAcquisitionUsageEventInput = TenantScoped &
  Pick<AcquisitionUsageEventRecord, "eventType" | "idempotencyKey" | "occurredAt"> &
  Partial<Pick<AcquisitionUsageEventRecord, "quantity" | "billable" | "campaignId" | "captureId" | "contactId" | "dealId" | "runtimeExecutionId" | "metadata">>;

export interface AcquisitionUsageEventTotal {
  readonly eventType: AcquisitionUsageEventType;
  readonly quantity: number;
  readonly billableQuantity: number;
  readonly eventCount: number;
}

export interface AcquisitionUsageEventSummary {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly totals: readonly AcquisitionUsageEventTotal[];
  readonly totalQuantity: number;
  readonly billableTotalQuantity: number;
}

/**
 * Narrow, tenant-scoped repository for the CS-023 billable-usage ledger.
 * createIfNotExists is the only write path -- usage events are append-only
 * and never updated, so a retried caller with the same idempotencyKey always
 * gets back the original record instead of a duplicate.
 */
export interface AcquisitionUsageEventRepository {
  createIfNotExists(context: TenantScoped, input: CreateAcquisitionUsageEventInput): Promise<AcquisitionUsageEventRecord>;
  summarizeByTenantAndPeriod(context: TenantScoped, periodStart: Date, periodEnd: Date): Promise<AcquisitionUsageEventSummary>;
  listByTenantAndPeriod(context: TenantScoped, periodStart: Date, periodEnd: Date, page?: PageRequest): Promise<Page<AcquisitionUsageEventRecord>>;
}

type PrismaWhere = Readonly<Record<string, unknown>>;
type PrismaData = Readonly<Record<string, unknown>>;
type SortDirection = "asc" | "desc";
interface UsageEventDelegate {
  create(args: { readonly data: PrismaData }): Promise<unknown>;
  findFirst(args: { readonly where: PrismaWhere; readonly take?: number; readonly orderBy?: Readonly<Record<string, SortDirection>> }): Promise<unknown | null>;
  findMany(args: { readonly where: PrismaWhere; readonly take?: number; readonly orderBy?: Readonly<Record<string, SortDirection>> }): Promise<readonly unknown[]>;
}

const normalizeRecord = (value: unknown): unknown => {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeRecord);
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, normalizeRecord(nested)]));
};
const parseRecord = (value: unknown): AcquisitionUsageEventRecord => acquisitionUsageEventRecordSchema.parse(normalizeRecord(value));
const dataWithDefined = (input: Readonly<Record<string, unknown>>): PrismaData => Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
const ensureContext = (context: TenantScoped): void => { z.object({ tenantId: z.string().min(1) }).strict().parse(context); };
const ensureTenantInput = (context: TenantScoped, input: TenantScoped): void => { ensureContext(context); assertTenantScope(context, input); };

const isUniqueConstraintViolation = (error: unknown): boolean => {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : undefined;
  return code === "P2002";
};

const pageArgs = (page?: PageRequest): { readonly take: number; readonly cursor?: string } => {
  const parsed = pageRequestSchema.parse(page ?? {});
  return parsed.cursor === undefined ? { take: (parsed.limit ?? 50) + 1 } : { take: (parsed.limit ?? 50) + 1, cursor: parsed.cursor };
};
const paginate = <T extends { readonly id: string }>(items: readonly T[], limit: number): Page<T> => {
  const page = items.slice(0, limit);
  if (items.length <= limit) return { items: page };
  const last = page[page.length - 1];
  return last === undefined ? { items: page } : { items: page, nextCursor: last.id };
};

const emptyTotal = (eventType: AcquisitionUsageEventType): AcquisitionUsageEventTotal => ({ eventType, quantity: 0, billableQuantity: 0, eventCount: 0 });

export class PrismaAcquisitionUsageEventRepository implements AcquisitionUsageEventRepository {
  private readonly usageEvents: UsageEventDelegate;

  constructor(prisma: PrismaPersistenceClient) {
    this.usageEvents = (prisma as unknown as { acquisitionUsageEvent: UsageEventDelegate }).acquisitionUsageEvent;
  }

  async createIfNotExists(context: TenantScoped, input: CreateAcquisitionUsageEventInput): Promise<AcquisitionUsageEventRecord> {
    ensureTenantInput(context, input);
    try {
      return parseRecord(await this.usageEvents.create({
        data: dataWithDefined({
          tenantId: context.tenantId,
          eventType: input.eventType,
          quantity: input.quantity ?? 1,
          billable: input.billable ?? true,
          campaignId: input.campaignId,
          captureId: input.captureId,
          contactId: input.contactId,
          dealId: input.dealId,
          runtimeExecutionId: input.runtimeExecutionId,
          idempotencyKey: input.idempotencyKey,
          occurredAt: input.occurredAt,
          metadata: input.metadata,
        }),
      }));
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        const existing = await this.usageEvents.findFirst({ where: { tenantId: context.tenantId, idempotencyKey: input.idempotencyKey } });
        if (existing !== null) return parseRecord(existing);
      }
      throw new PersistenceError({ code: "PERSISTENCE_TRANSIENT", message: "Acquisition usage event could not be recorded", status: 503 });
    }
  }

  async summarizeByTenantAndPeriod(context: TenantScoped, periodStart: Date, periodEnd: Date): Promise<AcquisitionUsageEventSummary> {
    ensureContext(context);
    const rows = await this.usageEvents.findMany({
      where: { tenantId: context.tenantId, occurredAt: { gte: periodStart, lte: periodEnd } },
      orderBy: { occurredAt: "asc" },
    });
    const events = rows.map(parseRecord);

    const totalsByType = new Map<AcquisitionUsageEventType, AcquisitionUsageEventTotal>();
    for (const event of events) {
      const current = totalsByType.get(event.eventType) ?? emptyTotal(event.eventType);
      totalsByType.set(event.eventType, {
        eventType: event.eventType,
        quantity: current.quantity + event.quantity,
        billableQuantity: current.billableQuantity + (event.billable ? event.quantity : 0),
        eventCount: current.eventCount + 1,
      });
    }

    const totals = [...totalsByType.values()].sort((a, b) => a.eventType.localeCompare(b.eventType));
    const totalQuantity = totals.reduce((sum, total) => sum + total.quantity, 0);
    const billableTotalQuantity = totals.reduce((sum, total) => sum + total.billableQuantity, 0);

    return {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      totals,
      totalQuantity,
      billableTotalQuantity,
    };
  }

  async listByTenantAndPeriod(context: TenantScoped, periodStart: Date, periodEnd: Date, page?: PageRequest): Promise<Page<AcquisitionUsageEventRecord>> {
    ensureContext(context);
    const args = pageArgs(page);
    const where = args.cursor === undefined
      ? { tenantId: context.tenantId, occurredAt: { gte: periodStart, lte: periodEnd } }
      : { tenantId: context.tenantId, occurredAt: { gte: periodStart, lte: periodEnd }, id: { gt: args.cursor } };
    const rows = await this.usageEvents.findMany({ where, take: args.take, orderBy: { id: "asc" } });
    return paginate(rows.map(parseRecord), args.take - 1);
  }
}
