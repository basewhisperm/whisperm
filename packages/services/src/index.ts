import { z } from "zod";

import {
  type ApprovalDecisionRecord,
  approvalDecisionRecordSchema,
  type ApprovalRepository,
  type ApprovalRequestRecord,
  approvalRequestRecordSchema,
  type AuditLogRecord,
  auditLogRecordSchema,
  type AuditLogRepository,
  type BillingRepository,
  type BillingUsageRecord,
  billingUsageRecordSchema,
  type Campaign,
  campaignSchema,
  type CampaignRepository,
  type CampaignVariant,
  campaignVariantSchema,
  type CreateAiExecutionInput,
  type CreateApprovalDecisionInput,
  type CreateApprovalRequestInput,
  type CreateAuditLogInput,
  type CreateCampaignInput,
  type CreateCampaignVariantInput,
  type CreateEventIngestionInput,
  type CreateInboxEventInput,
  type CreateOutboxEventInput,
  type CreatePublishJobInput,
  type CreateTenantInput,
  type CreateUserInput,
  type CreateWorkflowExecutionInput,
  type EventIngestion,
  eventIngestionSchema,
  type EventRepository,
  type ExecutionRepository,
  type IdempotencyRecord,
  idempotencyRecordSchema,
  type InboxEventRecord,
  inboxEventRecordSchema,
  type JsonObject,
  type OutboxEventRecord,
  outboxEventRecordSchema,
  type Page,
  type PageRequest,
  PersistenceError,
  type PublishJob,
  publishJobSchema,
  type RecordBillingUsageInput,
  type Tenant,
  type TenantRepository,
  tenantSchema,
  type UpdateCampaignInput,
  type UpdateTenantInput,
  type UpdateUserInput,
  type UpdateWorkflowExecutionInput,
  type User,
  type UserRepository,
  userSchema,
  type WorkflowExecution,
  workflowExecutionSchema,
  type WorkflowRepository,
  type WorkflowStepExecution,
  workflowStepExecutionSchema,
  type AiExecution,
  aiExecutionSchema,
  type UpsertWorkflowStepInput,
} from "@whisperm/repositories";
import {
  assertTenantScope,
  type PersistenceCorrelationMetadata,
  persistenceCorrelationMetadataSchema,
  type TenantScoped,
} from "@whisperm/types";

const metadataSchema = z.record(z.string(), z.unknown());
const idSchema = z.string().min(1);
const isoDateSchema = z.string().datetime();
const optimisticLockSchema = z.object({ expectedUpdatedAt: isoDateSchema }).strict();

export const serviceContextSchema = z.object({
  tenantId: idSchema,
  actorId: idSchema.optional(),
  correlation: persistenceCorrelationMetadataSchema,
}).strict();
export type ServiceContext = z.output<typeof serviceContextSchema>;

export const serviceErrorCodeValues = [
  "SERVICE_VALIDATION_FAILED",
  "SERVICE_TENANT_MISMATCH",
  "SERVICE_NOT_FOUND",
  "SERVICE_CONFLICT",
  "SERVICE_INVALID_STATE_TRANSITION",
  "SERVICE_IDEMPOTENCY_CONFLICT",
  "SERVICE_TRANSACTION_FAILED",
  "SERVICE_REPOSITORY_FAILED",
] as const;
export const serviceErrorCodeSchema = z.enum(serviceErrorCodeValues);
export type ServiceErrorCode = z.output<typeof serviceErrorCodeSchema>;

export const serviceErrorModelSchema = z.object({
  code: serviceErrorCodeSchema,
  message: z.string().min(1),
  status: z.number().int().min(400).max(599),
  retryable: z.boolean().default(false),
  details: metadataSchema.optional(),
  correlation: persistenceCorrelationMetadataSchema.optional(),
}).strict();
export type ServiceErrorModel = z.output<typeof serviceErrorModelSchema>;

export interface ServiceErrorInput {
  readonly code: ServiceErrorCode;
  readonly message: string;
  readonly status: number;
  readonly retryable?: boolean | undefined;
  readonly details?: JsonObject | undefined;
  readonly correlation?: PersistenceCorrelationMetadata | undefined;
  readonly cause?: unknown;
}

export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: JsonObject | undefined;
  readonly correlation?: PersistenceCorrelationMetadata | undefined;
  override readonly cause?: unknown;

  constructor(input: ServiceErrorInput) {
    super(input.message);
    this.name = "ServiceError";
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable ?? false;
    this.details = input.details;
    this.correlation = input.correlation;
    this.cause = input.cause;
    Object.setPrototypeOf(this, ServiceError.prototype);
  }

  toErrorModel(): ServiceErrorModel {
    return serviceErrorModelSchema.parse({
      code: this.code,
      message: this.message,
      status: this.status,
      retryable: this.retryable,
      details: this.details,
      correlation: this.correlation,
    });
  }
}

export interface ServiceRepositories {
  readonly tenants: TenantRepository;
  readonly users: UserRepository;
  readonly campaigns: CampaignRepository;
  readonly workflows: WorkflowRepository;
  readonly approvals: ApprovalRepository;
  readonly executions: ExecutionRepository;
  readonly events: EventRepository;
  readonly billing: BillingRepository;
  readonly auditLogs: AuditLogRepository;
}

export type TransactionalServiceWork<TResult> = (repositories: ServiceRepositories) => Promise<TResult>;

export interface ServiceTransactionManager {
  run<TResult>(context: ServiceContext, work: TransactionalServiceWork<TResult>): Promise<TResult>;
}

