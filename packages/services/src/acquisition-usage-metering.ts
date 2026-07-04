import { z } from "zod";

import type {
  AcquisitionUsageEventRecord,
  AcquisitionUsageEventRepository,
  AcquisitionUsageEventSummary,
  AcquisitionUsageEventType,
} from "@whisperm/repositories";
import type { TenantScoped } from "@whisperm/types";

export type { AcquisitionUsageEventRecord, AcquisitionUsageEventSummary, AcquisitionUsageEventTotal, AcquisitionUsageEventType } from "@whisperm/repositories";

const scopeSchema = z.object({ tenantId: z.string().trim().min(1) }).strict();

const usageEventTypeSchema = z.enum([
  "SELLER_DISCOVERED",
  "SELLER_QUALIFIED",
  "INVITATION_SENT",
  "SELLER_CLAIMED",
  "CRM_CONVERSION_CREATED",
  "REVENUE_ATTRIBUTED",
  "GROWTH_LOOP_EVALUATED",
  "GROWTH_RECOMMENDATION_APPLIED",
]);

export interface RecordAcquisitionUsageEventInput {
  readonly eventType: AcquisitionUsageEventType;
  readonly quantity?: number | undefined;
  readonly campaignId?: string | undefined;
  readonly captureId?: string | undefined;
  readonly contactId?: string | undefined;
  readonly dealId?: string | undefined;
  readonly runtimeExecutionId?: string | undefined;
  readonly idempotencyKey: string;
  readonly occurredAt?: Date | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly billable?: boolean | undefined;
}

const recordUsageEventInputSchema = z.object({
  eventType: usageEventTypeSchema,
  quantity: z.number().int().positive().optional(),
  campaignId: z.string().trim().min(1).optional(),
  captureId: z.string().trim().min(1).optional(),
  contactId: z.string().trim().min(1).optional(),
  dealId: z.string().trim().min(1).optional(),
  runtimeExecutionId: z.string().trim().min(1).optional(),
  idempotencyKey: z.string().trim().min(1),
  occurredAt: z.date().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  billable: z.boolean().optional(),
}).strict();

export interface GetUsageSummaryInput {
  readonly periodStart: Date;
  readonly periodEnd: Date;
}

const getUsageSummaryInputSchema = z.object({
  periodStart: z.date(),
  periodEnd: z.date(),
}).strict().refine((input) => input.periodStart.getTime() <= input.periodEnd.getTime(), {
  message: "periodStart must not be after periodEnd",
  path: ["periodStart"],
});

export interface AcquisitionUsageMeteringDependencies {
  readonly usageEvents: AcquisitionUsageEventRepository;
  readonly clock?: (() => Date) | undefined;
}

/**
 * Centralized, tenant-scoped billable-usage ledger for the autonomous
 * acquisition runtime (CS-018/019/020). It is the single place that answers
 * "what did this tenant consume, when, from which campaign/runtime, and is
 * it billable" -- CS-022 governance and a future billing/invoicing slice
 * both read from it instead of deriving counts ad hoc. It never mutates
 * billing plans and never talks to a payment provider.
 */
export class AcquisitionUsageMeteringService {
  constructor(private readonly deps: AcquisitionUsageMeteringDependencies) {}

  async recordUsageEvent(scopeInput: TenantScoped, input: RecordAcquisitionUsageEventInput): Promise<AcquisitionUsageEventRecord> {
    const scope = scopeSchema.parse(scopeInput) as TenantScoped;
    const data = recordUsageEventInputSchema.parse(input);
    const occurredAt = data.occurredAt ?? this.deps.clock?.() ?? new Date();

    return this.deps.usageEvents.createIfNotExists(scope, {
      tenantId: scope.tenantId,
      eventType: data.eventType,
      quantity: data.quantity ?? 1,
      billable: data.billable ?? true,
      campaignId: data.campaignId,
      captureId: data.captureId,
      contactId: data.contactId,
      dealId: data.dealId,
      runtimeExecutionId: data.runtimeExecutionId,
      idempotencyKey: data.idempotencyKey,
      occurredAt: occurredAt.toISOString(),
      metadata: data.metadata,
    });
  }

  async getUsageSummary(scopeInput: TenantScoped, input: GetUsageSummaryInput): Promise<AcquisitionUsageEventSummary> {
    const scope = scopeSchema.parse(scopeInput) as TenantScoped;
    const data = getUsageSummaryInputSchema.parse(input);
    return this.deps.usageEvents.summarizeByTenantAndPeriod(scope, data.periodStart, data.periodEnd);
  }
}

/**
 * Best-effort usage recording for low-risk runtime success points: a
 * metering failure must never fail the business operation it instruments.
 * Callers that need metering to be authoritative for governance should call
 * AcquisitionUsageMeteringService.recordUsageEvent directly instead.
 */
export const recordUsageEventBestEffort = async (
  service: Pick<AcquisitionUsageMeteringService, "recordUsageEvent">,
  scope: TenantScoped,
  input: RecordAcquisitionUsageEventInput,
  onError?: (error: unknown) => void,
): Promise<AcquisitionUsageEventRecord | null> => {
  try {
    return await service.recordUsageEvent(scope, input);
  } catch (error) {
    onError?.(error);
    return null;
  }
};
