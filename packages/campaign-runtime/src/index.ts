import { z } from "zod";
import { correlationMetadataSchema } from "@whisperm/types";
import type { CorrelationMetadata } from "@whisperm/types";

const safeKeyPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const isoDurationPattern = /^P(?=\d|T\d)(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/u;
const maxDelayMs = 366 * 24 * 60 * 60 * 1000;

export const campaignMetadataSchema = z.record(z.string(), z.unknown());
export type CampaignMetadata = z.output<typeof campaignMetadataSchema>;

export const campaignTimestampSchema = z.string().datetime();
export type CampaignTimestamp = z.output<typeof campaignTimestampSchema>;

export const campaignTenantContextSchema = z.object({
  tenantId: z.string().min(1),
  actorId: z.string().min(1).optional(),
  correlation: correlationMetadataSchema
}).strict();
export type CampaignTenantContext = z.output<typeof campaignTenantContextSchema>;

export const campaignErrorCodeValues = [
  "CAMPAIGN_VALIDATION_FAILED",
  "CAMPAIGN_TENANT_ISOLATION_VIOLATION",
  "CAMPAIGN_INVALID_STATE_TRANSITION",
  "CAMPAIGN_REPLAY_BLOCKED",
  "CAMPAIGN_IDEMPOTENCY_CONFLICT",
  "CAMPAIGN_APPROVAL_REQUIRED",
  "CAMPAIGN_BILLING_BLOCKED",
  "CAMPAIGN_QUOTA_EXCEEDED",
  "CAMPAIGN_BUDGET_EXCEEDED"
] as const;
export const campaignErrorCodeSchema = z.enum(campaignErrorCodeValues);
export type CampaignErrorCode = z.output<typeof campaignErrorCodeSchema>;

export const campaignErrorModelSchema = z.object({
  code: campaignErrorCodeSchema,
  message: z.string().min(1),
  status: z.number().int().min(400).max(599),
  retryable: z.boolean().default(false),
  details: campaignMetadataSchema.optional(),
  correlation: correlationMetadataSchema.optional()
}).strict();
export type CampaignErrorModel = z.output<typeof campaignErrorModelSchema>;

export interface CampaignRuntimeErrorInput {
  readonly code: CampaignErrorCode;
  readonly message: string;
  readonly status: number;
  readonly retryable?: boolean | undefined;
  readonly details?: CampaignMetadata | undefined;
  readonly correlation?: CorrelationMetadata | undefined;
}

export class CampaignRuntimeError extends Error {
  readonly code: CampaignErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: CampaignMetadata | undefined;
  readonly correlation?: CorrelationMetadata | undefined;

  constructor(input: CampaignRuntimeErrorInput) {
    super(input.message);
    this.name = "CampaignRuntimeError";
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable ?? false;
    this.details = input.details;
    this.correlation = input.correlation;
    Object.setPrototypeOf(this, CampaignRuntimeError.prototype);
  }

  toErrorModel(): CampaignErrorModel {
    return campaignErrorModelSchema.parse({
      code: this.code,
      message: this.message,
      status: this.status,
      retryable: this.retryable,
      details: this.details,
      correlation: this.correlation
    });
  }
}

const validationIssues = (error: z.ZodError): readonly CampaignMetadata[] => error.issues.map((issue) => ({
  path: issue.path.join("."),
  message: issue.message,
  code: issue.code
}));

export const parseCampaignContract = <TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  input: unknown,
  correlation?: CorrelationMetadata,
): z.output<TSchema> => {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new CampaignRuntimeError({
      code: "CAMPAIGN_VALIDATION_FAILED",
      message: "Campaign contract validation failed",
      status: 400,
      details: { issues: validationIssues(result.error) },
      correlation
    });
  }
  return result.data;
};

export const campaignChannelKindValues = ["EMAIL", "LINKEDIN", "META", "SMS", "WHATSAPP", "WEBHOOK", "IN_APP", "CUSTOM"] as const;
export const campaignChannelKindSchema = z.enum(campaignChannelKindValues);
export type CampaignChannelKind = z.output<typeof campaignChannelKindSchema>;

export const campaignLifecycleStateValues = [
  "DRAFT",
  "VALIDATING",
  "PENDING_APPROVAL",
  "APPROVED",
  "SCHEDULED",
  "RUNNING",
  "PAUSED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "ARCHIVED"
] as const;
export const campaignLifecycleStateSchema = z.enum(campaignLifecycleStateValues);
export type CampaignLifecycleState = z.output<typeof campaignLifecycleStateSchema>;

export const terminalCampaignLifecycleStateValues = ["COMPLETED", "CANCELLED", "ARCHIVED"] as const satisfies readonly CampaignLifecycleState[];
export type TerminalCampaignLifecycleState = (typeof terminalCampaignLifecycleStateValues)[number];