export interface ServiceDependencies extends ServiceRepositories {
  readonly transactions?: ServiceTransactionManager | undefined;
}

export interface DomainEventInput {
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly idempotencyKey: string;
  readonly payload: JsonObject;
  readonly availableAt?: string | undefined;
}

const validationIssues = (error: z.ZodError): readonly JsonObject[] => error.issues.map((issue) => ({
  path: issue.path.join("."),
  message: issue.message,
  code: issue.code,
}));

const parseContract = <TSchema extends z.ZodTypeAny>(schema: TSchema, input: unknown, correlation?: PersistenceCorrelationMetadata): z.output<TSchema> => {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ServiceError({
      code: "SERVICE_VALIDATION_FAILED",
      message: "Service contract validation failed",
      status: 400,
      details: { issues: validationIssues(result.error) },
      correlation,
    });
  }
  return result.data;
};

const contextToTenantScope = (context: ServiceContext): TenantScoped => ({ tenantId: context.tenantId });

const ensureContext = (input: unknown): ServiceContext => parseContract(serviceContextSchema, input);

const ensureTenantInput = <TInput extends TenantScoped>(context: ServiceContext, input: TInput): TInput => {
  try {
    assertTenantScope(context, input);
    return input;
  } catch (error) {
    throw new ServiceError({
      code: "SERVICE_TENANT_MISMATCH",
      message: "Service input tenantId does not match context tenantId",
      status: 403,
      correlation: context.correlation,
      cause: error,
    });
  }
};

const mapRepositoryError = (error: unknown, correlation: PersistenceCorrelationMetadata): never => {
  if (error instanceof ServiceError) {
    throw error;
  }
  if (error instanceof PersistenceError) {
    const code = error.code.includes("IDEMPOTENCY") ? "SERVICE_IDEMPOTENCY_CONFLICT" :
      error.status === 404 ? "SERVICE_NOT_FOUND" :
      error.status === 409 ? "SERVICE_CONFLICT" :
      "SERVICE_REPOSITORY_FAILED";
    throw new ServiceError({ code, message: error.message, status: error.status, correlation, cause: error });
  }
  throw new ServiceError({
    code: "SERVICE_REPOSITORY_FAILED",
    message: "Repository operation failed",
    status: 500,
    retryable: true,
    correlation,
    cause: error,
  });
};

const nonEmptyPartial = (value: Readonly<Record<string, unknown>>): boolean =>
  Object.keys(value).some((key) => value[key] !== undefined && key !== "expectedUpdatedAt");

const runWrite = async <TResult>(deps: ServiceDependencies, context: ServiceContext, work: TransactionalServiceWork<TResult>): Promise<TResult> => {
  try {
    if (deps.transactions !== undefined) {
      return await deps.transactions.run(context, work);
    }
    return await work(deps);
  } catch (error) {
    if (error instanceof ServiceError || error instanceof PersistenceError) {
      mapRepositoryError(error, context.correlation);
    }
    throw new ServiceError({
      code: "SERVICE_TRANSACTION_FAILED",
      message: "Service transaction failed",
      status: 500,
      retryable: true,
      correlation: context.correlation,
      cause: error,
    });
  }
};

const withoutUndefined = <TValue>(value: TValue): TValue => {
  if (Array.isArray(value)) {
    return value.map((item) => withoutUndefined(item)) as TValue;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Readonly<Record<string, unknown>>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, withoutUndefined(entryValue)] as const);
    return Object.fromEntries(entries) as TValue;
  }
  return value;
};

function exactInput<TInput>(value: TInput): TInput;
function exactInput<TInput>(value: unknown): TInput;
function exactInput<TInput>(value: unknown): TInput {
  return withoutUndefined(value) as TInput;
}

const createAuditInput = (context: ServiceContext, input: Omit<CreateAuditLogInput, "tenantId" | "correlationId" | "actorId" | "requestId">): CreateAuditLogInput => ({
  tenantId: context.tenantId,
  actorId: context.actorId,
  correlationId: context.correlation.correlationId,
  requestId: context.correlation.requestId,
  ...input,
});

const appendAudit = async (repositories: ServiceRepositories, context: ServiceContext, input: Omit<CreateAuditLogInput, "tenantId" | "correlationId" | "actorId" | "requestId">): Promise<AuditLogRecord> =>
  repositories.auditLogs.append(contextToTenantScope(context), createAuditInput(context, input));

const appendDomainEvent = async (repositories: ServiceRepositories, context: ServiceContext, input: DomainEventInput): Promise<OutboxEventRecord> => repositories.events.appendOutbox(contextToTenantScope(context), exactInput<CreateOutboxEventInput>({
  tenantId: context.tenantId,
  aggregateType: input.aggregateType,
  aggregateId: input.aggregateId,
  eventType: input.eventType,
  idempotencyKey: input.idempotencyKey,
  payload: input.payload,
  correlationId: context.correlation.correlationId,
  availableAt: input.availableAt,
}));

const ensureFound = <TRecord>(record: TRecord | null, context: ServiceContext, targetType: string, targetId: string): TRecord => {
  if (record === null) {
    throw new ServiceError({
      code: "SERVICE_NOT_FOUND",
      message: `${targetType} not found`,
      status: 404,
      details: { targetType, targetId },
      correlation: context.correlation,
    });
  }
  return record;
};

const tenantCreateInputSchema = z.object({ slug: idSchema, name: idSchema, externalId: idSchema.optional() }).strict();
const tenantUpdateInputSchema = z.object({ name: idSchema.optional(), externalId: idSchema.nullable().optional() }).merge(optimisticLockSchema).strict();

