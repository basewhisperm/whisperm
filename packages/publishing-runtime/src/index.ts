import { z } from "zod";

import type {
  ApprovalRepository,
  Campaign,
  CampaignRepository,
  CreateOutboxEventInput,
  CreatePublishJobInput,
  EventRepository,
  JsonObject,
  PublishJob,
} from "@whisperm/repositories";
import { correlationMetadataSchema, type CorrelationMetadata, type TenantScoped } from "@whisperm/types";

const isoDateSchema = z.string().datetime();
const idSchema = z.string().min(1);
const metadataSchema = z.record(z.string(), z.unknown()).default({});

export const publishingRuntimeStateValues = [
  "READY",
  "HELD_APPROVAL",
  "HELD_RELIABILITY",
  "HELD_RATE_LIMIT",
  "HELD_PROVIDER_AUTH",
  "REJECTED_TENANT_MISMATCH",
  "REJECTED_INVALID_STATE",
  "FAILED",
] as const;
export const publishingRuntimeStateSchema = z.enum(publishingRuntimeStateValues);
export type PublishingRuntimeState = z.output<typeof publishingRuntimeStateSchema>;

export const publishingOutboxEventTypeValues = [
  "PUBLISH_READY",
  "PUBLISH_HELD",
  "PUBLISH_REJECTED",
  "PUBLISH_DISPATCHED",
  "PUBLISH_FAILED",
] as const;
export const publishingOutboxEventTypeSchema = z.enum(publishingOutboxEventTypeValues);
export type PublishingOutboxEventType = z.output<typeof publishingOutboxEventTypeSchema>;

export const publishingRuntimeErrorCodeValues = [
  "PUBLISHING_VALIDATION_FAILED",
  "PUBLISHING_TENANT_MISMATCH",
  "PUBLISHING_INVALID_STATE",
  "PUBLISHING_REPOSITORY_FAILED",
  "PUBLISHING_DISPATCH_FAILED",
] as const;
export const publishingRuntimeErrorCodeSchema = z.enum(publishingRuntimeErrorCodeValues);
export type PublishingRuntimeErrorCode = z.output<typeof publishingRuntimeErrorCodeSchema>;

export const publishingRuntimeErrorModelSchema = z.object({
  code: publishingRuntimeErrorCodeSchema,
  message: z.string().min(1),
  status: z.number().int().min(400).max(599),
  retryable: z.boolean().default(false),
  details: metadataSchema.optional(),
  correlation: correlationMetadataSchema.optional(),
}).strict();
export type PublishingRuntimeErrorModel = z.output<typeof publishingRuntimeErrorModelSchema>;

export interface PublishingRuntimeErrorInput {
  readonly code: PublishingRuntimeErrorCode;
  readonly message: string;
  readonly status: number;
  readonly retryable?: boolean | undefined;
  readonly details?: JsonObject | undefined;
  readonly correlation?: CorrelationMetadata | undefined;
  readonly cause?: unknown;
}

export class PublishingRuntimeError extends Error {
  readonly code: PublishingRuntimeErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: JsonObject | undefined;
  readonly correlation?: CorrelationMetadata | undefined;
  override readonly cause?: unknown;

  constructor(input: PublishingRuntimeErrorInput) {
    super(input.message);
    this.name = "PublishingRuntimeError";
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable ?? false;
    this.details = input.details;
    this.correlation = input.correlation;
    this.cause = input.cause;
    Object.setPrototypeOf(this, PublishingRuntimeError.prototype);
  }

  toErrorModel(): PublishingRuntimeErrorModel {
    return publishingRuntimeErrorModelSchema.parse({
      code: this.code,
      message: this.message,
      status: this.status,
      retryable: this.retryable,
      details: this.details,
      correlation: this.correlation,
    });
  }
}

const validationIssues = (error: z.ZodError): readonly JsonObject[] => error.issues.map((issue) => ({
  path: issue.path.join("."),
  message: issue.message,
  code: issue.code,
}));