const campaignLifecycleTransitions: Readonly<Record<CampaignLifecycleState, readonly CampaignLifecycleState[]>> = {
  DRAFT: ["VALIDATING", "PENDING_APPROVAL", "CANCELLED", "ARCHIVED"],
  VALIDATING: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "FAILED", "CANCELLED"],
  PENDING_APPROVAL: ["APPROVED", "DRAFT", "CANCELLED", "FAILED"],
  APPROVED: ["SCHEDULED", "RUNNING", "CANCELLED", "ARCHIVED"],
  SCHEDULED: ["RUNNING", "PAUSED", "CANCELLED", "ARCHIVED"],
  RUNNING: ["PAUSED", "COMPLETED", "FAILED", "CANCELLED"],
  PAUSED: ["RUNNING", "SCHEDULED", "CANCELLED", "ARCHIVED"],
  COMPLETED: ["ARCHIVED"],
  FAILED: ["DRAFT", "SCHEDULED", "CANCELLED", "ARCHIVED"],
  CANCELLED: ["ARCHIVED"],
  ARCHIVED: []
};

export const isTerminalCampaignLifecycleState = (state: CampaignLifecycleState): state is TerminalCampaignLifecycleState =>
  terminalCampaignLifecycleStateValues.includes(state as TerminalCampaignLifecycleState);

export const canTransitionCampaignLifecycleState = (from: CampaignLifecycleState, to: CampaignLifecycleState): boolean =>
  campaignLifecycleTransitions[from].includes(to);

export const campaignLifecycleSnapshotSchema = z.object({
  tenantId: z.string().min(1),
  campaignId: z.string().min(1),
  state: campaignLifecycleStateSchema,
  version: z.number().int().nonnegative().default(0),
  updatedAt: campaignTimestampSchema,
  updatedBy: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  correlation: correlationMetadataSchema
}).strict();
export type CampaignLifecycleSnapshot = z.output<typeof campaignLifecycleSnapshotSchema>;

export interface TransitionCampaignLifecycleInput {
  readonly snapshot: CampaignLifecycleSnapshot;
  readonly to: CampaignLifecycleState;
  readonly now: Date;
  readonly actorId?: string | undefined;
  readonly reason?: string | undefined;
}

export const transitionCampaignLifecycleState = (input: TransitionCampaignLifecycleInput): CampaignLifecycleSnapshot => {
  if (!canTransitionCampaignLifecycleState(input.snapshot.state, input.to)) {
    throw new CampaignRuntimeError({
      code: "CAMPAIGN_INVALID_STATE_TRANSITION",
      message: `Cannot transition campaign from ${input.snapshot.state} to ${input.to}`,
      status: 409,
      correlation: input.snapshot.correlation
    });
  }

  return campaignLifecycleSnapshotSchema.parse({
    ...input.snapshot,
    state: input.to,
    version: input.snapshot.version + 1,
    updatedAt: input.now.toISOString(),
    updatedBy: input.actorId,
    reason: input.reason
  });
};

const tenantScopedEntitySchema = z.object({
  tenantId: z.string().min(1),
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  metadata: campaignMetadataSchema.default({})
}).strict();

export const campaignAudienceContractSchema = tenantScopedEntitySchema.extend({
  audienceId: z.string().min(1),
  source: z.enum(["STATIC", "SEGMENT", "EVENT", "IMPORT", "COMPOSITE"]),
  estimatedSize: z.number().int().min(0).optional(),
  consentRequired: z.literal(true).default(true)
}).strict().refine((value) => value.id === value.audienceId, { message: "id must match audienceId", path: ["id"] });
export type CampaignAudienceContract = z.output<typeof campaignAudienceContractSchema>;

export const segmentRuleOperatorValues = ["EQ", "NEQ", "IN", "NOT_IN", "GT", "GTE", "LT", "LTE", "EXISTS", "NOT_EXISTS", "CONTAINS"] as const;
export const segmentRuleOperatorSchema = z.enum(segmentRuleOperatorValues);
export type SegmentRuleOperator = z.output<typeof segmentRuleOperatorSchema>;

export const campaignSegmentRuleSchema = z.object({
  field: z.string().min(1),
  operator: segmentRuleOperatorSchema,
  value: z.unknown().optional()
}).strict();
export type CampaignSegmentRule = z.output<typeof campaignSegmentRuleSchema>;

export const campaignSegmentContractSchema = tenantScopedEntitySchema.extend({
  segmentId: z.string().min(1),
  rules: z.array(campaignSegmentRuleSchema).min(1),
  combinator: z.enum(["ALL", "ANY"]).default("ALL"),
  version: z.number().int().nonnegative()
}).strict().refine((value) => value.id === value.segmentId, { message: "id must match segmentId", path: ["id"] });
export type CampaignSegmentContract = z.output<typeof campaignSegmentContractSchema>;

export const campaignTargetingContractSchema = z.object({
  tenantId: z.string().min(1),
  audienceIds: z.array(z.string().min(1)).default([]),
  segmentIds: z.array(z.string().min(1)).default([]),
  exclusions: z.object({
    audienceIds: z.array(z.string().min(1)).default([]),
    segmentIds: z.array(z.string().min(1)).default([]),
    recipientIds: z.array(z.string().min(1)).default([])
  }).strict().default({}),
  frequencyCap: z.object({
    maxMessages: z.number().int().min(1),
    perDuration: z.string().regex(isoDurationPattern)
  }).strict().optional()
}).strict().refine((value) => value.audienceIds.length > 0 || value.segmentIds.length > 0, {
  message: "targeting requires at least one audience or segment"
});
export type CampaignTargetingContract = z.output<typeof campaignTargetingContractSchema>;

