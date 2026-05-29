import { z } from "zod";

export const billingCorrelationMetadataSchema = z.object({
  correlationId: z.string().min(1),
  requestId: z.string().min(1).optional(),
  causationId: z.string().min(1).optional(),
  traceId: z.string().min(1).optional(),
  spanId: z.string().min(1).optional()
}).strict();
export type BillingCorrelationMetadata = z.output<typeof billingCorrelationMetadataSchema>;

export const billingMetadataSchema = z.record(z.string(), z.unknown());
export type BillingMetadata = z.output<typeof billingMetadataSchema>;

export const billingProviderValues = ["STRIPE", "PADDLE", "CHARGEBEE", "RECURLY", "AWS_MARKETPLACE", "AZURE_MARKETPLACE", "INTERNAL"] as const;
export const billingProviderSchema = z.enum(billingProviderValues);
export type BillingProvider = z.output<typeof billingProviderSchema>;

export const aiProviderValues = ["OPENAI", "ANTHROPIC", "GEMINI", "AZURE_OPENAI", "CUSTOM"] as const;
export const aiProviderSchema = z.enum(aiProviderValues);
export type AiProvider = z.output<typeof aiProviderSchema>;

export const usageMetricValues = [
  "AI_INPUT_TOKENS",
  "AI_OUTPUT_TOKENS",
  "AI_CACHED_INPUT_TOKENS",
  "AI_REQUESTS",
  "WORKFLOW_RUNS",
  "WORKFLOW_STEPS",
  "RETRIEVAL_QUERIES",
  "RETRIEVAL_VECTOR_READS",
  "STORAGE_BYTES_HOURS",
  "APPROVAL_REQUESTS",
  "EXECUTION_SECONDS"
] as const;
export const usageMetricSchema = z.enum(usageMetricValues);
export type UsageMetric = z.output<typeof usageMetricSchema>;

export const costCategoryValues = ["AI_PROVIDER", "EXECUTION", "WORKFLOW", "RETRIEVAL", "STORAGE", "APPROVAL"] as const;
export const costCategorySchema = z.enum(costCategoryValues);
export type CostCategory = z.output<typeof costCategorySchema>;

export const billingActorSchema = z.object({
  actorId: z.string().min(1),
  actorType: z.enum(["USER", "SERVICE", "WORKER", "AI_AGENT"]),
  tenantId: z.string().min(1)
}).strict();
export type BillingActor = z.output<typeof billingActorSchema>;

export const moneySchema = z.object({
  currency: z.string().length(3).transform((currency) => currency.toUpperCase()),
  amountMinor: z.number().int()
}).strict();
export type Money = z.output<typeof moneySchema>;

export const nonNegativeMoneySchema = moneySchema.refine((money) => money.amountMinor >= 0, { message: "amountMinor must be non-negative", path: ["amountMinor"] });
export type NonNegativeMoney = z.output<typeof nonNegativeMoneySchema>;

export const billingTenantContextSchema = z.object({
  tenantId: z.string().min(1),
  accountId: z.string().min(1),
  subscriptionId: z.string().min(1).optional(),
  planId: z.string().min(1).optional(),
  correlation: billingCorrelationMetadataSchema
}).strict();
export type BillingTenantContext = z.output<typeof billingTenantContextSchema>;

export const subscriptionPlanSchema = z.object({
  planId: z.string().min(1),
  version: z.number().int().min(1),
  name: z.string().min(1),
  providerMappings: z.array(z.object({ provider: billingProviderSchema, externalPlanId: z.string().min(1) }).strict()).default([]),
  includedQuotas: z.array(z.object({ metric: usageMetricSchema, limit: z.number().int().nonnegative(), period: z.enum(["DAY", "MONTH", "BILLING_CYCLE"]) }).strict()).default([]),
  features: z.array(z.string().min(1)).default([]),
  active: z.boolean(),
  metadata: billingMetadataSchema.default({})
}).strict();
export type SubscriptionPlan = z.output<typeof subscriptionPlanSchema>;

export const billingCycleStateValues = ["SCHEDULED", "OPEN", "CLOSED", "INVOICED", "VOIDED"] as const;
export const billingCycleStateSchema = z.enum(billingCycleStateValues);
export type BillingCycleState = z.output<typeof billingCycleStateSchema>;