export class TenantService {
  constructor(private readonly deps: ServiceDependencies) {}

  async create(contextInput: ServiceContext, input: CreateTenantInput): Promise<Tenant> {
    const context = ensureContext(contextInput);
    const data = exactInput(parseContract(tenantCreateInputSchema, input, context.correlation));
    return runWrite(this.deps, context, async (repositories) => {
      const tenantInput: CreateTenantInput = data.externalId === undefined ? { slug: data.slug, name: data.name } : { slug: data.slug, name: data.name, externalId: data.externalId };
      const tenant = tenantSchema.parse(await repositories.tenants.create(tenantInput));
      await appendAudit(repositories, { ...context, tenantId: tenant.id }, { action: "TENANT_CREATED", targetType: "TENANT", targetId: tenant.id, metadata: { slug: tenant.slug } });
      await appendDomainEvent(repositories, { ...context, tenantId: tenant.id }, { aggregateType: "TENANT", aggregateId: tenant.id, eventType: "tenant.created", idempotencyKey: `tenant:${tenant.id}:created`, payload: { tenantId: tenant.id, slug: tenant.slug } });
      return tenant;
    });
  }

  async update(contextInput: ServiceContext, tenantId: string, input: UpdateTenantInput): Promise<Tenant> {
    const context = ensureContext(contextInput);
    if (context.tenantId !== tenantId) {
      throw new ServiceError({ code: "SERVICE_TENANT_MISMATCH", message: "Tenant updates must use the context tenant", status: 403, correlation: context.correlation });
    }
    const data = exactInput(parseContract(tenantUpdateInputSchema, input, context.correlation));
    if (!nonEmptyPartial(data)) {
      throw new ServiceError({ code: "SERVICE_VALIDATION_FAILED", message: "Tenant update must include at least one field", status: 400, correlation: context.correlation });
    }
    return runWrite(this.deps, context, async (repositories) => {
      const tenant = tenantSchema.parse(await repositories.tenants.update(tenantId, data as UpdateTenantInput));
      await appendAudit(repositories, context, { action: "TENANT_UPDATED", targetType: "TENANT", targetId: tenant.id });
      await appendDomainEvent(repositories, context, { aggregateType: "TENANT", aggregateId: tenant.id, eventType: "tenant.updated", idempotencyKey: `tenant:${tenant.id}:updated:${tenant.updatedAt}`, payload: { tenantId: tenant.id } });
      return tenant;
    });
  }
}

const createUserInputSchema = z.object({ tenantId: idSchema, email: z.string().email(), role: z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]), externalUserId: idSchema.nullable().optional(), displayName: idSchema.nullable().optional(), isActive: z.boolean().optional() }).strict();
const updateUserInputSchema = z.object({ email: z.string().email().optional(), role: z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]).optional(), externalUserId: idSchema.nullable().optional(), displayName: idSchema.nullable().optional(), isActive: z.boolean().optional() }).merge(optimisticLockSchema).strict();

export class UserService {
  constructor(private readonly deps: ServiceDependencies) {}

  async create(contextInput: ServiceContext, input: CreateUserInput): Promise<User> {
    const context = ensureContext(contextInput);
    const data = ensureTenantInput(context, exactInput(parseContract(createUserInputSchema, input, context.correlation)));
    return runWrite(this.deps, context, async (repositories) => {
      const user = userSchema.parse(await repositories.users.create(contextToTenantScope(context), data as CreateUserInput));
      await appendAudit(repositories, context, { action: "USER_CREATED", targetType: "USER", targetId: user.id, metadata: { role: user.role } });
      await appendDomainEvent(repositories, context, { aggregateType: "USER", aggregateId: user.id, eventType: "user.created", idempotencyKey: `user:${user.id}:created`, payload: { tenantId: user.tenantId, userId: user.id, role: user.role } });
      return user;
    });
  }

  async update(contextInput: ServiceContext, userId: string, input: UpdateUserInput): Promise<User> {
    const context = ensureContext(contextInput);
    const data = exactInput(parseContract(updateUserInputSchema, input, context.correlation));
    if (!nonEmptyPartial(data)) {
      throw new ServiceError({ code: "SERVICE_VALIDATION_FAILED", message: "User update must include at least one field", status: 400, correlation: context.correlation });
    }
    return runWrite(this.deps, context, async (repositories) => {
      const user = userSchema.parse(await repositories.users.update(contextToTenantScope(context), userId, data as UpdateUserInput));
      await appendAudit(repositories, context, { action: "USER_UPDATED", targetType: "USER", targetId: user.id, metadata: { role: user.role, isActive: user.isActive } });
      await appendDomainEvent(repositories, context, { aggregateType: "USER", aggregateId: user.id, eventType: "user.updated", idempotencyKey: `user:${user.id}:updated:${user.updatedAt}`, payload: { tenantId: user.tenantId, userId: user.id } });
      return user;
    });
  }

  async findById(contextInput: ServiceContext, userId: string): Promise<User | null> {
    const context = ensureContext(contextInput);
    return userSchema.nullable().parse(await this.deps.users.findById(contextToTenantScope(context), idSchema.parse(userId)));
  }
}