export const campaignPersonalizationContractSchema = z.object({
  tenantId: z.string().min(1),
  mode: z.enum(["NONE", "TEMPLATE_VARIABLES", "AI_ASSISTED", "AI_GENERATED"]),
  variables: z.record(z.string().regex(safeKeyPattern), z.object({
    source: z.enum(["PROFILE", "EVENT", "STATIC", "COMPUTED"]),
    required: z.boolean().default(false),
    fallback: z.string().optional()
  }).strict()).default({}),
  deterministic: z.literal(true).default(true)
}).strict();
export type CampaignPersonalizationContract = z.output<typeof campaignPersonalizationContractSchema>;

export const campaignContentBlockSchema = z.object({
  blockId: z.string().min(1),
  kind: z.enum(["SUBJECT", "BODY", "CTA", "HEADER", "FOOTER", "TEXT", "JSON"]),
  locale: z.string().min(2).default("en"),
  content: z.string().min(1),
  contentHash: z.string().min(1).optional()
}).strict();
export type CampaignContentBlock = z.output<typeof campaignContentBlockSchema>;

export const campaignContentContractSchema = z.object({
  tenantId: z.string().min(1),
  contentId: z.string().min(1),
  version: z.number().int().nonnegative(),
  blocks: z.array(campaignContentBlockSchema).min(1),
  personalization: campaignPersonalizationContractSchema.optional()
}).strict().refine((value) => value.personalization === undefined || value.personalization.tenantId === value.tenantId, {
  message: "personalization tenantId must match content tenantId",
  path: ["personalization", "tenantId"]
});
export type CampaignContentContract = z.output<typeof campaignContentContractSchema>;

export const campaignAssetContractSchema = z.object({
  tenantId: z.string().min(1),
  assetId: z.string().min(1),
  kind: z.enum(["IMAGE", "VIDEO", "DOCUMENT", "TEMPLATE", "LINK", "OTHER"]),
  uri: z.string().min(1),
  checksum: z.string().min(1).optional(),
  metadata: campaignMetadataSchema.default({})
}).strict();
export type CampaignAssetContract = z.output<typeof campaignAssetContractSchema>;

export const campaignChannelContractSchema = z.object({
  tenantId: z.string().min(1),
  channelId: z.string().min(1),
  kind: campaignChannelKindSchema,
  enabled: z.boolean().default(true),
  providerRef: z.string().min(1).optional(),
  capabilities: z.array(z.enum(["SEND", "SCHEDULE", "WEBHOOK", "TEMPLATE", "MEDIA", "REPLY_TRACKING"])).default([]),
  metadata: campaignMetadataSchema.default({})
}).strict();
export type CampaignChannelContract = z.output<typeof campaignChannelContractSchema>;

export const campaignTriggerContractSchema = z.object({
  tenantId: z.string().min(1),
  triggerId: z.string().min(1),
  kind: z.enum(["MANUAL", "SCHEDULED", "EVENT", "BEHAVIORAL", "API"]),
  eventType: z.string().min(1).optional(),
  scheduleId: z.string().min(1).optional(),
  replaySafe: z.literal(true).default(true),
  idempotencyKeyTemplate: z.string().min(1).optional(),
  metadata: campaignMetadataSchema.default({})
}).strict().superRefine((trigger, ctx) => {
  if (trigger.kind === "EVENT" && trigger.eventType === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "EVENT triggers require eventType", path: ["eventType"] });
  }
  if (trigger.kind === "SCHEDULED" && trigger.scheduleId === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "SCHEDULED triggers require scheduleId", path: ["scheduleId"] });
  }
});
export type CampaignTriggerContract = z.output<typeof campaignTriggerContractSchema>;

const detectCampaignSequenceCycle = (sequence: { readonly entryStepId: string; readonly steps: readonly { readonly stepId: string; readonly nextStepIds: readonly string[] }[] }): readonly string[] | undefined => {
  const stepsById = new Map(sequence.steps.map((step) => [step.stepId, step]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (stepId: string, path: readonly string[]): readonly string[] | undefined => {
    if (visited.has(stepId)) {
      return undefined;
    }
    if (visiting.has(stepId)) {
      return [...path, stepId];
    }

    const step = stepsById.get(stepId);
    if (step === undefined) {
      return undefined;
    }

    visiting.add(stepId);
    for (const nextStepId of step.nextStepIds) {
      const cycle = visit(nextStepId, [...path, stepId]);
      if (cycle !== undefined) {
        return cycle;
      }
    }
    visiting.delete(stepId);
    visited.add(stepId);
    return undefined;
  };

  for (const step of sequence.steps) {
    const cycle = visit(step.stepId, []);
    if (cycle !== undefined) {
      return cycle;
    }
  }
  return undefined;
};

export const campaignStepContractSchema = z.object({
  tenantId: z.string().min(1),
  stepId: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["SEND", "WAIT", "DECISION", "WEBHOOK", "ENROLL", "EXIT"]),
  channelId: z.string().min(1).optional(),
  contentId: z.string().min(1).optional(),
  waitDuration: z.string().regex(isoDurationPattern).optional(),
  nextStepIds: z.array(z.string().min(1)).default([]),
  retryPolicyId: z.string().min(1).optional(),
  metadata: campaignMetadataSchema.default({})
}).strict().superRefine((step, ctx) => {
  if (step.kind === "SEND" && (step.channelId === undefined || step.contentId === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "SEND steps require channelId and contentId" });
  }
  if (step.kind === "WAIT" && step.waitDuration === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "WAIT steps require waitDuration", path: ["waitDuration"] });
  }
});
export type CampaignStepContract = z.output<typeof campaignStepContractSchema>;