export const parsePublishingContract = <TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  input: unknown,
  correlation?: CorrelationMetadata,
): z.output<TSchema> => {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new PublishingRuntimeError({
      code: "PUBLISHING_VALIDATION_FAILED",
      message: "Publishing runtime contract validation failed",
      status: 400,
      details: { issues: validationIssues(result.error) },
      correlation,
    });
  }
  return result.data;
};

export const publishingContextSchema = z.object({
  tenantId: idSchema,
  actorId: idSchema.optional(),
  correlation: correlationMetadataSchema,
}).strict();
export type PublishingContext = z.output<typeof publishingContextSchema>;

export const publishingContentStateSchema = z.enum(["DRAFT", "REVIEW", "APPROVED", "ARCHIVED"]);
export type PublishingContentState = z.output<typeof publishingContentStateSchema>;

export const publishingContentSnapshotSchema = z.object({
  tenantId: idSchema,
  contentId: idSchema,
  campaignId: idSchema.optional(),
  contentVariantId: idSchema.optional(),
  state: publishingContentStateSchema,
  version: z.number().int().nonnegative(),
  metadata: metadataSchema,
}).strict();
export type PublishingContentSnapshot = z.output<typeof publishingContentSnapshotSchema>;

export const providerConnectionSnapshotSchema = z.object({
  tenantId: idSchema,
  connectionId: idSchema,
  providerId: idSchema,
  providerKind: idSchema,
  authorized: z.boolean(),
  revokedAt: isoDateSchema.nullable().optional(),
  metadata: metadataSchema,
}).strict();
export type ProviderConnectionSnapshot = z.output<typeof providerConnectionSnapshotSchema>;

export const rateLimitDecisionSchema = z.object({
  tenantId: idSchema,
  allowed: z.boolean(),
  reason: z.string().min(1).optional(),
  retryAfter: isoDateSchema.optional(),
  quotaKey: z.string().min(1).optional(),
}).strict();
export type RateLimitDecision = z.output<typeof rateLimitDecisionSchema>;

export const reliabilityDecisionSchema = z.object({
  tenantId: idSchema,
  permitsPublish: z.boolean(),
  health: z.enum(["HEALTHY", "DEGRADED", "UNHEALTHY"]),
  reason: z.string().min(1).optional(),
}).strict();
export type ReliabilityDecision = z.output<typeof reliabilityDecisionSchema>;

export const publishRequestSchema = z.object({
  tenantId: idSchema,
  campaignId: idSchema,
  contentId: idSchema,
  providerConnectionId: idSchema,
  target: idSchema,
  channel: idSchema,
  idempotencyKey: idSchema,
  approvalIds: z.array(idSchema).default([]),
  activeCampaignStates: z.array(publishingContentStateSchema).default(["APPROVED"]),
  scheduledAt: isoDateSchema.optional(),
  metadata: metadataSchema,
}).strict();
export type PublishRequest = z.output<typeof publishRequestSchema>;

export const prePublishInputSchema = z.object({
  context: publishingContextSchema,
  request: publishRequestSchema,
}).strict();
export type PrePublishInput = z.output<typeof prePublishInputSchema>;

export const publishWorkerJobPayloadSchema = z.object({
  tenantId: idSchema,
  jobKind: z.literal("PUBLISH_CONTENT"),
  campaignId: idSchema,
  contentId: idSchema,
  contentVariantId: idSchema.optional(),
  providerConnectionId: idSchema,
  providerId: idSchema,
  providerKind: idSchema,
  target: idSchema,
  channel: idSchema,
  idempotencyKey: idSchema,
  correlation: correlationMetadataSchema,
  replaySafe: z.literal(true),
  metadata: metadataSchema,
}).strict();
export type PublishWorkerJobPayload = z.output<typeof publishWorkerJobPayloadSchema>;