const billingCycleTransitions: Readonly<Record<BillingCycleState, readonly BillingCycleState[]>> = {
  SCHEDULED: ["OPEN", "VOIDED"],
  OPEN: ["CLOSED", "VOIDED"],
  CLOSED: ["INVOICED", "OPEN", "VOIDED"],
  INVOICED: [],
  VOIDED: []
};

export const canTransitionBillingCycleState = (from: BillingCycleState, to: BillingCycleState): boolean =>
  billingCycleTransitions[from].includes(to);

export const billingCycleSchema = z.object({
  tenantId: z.string().min(1),
  cycleId: z.string().min(1),
  subscriptionId: z.string().min(1),
  state: billingCycleStateSchema,
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  closedAt: z.string().datetime().optional(),
  invoicedAt: z.string().datetime().optional(),
  correlation: billingCorrelationMetadataSchema
}).strict().superRefine((cycle, ctx) => {
  if (Date.parse(cycle.startsAt) >= Date.parse(cycle.endsAt)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "billing cycle startsAt must be before endsAt", path: ["endsAt"] });
  }
  if (cycle.state === "INVOICED" && cycle.invoicedAt === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "INVOICED cycles require invoicedAt", path: ["invoicedAt"] });
  }
});
export type BillingCycle = z.output<typeof billingCycleSchema>;

export const pricingTierSchema = z.object({
  upTo: z.number().int().positive().optional(),
  unitAmountMinor: z.number().int().nonnegative()
}).strict();
export type PricingTier = z.output<typeof pricingTierSchema>;

export const pricingModelSchema = z.object({
  pricingModelId: z.string().min(1),
  planId: z.string().min(1),
  version: z.number().int().min(1),
  metric: usageMetricSchema,
  currency: z.string().length(3).transform((currency) => currency.toUpperCase()),
  model: z.enum(["FLAT", "PER_UNIT", "TIERED", "PACKAGE"]),
  flatAmountMinor: z.number().int().nonnegative().optional(),
  unitAmountMinor: z.number().int().nonnegative().optional(),
  packageSize: z.number().int().positive().optional(),
  tiers: z.array(pricingTierSchema).default([]),
  effectiveAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
  providerMappings: z.array(z.object({ provider: billingProviderSchema, externalPriceId: z.string().min(1) }).strict()).default([]),
  metadata: billingMetadataSchema.default({})
}).strict().superRefine((pricing, ctx) => {
  if (pricing.model === "FLAT" && pricing.flatAmountMinor === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "FLAT pricing requires flatAmountMinor", path: ["flatAmountMinor"] });
  }
  if (pricing.model === "PER_UNIT" && pricing.unitAmountMinor === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "PER_UNIT pricing requires unitAmountMinor", path: ["unitAmountMinor"] });
  }
  if (pricing.model === "PACKAGE" && (pricing.packageSize === undefined || pricing.unitAmountMinor === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "PACKAGE pricing requires packageSize and unitAmountMinor" });
  }
  if (pricing.model === "TIERED" && pricing.tiers.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "TIERED pricing requires tiers", path: ["tiers"] });
  }
});
export type PricingModel = z.output<typeof pricingModelSchema>;

export const usageEventSchema = z.object({
  eventId: z.string().min(1),
  tenantId: z.string().min(1),
  metric: usageMetricSchema,
  quantity: z.number().int().positive(),
  occurredAt: z.string().datetime(),
  source: z.enum(["API", "WORKER", "WORKFLOW", "RETRIEVAL", "APPROVAL", "SYSTEM"]),
  resourceId: z.string().min(1).optional(),
  subjectId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1),
  replaySafe: z.literal(true),
  correlation: billingCorrelationMetadataSchema,
  metadata: billingMetadataSchema.default({})
}).strict();
export type UsageEvent = z.output<typeof usageEventSchema>;

export const meteringRecordSchema = z.object({
  meterId: z.string().min(1),
  tenantId: z.string().min(1),
  eventId: z.string().min(1),
  metric: usageMetricSchema,
  quantity: z.number().int().positive(),
  measuredAt: z.string().datetime(),
  idempotencyKey: z.string().min(1),
  correlation: billingCorrelationMetadataSchema
}).strict();
export type MeteringRecord = z.output<typeof meteringRecordSchema>;