export const campaignSequenceContractSchema = z.object({
  tenantId: z.string().min(1),
  sequenceId: z.string().min(1),
  steps: z.array(campaignStepContractSchema).min(1),
  entryStepId: z.string().min(1)
}).strict().superRefine((sequence, ctx) => {
  const ids = new Set(sequence.steps.map((step) => step.stepId));
  if (!ids.has(sequence.entryStepId)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "entryStepId must reference a sequence step", path: ["entryStepId"] });
  }
  sequence.steps.forEach((step, index) => {
    if (step.tenantId !== sequence.tenantId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "step tenantId must match sequence tenantId", path: ["steps", index, "tenantId"] });
    }
    step.nextStepIds.forEach((nextStepId) => {
      if (!ids.has(nextStepId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "nextStepIds must reference sequence steps", path: ["steps", index, "nextStepIds"] });
      }
    });
  });

  // Campaign sequences are modeled as deterministic DAGs. Re-entry or recurring
  // outreach must be represented by campaign triggers/schedules instead of a
  // nextStepIds cycle so retries and idempotency keys never re-dispatch a step
  // through an unbounded loop.
  const cycle = detectCampaignSequenceCycle(sequence);
  if (cycle !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "sequence nextStepIds must form an acyclic graph", path: ["steps"], params: { cycle: cycle.join(" -> ") } });
  }
});
export type CampaignSequenceContract = z.output<typeof campaignSequenceContractSchema>;

export const campaignJourneyContractSchema = z.object({
  tenantId: z.string().min(1),
  journeyId: z.string().min(1),
  sequences: z.array(campaignSequenceContractSchema).min(1),
  triggers: z.array(campaignTriggerContractSchema).default([]),
  version: z.number().int().nonnegative()
}).strict().superRefine((journey, ctx) => {
  journey.sequences.forEach((sequence, index) => {
    if (sequence.tenantId !== journey.tenantId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "sequence tenantId must match journey tenantId", path: ["sequences", index, "tenantId"] });
    }
  });
  journey.triggers.forEach((trigger, index) => {
    if (trigger.tenantId !== journey.tenantId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "trigger tenantId must match journey tenantId", path: ["triggers", index, "tenantId"] });
    }
  });
});
export type CampaignJourneyContract = z.output<typeof campaignJourneyContractSchema>;

export const campaignRetryPolicySchema = z.object({
  retryPolicyId: z.string().min(1),
  maxAttempts: z.number().int().min(1).max(25),
  initialDelayMs: z.number().int().min(0).max(maxDelayMs),
  maxDelayMs: z.number().int().min(0).max(maxDelayMs),
  backoffMultiplier: z.number().min(1).max(10).default(1),
  jitter: z.literal(false).default(false),
  retryableErrorCodes: z.array(z.string().min(1)).default([]),
  replaySafe: z.literal(true).default(true)
}).strict().refine((policy) => policy.maxDelayMs >= policy.initialDelayMs, {
  message: "maxDelayMs must be greater than or equal to initialDelayMs",
  path: ["maxDelayMs"]
});
export type CampaignRetryPolicy = z.output<typeof campaignRetryPolicySchema>;

export const campaignQuotaContractSchema = z.object({
  tenantId: z.string().min(1),
  quotaId: z.string().min(1),
  scope: z.enum(["TENANT", "CAMPAIGN", "CHANNEL", "RECIPIENT"]),
  limit: z.number().int().min(0),
  used: z.number().int().min(0).default(0),
  resetAt: campaignTimestampSchema.optional(),
  failClosed: z.literal(true).default(true)
}).strict().refine((quota) => quota.used <= quota.limit, { message: "used quota cannot exceed limit", path: ["used"] });
export type CampaignQuotaContract = z.output<typeof campaignQuotaContractSchema>;

export const campaignBudgetContractSchema = z.object({
  tenantId: z.string().min(1),
  budgetId: z.string().min(1),
  currency: z.string().length(3),
  limitMinor: z.number().int().min(0),
  reservedMinor: z.number().int().min(0).default(0),
  spentMinor: z.number().int().min(0).default(0),
  enforceHardLimit: z.literal(true).default(true)
}).strict().refine((budget) => budget.reservedMinor + budget.spentMinor <= budget.limitMinor, {
  message: "reserved plus spent cannot exceed limit",
  path: ["reservedMinor"]
});
export type CampaignBudgetContract = z.output<typeof campaignBudgetContractSchema>;