export const publishWorkerJobSchema = z.object({
  tenantId: idSchema,
  queueName: z.string().min(1),
  jobName: z.literal("publish.content"),
  jobId: idSchema,
  dedupeKey: idSchema,
  payload: publishWorkerJobPayloadSchema,
  scheduledAt: isoDateSchema.optional(),
  replaySafe: z.literal(true),
}).strict().refine((job) => job.tenantId === job.payload.tenantId, {
  message: "worker job tenantId must match payload tenantId",
  path: ["payload", "tenantId"],
});
export type PublishWorkerJob = z.output<typeof publishWorkerJobSchema>;

export const prePublishDecisionSchema = z.object({
  tenantId: idSchema,
  state: publishingRuntimeStateSchema,
  reason: z.string().min(1),
  eventType: publishingOutboxEventTypeSchema,
  request: publishRequestSchema,
  workerJob: publishWorkerJobSchema.optional(),
  existingPublishJobId: idSchema.optional(),
  correlation: correlationMetadataSchema,
}).strict();
export type PrePublishDecision = z.output<typeof prePublishDecisionSchema>;

export const publishDispatchResultSchema = z.object({
  tenantId: idSchema,
  state: publishingRuntimeStateSchema,
  decision: prePublishDecisionSchema,
  publishJob: z.unknown().optional(),
  workerJob: publishWorkerJobSchema.optional(),
  correlation: correlationMetadataSchema,
}).strict();
export type PublishDispatchResult = Omit<z.output<typeof publishDispatchResultSchema>, "publishJob"> & {
  readonly publishJob?: PublishJob | undefined;
};

export interface PublishingContentRepository {
  findContentById(context: TenantScoped, contentId: string): Promise<PublishingContentSnapshot | null>;
}

export interface PublishingProviderConnectionRepository {
  findProviderConnectionById(context: TenantScoped, connectionId: string): Promise<ProviderConnectionSnapshot | null>;
}

export interface PublishingRateLimitService {
  checkPublishAllowed(input: {
    readonly tenantId: string;
    readonly campaignId: string;
    readonly contentId: string;
    readonly providerConnectionId: string;
    readonly target: string;
    readonly idempotencyKey: string;
    readonly correlation: CorrelationMetadata;
  }): Promise<RateLimitDecision>;
}

export interface PublishingReliabilityService {
  checkPublishHealth(input: {
    readonly tenantId: string;
    readonly providerConnectionId: string;
    readonly target: string;
    readonly correlation: CorrelationMetadata;
  }): Promise<ReliabilityDecision>;
}

export interface PublishingRuntimeDependencies {
  readonly campaigns: Pick<CampaignRepository, "findById" | "findPublishJobByIdempotencyKey" | "enqueuePublish">;
  readonly contents: PublishingContentRepository;
  readonly approvals: Pick<ApprovalRepository, "findRequestByApprovalId">;
  readonly providerConnections: PublishingProviderConnectionRepository;
  readonly rateLimits: PublishingRateLimitService;
  readonly reliability: PublishingReliabilityService;
  readonly events: Pick<EventRepository, "appendOutbox">;
  readonly queueName?: string | undefined;
}

const isTenantMismatch = (input: PrePublishInput): boolean => input.context.tenantId !== input.request.tenantId;

const heldStates = new Set<PublishingRuntimeState>([
  "HELD_APPROVAL",
  "HELD_RELIABILITY",
  "HELD_RATE_LIMIT",
  "HELD_PROVIDER_AUTH",
]);

const eventTypeForState = (state: PublishingRuntimeState): PublishingOutboxEventType => {
  if (state === "READY") return "PUBLISH_READY";
  if (state === "FAILED") return "PUBLISH_FAILED";
  if (state.startsWith("REJECTED_")) return "PUBLISH_REJECTED";
  if (heldStates.has(state)) return "PUBLISH_HELD";
  return "PUBLISH_FAILED";
};

const ensureTenantRecord = (tenantId: string, record: { readonly tenantId: string } | null): PublishingRuntimeState | undefined => {
  if (record === null) return "REJECTED_INVALID_STATE";
  return record.tenantId === tenantId ? undefined : "REJECTED_TENANT_MISMATCH";
};