export const usageAggregationWindowSchema = z.object({
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  grain: z.enum(["HOUR", "DAY", "BILLING_CYCLE"])
}).strict().refine((window) => Date.parse(window.startsAt) < Date.parse(window.endsAt), { message: "aggregation startsAt must be before endsAt", path: ["endsAt"] });
export type UsageAggregationWindow = z.output<typeof usageAggregationWindowSchema>;

export const usageAggregateSchema = z.object({
  aggregateId: z.string().min(1),
  tenantId: z.string().min(1),
  metric: usageMetricSchema,
  quantity: z.number().int().nonnegative(),
  window: usageAggregationWindowSchema,
  sourceEventIds: z.array(z.string().min(1)),
  replaySafe: z.literal(true),
  computedAt: z.string().datetime(),
  correlation: billingCorrelationMetadataSchema
}).strict();
export type UsageAggregate = z.output<typeof usageAggregateSchema>;

export const usageSnapshotSchema = z.object({
  snapshotId: z.string().min(1),
  tenantId: z.string().min(1),
  cycleId: z.string().min(1),
  aggregates: z.array(usageAggregateSchema),
  capturedAt: z.string().datetime(),
  replaySafe: z.literal(true),
  correlation: billingCorrelationMetadataSchema
}).strict().superRefine((snapshot, ctx) => {
  for (const [index, aggregate] of snapshot.aggregates.entries()) {
    if (aggregate.tenantId !== snapshot.tenantId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "aggregate tenantId must match snapshot tenantId", path: ["aggregates", index, "tenantId"] });
    }
  }
});
export type UsageSnapshot = z.output<typeof usageSnapshotSchema>;

export const ledgerEntryDirectionSchema = z.enum(["DEBIT", "CREDIT"]);
export type LedgerEntryDirection = z.output<typeof ledgerEntryDirectionSchema>;

export const usageLedgerEntrySchema = z.object({
  ledgerEntryId: z.string().min(1),
  tenantId: z.string().min(1),
  cycleId: z.string().min(1),
  metric: usageMetricSchema,
  quantity: z.number().int().positive(),
  direction: ledgerEntryDirectionSchema,
  sourceEventId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  postedAt: z.string().datetime(),
  replaySafe: z.literal(true),
  correlation: billingCorrelationMetadataSchema
}).strict();
export type UsageLedgerEntry = z.output<typeof usageLedgerEntrySchema>;

export const creditLedgerEntrySchema = z.object({
  creditEntryId: z.string().min(1),
  tenantId: z.string().min(1),
  accountId: z.string().min(1),
  currency: z.string().length(3).transform((currency) => currency.toUpperCase()),
  amountMinor: z.number().int().positive(),
  direction: ledgerEntryDirectionSchema,
  reason: z.enum(["PURCHASE", "PROMOTION", "REFUND", "USAGE_CHARGE", "ADJUSTMENT", "EXPIRATION"]),
  sourceId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  postedAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
  replaySafe: z.literal(true),
  correlation: billingCorrelationMetadataSchema
}).strict();
export type CreditLedgerEntry = z.output<typeof creditLedgerEntrySchema>;

export const tokenAccountingSchema = z.object({
  tenantId: z.string().min(1),
  provider: aiProviderSchema,
  model: z.string().min(1),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative().default(0),
  requestCount: z.number().int().positive(),
  measuredAt: z.string().datetime(),
  correlation: billingCorrelationMetadataSchema
}).strict();
export type TokenAccounting = z.output<typeof tokenAccountingSchema>;

export const aiProviderCostSchema = z.object({
  tenantId: z.string().min(1),
  provider: aiProviderSchema,
  model: z.string().min(1),
  inputCost: nonNegativeMoneySchema,
  outputCost: nonNegativeMoneySchema,
  cachedInputCost: nonNegativeMoneySchema.default({ currency: "USD", amountMinor: 0 }),
  totalCost: nonNegativeMoneySchema,
  providerInvoiceId: z.string().min(1).optional(),
  usageWindow: usageAggregationWindowSchema,
  correlation: billingCorrelationMetadataSchema
}).strict().refine((cost) => cost.inputCost.currency === cost.outputCost.currency && cost.inputCost.currency === cost.cachedInputCost.currency && cost.inputCost.currency === cost.totalCost.currency, {
  message: "AI provider cost currencies must match",
  path: ["totalCost", "currency"]
});
export type AiProviderCost = z.output<typeof aiProviderCostSchema>;