export const campaignApprovalIntegrationContractSchema = z.object({
  tenantId: z.string().min(1),
  campaignId: z.string().min(1),
  approvalId: z.string().min(1).optional(),
  required: z.boolean(),
  state: z.enum(["NOT_REQUIRED", "REQUESTED", "APPROVED", "REJECTED", "EXPIRED"]),
  requestedBy: z.string().min(1).optional(),
  decidedBy: z.string().min(1).optional(),
  decidedAt: campaignTimestampSchema.optional(),
  correlation: correlationMetadataSchema
}).strict().superRefine((approval, ctx) => {
  if (approval.required && approval.state === "NOT_REQUIRED") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "required approvals cannot be NOT_REQUIRED", path: ["state"] });
  }
  if (["REQUESTED", "APPROVED", "REJECTED", "EXPIRED"].includes(approval.state) && approval.approvalId === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "approval state requires approvalId", path: ["approvalId"] });
  }
});
export type CampaignApprovalIntegrationContract = z.output<typeof campaignApprovalIntegrationContractSchema>;

export const campaignBillingIntegrationContractSchema = z.object({
  tenantId: z.string().min(1),
  campaignId: z.string().min(1),
  accountId: z.string().min(1),
  reservationId: z.string().min(1).optional(),
  estimatedCostMinor: z.number().int().min(0),
  currency: z.string().length(3),
  billable: z.boolean().default(true),
  correlation: correlationMetadataSchema
}).strict();
export type CampaignBillingIntegrationContract = z.output<typeof campaignBillingIntegrationContractSchema>;

export const campaignScheduleIntegrationContractSchema = z.object({
  tenantId: z.string().min(1),
  campaignId: z.string().min(1),
  scheduleId: z.string().min(1),
  runAt: campaignTimestampSchema.optional(),
  timeZone: z.string().min(1).default("UTC"),
  scheduleKind: z.enum(["ONE_TIME", "CRON", "INTERVAL", "EVENT"]),
  correlation: correlationMetadataSchema
}).strict();
export type CampaignScheduleIntegrationContract = z.output<typeof campaignScheduleIntegrationContractSchema>;

export const campaignTelemetryIntegrationContractSchema = z.object({
  tenantId: z.string().min(1),
  campaignId: z.string().min(1),
  eventName: z.string().regex(safeKeyPattern),
  occurredAt: campaignTimestampSchema,
  attributes: z.record(z.string().regex(safeKeyPattern), z.union([z.string(), z.number(), z.boolean()])).default({}),
  correlation: correlationMetadataSchema
}).strict();
export type CampaignTelemetryIntegrationContract = z.output<typeof campaignTelemetryIntegrationContractSchema>;

export const campaignObservabilityIntegrationContractSchema = z.object({
  tenantId: z.string().min(1),
  campaignId: z.string().min(1),
  auditId: z.string().min(1),
  action: z.string().regex(safeKeyPattern),
  actorId: z.string().min(1).optional(),
  targetId: z.string().min(1),
  occurredAt: campaignTimestampSchema,
  correlation: correlationMetadataSchema,
  metadata: campaignMetadataSchema.default({})
}).strict();
export type CampaignObservabilityIntegrationContract = z.output<typeof campaignObservabilityIntegrationContractSchema>;

export const campaignAttributionContractSchema = z.object({
  tenantId: z.string().min(1),
  campaignId: z.string().min(1),
  attributionId: z.string().min(1),
  model: z.enum(["FIRST_TOUCH", "LAST_TOUCH", "LINEAR", "POSITION_BASED", "CUSTOM"]),
  conversionEventType: z.string().min(1),
  lookbackDuration: z.string().regex(isoDurationPattern),
  metadata: campaignMetadataSchema.default({})
}).strict();
export type CampaignAttributionContract = z.output<typeof campaignAttributionContractSchema>;

export const campaignAnalyticsContractSchema = z.object({
  tenantId: z.string().min(1),
  campaignId: z.string().min(1),
  windowStart: campaignTimestampSchema,
  windowEnd: campaignTimestampSchema,
  metrics: z.record(z.string().regex(safeKeyPattern), z.number()).default({}),
  dimensions: z.record(z.string().regex(safeKeyPattern), z.string()).default({})
}).strict().refine((analytics) => Date.parse(analytics.windowEnd) > Date.parse(analytics.windowStart), {
  message: "windowEnd must be after windowStart",
  path: ["windowEnd"]
});
export type CampaignAnalyticsContract = z.output<typeof campaignAnalyticsContractSchema>;

export const campaignAuditTrailContractSchema = z.object({
  tenantId: z.string().min(1),
  campaignId: z.string().min(1),
  auditId: z.string().min(1),
  action: z.string().regex(safeKeyPattern),
  actorId: z.string().min(1).optional(),
  occurredAt: campaignTimestampSchema,
  correlation: correlationMetadataSchema,
  before: campaignMetadataSchema.optional(),
  after: campaignMetadataSchema.optional()
}).strict();
export type CampaignAuditTrailContract = z.output<typeof campaignAuditTrailContractSchema>;