const createCampaignInputSchema = z.object({ tenantId: idSchema, title: idSchema, contactId: idSchema.nullable().optional(), createdByUserId: idSchema.nullable().optional(), externalId: idSchema.nullable().optional(), state: z.enum(["DRAFT", "REVIEW", "APPROVED", "ARCHIVED"]).optional(), source: idSchema.nullable().optional(), metadata: metadataSchema.nullable().optional() }).strict();
const updateCampaignInputSchema = z.object({ title: idSchema.optional(), contactId: idSchema.nullable().optional(), createdByUserId: idSchema.nullable().optional(), externalId: idSchema.nullable().optional(), state: z.enum(["DRAFT", "REVIEW", "APPROVED", "ARCHIVED"]).optional(), source: idSchema.nullable().optional(), metadata: metadataSchema.nullable().optional() }).merge(optimisticLockSchema).strict();
const createVariantInputSchema = z.object({ tenantId: idSchema, contentItemId: idSchema, label: idSchema, channel: idSchema, body: idSchema, externalId: idSchema.nullable().optional(), version: z.number().int().positive().optional(), state: z.enum(["DRAFT", "REVIEW", "APPROVED", "ARCHIVED"]).optional(), metadata: metadataSchema.nullable().optional() }).strict();
const publishInputSchema = z.object({ tenantId: idSchema, target: idSchema, contentItemId: idSchema.nullable().optional(), contentVariantId: idSchema.nullable().optional(), externalId: idSchema.nullable().optional(), idempotencyKey: idSchema.nullable().optional(), state: z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"]).optional(), scheduledAt: isoDateSchema.nullable().optional(), metadata: metadataSchema.nullable().optional() }).strict();

export class CampaignService {
  constructor(private readonly deps: ServiceDependencies) {}

  async create(contextInput: ServiceContext, input: CreateCampaignInput): Promise<Campaign> {
    const context = ensureContext(contextInput);
    const data = ensureTenantInput(context, exactInput(parseContract(createCampaignInputSchema, input, context.correlation)));
    return runWrite(this.deps, context, async (repositories) => {
      const campaign = campaignSchema.parse(await repositories.campaigns.create(contextToTenantScope(context), exactInput<CreateCampaignInput>({ ...data, state: data.state ?? "DRAFT" })));
      await appendAudit(repositories, context, { action: "CAMPAIGN_CREATED", targetType: "CAMPAIGN", targetId: campaign.id });
      await appendDomainEvent(repositories, context, { aggregateType: "CAMPAIGN", aggregateId: campaign.id, eventType: "campaign.created", idempotencyKey: `campaign:${campaign.id}:created`, payload: { tenantId: campaign.tenantId, campaignId: campaign.id, state: campaign.state } });
      return campaign;
    });
  }

  async update(contextInput: ServiceContext, campaignId: string, input: UpdateCampaignInput): Promise<Campaign> {
    const context = ensureContext(contextInput);
    const current = ensureFound(await this.deps.campaigns.findById(contextToTenantScope(context), campaignId), context, "CAMPAIGN", campaignId);
    const data = exactInput(parseContract(updateCampaignInputSchema, input, context.correlation));
    if (current.state === "ARCHIVED" && data.state !== undefined && data.state !== "ARCHIVED") {
      throw new ServiceError({ code: "SERVICE_INVALID_STATE_TRANSITION", message: "Archived campaigns cannot be reactivated", status: 409, correlation: context.correlation });
    }
    return runWrite(this.deps, context, async (repositories) => {
      const campaign = campaignSchema.parse(await repositories.campaigns.update(contextToTenantScope(context), campaignId, data as UpdateCampaignInput));
      await appendAudit(repositories, context, { action: "CAMPAIGN_UPDATED", targetType: "CAMPAIGN", targetId: campaign.id, metadata: { state: campaign.state } });
      await appendDomainEvent(repositories, context, { aggregateType: "CAMPAIGN", aggregateId: campaign.id, eventType: "campaign.updated", idempotencyKey: `campaign:${campaign.id}:updated:${campaign.updatedAt}`, payload: { tenantId: campaign.tenantId, campaignId: campaign.id, state: campaign.state } });
      return campaign;
    });
  }

  async addVariant(contextInput: ServiceContext, input: CreateCampaignVariantInput): Promise<CampaignVariant> {
    const context = ensureContext(contextInput);
    const data = ensureTenantInput(context, exactInput(parseContract(createVariantInputSchema, input, context.correlation)));
    const campaign = ensureFound(await this.deps.campaigns.findById(contextToTenantScope(context), data.contentItemId), context, "CAMPAIGN", data.contentItemId);
    if (campaign.state === "ARCHIVED") {
      throw new ServiceError({ code: "SERVICE_INVALID_STATE_TRANSITION", message: "Cannot add variants to archived campaigns", status: 409, correlation: context.correlation });
    }
    return runWrite(this.deps, context, async (repositories) => {
      const variant = campaignVariantSchema.parse(await repositories.campaigns.addVariant(contextToTenantScope(context), data as CreateCampaignVariantInput));
      await appendAudit(repositories, context, { action: "CAMPAIGN_VARIANT_ADDED", targetType: "CAMPAIGN", targetId: variant.contentItemId, metadata: { variantId: variant.id } });
      await appendDomainEvent(repositories, context, { aggregateType: "CAMPAIGN", aggregateId: variant.contentItemId, eventType: "campaign.variant_added", idempotencyKey: `campaign:${variant.contentItemId}:variant:${variant.id}:created`, payload: { tenantId: variant.tenantId, campaignId: variant.contentItemId, variantId: variant.id } });
      return variant;
    });
  }

  async enqueuePublish(contextInput: ServiceContext, input: CreatePublishJobInput): Promise<PublishJob> {
    const context = ensureContext(contextInput);
    const data = ensureTenantInput(context, exactInput(parseContract(publishInputSchema, input, context.correlation)));
    if (data.idempotencyKey !== undefined && data.idempotencyKey !== null) {
      const existing = await this.deps.campaigns.findPublishJobByIdempotencyKey(contextToTenantScope(context), data.idempotencyKey);
      if (existing !== null) return publishJobSchema.parse(existing);
    }
    return runWrite(this.deps, context, async (repositories) => {
      const job = publishJobSchema.parse(await repositories.campaigns.enqueuePublish(contextToTenantScope(context), exactInput<CreatePublishJobInput>({ ...data, state: data.state ?? "QUEUED" })));
      await appendAudit(repositories, context, { action: "CAMPAIGN_PUBLISH_ENQUEUED", targetType: "PUBLISH_JOB", targetId: job.id, metadata: { target: job.target } });
      await appendDomainEvent(repositories, context, { aggregateType: "PUBLISH_JOB", aggregateId: job.id, eventType: "campaign.publish_enqueued", idempotencyKey: job.idempotencyKey ?? `publish-job:${job.id}:created`, payload: { tenantId: job.tenantId, publishJobId: job.id, target: job.target } });
      return job;
    });
  }
}

const workflowStateSchema = z.enum(["PENDING", "SCHEDULED", "RUNNING", "WAITING_FOR_APPROVAL", "WAITING_FOR_EVENT", "RETRY_SCHEDULED", "SUCCEEDED", "FAILED", "CANCELLED", "DEAD_LETTERED"]);
const createWorkflowInputSchema = z.object({ tenantId: idSchema, workflowId: idSchema, workflowVersion: z.number().int().positive(), runId: idSchema, correlationId: idSchema, state: workflowStateSchema.optional(), idempotencyKey: idSchema.nullable().optional(), input: metadataSchema.optional(), causationId: idSchema.nullable().optional(), scheduledAt: isoDateSchema.nullable().optional() }).strict();
const updateWorkflowInputSchema = z.object({ state: workflowStateSchema.optional(), output: metadataSchema.nullable().optional(), error: metadataSchema.nullable().optional(), scheduledAt: isoDateSchema.nullable().optional(), startedAt: isoDateSchema.nullable().optional(), finishedAt: isoDateSchema.nullable().optional() }).merge(optimisticLockSchema).strict();
const workflowStepInputSchema = z.object({ tenantId: idSchema, workflowExecutionId: idSchema, stepId: idSchema, state: z.enum(["PENDING", "RUNNING", "WAITING", "RETRY_SCHEDULED", "SUCCEEDED", "FAILED", "SKIPPED", "DEAD_LETTERED"]).optional(), attempt: z.number().int().nonnegative().optional(), maxAttempts: z.number().int().positive().optional(), input: metadataSchema.optional(), scheduledAt: isoDateSchema.nullable().optional() }).strict();
const terminalWorkflowStates = new Set(["SUCCEEDED", "FAILED", "CANCELLED", "DEAD_LETTERED"]);

export class WorkflowService {
  constructor(private readonly deps: ServiceDependencies) {}

  async start(contextInput: ServiceContext, input: CreateWorkflowExecutionInput): Promise<WorkflowExecution> {
    const context = ensureContext(contextInput);
    const data = ensureTenantInput(context, exactInput(parseContract(createWorkflowInputSchema, input, context.correlation)));
    const existing = await this.deps.workflows.findExecutionByRunId(contextToTenantScope(context), data.runId);
    if (existing !== null) return workflowExecutionSchema.parse(existing);
    return runWrite(this.deps, context, async (repositories) => {
      const execution = workflowExecutionSchema.parse(await repositories.workflows.createExecution(contextToTenantScope(context), exactInput<CreateWorkflowExecutionInput>({ ...data, state: data.state ?? "PENDING", input: data.input ?? {} })));
      await appendAudit(repositories, context, { action: "WORKFLOW_STARTED", targetType: "WORKFLOW_EXECUTION", targetId: execution.id, metadata: { workflowId: execution.workflowId } });
      await appendDomainEvent(repositories, context, { aggregateType: "WORKFLOW_EXECUTION", aggregateId: execution.id, eventType: "workflow.started", idempotencyKey: data.idempotencyKey ?? `workflow:${execution.runId}:started`, payload: { tenantId: execution.tenantId, workflowExecutionId: execution.id, runId: execution.runId, state: execution.state } });
      return execution;
    });
  }

  async transition(contextInput: ServiceContext, executionId: string, input: UpdateWorkflowExecutionInput): Promise<WorkflowExecution> {
    const context = ensureContext(contextInput);
    const current = ensureFound(await this.deps.workflows.findExecutionById(contextToTenantScope(context), executionId), context, "WORKFLOW_EXECUTION", executionId);
    const data = exactInput(parseContract(updateWorkflowInputSchema, input, context.correlation));
    if (terminalWorkflowStates.has(current.state) && data.state !== undefined && data.state !== current.state) {
      throw new ServiceError({ code: "SERVICE_INVALID_STATE_TRANSITION", message: "Terminal workflow executions cannot transition", status: 409, correlation: context.correlation });
    }
    return runWrite(this.deps, context, async (repositories) => {
      const execution = workflowExecutionSchema.parse(await repositories.workflows.updateExecution(contextToTenantScope(context), executionId, data as UpdateWorkflowExecutionInput));
      await appendAudit(repositories, context, { action: "WORKFLOW_TRANSITIONED", targetType: "WORKFLOW_EXECUTION", targetId: execution.id, metadata: { state: execution.state } });
      await appendDomainEvent(repositories, context, { aggregateType: "WORKFLOW_EXECUTION", aggregateId: execution.id, eventType: "workflow.transitioned", idempotencyKey: `workflow:${execution.id}:state:${execution.state}:${execution.updatedAt}`, payload: { tenantId: execution.tenantId, workflowExecutionId: execution.id, state: execution.state } });
      return execution;
    });
  }

  async upsertStep(contextInput: ServiceContext, input: UpsertWorkflowStepInput): Promise<WorkflowStepExecution> {
    const context = ensureContext(contextInput);
    const data = ensureTenantInput(context, exactInput(parseContract(workflowStepInputSchema, input, context.correlation)));
    return workflowStepExecutionSchema.parse(await this.deps.workflows.upsertStep(contextToTenantScope(context), data as UpsertWorkflowStepInput));
  }

  async listRunnable(contextInput: ServiceContext, state: z.output<typeof workflowStateSchema>, page?: PageRequest): Promise<Page<WorkflowExecution>> {
    const context = ensureContext(contextInput);
    return this.deps.workflows.listRunnableExecutions(contextToTenantScope(context), workflowStateSchema.parse(state), page);
  }
}

const approvalRequestInputSchema = z.object({ tenantId: idSchema, approvalId: idSchema, requesterId: idSchema, resourceType: idSchema, resourceId: idSchema, state: z.enum(["REQUESTED", "APPROVED", "REJECTED", "CANCELLED", "EXPIRED"]), idempotencyKey: idSchema, metadata: metadataSchema.optional(), correlation: persistenceCorrelationMetadataSchema }).strict();
const approvalDecisionInputSchema = z.object({ tenantId: idSchema, approvalId: idSchema, decisionId: idSchema, outcome: z.enum(["APPROVED", "REJECTED", "CANCELLED"]), decidedBy: idSchema, reason: idSchema.optional(), idempotencyKey: idSchema, metadata: metadataSchema.optional(), correlation: persistenceCorrelationMetadataSchema }).strict();

export class ApprovalService {
  constructor(private readonly deps: ServiceDependencies) {}

  async request(contextInput: ServiceContext, input: CreateApprovalRequestInput): Promise<ApprovalRequestRecord> {
    const context = ensureContext(contextInput);
    const data = ensureTenantInput(context, exactInput(parseContract(approvalRequestInputSchema, input, context.correlation)));
    const existing = await this.deps.approvals.findRequestByApprovalId(contextToTenantScope(context), data.approvalId);
    if (existing !== null) return approvalRequestRecordSchema.parse(existing);
    return runWrite(this.deps, context, async (repositories) => {
      const request = approvalRequestRecordSchema.parse(await repositories.approvals.createRequest(contextToTenantScope(context), data as CreateApprovalRequestInput));
      await appendAudit(repositories, context, { action: "APPROVAL_REQUESTED", targetType: data.resourceType, targetId: data.resourceId, metadata: { approvalId: request.approvalId } });
      await appendDomainEvent(repositories, context, { aggregateType: data.resourceType, aggregateId: data.resourceId, eventType: "approval.requested", idempotencyKey: data.idempotencyKey, payload: { tenantId: request.tenantId, approvalId: request.approvalId, state: request.state } });
      return request;
    });
  }

  async decide(contextInput: ServiceContext, input: CreateApprovalDecisionInput): Promise<ApprovalDecisionRecord> {
    const context = ensureContext(contextInput);
    const data = ensureTenantInput(context, exactInput(parseContract(approvalDecisionInputSchema, input, context.correlation)));
    const request = ensureFound(await this.deps.approvals.findRequestByApprovalId(contextToTenantScope(context), data.approvalId), context, "APPROVAL", data.approvalId);
    if (request.state !== "REQUESTED") {
      throw new ServiceError({ code: "SERVICE_INVALID_STATE_TRANSITION", message: "Only requested approvals can be decided", status: 409, correlation: context.correlation });
    }
    return runWrite(this.deps, context, async (repositories) => {
      const decision = approvalDecisionRecordSchema.parse(await repositories.approvals.recordDecision(contextToTenantScope(context), data as CreateApprovalDecisionInput));
      await appendAudit(repositories, context, { action: "APPROVAL_DECIDED", targetType: request.resourceType, targetId: request.resourceId, metadata: { approvalId: decision.approvalId, outcome: decision.outcome } });
      await appendDomainEvent(repositories, context, { aggregateType: request.resourceType, aggregateId: request.resourceId, eventType: "approval.decided", idempotencyKey: data.idempotencyKey, payload: { tenantId: decision.tenantId, approvalId: decision.approvalId, outcome: decision.outcome } });
      return decision;
    });
  }
}

const aiExecutionInputSchema = z.object({ tenantId: idSchema, providerId: idSchema, providerKind: idSchema, model: idSchema, promptHash: idSchema, request: metadataSchema, correlationId: idSchema, workflowExecutionId: idSchema.nullable().optional(), state: z.enum(["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"]).optional(), idempotencyKey: idSchema.nullable().optional(), startedAt: isoDateSchema.nullable().optional() }).strict();
const aiExecutionUpdateSchema = z.object({ state: z.enum(["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"]).optional(), response: metadataSchema.nullable().optional(), usage: metadataSchema.nullable().optional(), error: metadataSchema.nullable().optional(), startedAt: isoDateSchema.nullable().optional(), finishedAt: isoDateSchema.nullable().optional() }).merge(optimisticLockSchema).strict();

export class ExecutionService {
  constructor(private readonly deps: ServiceDependencies) {}

  async createAiExecution(contextInput: ServiceContext, input: CreateAiExecutionInput): Promise<AiExecution> {
    const context = ensureContext(contextInput);
    const data = ensureTenantInput(context, exactInput(parseContract(aiExecutionInputSchema, input, context.correlation)));
    if (data.idempotencyKey !== undefined && data.idempotencyKey !== null) {
      const existing = await this.deps.executions.findAiExecutionByIdempotencyKey(contextToTenantScope(context), data.idempotencyKey);
      if (existing !== null) return aiExecutionSchema.parse(existing);
    }
    return runWrite(this.deps, context, async (repositories) => {
      const execution = aiExecutionSchema.parse(await repositories.executions.createAiExecution(contextToTenantScope(context), exactInput<CreateAiExecutionInput>({ ...data, state: data.state ?? "PENDING" })));
      await appendAudit(repositories, context, { action: "AI_EXECUTION_CREATED", targetType: "AI_EXECUTION", targetId: execution.id, metadata: { providerKind: execution.providerKind, model: execution.model } });
      await appendDomainEvent(repositories, context, { aggregateType: "AI_EXECUTION", aggregateId: execution.id, eventType: "ai_execution.created", idempotencyKey: data.idempotencyKey ?? `ai-execution:${execution.id}:created`, payload: { tenantId: execution.tenantId, aiExecutionId: execution.id, state: execution.state } });
      return execution;
    });
  }

  async updateAiExecution(contextInput: ServiceContext, executionId: string, input: Parameters<ExecutionRepository["updateAiExecution"]>[2]): Promise<AiExecution> {
    const context = ensureContext(contextInput);
    const data = exactInput(parseContract(aiExecutionUpdateSchema, input, context.correlation));
    return runWrite(this.deps, context, async (repositories) => {
      const execution = aiExecutionSchema.parse(await repositories.executions.updateAiExecution(contextToTenantScope(context), executionId, data as Parameters<ExecutionRepository["updateAiExecution"]>[2]));
      await appendAudit(repositories, context, { action: "AI_EXECUTION_UPDATED", targetType: "AI_EXECUTION", targetId: execution.id, metadata: { state: execution.state } });
      await appendDomainEvent(repositories, context, { aggregateType: "AI_EXECUTION", aggregateId: execution.id, eventType: "ai_execution.updated", idempotencyKey: `ai-execution:${execution.id}:updated:${execution.updatedAt}`, payload: { tenantId: execution.tenantId, aiExecutionId: execution.id, state: execution.state } });
      return execution;
    });
  }
}

const eventIngestionInputSchema = z.object({ tenantId: idSchema, provider: idSchema, providerEventId: idSchema, eventType: idSchema, idempotencyKey: idSchema, occurredAt: isoDateSchema, payload: metadataSchema, correlationId: idSchema, state: z.enum(["RECEIVED", "NORMALIZED", "PROCESSED", "FAILED", "DEAD_LETTERED"]).optional(), receivedAt: isoDateSchema.optional() }).strict();
const outboxInputSchema = z.object({ tenantId: idSchema, aggregateType: idSchema, aggregateId: idSchema, eventType: idSchema, idempotencyKey: idSchema, payload: metadataSchema, correlationId: idSchema, eventVersion: z.number().int().positive().optional(), headers: metadataSchema.optional(), state: z.enum(["PENDING", "PUBLISHED", "CONSUMED", "FAILED", "DEAD_LETTERED"]).optional(), availableAt: isoDateSchema.optional() }).strict();
const inboxInputSchema = z.object({ tenantId: idSchema, source: idSchema, messageId: idSchema, eventType: idSchema, payload: metadataSchema, correlationId: idSchema, headers: metadataSchema.optional(), state: z.enum(["PENDING", "PUBLISHED", "CONSUMED", "FAILED", "DEAD_LETTERED"]).optional(), receivedAt: isoDateSchema.optional() }).strict();
const idempotencyReserveSchema = z.object({ tenantId: idSchema, scope: idSchema, key: idSchema, requestHash: idSchema, state: z.enum(["IN_PROGRESS", "COMPLETED", "FAILED", "EXPIRED"]), response: z.unknown().optional(), lockedUntil: isoDateSchema.nullable().optional(), expiresAt: isoDateSchema }).strict();

export class EventService {
  constructor(private readonly deps: ServiceDependencies) {}

  async ingest(contextInput: ServiceContext, input: CreateEventIngestionInput): Promise<EventIngestion> {
    const context = ensureContext(contextInput);
    const data = ensureTenantInput(context, exactInput(parseContract(eventIngestionInputSchema, input, context.correlation)));
    const existing = await this.deps.events.findIngestionByProviderEvent(contextToTenantScope(context), data.provider, data.providerEventId);
    if (existing !== null) return eventIngestionSchema.parse(existing);
    return runWrite(this.deps, context, async (repositories) => {
      const ingestion = eventIngestionSchema.parse(await repositories.events.ingest(contextToTenantScope(context), exactInput<CreateEventIngestionInput>({ ...data, state: data.state ?? "RECEIVED" })));
      await appendAudit(repositories, context, { action: "EVENT_INGESTED", targetType: "EVENT_INGESTION", targetId: ingestion.id, metadata: { provider: ingestion.provider, eventType: ingestion.eventType } });
      await appendDomainEvent(repositories, context, { aggregateType: "EVENT_INGESTION", aggregateId: ingestion.id, eventType: "event.ingested", idempotencyKey: data.idempotencyKey, payload: { tenantId: ingestion.tenantId, ingestionId: ingestion.id, provider: ingestion.provider, providerEventId: ingestion.providerEventId } });
      return ingestion;
    });
  }

  async appendOutbox(contextInput: ServiceContext, input: CreateOutboxEventInput): Promise<OutboxEventRecord> {
    const context = ensureContext(contextInput);
    const data = ensureTenantInput(context, exactInput(parseContract(outboxInputSchema, input, context.correlation)));
    return outboxEventRecordSchema.parse(await this.deps.events.appendOutbox(contextToTenantScope(context), data as CreateOutboxEventInput));
  }

  async recordInbox(contextInput: ServiceContext, input: CreateInboxEventInput): Promise<InboxEventRecord> {
    const context = ensureContext(contextInput);
    const data = ensureTenantInput(context, exactInput(parseContract(inboxInputSchema, input, context.correlation)));
    return inboxEventRecordSchema.parse(await this.deps.events.recordInbox(contextToTenantScope(context), data as CreateInboxEventInput));
  }

  async reserveIdempotency(input: Omit<IdempotencyRecord, "id" | "createdAt" | "updatedAt">): Promise<IdempotencyRecord> {
    const data = exactInput(parseContract(idempotencyReserveSchema, input));
    return idempotencyRecordSchema.parse(await this.deps.events.reserveIdempotency(data));
  }

  async completeIdempotency(contextInput: ServiceContext, scope: string, key: string, response: unknown): Promise<IdempotencyRecord> {
    const context = ensureContext(contextInput);
    return idempotencyRecordSchema.parse(await this.deps.events.completeIdempotency({ tenantId: context.tenantId, scope: idSchema.parse(scope), key: idSchema.parse(key), response }));
  }
}

const billingUsageInputSchema = z.object({ tenantId: idSchema, usageId: idSchema, metric: idSchema, quantity: z.number().nonnegative(), occurredAt: isoDateSchema, idempotencyKey: idSchema, metadata: metadataSchema.optional(), correlation: persistenceCorrelationMetadataSchema }).strict();

export class BillingService {
  constructor(private readonly deps: ServiceDependencies) {}

  async recordUsage(contextInput: ServiceContext, input: RecordBillingUsageInput): Promise<BillingUsageRecord> {
    const context = ensureContext(contextInput);
    const data = ensureTenantInput(context, exactInput(parseContract(billingUsageInputSchema, input, context.correlation)));
    const existing = await this.deps.billing.findUsageByIdempotencyKey(contextToTenantScope(context), data.idempotencyKey);
    if (existing !== null) return billingUsageRecordSchema.parse(existing);
    return runWrite(this.deps, context, async (repositories) => {
      const usage = billingUsageRecordSchema.parse(await repositories.billing.recordUsage(contextToTenantScope(context), data as RecordBillingUsageInput));
      await appendAudit(repositories, context, { action: "BILLING_USAGE_RECORDED", targetType: "BILLING_USAGE", targetId: usage.idempotencyKey, metadata: { metric: usage.metric, quantity: usage.quantity } });
      await appendDomainEvent(repositories, context, { aggregateType: "BILLING_USAGE", aggregateId: usage.idempotencyKey, eventType: "billing.usage_recorded", idempotencyKey: usage.idempotencyKey, payload: { tenantId: usage.tenantId, usageId: usage.usageId, metric: usage.metric, quantity: usage.quantity } });
      return usage;
    });
  }
}

const auditInputSchema = z.object({ tenantId: idSchema, action: idSchema, targetType: idSchema, correlationId: idSchema, actorId: idSchema.nullable().optional(), targetId: idSchema.nullable().optional(), requestId: idSchema.nullable().optional(), metadata: metadataSchema.nullable().optional(), occurredAt: isoDateSchema.optional() }).strict();

export class AuditService {
  constructor(private readonly deps: ServiceDependencies) {}

  async append(contextInput: ServiceContext, input: CreateAuditLogInput): Promise<AuditLogRecord> {
    const context = ensureContext(contextInput);
    const data = ensureTenantInput(context, exactInput(parseContract(auditInputSchema, input, context.correlation)));
    return auditLogRecordSchema.parse(await this.deps.auditLogs.append(contextToTenantScope(context), data as CreateAuditLogInput));
  }

  async listByTarget(contextInput: ServiceContext, targetType: string, targetId: string, page?: PageRequest): Promise<Page<AuditLogRecord>> {
    const context = ensureContext(contextInput);
    return this.deps.auditLogs.listByTarget(contextToTenantScope(context), idSchema.parse(targetType), idSchema.parse(targetId), page);
  }
}

export interface WhispeRMServices {
  readonly tenants: TenantService;
  readonly users: UserService;
  readonly campaigns: CampaignService;
  readonly workflows: WorkflowService;
  readonly approvals: ApprovalService;
  readonly executions: ExecutionService;
  readonly events: EventService;
  readonly billing: BillingService;
  readonly audit: AuditService;
}

export const createWhispeRMServices = (dependencies: ServiceDependencies): WhispeRMServices => ({
  tenants: new TenantService(dependencies),
  users: new UserService(dependencies),
  campaigns: new CampaignService(dependencies),
  workflows: new WorkflowService(dependencies),
  approvals: new ApprovalService(dependencies),
  executions: new ExecutionService(dependencies),
  events: new EventService(dependencies),
  billing: new BillingService(dependencies),
  audit: new AuditService(dependencies),
});