const baseCostAttributionSchema = z.object({
  attributionId: z.string().min(1),
  tenantId: z.string().min(1),
  category: costCategorySchema,
  cost: nonNegativeMoneySchema,
  occurredAt: z.string().datetime(),
  idempotencyKey: z.string().min(1),
  replaySafe: z.literal(true),
  correlation: billingCorrelationMetadataSchema,
  metadata: billingMetadataSchema.default({})
}).strict();

export const executionCostAttributionSchema = baseCostAttributionSchema.extend({
  category: z.literal("EXECUTION"),
  executionId: z.string().min(1),
  workerId: z.string().min(1).optional(),
  durationMs: z.number().int().nonnegative()
}).strict();
export type ExecutionCostAttribution = z.output<typeof executionCostAttributionSchema>;

export const workflowCostAttributionSchema = baseCostAttributionSchema.extend({
  category: z.literal("WORKFLOW"),
  workflowId: z.string().min(1),
  runId: z.string().min(1),
  stepId: z.string().min(1).optional()
}).strict();
export type WorkflowCostAttribution = z.output<typeof workflowCostAttributionSchema>;

export const retrievalCostAttributionSchema = baseCostAttributionSchema.extend({
  category: z.literal("RETRIEVAL"),
  retrievalId: z.string().min(1),
  indexName: z.string().min(1),
  vectorReads: z.number().int().nonnegative()
}).strict();
export type RetrievalCostAttribution = z.output<typeof retrievalCostAttributionSchema>;

export const storageCostAttributionSchema = baseCostAttributionSchema.extend({
  category: z.literal("STORAGE"),
  storageNamespace: z.string().min(1),
  bytesHours: z.number().int().nonnegative()
}).strict();
export type StorageCostAttribution = z.output<typeof storageCostAttributionSchema>;

export const approvalCostAttributionSchema = baseCostAttributionSchema.extend({
  category: z.literal("APPROVAL"),
  approvalId: z.string().min(1),
  decisionId: z.string().min(1).optional()
}).strict();
export type ApprovalCostAttribution = z.output<typeof approvalCostAttributionSchema>;

export const costAttributionSchema = z.discriminatedUnion("category", [
  executionCostAttributionSchema,
  workflowCostAttributionSchema,
  retrievalCostAttributionSchema,
  storageCostAttributionSchema,
  approvalCostAttributionSchema
]);
export type CostAttribution = z.output<typeof costAttributionSchema>;

export const quotaPolicySchema = z.object({
  quotaId: z.string().min(1),
  tenantId: z.string().min(1),
  metric: usageMetricSchema,
  limit: z.number().int().nonnegative(),
  period: z.enum(["DAY", "MONTH", "BILLING_CYCLE"]),
  enforcement: z.enum(["HARD", "SOFT"]),
  failClosed: z.literal(true),
  active: z.boolean(),
  correlation: billingCorrelationMetadataSchema
}).strict();
export type QuotaPolicy = z.output<typeof quotaPolicySchema>;

export const rateLimitPolicySchema = z.object({
  rateLimitId: z.string().min(1),
  tenantId: z.string().min(1),
  metric: usageMetricSchema,
  limit: z.number().int().positive(),
  windowSeconds: z.number().int().positive(),
  burstLimit: z.number().int().positive().optional(),
  failClosed: z.literal(true),
  active: z.boolean(),
  correlation: billingCorrelationMetadataSchema
}).strict();
export type RateLimitPolicy = z.output<typeof rateLimitPolicySchema>;

export const quotaEnforcementDecisionSchema = z.object({
  tenantId: z.string().min(1),
  policyId: z.string().min(1),
  allowed: z.boolean(),
  reason: z.enum(["WITHIN_LIMIT", "SOFT_LIMIT_EXCEEDED", "HARD_LIMIT_EXCEEDED", "POLICY_INACTIVE"]),
  metric: usageMetricSchema,
  currentQuantity: z.number().int().nonnegative(),
  requestedQuantity: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
  evaluatedAt: z.string().datetime(),
  replaySafe: z.literal(true),
  correlation: billingCorrelationMetadataSchema
}).strict();
export type QuotaEnforcementDecision = z.output<typeof quotaEnforcementDecisionSchema>;