export const campaignEnrollmentStateValues = ["PENDING", "ENROLLED", "PAUSED", "COMPLETED", "CANCELLED", "FAILED"] as const;
export const campaignEnrollmentStateSchema = z.enum(campaignEnrollmentStateValues);
export type CampaignEnrollmentState = z.output<typeof campaignEnrollmentStateSchema>;

export const campaignEnrollmentContractSchema = z.object({
  tenantId: z.string().min(1),
  campaignId: z.string().min(1),
  enrollmentId: z.string().min(1),
  recipientId: z.string().min(1),
  state: campaignEnrollmentStateSchema,
  currentStepId: z.string().min(1).optional(),
  enrolledAt: campaignTimestampSchema,
  updatedAt: campaignTimestampSchema,
  idempotencyKey: z.string().min(1),
  correlation: correlationMetadataSchema,
  metadata: campaignMetadataSchema.default({})
}).strict();
export type CampaignEnrollmentContract = z.output<typeof campaignEnrollmentContractSchema>;

export const campaignPauseContractSchema = z.object({
  tenantId: z.string().min(1),
  campaignId: z.string().min(1),
  pausedBy: z.string().min(1),
  pausedAt: campaignTimestampSchema,
  reason: z.string().min(1),
  correlation: correlationMetadataSchema
}).strict();
export type CampaignPauseContract = z.output<typeof campaignPauseContractSchema>;

export const campaignResumeContractSchema = z.object({
  tenantId: z.string().min(1),
  campaignId: z.string().min(1),
  resumedBy: z.string().min(1),
  resumedAt: campaignTimestampSchema,
  correlation: correlationMetadataSchema
}).strict();
export type CampaignResumeContract = z.output<typeof campaignResumeContractSchema>;

export const campaignArchiveContractSchema = z.object({
  tenantId: z.string().min(1),
  campaignId: z.string().min(1),
  archivedBy: z.string().min(1),
  archivedAt: campaignTimestampSchema,
  reason: z.string().min(1).optional(),
  correlation: correlationMetadataSchema
}).strict();
export type CampaignArchiveContract = z.output<typeof campaignArchiveContractSchema>;

export const campaignCancellationContractSchema = z.object({
  tenantId: z.string().min(1),
  campaignId: z.string().min(1),
  cancelledBy: z.string().min(1),
  cancelledAt: campaignTimestampSchema,
  reason: z.string().min(1),
  stopEnrollments: z.literal(true).default(true),
  correlation: correlationMetadataSchema
}).strict();
export type CampaignCancellationContract = z.output<typeof campaignCancellationContractSchema>;

export const replaySafeCampaignExecutionContractSchema = z.object({
  tenantId: z.string().min(1),
  campaignId: z.string().min(1),
  executionId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  attempt: z.number().int().min(1).default(1),
  replayOfExecutionId: z.string().min(1).optional(),
  deterministic: z.literal(true).default(true),
  sideEffects: z.array(z.enum(["SCHEDULE", "APPROVAL", "BILLING", "TELEMETRY", "OBSERVABILITY", "ENQUEUE"])).default([]),
  correlation: correlationMetadataSchema
}).strict();
export type ReplaySafeCampaignExecutionContract = z.output<typeof replaySafeCampaignExecutionContractSchema>;

export const campaignExecutionContractSchema = z.object({
  tenantId: z.string().min(1),
  campaignId: z.string().min(1),
  executionId: z.string().min(1),
  lifecycle: campaignLifecycleSnapshotSchema,
  targeting: campaignTargetingContractSchema,
  journey: campaignJourneyContractSchema.optional(),
  sequence: campaignSequenceContractSchema.optional(),
  channels: z.array(campaignChannelContractSchema).default([]),
  content: z.array(campaignContentContractSchema).default([]),
  assets: z.array(campaignAssetContractSchema).default([]),
  retryPolicies: z.array(campaignRetryPolicySchema).default([]),
  approval: campaignApprovalIntegrationContractSchema.optional(),
  billing: campaignBillingIntegrationContractSchema.optional(),
  schedule: campaignScheduleIntegrationContractSchema.optional(),
  quota: campaignQuotaContractSchema.optional(),
  budget: campaignBudgetContractSchema.optional(),
  replay: replaySafeCampaignExecutionContractSchema,
  createdAt: campaignTimestampSchema,
  correlation: correlationMetadataSchema,
  metadata: campaignMetadataSchema.default({})
}).strict().superRefine((execution, ctx) => {
  const tenantScoped = [
    execution.lifecycle,
    execution.targeting,
    execution.journey,
    execution.sequence,
    execution.approval,
    execution.billing,
    execution.schedule,
    execution.quota,
    execution.budget,
    execution.replay
  ];
  tenantScoped.forEach((value, index) => {
    if (value !== undefined && value.tenantId !== execution.tenantId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "nested execution contracts must match execution tenantId", path: [index] });
    }
  });
  [execution.channels, execution.content, execution.assets, execution.retryPolicies].forEach((items, groupIndex) => {
    items.forEach((item, itemIndex) => {
      if ("tenantId" in item && item.tenantId !== execution.tenantId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "nested collection contracts must match execution tenantId", path: ["collections", groupIndex, itemIndex, "tenantId"] });
      }
    });
  });
  if (execution.lifecycle.campaignId !== execution.campaignId || execution.replay.campaignId !== execution.campaignId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "nested execution contracts must match campaignId", path: ["campaignId"] });
  }
});
export type CampaignExecutionContract = z.output<typeof campaignExecutionContractSchema>;