const createFailedDecision = (input: PrePublishInput, error: unknown): PrePublishDecision => createDecision(
  input,
  "FAILED",
  error instanceof Error ? error.message : "Publishing runtime dependency failed",
);

export const buildPublishWorkerJob = (input: {
  readonly context: PublishingContext;
  readonly request: PublishRequest;
  readonly content: PublishingContentSnapshot;
  readonly providerConnection: ProviderConnectionSnapshot;
  readonly queueName?: string | undefined;
}): PublishWorkerJob => publishWorkerJobSchema.parse({
  tenantId: input.request.tenantId,
  queueName: input.queueName ?? `tenant.${input.request.tenantId}.publishing`,
  jobName: "publish.content",
  jobId: input.request.idempotencyKey,
  dedupeKey: input.request.idempotencyKey,
  payload: {
    tenantId: input.request.tenantId,
    jobKind: "PUBLISH_CONTENT",
    campaignId: input.request.campaignId,
    contentId: input.request.contentId,
    contentVariantId: input.content.contentVariantId,
    providerConnectionId: input.request.providerConnectionId,
    providerId: input.providerConnection.providerId,
    providerKind: input.providerConnection.providerKind,
    target: input.request.target,
    channel: input.request.channel,
    idempotencyKey: input.request.idempotencyKey,
    correlation: input.context.correlation,
    replaySafe: true,
    metadata: input.request.metadata,
  },
  scheduledAt: input.request.scheduledAt,
  replaySafe: true,
});

export const buildPublishJobInput = (decision: PrePublishDecision): CreatePublishJobInput => {
  if (decision.workerJob === undefined) {
    throw new PublishingRuntimeError({
      code: "PUBLISHING_INVALID_STATE",
      message: "Cannot build publish job input without a READY worker job",
      status: 409,
      correlation: decision.correlation,
    });
  }

  return {
    tenantId: decision.tenantId,
    target: decision.request.target,
    contentItemId: decision.request.campaignId,
    contentVariantId: decision.workerJob.payload.contentVariantId,
    idempotencyKey: decision.request.idempotencyKey,
    state: "QUEUED",
    scheduledAt: decision.request.scheduledAt,
    metadata: {
      ...decision.request.metadata,
      campaignId: decision.request.campaignId,
      contentId: decision.request.contentId,
      providerConnectionId: decision.request.providerConnectionId,
      providerId: decision.workerJob.payload.providerId,
      providerKind: decision.workerJob.payload.providerKind,
      channel: decision.request.channel,
      workerJobId: decision.workerJob.jobId,
      replaySafe: true,
      correlationId: decision.correlation.correlationId,
    },
  };
};

export const buildPublishingOutboxEvent = (decision: PrePublishDecision, eventType = decision.eventType): CreateOutboxEventInput => ({
  tenantId: decision.tenantId,
  aggregateType: "PUBLISH",
  aggregateId: decision.request.idempotencyKey,
  eventType,
  idempotencyKey: `${decision.request.idempotencyKey}:${eventType}`,
  correlationId: decision.correlation.correlationId,
  payload: {
    tenantId: decision.tenantId,
    campaignId: decision.request.campaignId,
    contentId: decision.request.contentId,
    providerConnectionId: decision.request.providerConnectionId,
    target: decision.request.target,
    channel: decision.request.channel,
    idempotencyKey: decision.request.idempotencyKey,
    state: decision.state,
    reason: decision.reason,
    workerJob: decision.workerJob,
    existingPublishJobId: decision.existingPublishJobId,
    replaySafe: true,
  },
});

const appendDecisionEvent = async (dependencies: PublishingRuntimeDependencies, decision: PrePublishDecision, eventType = decision.eventType): Promise<void> => {
  await dependencies.events.appendOutbox({ tenantId: decision.tenantId }, buildPublishingOutboxEvent(decision, eventType));
};