export const budgetSchema = z.object({
  budgetId: z.string().min(1),
  tenantId: z.string().min(1),
  name: z.string().min(1),
  amount: nonNegativeMoneySchema,
  period: z.enum(["MONTH", "BILLING_CYCLE", "QUARTER", "YEAR"]),
  enforcement: z.enum(["ALERT_ONLY", "SOFT_STOP", "HARD_STOP"]),
  active: z.boolean(),
  correlation: billingCorrelationMetadataSchema
}).strict();
export type Budget = z.output<typeof budgetSchema>;

export const spendThresholdSchema = z.object({
  thresholdId: z.string().min(1),
  tenantId: z.string().min(1),
  budgetId: z.string().min(1),
  percentage: z.number().min(0).max(1000),
  action: z.enum(["ALERT", "REQUIRE_APPROVAL", "BLOCK"]),
  correlation: billingCorrelationMetadataSchema
}).strict();
export type SpendThreshold = z.output<typeof spendThresholdSchema>;

export const alertThresholdSchema = z.object({
  alertThresholdId: z.string().min(1),
  tenantId: z.string().min(1),
  metric: z.union([usageMetricSchema, z.literal("SPEND")]),
  threshold: z.number().nonnegative(),
  severity: z.enum(["INFO", "WARNING", "CRITICAL"]),
  channel: z.enum(["WEBHOOK", "EMAIL", "AUDIT_LOG", "TELEMETRY"]),
  correlation: billingCorrelationMetadataSchema
}).strict();
export type AlertThreshold = z.output<typeof alertThresholdSchema>;

export const invoiceLineItemSchema = z.object({
  lineItemId: z.string().min(1),
  tenantId: z.string().min(1),
  metric: usageMetricSchema.optional(),
  description: z.string().min(1),
  quantity: z.number().int().nonnegative(),
  unitAmountMinor: z.number().int().nonnegative(),
  amount: nonNegativeMoneySchema,
  sourceAggregateId: z.string().min(1).optional()
}).strict();
export type InvoiceLineItem = z.output<typeof invoiceLineItemSchema>;

export const invoiceGenerationContractSchema = z.object({
  invoiceId: z.string().min(1),
  tenantId: z.string().min(1),
  accountId: z.string().min(1),
  cycleId: z.string().min(1),
  currency: z.string().length(3).transform((currency) => currency.toUpperCase()),
  state: z.enum(["DRAFT", "FINALIZED", "VOIDED"]),
  generatedAt: z.string().datetime(),
  lineItems: z.array(invoiceLineItemSchema),
  subtotal: nonNegativeMoneySchema,
  creditsApplied: nonNegativeMoneySchema,
  total: nonNegativeMoneySchema,
  provider: billingProviderSchema.optional(),
  externalInvoiceId: z.string().min(1).optional(),
  replaySafe: z.literal(true),
  correlation: billingCorrelationMetadataSchema
}).strict().superRefine((invoice, ctx) => {
  for (const [index, lineItem] of invoice.lineItems.entries()) {
    if (lineItem.tenantId !== invoice.tenantId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "line item tenantId must match invoice tenantId", path: ["lineItems", index, "tenantId"] });
    }
    if (lineItem.amount.currency !== invoice.currency) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "line item currency must match invoice currency", path: ["lineItems", index, "amount", "currency"] });
    }
  }
  if (invoice.subtotal.currency !== invoice.currency || invoice.creditsApplied.currency !== invoice.currency || invoice.total.currency !== invoice.currency) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invoice totals must use invoice currency" });
  }
});
export type InvoiceGenerationContract = z.output<typeof invoiceGenerationContractSchema>;

export const costReconciliationContractSchema = z.object({
  reconciliationId: z.string().min(1),
  tenantId: z.string().min(1),
  provider: z.union([billingProviderSchema, aiProviderSchema]),
  internalCost: nonNegativeMoneySchema,
  externalCost: nonNegativeMoneySchema,
  variance: moneySchema,
  status: z.enum(["MATCHED", "VARIANCE", "NEEDS_REVIEW"]),
  reconciledAt: z.string().datetime(),
  replaySafe: z.literal(true),
  correlation: billingCorrelationMetadataSchema
}).strict().refine((record) => record.internalCost.currency === record.externalCost.currency && record.internalCost.currency === record.variance.currency, {
  message: "reconciliation currencies must match",
  path: ["variance", "currency"]
});
export type CostReconciliationContract = z.output<typeof costReconciliationContractSchema>;