export const buildCampaignIdempotencyKey = (input: {
  readonly tenantId: string;
  readonly campaignId: string;
  readonly executionId?: string | undefined;
  readonly recipientId?: string | undefined;
  readonly stepId?: string | undefined;
}): string => [input.tenantId, input.campaignId, input.executionId, input.recipientId, input.stepId]
  .filter((value): value is string => value !== undefined && value.length > 0)
  .join(":");

export const calculateCampaignRetryDelayMs = (policy: CampaignRetryPolicy, attempt: number): number => {
  const safeAttempt = Math.max(1, attempt);
  const delay = policy.initialDelayMs * (policy.backoffMultiplier ** (safeAttempt - 1));
  return Math.min(Math.round(delay), policy.maxDelayMs);
};

export interface AssertCampaignTenantIsolationInput {
  readonly expectedTenantId: string;
  readonly contracts: readonly { readonly tenantId: string; readonly correlation?: CorrelationMetadata | undefined }[];
  readonly correlation?: CorrelationMetadata | undefined;
}

export const assertCampaignTenantIsolation = (input: AssertCampaignTenantIsolationInput): void => {
  const violation = input.contracts.find((contract) => contract.tenantId !== input.expectedTenantId);
  if (violation !== undefined) {
    throw new CampaignRuntimeError({
      code: "CAMPAIGN_TENANT_ISOLATION_VIOLATION",
      message: "Campaign tenant isolation violation",
      status: 403,
      details: { expectedTenantId: input.expectedTenantId, actualTenantId: violation.tenantId },
      correlation: input.correlation ?? violation.correlation
    });
  }
};

export interface CreateCampaignExecutionInput {
  readonly tenantId: string;
  readonly campaignId: string;
  readonly executionId: string;
  readonly lifecycle: CampaignLifecycleSnapshot;
  readonly targeting: CampaignTargetingContract;
  readonly correlation: CorrelationMetadata;
  readonly now: Date;
  readonly journey?: CampaignJourneyContract | undefined;
  readonly sequence?: CampaignSequenceContract | undefined;
  readonly channels?: readonly CampaignChannelContract[] | undefined;
  readonly content?: readonly CampaignContentContract[] | undefined;
  readonly assets?: readonly CampaignAssetContract[] | undefined;
  readonly retryPolicies?: readonly CampaignRetryPolicy[] | undefined;
  readonly approval?: CampaignApprovalIntegrationContract | undefined;
  readonly billing?: CampaignBillingIntegrationContract | undefined;
  readonly schedule?: CampaignScheduleIntegrationContract | undefined;
  readonly quota?: CampaignQuotaContract | undefined;
  readonly budget?: CampaignBudgetContract | undefined;
  readonly metadata?: CampaignMetadata | undefined;
}

export const createCampaignExecutionContract = (input: CreateCampaignExecutionInput): CampaignExecutionContract => {
  const replay = replaySafeCampaignExecutionContractSchema.parse({
    tenantId: input.tenantId,
    campaignId: input.campaignId,
    executionId: input.executionId,
    idempotencyKey: buildCampaignIdempotencyKey({ tenantId: input.tenantId, campaignId: input.campaignId, executionId: input.executionId }),
    attempt: 1,
    deterministic: true,
    sideEffects: ["SCHEDULE", "APPROVAL", "BILLING", "TELEMETRY", "OBSERVABILITY", "ENQUEUE"],
    correlation: input.correlation
  });

  return campaignExecutionContractSchema.parse({
    tenantId: input.tenantId,
    campaignId: input.campaignId,
    executionId: input.executionId,
    lifecycle: input.lifecycle,
    targeting: input.targeting,
    journey: input.journey,
    sequence: input.sequence,
    channels: input.channels ?? [],
    content: input.content ?? [],
    assets: input.assets ?? [],
    retryPolicies: input.retryPolicies ?? [],
    approval: input.approval,
    billing: input.billing,
    schedule: input.schedule,
    quota: input.quota,
    budget: input.budget,
    replay,
    createdAt: input.now.toISOString(),
    correlation: input.correlation,
    metadata: input.metadata ?? {}
  });
};

export type CampaignDispatchResult = "DISPATCHED" | "SKIPPED_ALREADY_CLAIMED" | "BLOCKED_APPROVAL" | "BLOCKED_BILLING" | "BLOCKED_QUOTA" | "BLOCKED_BUDGET";