const allApprovalsSatisfied = async (dependencies: PublishingRuntimeDependencies, input: PrePublishInput): Promise<boolean> => {
  for (const approvalId of input.request.approvalIds) {
    const approval = await dependencies.approvals.findRequestByApprovalId({ tenantId: input.request.tenantId }, approvalId);
    if (approval === null || approval.tenantId !== input.request.tenantId || approval.resourceId !== input.request.contentId || approval.state !== "APPROVED") {
      return false;
    }
  }
  return true;
};

const evaluatePrePublishGateUnchecked = async (dependencies: PublishingRuntimeDependencies, input: PrePublishInput): Promise<PrePublishDecision> => {
  if (isTenantMismatch(input)) {
    return createDecision(input, "REJECTED_TENANT_MISMATCH", "Tenant context does not match publish payload tenantId");
  }

  const scope = { tenantId: input.request.tenantId };
  const campaign = await dependencies.campaigns.findById(scope, input.request.campaignId);
  const campaignMismatch = ensureTenantRecord(input.request.tenantId, campaign);
  if (campaignMismatch !== undefined) {
    return createDecision(input, campaignMismatch, "Campaign does not exist for tenant");
  }

  if (!input.request.activeCampaignStates.includes((campaign as Campaign).state)) {
    return createDecision(input, "REJECTED_INVALID_STATE", "Campaign is not active for publishing");
  }

  const content = await dependencies.contents.findContentById(scope, input.request.contentId);
  const contentMismatch = ensureTenantRecord(input.request.tenantId, content);
  if (contentMismatch !== undefined || content === null) {
    return createDecision(input, contentMismatch ?? "REJECTED_INVALID_STATE", "Content does not exist for tenant");
  }

  if (content.campaignId !== undefined && content.campaignId !== input.request.campaignId) {
    return createDecision(input, "REJECTED_INVALID_STATE", "Content does not belong to campaign");
  }

  if (content.state !== "APPROVED") {
    return createDecision(input, "REJECTED_INVALID_STATE", "Content is not approved");
  }

  if (!(await allApprovalsSatisfied(dependencies, input))) {
    return createDecision(input, "HELD_APPROVAL", "Approval requirements are not satisfied");
  }

  const providerConnection = await dependencies.providerConnections.findProviderConnectionById(scope, input.request.providerConnectionId);
  if (providerConnection === null) {
    return createDecision(input, "HELD_PROVIDER_AUTH", "Provider connection does not exist for tenant");
  }
  const providerMismatch = ensureTenantRecord(input.request.tenantId, providerConnection);
  if (providerMismatch !== undefined) {
    return createDecision(input, providerMismatch, "Provider connection tenantId does not match publish tenantId");
  }

  if (!providerConnection.authorized || providerConnection.revokedAt !== undefined && providerConnection.revokedAt !== null) {
    return createDecision(input, "HELD_PROVIDER_AUTH", "Provider connection is not authorized");
  }

  const rateLimit = rateLimitDecisionSchema.parse(await dependencies.rateLimits.checkPublishAllowed({
    tenantId: input.request.tenantId,
    campaignId: input.request.campaignId,
    contentId: input.request.contentId,
    providerConnectionId: input.request.providerConnectionId,
    target: input.request.target,
    idempotencyKey: input.request.idempotencyKey,
    correlation: input.context.correlation,
  }));
  if (rateLimit.tenantId !== input.request.tenantId) {
    return createDecision(input, "REJECTED_TENANT_MISMATCH", "Rate-limit decision tenantId does not match publish tenantId");
  }
  if (!rateLimit.allowed) {
    return createDecision(input, "HELD_RATE_LIMIT", rateLimit.reason ?? "Rate limit or quota does not allow publish");
  }

  const reliability = reliabilityDecisionSchema.parse(await dependencies.reliability.checkPublishHealth({
    tenantId: input.request.tenantId,
    providerConnectionId: input.request.providerConnectionId,
    target: input.request.target,
    correlation: input.context.correlation,
  }));
  if (reliability.tenantId !== input.request.tenantId) {
    return createDecision(input, "REJECTED_TENANT_MISMATCH", "Reliability decision tenantId does not match publish tenantId");
  }
  if (!reliability.permitsPublish) {
    return createDecision(input, "HELD_RELIABILITY", reliability.reason ?? "Reliability health does not permit publish");
  }

  const existingPublishJob = await dependencies.campaigns.findPublishJobByIdempotencyKey(scope, input.request.idempotencyKey);
  if (existingPublishJob !== null) {
    return createDecision(input, "REJECTED_INVALID_STATE", "Publish idempotency key has already been used", undefined, existingPublishJob.id);
  }

  return createDecision(
    input,
    "READY",
    "Publish request passed all pre-publish gates",
    buildPublishWorkerJob({ context: input.context, request: input.request, content, providerConnection, queueName: dependencies.queueName }),
  );
};