export const billingAuditTrailSchema = z.object({
  auditId: z.string().min(1),
  tenantId: z.string().min(1),
  actor: billingActorSchema,
  action: z.enum(["PLAN_CHANGED", "QUOTA_CHANGED", "BUDGET_CHANGED", "CREDIT_POSTED", "INVOICE_GENERATED", "THRESHOLD_TRIGGERED", "RECONCILED"]),
  targetType: z.string().min(1),
  targetId: z.string().min(1),
  occurredAt: z.string().datetime(),
  correlation: billingCorrelationMetadataSchema,
  metadata: billingMetadataSchema.default({})
}).strict().refine((audit) => audit.actor.tenantId === audit.tenantId, { message: "audit actor tenantId must match audit tenantId", path: ["actor", "tenantId"] });
export type BillingAuditTrail = z.output<typeof billingAuditTrailSchema>;

export const billingTelemetryEventSchema = z.object({
  eventId: z.string().min(1),
  tenantId: z.string().min(1),
  name: z.string().min(1),
  occurredAt: z.string().datetime(),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  correlation: billingCorrelationMetadataSchema
}).strict();
export type BillingTelemetryEvent = z.output<typeof billingTelemetryEventSchema>;

export interface BillingTelemetrySpan {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
  end(status: "OK" | "ERROR"): void;
}

export interface BillingTelemetryHooks {
  startSpan?(name: string, attributes: Readonly<Record<string, string | number | boolean>>): BillingTelemetrySpan;
  recordEvent?(event: BillingTelemetryEvent): void | Promise<void>;
  recordAudit?(audit: BillingAuditTrail): void | Promise<void>;
}

export interface BillingLedgerPort {
  postUsage(entry: UsageLedgerEntry): Promise<void> | void;
  postCredit(entry: CreditLedgerEntry): Promise<void> | void;
}

export interface BillingRuntimeOptions {
  readonly telemetry?: BillingTelemetryHooks;
}

export class BillingRuntimeError extends Error {
  public readonly code: "BILLING_TENANT_ISOLATION_VIOLATION" | "BILLING_INVALID_TRANSITION" | "BILLING_VALIDATION_FAILED";
  public readonly tenantId: string;
  public readonly correlation: BillingCorrelationMetadata | undefined;

  public constructor(input: { readonly code: BillingRuntimeError["code"]; readonly message: string; readonly tenantId: string; readonly correlation: BillingCorrelationMetadata | undefined }) {
    super(input.message);
    this.name = "BillingRuntimeError";
    this.code = input.code;
    this.tenantId = input.tenantId;
    this.correlation = input.correlation;
  }
}

export const assertSameTenant = (tenantId: string, candidate: { readonly tenantId: string }, label: string, correlation?: BillingCorrelationMetadata): void => {
  if (candidate.tenantId !== tenantId) {
    throw new BillingRuntimeError({ code: "BILLING_TENANT_ISOLATION_VIOLATION", message: `${label} tenantId must match ${tenantId}`, tenantId, correlation });
  }
};

export const assertBillingTenantIsolation = (input: {
  readonly tenantId: string;
  readonly usageEvents?: readonly UsageEvent[];
  readonly aggregates?: readonly UsageAggregate[];
  readonly costs?: readonly CostAttribution[];
  readonly invoices?: readonly InvoiceGenerationContract[];
  readonly correlation?: BillingCorrelationMetadata;
}): void => {
  for (const event of input.usageEvents ?? []) {
    assertSameTenant(input.tenantId, event, "usage event", input.correlation);
  }
  for (const aggregate of input.aggregates ?? []) {
    assertSameTenant(input.tenantId, aggregate, "usage aggregate", input.correlation);
  }
  for (const cost of input.costs ?? []) {
    assertSameTenant(input.tenantId, cost, "cost attribution", input.correlation);
  }
  for (const invoice of input.invoices ?? []) {
    assertSameTenant(input.tenantId, invoice, "invoice", input.correlation);
  }
};

export const buildUsageEventIdempotencyKey = (event: Pick<UsageEvent, "tenantId" | "metric" | "source" | "resourceId" | "occurredAt">): string =>
  [event.tenantId, event.metric, event.source, event.resourceId ?? "none", event.occurredAt].join(":");