export interface CampaignRuntimePorts {
  readonly idempotency?: {
    readonly claim: (contract: ReplaySafeCampaignExecutionContract) => Promise<"CLAIMED" | "ALREADY_CLAIMED"> | "CLAIMED" | "ALREADY_CLAIMED";
    readonly complete: (contract: ReplaySafeCampaignExecutionContract) => Promise<void> | void;
  } | undefined;
  readonly scheduler?: { readonly scheduleCampaign: (contract: CampaignScheduleIntegrationContract) => Promise<void> | void } | undefined;
  readonly approval?: { readonly requestApproval: (contract: CampaignApprovalIntegrationContract) => Promise<void> | void } | undefined;
  readonly billing?: { readonly reserveCampaignBudget: (contract: CampaignBillingIntegrationContract) => Promise<void> | void } | undefined;
  readonly telemetry?: { readonly emit: (contract: CampaignTelemetryIntegrationContract) => Promise<void> | void } | undefined;
  readonly observability?: { readonly audit: (contract: CampaignObservabilityIntegrationContract) => Promise<void> | void } | undefined;
  readonly enqueue?: { readonly enqueueExecution: (contract: CampaignExecutionContract) => Promise<void> | void } | undefined;
}

export const dispatchCampaignExecution = async (
  execution: CampaignExecutionContract,
  ports: CampaignRuntimePorts,
): Promise<CampaignDispatchResult> => {
  assertCampaignTenantIsolation({
    expectedTenantId: execution.tenantId,
    contracts: [execution.lifecycle, execution.targeting, execution.replay],
    correlation: execution.correlation
  });

  const claim = await ports.idempotency?.claim(execution.replay);
  if (claim === "ALREADY_CLAIMED") {
    return "SKIPPED_ALREADY_CLAIMED";
  }

  if (execution.approval?.required === true && execution.approval.state !== "APPROVED") {
    return "BLOCKED_APPROVAL";
  }
  if (execution.quota !== undefined && execution.quota.used >= execution.quota.limit) {
    return "BLOCKED_QUOTA";
  }
  if (execution.budget !== undefined && execution.budget.reservedMinor + execution.budget.spentMinor >= execution.budget.limitMinor) {
    return "BLOCKED_BUDGET";
  }

  if (execution.schedule !== undefined) {
    await ports.scheduler?.scheduleCampaign(execution.schedule);
  }
  if (execution.approval !== undefined && execution.approval.required) {
    await ports.approval?.requestApproval(execution.approval);
  }
  if (execution.billing !== undefined && execution.billing.billable) {
    await ports.billing?.reserveCampaignBudget(execution.billing);
  }

  await ports.telemetry?.emit(campaignTelemetryIntegrationContractSchema.parse({
    tenantId: execution.tenantId,
    campaignId: execution.campaignId,
    eventName: "campaign.execution.dispatched",
    occurredAt: execution.createdAt,
    attributes: { attempt: execution.replay.attempt },
    correlation: execution.correlation
  }));
  await ports.observability?.audit(campaignObservabilityIntegrationContractSchema.parse({
    tenantId: execution.tenantId,
    campaignId: execution.campaignId,
    auditId: buildCampaignIdempotencyKey({ tenantId: execution.tenantId, campaignId: execution.campaignId, executionId: execution.executionId, stepId: "audit" }),
    action: "campaign.execution.dispatched",
    targetId: execution.executionId,
    occurredAt: execution.createdAt,
    correlation: execution.correlation
  }));
  await ports.enqueue?.enqueueExecution(execution);
  await ports.idempotency?.complete(execution.replay);

  return "DISPATCHED";
};

export const campaignRuntimeExecutionStatusValues = ["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"] as const;
export const campaignRuntimeExecutionStatusSchema = z.enum(campaignRuntimeExecutionStatusValues);
export type CampaignRuntimeExecutionStatus = z.output<typeof campaignRuntimeExecutionStatusSchema>;

export const campaignRuntimeExecutionTriggerValues = ["MANUAL", "SCHEDULED", "SYSTEM"] as const;
export const campaignRuntimeExecutionTriggerSchema = z.enum(campaignRuntimeExecutionTriggerValues);
export type CampaignRuntimeExecutionTrigger = z.output<typeof campaignRuntimeExecutionTriggerSchema>;

export const campaignRuntimeWorkerResultSchema = z.object({
  status: z.enum(["COMPLETED", "FAILED"]),
  metrics: campaignMetadataSchema.default({}),
  errorCode: z.string().min(1).optional(),
  errorMessage: z.string().min(1).optional()
}).strict();
export type CampaignRuntimeWorkerResult = z.output<typeof campaignRuntimeWorkerResultSchema>;

export const campaignRuntimeWorkerInputSchema = z.object({
  tenantId: z.string().min(1),
  campaignId: z.string().min(1),
  executionId: z.string().min(1),
  trigger: campaignRuntimeExecutionTriggerSchema,
  correlation: correlationMetadataSchema.optional()
}).strict();
export type CampaignRuntimeWorkerInput = z.output<typeof campaignRuntimeWorkerInputSchema>;

export interface CampaignRuntimeWorker {
  readonly type: string;
  execute(input: CampaignRuntimeWorkerInput): Promise<CampaignRuntimeWorkerResult>;
}

export class NoopCampaignRuntimeWorker implements CampaignRuntimeWorker {
  readonly type = "noop";

  async execute(_input: CampaignRuntimeWorkerInput): Promise<CampaignRuntimeWorkerResult> {
    return { status: "COMPLETED", metrics: { noop: true } };
  }
}