export const evaluatePrePublishGate = async (dependencies: PublishingRuntimeDependencies, input: unknown): Promise<PrePublishDecision> => {
  const parsed = parsePublishingContract(prePublishInputSchema, input);
  try {
    const decision = await evaluatePrePublishGateUnchecked(dependencies, parsed);
    await appendDecisionEvent(dependencies, decision);
    return decision;
  } catch (error) {
    const failed = createFailedDecision(parsed, error);
    await appendDecisionEvent(dependencies, failed, "PUBLISH_FAILED");
    return failed;
  }
};

export const dispatchPublish = async (dependencies: PublishingRuntimeDependencies, input: unknown): Promise<PublishDispatchResult> => {
  const decision = await evaluatePrePublishGate(dependencies, input);
  if (decision.state !== "READY" || decision.workerJob === undefined) {
    return {
      tenantId: decision.tenantId,
      state: decision.state,
      decision,
      correlation: decision.correlation,
    };
  }

  try {
    const publishJob = await dependencies.campaigns.enqueuePublish({ tenantId: decision.tenantId }, buildPublishJobInput(decision));
    const dispatchedDecision = createDecision(decision, "READY", "Publish job dispatched", decision.workerJob);
    await appendDecisionEvent(dependencies, dispatchedDecision, "PUBLISH_DISPATCHED");
    return {
      tenantId: decision.tenantId,
      state: "READY",
      decision: dispatchedDecision,
      publishJob,
      workerJob: decision.workerJob,
      correlation: decision.correlation,
    };
  } catch (error) {
    const failed = createFailedDecision({ context: { tenantId: decision.tenantId, correlation: decision.correlation }, request: decision.request }, error);
    await appendDecisionEvent(dependencies, failed, "PUBLISH_FAILED");
    return {
      tenantId: decision.tenantId,
      state: "FAILED",
      decision: failed,
      workerJob: decision.workerJob,
      correlation: decision.correlation,
    };
  }
};

const createDecisionFromDecision = (
  previous: PrePublishDecision,
  state: PublishingRuntimeState,
  reason: string,
  workerJob?: PublishWorkerJob,
): PrePublishDecision => prePublishDecisionSchema.parse({
  tenantId: previous.tenantId,
  state,
  reason,
  eventType: eventTypeForState(state),
  request: previous.request,
  workerJob,
  existingPublishJobId: previous.existingPublishJobId,
  correlation: previous.correlation,
});

function createDecision(
  input: PrePublishInput | PrePublishDecision,
  state: PublishingRuntimeState,
  reason: string,
  workerJob?: PublishWorkerJob,
  existingPublishJobId?: string,
): PrePublishDecision {
  if ("eventType" in input) {
    return createDecisionFromDecision(input, state, reason, workerJob);
  }
  return prePublishDecisionSchema.parse({
    tenantId: state === "REJECTED_TENANT_MISMATCH" ? input.context.tenantId : input.request.tenantId,
    state,
    reason,
    eventType: eventTypeForState(state),
    request: input.request,
    workerJob,
    existingPublishJobId,
    correlation: input.context.correlation,
  });
}