export const createMeteringRecordFromUsageEvent = (input: { readonly meterId: string; readonly event: UsageEvent; readonly measuredAt: Date }): MeteringRecord =>
  meteringRecordSchema.parse({
    meterId: input.meterId,
    tenantId: input.event.tenantId,
    eventId: input.event.eventId,
    metric: input.event.metric,
    quantity: input.event.quantity,
    measuredAt: input.measuredAt.toISOString(),
    idempotencyKey: input.event.idempotencyKey,
    correlation: input.event.correlation
  });

export const aggregateUsageEvents = (input: {
  readonly aggregateId: string;
  readonly tenantId: string;
  readonly metric: UsageMetric;
  readonly events: readonly UsageEvent[];
  readonly window: UsageAggregationWindow;
  readonly computedAt: Date;
  readonly correlation: BillingCorrelationMetadata;
}): UsageAggregate => {
  assertBillingTenantIsolation({ tenantId: input.tenantId, usageEvents: input.events, correlation: input.correlation });
  const startsAt = Date.parse(input.window.startsAt);
  const endsAt = Date.parse(input.window.endsAt);
  const includedEvents = input.events.filter((event) => event.metric === input.metric && Date.parse(event.occurredAt) >= startsAt && Date.parse(event.occurredAt) < endsAt);
  const quantity = includedEvents.reduce((total, event) => total + event.quantity, 0);

  return usageAggregateSchema.parse({
    aggregateId: input.aggregateId,
    tenantId: input.tenantId,
    metric: input.metric,
    quantity,
    window: input.window,
    sourceEventIds: includedEvents.map((event) => event.eventId).sort(),
    replaySafe: true,
    computedAt: input.computedAt.toISOString(),
    correlation: input.correlation
  });
};

export const evaluateQuota = (input: {
  readonly policy: QuotaPolicy;
  readonly currentQuantity: number;
  readonly requestedQuantity: number;
  readonly evaluatedAt: Date;
}): QuotaEnforcementDecision => {
  const total = input.currentQuantity + input.requestedQuantity;
  const active = input.policy.active;
  const exceeded = total > input.policy.limit;
  const allowed = !active || !exceeded || input.policy.enforcement === "SOFT";
  const reason: QuotaEnforcementDecision["reason"] = !active ? "POLICY_INACTIVE" : !exceeded ? "WITHIN_LIMIT" : input.policy.enforcement === "SOFT" ? "SOFT_LIMIT_EXCEEDED" : "HARD_LIMIT_EXCEEDED";

  return quotaEnforcementDecisionSchema.parse({
    tenantId: input.policy.tenantId,
    policyId: input.policy.quotaId,
    allowed,
    reason,
    metric: input.policy.metric,
    currentQuantity: input.currentQuantity,
    requestedQuantity: input.requestedQuantity,
    limit: input.policy.limit,
    evaluatedAt: input.evaluatedAt.toISOString(),
    replaySafe: true,
    correlation: input.policy.correlation
  });
};

export const evaluateRateLimit = (input: {
  readonly policy: RateLimitPolicy;
  readonly observedQuantity: number;
  readonly requestedQuantity: number;
  readonly evaluatedAt: Date;
}): QuotaEnforcementDecision => {
  const effectiveLimit = input.policy.burstLimit ?? input.policy.limit;
  const total = input.observedQuantity + input.requestedQuantity;
  const allowed = !input.policy.active || total <= effectiveLimit;

  return quotaEnforcementDecisionSchema.parse({
    tenantId: input.policy.tenantId,
    policyId: input.policy.rateLimitId,
    allowed,
    reason: !input.policy.active ? "POLICY_INACTIVE" : allowed ? "WITHIN_LIMIT" : "HARD_LIMIT_EXCEEDED",
    metric: input.policy.metric,
    currentQuantity: input.observedQuantity,
    requestedQuantity: input.requestedQuantity,
    limit: effectiveLimit,
    evaluatedAt: input.evaluatedAt.toISOString(),
    replaySafe: true,
    correlation: input.policy.correlation
  });
};

export const transitionBillingCycleState = (input: { readonly cycle: BillingCycle; readonly to: BillingCycleState; readonly now: Date }): BillingCycle => {
  if (!canTransitionBillingCycleState(input.cycle.state, input.to)) {
    throw new BillingRuntimeError({ code: "BILLING_INVALID_TRANSITION", message: `Cannot transition billing cycle from ${input.cycle.state} to ${input.to}`, tenantId: input.cycle.tenantId, correlation: input.cycle.correlation });
  }

  return billingCycleSchema.parse({
    ...input.cycle,
    state: input.to,
    closedAt: input.to === "CLOSED" ? input.now.toISOString() : input.cycle.closedAt,
    invoicedAt: input.to === "INVOICED" ? input.now.toISOString() : input.cycle.invoicedAt
  });
};

const roundMinor = (value: number): number => Math.round(value);

export const calculateUsageCharge = (input: { readonly pricing: PricingModel; readonly quantity: number }): NonNegativeMoney => {
  let amountMinor = 0;
  if (input.pricing.model === "FLAT") {
    amountMinor = input.pricing.flatAmountMinor ?? 0;
  } else if (input.pricing.model === "PER_UNIT") {
    amountMinor = (input.pricing.unitAmountMinor ?? 0) * input.quantity;
  } else if (input.pricing.model === "PACKAGE") {
    const packages = Math.ceil(input.quantity / (input.pricing.packageSize ?? 1));
    amountMinor = packages * (input.pricing.unitAmountMinor ?? 0);
  } else {
    let remaining = input.quantity;
    let previousLimit = 0;
    for (const tier of input.pricing.tiers) {
      if (remaining <= 0) {
        break;
      }
      const tierLimit = tier.upTo ?? Number.MAX_SAFE_INTEGER;
      const tierQuantity = Math.min(remaining, tierLimit - previousLimit);
      amountMinor += tierQuantity * tier.unitAmountMinor;
      remaining -= tierQuantity;
      previousLimit = tierLimit;
    }
  }

  return nonNegativeMoneySchema.parse({ currency: input.pricing.currency, amountMinor: roundMinor(amountMinor) });
};

export const reconcileCosts = (input: {
  readonly reconciliationId: string;
  readonly tenantId: string;
  readonly provider: BillingProvider | AiProvider;
  readonly internalCost: NonNegativeMoney;
  readonly externalCost: NonNegativeMoney;
  readonly reconciledAt: Date;
  readonly toleranceMinor: number;
  readonly correlation: BillingCorrelationMetadata;
}): CostReconciliationContract => {
  const varianceMinor = input.externalCost.amountMinor - input.internalCost.amountMinor;
  const absoluteVariance = Math.abs(varianceMinor);
  const status: CostReconciliationContract["status"] = absoluteVariance === 0 ? "MATCHED" : absoluteVariance <= input.toleranceMinor ? "VARIANCE" : "NEEDS_REVIEW";

  return costReconciliationContractSchema.parse({
    reconciliationId: input.reconciliationId,
    tenantId: input.tenantId,
    provider: input.provider,
    internalCost: input.internalCost,
    externalCost: input.externalCost,
    variance: { currency: input.internalCost.currency, amountMinor: varianceMinor },
    status,
    reconciledAt: input.reconciledAt.toISOString(),
    replaySafe: true,
    correlation: input.correlation
  });
};

export const createBillingTelemetryEvent = (input: {
  readonly eventId: string;
  readonly tenantId: string;
  readonly name: string;
  readonly occurredAt: Date;
  readonly correlation: BillingCorrelationMetadata;
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}): BillingTelemetryEvent =>
  billingTelemetryEventSchema.parse({
    eventId: input.eventId,
    tenantId: input.tenantId,
    name: input.name,
    occurredAt: input.occurredAt.toISOString(),
    attributes: input.attributes ?? {},
    correlation: input.correlation
  });

export const buildBillingAuditTrail = (input: {
  readonly auditId: string;
  readonly tenantId: string;
  readonly actor: BillingActor;
  readonly action: BillingAuditTrail["action"];
  readonly targetType: string;
  readonly targetId: string;
  readonly occurredAt: Date;
  readonly correlation: BillingCorrelationMetadata;
  readonly metadata?: BillingMetadata;
}): BillingAuditTrail =>
  billingAuditTrailSchema.parse({
    auditId: input.auditId,
    tenantId: input.tenantId,
    actor: input.actor,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    occurredAt: input.occurredAt.toISOString(),
    correlation: input.correlation,
    metadata: input.metadata ?? {}
  });
