import { z } from "zod";

import {
  PersistenceError,
  type PersistenceCorrelationMetadata,
  assertTenantScope,
  persistenceCorrelationMetadataSchema,
  type TenantScoped,
} from "@whisperm/types";

export { PersistenceError } from "@whisperm/types";

export type JsonObject = Readonly<Record<string, unknown>>;
export type SortDirection = "asc" | "desc";

export interface PageRequest {
  readonly limit?: number;
  readonly cursor?: string;
}

export interface Page<TItem> {
  readonly items: readonly TItem[];
  readonly nextCursor?: string;
}

export interface OptimisticLock {
  readonly expectedUpdatedAt: string;
}

export interface RepositoryTransaction {
  readonly tenantId: string;
  readonly correlation: PersistenceCorrelationMetadata;
  readonly prisma: PrismaPersistenceClient;
}

export interface TransactionOptions {
  readonly maxWaitMs?: number;
  readonly timeoutMs?: number;
}

export interface RepositoryTransactionRunner {
  runInTransaction<TResult>(
    context: TenantScoped & { readonly correlation: PersistenceCorrelationMetadata },
    work: (transaction: RepositoryTransaction) => Promise<TResult>,
    options?: TransactionOptions,
  ): Promise<TResult>;
}

type PrismaWhere = Readonly<Record<string, unknown>>;
type PrismaData = Readonly<Record<string, unknown>>;
type PrismaOrderBy = Readonly<Record<string, SortDirection>>;

interface PrismaDelegate {
  create(args: { readonly data: PrismaData }): Promise<unknown>;
  findUnique?(args: { readonly where: PrismaWhere }): Promise<unknown | null>;
  findFirst(args: { readonly where: PrismaWhere; readonly orderBy?: PrismaOrderBy }): Promise<unknown | null>;
  findMany(args: { readonly where: PrismaWhere; readonly take?: number; readonly orderBy?: PrismaOrderBy }): Promise<readonly unknown[]>;
  update(args: { readonly where: PrismaWhere; readonly data: PrismaData }): Promise<unknown>;
  updateMany(args: { readonly where: PrismaWhere; readonly data: PrismaData }): Promise<{ readonly count: number }>;
  upsert?(args: { readonly where: PrismaWhere; readonly create: PrismaData; readonly update: PrismaData }): Promise<unknown>;
}

export interface PrismaPersistenceClient {
  readonly tenant: PrismaDelegate;
  readonly tenantUser: PrismaDelegate;
  readonly contact: PrismaDelegate;
  readonly leadEvent: PrismaDelegate;
  readonly contentItem: PrismaDelegate;
  readonly contentVariant: PrismaDelegate;
  readonly publishJob: PrismaDelegate;
  readonly workflowExecution: PrismaDelegate;
  readonly workflowStepExecution: PrismaDelegate;
  readonly eventIngestion: PrismaDelegate;
  readonly outboxEvent: PrismaDelegate;
  readonly inboxEvent: PrismaDelegate;
  readonly idempotencyKey: PrismaDelegate;
  readonly aiExecution: PrismaDelegate;
  readonly auditLog: PrismaDelegate;
  $transaction?<TResult>(work: (client: PrismaPersistenceClient) => Promise<TResult>, options?: { readonly maxWait?: number; readonly timeout?: number }): Promise<TResult>;
}

const pageRequestSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).optional()
}).strict();

const isoDateSchema = z.string().datetime();
const metadataSchema = z.record(z.string(), z.unknown()).default({});
const tenantContextSchema = z.object({ tenantId: z.string().min(1) }).strict();
const tenantRoleSchema = z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]);
const contentStateSchema = z.enum(["DRAFT", "REVIEW", "APPROVED", "ARCHIVED"]);
const publishStateSchema = z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"]);
const workflowExecutionStateSchema = z.enum([
  "PENDING", "SCHEDULED", "RUNNING", "WAITING_FOR_APPROVAL", "WAITING_FOR_EVENT", "RETRY_SCHEDULED", "SUCCEEDED", "FAILED", "CANCELLED", "DEAD_LETTERED"
]);
const workflowStepExecutionStateSchema = z.enum(["PENDING", "RUNNING", "WAITING", "RETRY_SCHEDULED", "SUCCEEDED", "FAILED", "SKIPPED", "DEAD_LETTERED"]);
const aiExecutionStateSchema = z.enum(["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"]);
const eventPersistenceStateSchema = z.enum(["RECEIVED", "NORMALIZED", "PROCESSED", "FAILED", "DEAD_LETTERED"]);
const deliveryStateSchema = z.enum(["PENDING", "PUBLISHED", "CONSUMED", "FAILED", "DEAD_LETTERED"]);
const idempotencyStateSchema = z.enum(["IN_PROGRESS", "COMPLETED", "FAILED", "EXPIRED"]);

const baseRecordSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema.optional()
}).strict();

export const tenantSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  externalId: z.string().min(1).nullable().optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
}).strict();
export type Tenant = z.output<typeof tenantSchema>;
export type CreateTenantInput = Pick<Tenant, "slug" | "name"> & { readonly externalId?: string };
export type UpdateTenantInput = Partial<Pick<Tenant, "name" | "externalId">> & OptimisticLock;

export const userSchema = baseRecordSchema.extend({
  externalUserId: z.string().min(1).nullable().optional(),
  email: z.string().email(),
  displayName: z.string().min(1).nullable().optional(),
  role: tenantRoleSchema,
  isActive: z.boolean()
}).required({ updatedAt: true }).strict();
export type User = z.output<typeof userSchema>;
export type CreateUserInput = TenantScoped & Pick<User, "email" | "role"> & Partial<Pick<User, "externalUserId" | "displayName" | "isActive">>;
export type UpdateUserInput = Partial<Pick<User, "email" | "role" | "externalUserId" | "displayName" | "isActive">> & OptimisticLock;


export const contactRecordSchema = baseRecordSchema.extend({
  externalId: z.string().min(1).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().min(1).nullable().optional(),
  firstName: z.string().min(1).nullable().optional(),
  lastName: z.string().min(1).nullable().optional(),
  metadata: metadataSchema.nullable().optional()
}).required({ updatedAt: true }).strict();
export type ContactRecord = z.output<typeof contactRecordSchema>;
export type CreateContactInput = TenantScoped & Partial<Pick<ContactRecord, "externalId" | "email" | "phone" | "firstName" | "lastName" | "metadata">>;
export type UpdateContactInput = Partial<Pick<ContactRecord, "externalId" | "email" | "phone" | "firstName" | "lastName" | "metadata">> & OptimisticLock;

export const leadEventRecordSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  contactId: z.string().min(1).nullable().optional(),
  inboundEventId: z.string().min(1).nullable().optional(),
  externalId: z.string().min(1).nullable().optional(),
  eventType: z.string().min(1),
  correlationId: z.string().min(1).nullable().optional(),
  occurredAt: isoDateSchema,
  payload: metadataSchema.nullable().optional(),
  createdAt: isoDateSchema
}).strict();
export type LeadEventRecord = z.output<typeof leadEventRecordSchema>;

export const campaignSchema = baseRecordSchema.extend({
  contactId: z.string().min(1).nullable().optional(),
  createdByUserId: z.string().min(1).nullable().optional(),
  externalId: z.string().min(1).nullable().optional(),
  title: z.string().min(1),
  state: contentStateSchema,
  source: z.string().min(1).nullable().optional(),
  metadata: metadataSchema.nullable().optional()
}).required({ updatedAt: true }).strict();
export type Campaign = z.output<typeof campaignSchema>;
export type CreateCampaignInput = TenantScoped & Pick<Campaign, "title"> & Partial<Pick<Campaign, "contactId" | "createdByUserId" | "externalId" | "state" | "source" | "metadata">>;
export type UpdateCampaignInput = Partial<Pick<Campaign, "title" | "contactId" | "createdByUserId" | "externalId" | "state" | "source" | "metadata">> & OptimisticLock;

export const campaignVariantSchema = baseRecordSchema.extend({
  contentItemId: z.string().min(1),
  externalId: z.string().min(1).nullable().optional(),
  label: z.string().min(1),
  channel: z.string().min(1),
  version: z.number().int().positive(),
  state: contentStateSchema,
  body: z.string().min(1),
  metadata: metadataSchema.nullable().optional()
}).required({ updatedAt: true }).strict();
export type CampaignVariant = z.output<typeof campaignVariantSchema>;
export type CreateCampaignVariantInput = TenantScoped & Pick<CampaignVariant, "contentItemId" | "label" | "channel" | "body"> & Partial<Pick<CampaignVariant, "externalId" | "version" | "state" | "metadata">>;

export const publishJobSchema = baseRecordSchema.extend({
  contentItemId: z.string().min(1).nullable().optional(),
  contentVariantId: z.string().min(1).nullable().optional(),
  externalId: z.string().min(1).nullable().optional(),
  idempotencyKey: z.string().min(1).nullable().optional(),
  target: z.string().min(1),
  state: publishStateSchema,
  attempts: z.number().int().nonnegative(),
  scheduledAt: isoDateSchema.nullable().optional(),
  startedAt: isoDateSchema.nullable().optional(),
  finishedAt: isoDateSchema.nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  metadata: metadataSchema.nullable().optional()
}).required({ updatedAt: true }).strict();
export type PublishJob = z.output<typeof publishJobSchema>;
export type CreatePublishJobInput = TenantScoped & Pick<PublishJob, "target"> & Partial<Pick<PublishJob, "contentItemId" | "contentVariantId" | "externalId" | "idempotencyKey" | "state" | "scheduledAt" | "metadata">>;

export const workflowExecutionSchema = baseRecordSchema.extend({
  workflowId: z.string().min(1),
  workflowVersion: z.number().int().positive(),
  runId: z.string().min(1),
  state: workflowExecutionStateSchema,
  idempotencyKey: z.string().min(1).nullable().optional(),
  input: metadataSchema,
  output: z.record(z.string(), z.unknown()).nullable().optional(),
  error: z.record(z.string(), z.unknown()).nullable().optional(),
  correlationId: z.string().min(1),
  causationId: z.string().min(1).nullable().optional(),
  scheduledAt: isoDateSchema.nullable().optional(),
  startedAt: isoDateSchema.nullable().optional(),
  finishedAt: isoDateSchema.nullable().optional()
}).required({ updatedAt: true }).strict();
export type WorkflowExecution = z.output<typeof workflowExecutionSchema>;
export type CreateWorkflowExecutionInput = TenantScoped & Pick<WorkflowExecution, "workflowId" | "workflowVersion" | "runId" | "correlationId"> & Partial<Pick<WorkflowExecution, "state" | "idempotencyKey" | "input" | "causationId" | "scheduledAt">>;
export type UpdateWorkflowExecutionInput = Partial<Pick<WorkflowExecution, "state" | "output" | "error" | "scheduledAt" | "startedAt" | "finishedAt">> & OptimisticLock;

export const workflowStepExecutionSchema = baseRecordSchema.extend({
  workflowExecutionId: z.string().min(1),
  stepId: z.string().min(1),
  state: workflowStepExecutionStateSchema,
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  input: metadataSchema,
  output: z.record(z.string(), z.unknown()).nullable().optional(),
  error: z.record(z.string(), z.unknown()).nullable().optional(),
  scheduledAt: isoDateSchema.nullable().optional(),
  startedAt: isoDateSchema.nullable().optional(),
  finishedAt: isoDateSchema.nullable().optional()
}).required({ updatedAt: true }).strict();
export type WorkflowStepExecution = z.output<typeof workflowStepExecutionSchema>;
export type UpsertWorkflowStepInput = TenantScoped & Pick<WorkflowStepExecution, "workflowExecutionId" | "stepId"> & Partial<Pick<WorkflowStepExecution, "state" | "attempt" | "maxAttempts" | "input" | "scheduledAt">>;

export const approvalRequestRecordSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  approvalId: z.string().min(1),
  requesterId: z.string().min(1),
  resourceType: z.string().min(1),
  resourceId: z.string().min(1),
  state: z.enum(["REQUESTED", "APPROVED", "REJECTED", "CANCELLED", "EXPIRED"]),
  idempotencyKey: z.string().min(1),
  metadata: metadataSchema,
  correlation: persistenceCorrelationMetadataSchema,
  createdAt: isoDateSchema
}).strict();
export type ApprovalRequestRecord = z.output<typeof approvalRequestRecordSchema>;
export type CreateApprovalRequestInput = TenantScoped & Omit<ApprovalRequestRecord, "id" | "createdAt" | "correlation" | "metadata"> & { readonly metadata?: JsonObject; readonly correlation: PersistenceCorrelationMetadata };

export const approvalDecisionRecordSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  approvalId: z.string().min(1),
  decisionId: z.string().min(1),
  outcome: z.enum(["APPROVED", "REJECTED", "CANCELLED"]),
  decidedBy: z.string().min(1),
  reason: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1),
  metadata: metadataSchema,
  correlation: persistenceCorrelationMetadataSchema,
  createdAt: isoDateSchema
}).strict();
export type ApprovalDecisionRecord = z.output<typeof approvalDecisionRecordSchema>;
export type CreateApprovalDecisionInput = TenantScoped & Omit<ApprovalDecisionRecord, "id" | "createdAt" | "correlation" | "metadata"> & { readonly metadata?: JsonObject; readonly correlation: PersistenceCorrelationMetadata };

export const aiExecutionSchema = baseRecordSchema.extend({
  workflowExecutionId: z.string().min(1).nullable().optional(),
  providerId: z.string().min(1),
  providerKind: z.string().min(1),
  model: z.string().min(1),
  state: aiExecutionStateSchema,
  idempotencyKey: z.string().min(1).nullable().optional(),
  promptHash: z.string().min(1),
  request: z.record(z.string(), z.unknown()),
  response: z.record(z.string(), z.unknown()).nullable().optional(),
  usage: z.record(z.string(), z.unknown()).nullable().optional(),
  error: z.record(z.string(), z.unknown()).nullable().optional(),
  correlationId: z.string().min(1),
  startedAt: isoDateSchema.nullable().optional(),
  finishedAt: isoDateSchema.nullable().optional()
}).required({ updatedAt: true }).strict();
export type AiExecution = z.output<typeof aiExecutionSchema>;
export type CreateAiExecutionInput = TenantScoped & Pick<AiExecution, "providerId" | "providerKind" | "model" | "promptHash" | "request" | "correlationId"> & Partial<Pick<AiExecution, "workflowExecutionId" | "state" | "idempotencyKey" | "startedAt">>;

export const eventIngestionSchema = baseRecordSchema.extend({
  provider: z.string().min(1),
  providerEventId: z.string().min(1),
  eventType: z.string().min(1),
  idempotencyKey: z.string().min(1),
  state: eventPersistenceStateSchema,
  occurredAt: isoDateSchema,
  receivedAt: isoDateSchema,
  processedAt: isoDateSchema.nullable().optional(),
  payload: z.record(z.string(), z.unknown()),
  error: z.record(z.string(), z.unknown()).nullable().optional(),
  correlationId: z.string().min(1)
}).strict();
export type EventIngestion = z.output<typeof eventIngestionSchema>;
export type CreateEventIngestionInput = TenantScoped & Pick<EventIngestion, "provider" | "providerEventId" | "eventType" | "idempotencyKey" | "occurredAt" | "payload" | "correlationId"> & Partial<Pick<EventIngestion, "state" | "receivedAt">>;

export const outboxEventRecordSchema = baseRecordSchema.extend({
  aggregateType: z.string().min(1),
  aggregateId: z.string().min(1),
  eventType: z.string().min(1),
  eventVersion: z.number().int().positive(),
  idempotencyKey: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  headers: z.record(z.string(), z.unknown()),
  state: deliveryStateSchema,
  availableAt: isoDateSchema,
  publishedAt: isoDateSchema.nullable().optional(),
  attemptsMade: z.number().int().nonnegative(),
  correlationId: z.string().min(1)
}).required({ updatedAt: true }).strict();
export type OutboxEventRecord = z.output<typeof outboxEventRecordSchema>;
export type CreateOutboxEventInput = TenantScoped & Pick<OutboxEventRecord, "aggregateType" | "aggregateId" | "eventType" | "idempotencyKey" | "payload" | "correlationId"> & Partial<Pick<OutboxEventRecord, "eventVersion" | "headers" | "state" | "availableAt">>;

export const inboxEventRecordSchema = z.object({
  id: z.string().min(1), tenantId: z.string().min(1), source: z.string().min(1), messageId: z.string().min(1), eventType: z.string().min(1), payload: z.record(z.string(), z.unknown()), headers: z.record(z.string(), z.unknown()), state: deliveryStateSchema, receivedAt: isoDateSchema, processedAt: isoDateSchema.nullable().optional(), attemptsMade: z.number().int().nonnegative(), correlationId: z.string().min(1), error: z.record(z.string(), z.unknown()).nullable().optional()
}).strict();
export type InboxEventRecord = z.output<typeof inboxEventRecordSchema>;
export type CreateInboxEventInput = TenantScoped & Pick<InboxEventRecord, "source" | "messageId" | "eventType" | "payload" | "correlationId"> & Partial<Pick<InboxEventRecord, "headers" | "state" | "receivedAt">>;

export const idempotencyRecordSchema = baseRecordSchema.extend({
  scope: z.string().min(1),
  key: z.string().min(1),
  requestHash: z.string().min(1),
  state: idempotencyStateSchema,
  response: z.unknown().optional(),
  lockedUntil: isoDateSchema.nullable().optional(),
  expiresAt: isoDateSchema
}).required({ updatedAt: true }).strict();
export type IdempotencyRecord = z.output<typeof idempotencyRecordSchema>;

export const auditLogRecordSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  actorId: z.string().min(1).nullable().optional(),
  action: z.string().min(1),
  targetType: z.string().min(1),
  targetId: z.string().min(1).nullable().optional(),
  correlationId: z.string().min(1),
  requestId: z.string().min(1).nullable().optional(),
  occurredAt: isoDateSchema,
  metadata: metadataSchema.nullable().optional()
}).strict();
export type AuditLogRecord = z.output<typeof auditLogRecordSchema>;
export type CreateAuditLogInput = TenantScoped & Pick<AuditLogRecord, "action" | "targetType" | "correlationId"> & Partial<Pick<AuditLogRecord, "actorId" | "targetId" | "requestId" | "metadata" | "occurredAt">>;

export const billingUsageRecordSchema = z.object({
  id: z.string().min(1), tenantId: z.string().min(1), usageId: z.string().min(1), metric: z.string().min(1), quantity: z.number().nonnegative(), occurredAt: isoDateSchema, idempotencyKey: z.string().min(1), metadata: metadataSchema, correlation: persistenceCorrelationMetadataSchema, createdAt: isoDateSchema
}).strict();
export type BillingUsageRecord = z.output<typeof billingUsageRecordSchema>;
export type RecordBillingUsageInput = TenantScoped & Omit<BillingUsageRecord, "id" | "createdAt" | "correlation" | "metadata"> & { readonly metadata?: JsonObject; readonly correlation: PersistenceCorrelationMetadata };

export interface TenantRepository extends RepositoryTransactionRunner {
  create(input: CreateTenantInput): Promise<Tenant>;
  findById(id: string): Promise<Tenant | null>;
  findBySlug(slug: string): Promise<Tenant | null>;
  update(id: string, input: UpdateTenantInput): Promise<Tenant>;
}
export interface UserRepository { create(context: TenantScoped, input: CreateUserInput): Promise<User>; findById(context: TenantScoped, id: string): Promise<User | null>; findByEmail(context: TenantScoped, email: string): Promise<User | null>; list(context: TenantScoped, page?: PageRequest): Promise<Page<User>>; update(context: TenantScoped, id: string, input: UpdateUserInput): Promise<User>; }
export interface ContactRepository { create(context: TenantScoped, input: CreateContactInput): Promise<ContactRecord>; findById(context: TenantScoped, id: string): Promise<ContactRecord | null>; list(context: TenantScoped, page?: PageRequest): Promise<Page<ContactRecord>>; update(context: TenantScoped, id: string, input: UpdateContactInput): Promise<ContactRecord>; listLeadEvents(context: TenantScoped, contactId: string, page?: PageRequest): Promise<Page<LeadEventRecord>>; }
export interface CampaignRepository { create(context: TenantScoped, input: CreateCampaignInput): Promise<Campaign>; findById(context: TenantScoped, id: string): Promise<Campaign | null>; list(context: TenantScoped, page?: PageRequest): Promise<Page<Campaign>>; update(context: TenantScoped, id: string, input: UpdateCampaignInput): Promise<Campaign>; addVariant(context: TenantScoped, input: CreateCampaignVariantInput): Promise<CampaignVariant>; enqueuePublish(context: TenantScoped, input: CreatePublishJobInput): Promise<PublishJob>; findPublishJobByIdempotencyKey(context: TenantScoped, idempotencyKey: string): Promise<PublishJob | null>; }
export interface WorkflowRepository { createExecution(context: TenantScoped, input: CreateWorkflowExecutionInput): Promise<WorkflowExecution>; findExecutionById(context: TenantScoped, id: string): Promise<WorkflowExecution | null>; findExecutionByRunId(context: TenantScoped, runId: string): Promise<WorkflowExecution | null>; updateExecution(context: TenantScoped, id: string, input: UpdateWorkflowExecutionInput): Promise<WorkflowExecution>; upsertStep(context: TenantScoped, input: UpsertWorkflowStepInput): Promise<WorkflowStepExecution>; listRunnableExecutions(context: TenantScoped, state: z.output<typeof workflowExecutionStateSchema>, page?: PageRequest): Promise<Page<WorkflowExecution>>; }
export interface ApprovalRepository { createRequest(context: TenantScoped, input: CreateApprovalRequestInput): Promise<ApprovalRequestRecord>; recordDecision(context: TenantScoped, input: CreateApprovalDecisionInput): Promise<ApprovalDecisionRecord>; findRequestByApprovalId(context: TenantScoped, approvalId: string): Promise<ApprovalRequestRecord | null>; }
export interface ExecutionRepository { createAiExecution(context: TenantScoped, input: CreateAiExecutionInput): Promise<AiExecution>; findAiExecutionByIdempotencyKey(context: TenantScoped, idempotencyKey: string): Promise<AiExecution | null>; updateAiExecution(context: TenantScoped, id: string, input: Partial<Pick<AiExecution, "state" | "response" | "usage" | "error" | "startedAt" | "finishedAt">> & OptimisticLock): Promise<AiExecution>; }
export interface EventRepository { ingest(context: TenantScoped, input: CreateEventIngestionInput): Promise<EventIngestion>; findIngestionByProviderEvent(context: TenantScoped, provider: string, providerEventId: string): Promise<EventIngestion | null>; appendOutbox(context: TenantScoped, input: CreateOutboxEventInput): Promise<OutboxEventRecord>; markOutboxPublished(context: TenantScoped, id: string, publishedAt: string): Promise<void>; recordInbox(context: TenantScoped, input: CreateInboxEventInput): Promise<InboxEventRecord>; markInboxConsumed(context: TenantScoped, id: string, processedAt: string): Promise<void>; reserveIdempotency(input: Omit<IdempotencyRecord, "id" | "createdAt" | "updatedAt">): Promise<IdempotencyRecord>; completeIdempotency(input: TenantScoped & { readonly scope: string; readonly key: string; readonly response: unknown }): Promise<IdempotencyRecord>; }
export interface BillingRepository { recordUsage(context: TenantScoped, input: RecordBillingUsageInput): Promise<BillingUsageRecord>; findUsageByIdempotencyKey(context: TenantScoped, idempotencyKey: string): Promise<BillingUsageRecord | null>; }
export interface AuditLogRepository { append(context: TenantScoped, input: CreateAuditLogInput): Promise<AuditLogRecord>; listByTarget(context: TenantScoped, targetType: string, targetId: string, page?: PageRequest): Promise<Page<AuditLogRecord>>; }

const ensureContext = (context: TenantScoped): void => {
  tenantContextSchema.parse({ tenantId: context.tenantId });
};

const ensureTenantInput = (context: TenantScoped, input: TenantScoped): void => {
  ensureContext(context);
  assertTenantScope(context, input);
};

const withTenant = (context: TenantScoped, where: PrismaWhere = {}): PrismaWhere => ({ ...where, tenantId: context.tenantId });
const byTenantId = (context: TenantScoped, id: string): PrismaWhere => ({ tenantId: context.tenantId, id });
const byCompoundTenantId = (context: TenantScoped, id: string): PrismaWhere => ({ tenantId_id: { tenantId: context.tenantId, id } });
const dateToIso = (value: unknown): unknown => value instanceof Date ? value.toISOString() : value;

const normalizeRecord = (value: unknown): unknown => {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeRecord);
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, normalizeRecord(nested)]));
};

const parseRecord = <TSchema extends z.ZodTypeAny>(schema: TSchema, value: unknown): z.output<TSchema> => schema.parse(normalizeRecord(value));

const dataWithDefined = (input: Readonly<Record<string, unknown>>): PrismaData => Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));

const paginate = <TItem extends { readonly id: string }>(items: readonly TItem[], limit: number): Page<TItem> => {
  const pageItems = items.slice(0, limit);
  const extra = items.length > limit;
  if (!extra) return { items: pageItems };
  const last = pageItems[pageItems.length - 1];
  return last === undefined ? { items: pageItems } : { items: pageItems, nextCursor: last.id };
};

const pageArgs = (page?: PageRequest): { readonly take: number; readonly cursor?: string } => {
  const parsed = pageRequestSchema.parse(page ?? {});
  const take = (parsed.limit ?? 50) + 1;
  return parsed.cursor === undefined ? { take } : { take, cursor: parsed.cursor };
};

const cursorWhere = (context: TenantScoped, cursor?: string, extra: PrismaWhere = {}): PrismaWhere => cursor === undefined
  ? withTenant(context, extra)
  : withTenant(context, { ...extra, id: { gt: cursor } });

const mapPrismaError = (error: unknown, conflictMessage: string): never => {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
  if (code === "P2002") {
    throw new PersistenceError({ code: "PERSISTENCE_CONFLICT", message: conflictMessage, status: 409 });
  }
  if (error instanceof PersistenceError) throw error;
  throw new PersistenceError({ code: "PERSISTENCE_TRANSIENT", message: "Prisma repository operation failed", status: 503 });
};

const updateOptimistic = async <TSchema extends z.ZodTypeAny>(delegate: PrismaDelegate, schema: TSchema, context: TenantScoped, id: string, input: OptimisticLock & object): Promise<z.output<TSchema>> => {
  const { expectedUpdatedAt, ...rest } = input as OptimisticLock & Readonly<Record<string, unknown>>;
  const result = await delegate.updateMany({ where: { tenantId: context.tenantId, id, updatedAt: new Date(expectedUpdatedAt) }, data: dataWithDefined(rest) });
  if (result.count !== 1) {
    throw new PersistenceError({ code: "PERSISTENCE_CONFLICT", message: "Optimistic lock conflict", status: 409, details: { id } });
  }
  const updated = await delegate.findFirst({ where: byTenantId(context, id) });
  if (updated === null) throw new PersistenceError({ code: "PERSISTENCE_NOT_FOUND", message: "Record not found after update", status: 404, details: { id } });
  return parseRecord(schema, updated);
};

export class PrismaTenantRepository implements TenantRepository {
  constructor(private readonly prisma: PrismaPersistenceClient) {}
  async runInTransaction<TResult>(context: TenantScoped & { readonly correlation: PersistenceCorrelationMetadata }, work: (transaction: RepositoryTransaction) => Promise<TResult>, options?: TransactionOptions): Promise<TResult> {
    ensureContext(context);
    const transactionOptions = options === undefined ? undefined : dataWithDefined({ maxWait: options.maxWaitMs, timeout: options.timeoutMs }) as { readonly maxWait?: number; readonly timeout?: number };
    if (this.prisma.$transaction === undefined) return work({ tenantId: context.tenantId, correlation: context.correlation, prisma: this.prisma });
    return this.prisma.$transaction(async (client) => work({ tenantId: context.tenantId, correlation: context.correlation, prisma: client }), transactionOptions);
  }
  async create(input: CreateTenantInput): Promise<Tenant> {
    try { return parseRecord(tenantSchema, await this.prisma.tenant.create({ data: dataWithDefined(input) })); } catch (error) { return mapPrismaError(error, "Tenant already exists"); }
  }
  async findById(id: string): Promise<Tenant | null> { const result = await this.prisma.tenant.findFirst({ where: { id } }); return result === null ? null : parseRecord(tenantSchema, result); }
  async findBySlug(slug: string): Promise<Tenant | null> { const result = await this.prisma.tenant.findFirst({ where: { slug } }); return result === null ? null : parseRecord(tenantSchema, result); }
  async update(id: string, input: UpdateTenantInput): Promise<Tenant> {
    const { expectedUpdatedAt, ...rest } = input;
    const result = await this.prisma.tenant.updateMany({ where: { id, updatedAt: new Date(expectedUpdatedAt) }, data: dataWithDefined(rest) });
    if (result.count !== 1) throw new PersistenceError({ code: "PERSISTENCE_CONFLICT", message: "Optimistic lock conflict", status: 409, details: { id } });
    const updated = await this.prisma.tenant.findFirst({ where: { id } });
    if (updated === null) throw new PersistenceError({ code: "PERSISTENCE_NOT_FOUND", message: "Tenant not found after update", status: 404, details: { id } });
    return parseRecord(tenantSchema, updated);
  }
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaPersistenceClient) {}
  async create(context: TenantScoped, input: CreateUserInput): Promise<User> { ensureTenantInput(context, input); try { return parseRecord(userSchema, await this.prisma.tenantUser.create({ data: dataWithDefined(input) })); } catch (error) { return mapPrismaError(error, "User already exists"); } }
  async findById(context: TenantScoped, id: string): Promise<User | null> { ensureContext(context); const result = await this.prisma.tenantUser.findFirst({ where: byTenantId(context, id) }); return result === null ? null : parseRecord(userSchema, result); }
  async findByEmail(context: TenantScoped, email: string): Promise<User | null> { ensureContext(context); const result = await this.prisma.tenantUser.findFirst({ where: withTenant(context, { email }) }); return result === null ? null : parseRecord(userSchema, result); }
  async list(context: TenantScoped, page?: PageRequest): Promise<Page<User>> { ensureContext(context); const args = pageArgs(page); const rows = await this.prisma.tenantUser.findMany({ where: cursorWhere(context, args.cursor), take: args.take, orderBy: { id: "asc" } }); return paginate(rows.map((row) => parseRecord(userSchema, row)), args.take - 1); }
  async update(context: TenantScoped, id: string, input: UpdateUserInput): Promise<User> { ensureContext(context); return updateOptimistic(this.prisma.tenantUser, userSchema, context, id, input); }
}


export class PrismaContactRepository implements ContactRepository {
  constructor(private readonly prisma: PrismaPersistenceClient) {}
  async create(context: TenantScoped, input: CreateContactInput): Promise<ContactRecord> { ensureTenantInput(context, input); try { return parseRecord(contactRecordSchema, await this.prisma.contact.create({ data: dataWithDefined(input) })); } catch (error) { return mapPrismaError(error, "Contact already exists"); } }
  async findById(context: TenantScoped, id: string): Promise<ContactRecord | null> { ensureContext(context); const result = await this.prisma.contact.findFirst({ where: byTenantId(context, id) }); return result === null ? null : parseRecord(contactRecordSchema, result); }
  async list(context: TenantScoped, page?: PageRequest): Promise<Page<ContactRecord>> { ensureContext(context); const args = pageArgs(page); const rows = await this.prisma.contact.findMany({ where: cursorWhere(context, args.cursor), take: args.take, orderBy: { id: "asc" } }); return paginate(rows.map((row) => parseRecord(contactRecordSchema, row)), args.take - 1); }
  async update(context: TenantScoped, id: string, input: UpdateContactInput): Promise<ContactRecord> { ensureContext(context); return updateOptimistic(this.prisma.contact, contactRecordSchema, context, id, input); }
  async listLeadEvents(context: TenantScoped, contactId: string, page?: PageRequest): Promise<Page<LeadEventRecord>> { ensureContext(context); const args = pageArgs(page); const rows = await this.prisma.leadEvent.findMany({ where: cursorWhere(context, args.cursor, { contactId }), take: args.take, orderBy: { id: "asc" } }); return paginate(rows.map((row) => parseRecord(leadEventRecordSchema, row)), args.take - 1); }
}

export class PrismaCampaignRepository implements CampaignRepository {
  constructor(private readonly prisma: PrismaPersistenceClient) {}
  async create(context: TenantScoped, input: CreateCampaignInput): Promise<Campaign> { ensureTenantInput(context, input); try { return parseRecord(campaignSchema, await this.prisma.contentItem.create({ data: dataWithDefined({ state: "DRAFT", ...input }) })); } catch (error) { return mapPrismaError(error, "Campaign already exists"); } }
  async findById(context: TenantScoped, id: string): Promise<Campaign | null> { ensureContext(context); const result = await this.prisma.contentItem.findFirst({ where: byTenantId(context, id) }); return result === null ? null : parseRecord(campaignSchema, result); }
  async list(context: TenantScoped, page?: PageRequest): Promise<Page<Campaign>> { ensureContext(context); const args = pageArgs(page); const rows = await this.prisma.contentItem.findMany({ where: cursorWhere(context, args.cursor), take: args.take, orderBy: { id: "asc" } }); return paginate(rows.map((row) => parseRecord(campaignSchema, row)), args.take - 1); }
  async update(context: TenantScoped, id: string, input: UpdateCampaignInput): Promise<Campaign> { ensureContext(context); return updateOptimistic(this.prisma.contentItem, campaignSchema, context, id, input); }
  async addVariant(context: TenantScoped, input: CreateCampaignVariantInput): Promise<CampaignVariant> { ensureTenantInput(context, input); try { return parseRecord(campaignVariantSchema, await this.prisma.contentVariant.create({ data: dataWithDefined({ state: "DRAFT", version: 1, ...input }) })); } catch (error) { return mapPrismaError(error, "Campaign variant already exists"); } }
  async enqueuePublish(context: TenantScoped, input: CreatePublishJobInput): Promise<PublishJob> { ensureTenantInput(context, input); try { return parseRecord(publishJobSchema, await this.prisma.publishJob.create({ data: dataWithDefined({ state: "QUEUED", ...input }) })); } catch (error) { return mapPrismaError(error, "Publish job already exists"); } }
  async findPublishJobByIdempotencyKey(context: TenantScoped, idempotencyKey: string): Promise<PublishJob | null> { ensureContext(context); const result = await this.prisma.publishJob.findFirst({ where: withTenant(context, { idempotencyKey }) }); return result === null ? null : parseRecord(publishJobSchema, result); }
}

export class PrismaWorkflowRepository implements WorkflowRepository {
  constructor(private readonly prisma: PrismaPersistenceClient) {}
  async createExecution(context: TenantScoped, input: CreateWorkflowExecutionInput): Promise<WorkflowExecution> { ensureTenantInput(context, input); try { return parseRecord(workflowExecutionSchema, await this.prisma.workflowExecution.create({ data: dataWithDefined({ state: "PENDING", input: {}, ...input }) })); } catch (error) { return mapPrismaError(error, "Workflow execution already exists"); } }
  async findExecutionById(context: TenantScoped, id: string): Promise<WorkflowExecution | null> { ensureContext(context); const result = await this.prisma.workflowExecution.findFirst({ where: byTenantId(context, id) }); return result === null ? null : parseRecord(workflowExecutionSchema, result); }
  async findExecutionByRunId(context: TenantScoped, runId: string): Promise<WorkflowExecution | null> { ensureContext(context); const result = await this.prisma.workflowExecution.findFirst({ where: withTenant(context, { runId }) }); return result === null ? null : parseRecord(workflowExecutionSchema, result); }
  async updateExecution(context: TenantScoped, id: string, input: UpdateWorkflowExecutionInput): Promise<WorkflowExecution> { ensureContext(context); return updateOptimistic(this.prisma.workflowExecution, workflowExecutionSchema, context, id, input); }
  async upsertStep(context: TenantScoped, input: UpsertWorkflowStepInput): Promise<WorkflowStepExecution> { ensureTenantInput(context, input); if (this.prisma.workflowStepExecution.upsert === undefined) throw new PersistenceError({ code: "PERSISTENCE_TRANSIENT", message: "Prisma upsert is unavailable", status: 503 }); try { return parseRecord(workflowStepExecutionSchema, await this.prisma.workflowStepExecution.upsert({ where: { tenantId_workflowExecutionId_stepId: { tenantId: context.tenantId, workflowExecutionId: input.workflowExecutionId, stepId: input.stepId } }, create: dataWithDefined({ state: "PENDING", attempt: 0, maxAttempts: 1, input: {}, ...input }), update: dataWithDefined(input) })); } catch (error) { return mapPrismaError(error, "Workflow step conflict"); } }
  async listRunnableExecutions(context: TenantScoped, state: z.output<typeof workflowExecutionStateSchema>, page?: PageRequest): Promise<Page<WorkflowExecution>> { ensureContext(context); const args = pageArgs(page); const rows = await this.prisma.workflowExecution.findMany({ where: cursorWhere(context, args.cursor, { state }), take: args.take, orderBy: { id: "asc" } }); return paginate(rows.map((row) => parseRecord(workflowExecutionSchema, row)), args.take - 1); }
}

const auditApprovalRequest = (input: CreateApprovalRequestInput): CreateAuditLogInput => ({ tenantId: input.tenantId, actorId: input.requesterId, action: "APPROVAL_REQUESTED", targetType: "APPROVAL", targetId: input.approvalId, correlationId: input.correlation.correlationId, requestId: input.correlation.requestId, metadata: { ...input.metadata, approval: input } });
const auditApprovalDecision = (input: CreateApprovalDecisionInput): CreateAuditLogInput => ({ tenantId: input.tenantId, actorId: input.decidedBy, action: "APPROVAL_DECIDED", targetType: "APPROVAL", targetId: input.approvalId, correlationId: input.correlation.correlationId, requestId: input.correlation.requestId, metadata: { ...input.metadata, decision: input } });

export class PrismaApprovalRepository implements ApprovalRepository {
  constructor(private readonly audit: AuditLogRepository) {}
  async createRequest(context: TenantScoped, input: CreateApprovalRequestInput): Promise<ApprovalRequestRecord> { ensureTenantInput(context, input); const row = await this.audit.append(context, auditApprovalRequest(input)); return approvalRequestRecordSchema.parse({ id: row.id, tenantId: input.tenantId, approvalId: input.approvalId, requesterId: input.requesterId, resourceType: input.resourceType, resourceId: input.resourceId, state: input.state, idempotencyKey: input.idempotencyKey, metadata: input.metadata ?? {}, correlation: input.correlation, createdAt: row.occurredAt }); }
  async recordDecision(context: TenantScoped, input: CreateApprovalDecisionInput): Promise<ApprovalDecisionRecord> { ensureTenantInput(context, input); const row = await this.audit.append(context, auditApprovalDecision(input)); return approvalDecisionRecordSchema.parse({ id: row.id, tenantId: input.tenantId, approvalId: input.approvalId, decisionId: input.decisionId, outcome: input.outcome, decidedBy: input.decidedBy, reason: input.reason, idempotencyKey: input.idempotencyKey, metadata: input.metadata ?? {}, correlation: input.correlation, createdAt: row.occurredAt }); }
  async findRequestByApprovalId(context: TenantScoped, approvalId: string): Promise<ApprovalRequestRecord | null> { const page = await this.audit.listByTarget(context, "APPROVAL", approvalId, { limit: 100 }); const row = page.items.find((item) => item.action === "APPROVAL_REQUESTED"); if (row === undefined) return null; const metadata = (row.metadata ?? {}) as JsonObject; const approval = metadata.approval; return approval === undefined ? null : approvalRequestRecordSchema.parse({ ...(approval as JsonObject), id: row.id, createdAt: row.occurredAt }); }
}

export class PrismaExecutionRepository implements ExecutionRepository {
  constructor(private readonly prisma: PrismaPersistenceClient) {}
  async createAiExecution(context: TenantScoped, input: CreateAiExecutionInput): Promise<AiExecution> { ensureTenantInput(context, input); try { return parseRecord(aiExecutionSchema, await this.prisma.aiExecution.create({ data: dataWithDefined({ state: "PENDING", ...input }) })); } catch (error) { return mapPrismaError(error, "AI execution already exists"); } }
  async findAiExecutionByIdempotencyKey(context: TenantScoped, idempotencyKey: string): Promise<AiExecution | null> { ensureContext(context); const result = await this.prisma.aiExecution.findFirst({ where: withTenant(context, { idempotencyKey }) }); return result === null ? null : parseRecord(aiExecutionSchema, result); }
  async updateAiExecution(context: TenantScoped, id: string, input: Partial<Pick<AiExecution, "state" | "response" | "usage" | "error" | "startedAt" | "finishedAt">> & OptimisticLock): Promise<AiExecution> { ensureContext(context); return updateOptimistic(this.prisma.aiExecution, aiExecutionSchema, context, id, input); }
}

export class PrismaEventRepository implements EventRepository {
  constructor(private readonly prisma: PrismaPersistenceClient) {}
  async ingest(context: TenantScoped, input: CreateEventIngestionInput): Promise<EventIngestion> { ensureTenantInput(context, input); try { return parseRecord(eventIngestionSchema, await this.prisma.eventIngestion.create({ data: dataWithDefined({ state: "RECEIVED", receivedAt: new Date(), ...input }) })); } catch (error) { return mapPrismaError(error, "Event ingestion already exists"); } }
  async findIngestionByProviderEvent(context: TenantScoped, provider: string, providerEventId: string): Promise<EventIngestion | null> { ensureContext(context); const result = await this.prisma.eventIngestion.findFirst({ where: withTenant(context, { provider, providerEventId }) }); return result === null ? null : parseRecord(eventIngestionSchema, result); }
  async appendOutbox(context: TenantScoped, input: CreateOutboxEventInput): Promise<OutboxEventRecord> { ensureTenantInput(context, input); try { return parseRecord(outboxEventRecordSchema, await this.prisma.outboxEvent.create({ data: dataWithDefined({ eventVersion: 1, headers: {}, state: "PENDING", availableAt: new Date(), ...input }) })); } catch (error) { return mapPrismaError(error, "Outbox event already exists"); } }
  async markOutboxPublished(context: TenantScoped, id: string, publishedAt: string): Promise<void> { ensureContext(context); await this.prisma.outboxEvent.updateMany({ where: byTenantId(context, id), data: { state: "PUBLISHED", publishedAt: new Date(publishedAt) } }); }
  async recordInbox(context: TenantScoped, input: CreateInboxEventInput): Promise<InboxEventRecord> { ensureTenantInput(context, input); try { return parseRecord(inboxEventRecordSchema, await this.prisma.inboxEvent.create({ data: dataWithDefined({ headers: {}, state: "PENDING", receivedAt: new Date(), ...input }) })); } catch (error) { return mapPrismaError(error, "Inbox event already exists"); } }
  async markInboxConsumed(context: TenantScoped, id: string, processedAt: string): Promise<void> { ensureContext(context); await this.prisma.inboxEvent.updateMany({ where: byTenantId(context, id), data: { state: "CONSUMED", processedAt: new Date(processedAt) } }); }
  async reserveIdempotency(input: Omit<IdempotencyRecord, "id" | "createdAt" | "updatedAt">): Promise<IdempotencyRecord> { ensureContext(input); try { return parseRecord(idempotencyRecordSchema, await this.prisma.idempotencyKey.create({ data: dataWithDefined({ ...input, state: input.state ?? "IN_PROGRESS" }) })); } catch (error) { return mapPrismaError(error, "Idempotency key already reserved"); } }
  async completeIdempotency(input: TenantScoped & { readonly scope: string; readonly key: string; readonly response: unknown }): Promise<IdempotencyRecord> { ensureContext(input); const result = await this.prisma.idempotencyKey.updateMany({ where: withTenant(input, { scope: input.scope, key: input.key, state: "IN_PROGRESS" }), data: { state: "COMPLETED", response: input.response } }); if (result.count !== 1) throw new PersistenceError({ code: "PERSISTENCE_IDEMPOTENCY_CONFLICT", message: "Idempotency key is not in progress", status: 409 }); const row = await this.prisma.idempotencyKey.findFirst({ where: withTenant(input, { scope: input.scope, key: input.key }) }); if (row === null) throw new PersistenceError({ code: "PERSISTENCE_NOT_FOUND", message: "Idempotency key not found", status: 404 }); return parseRecord(idempotencyRecordSchema, row); }
}

export class PrismaBillingRepository implements BillingRepository {
  constructor(private readonly audit: AuditLogRepository) {}
  async recordUsage(context: TenantScoped, input: RecordBillingUsageInput): Promise<BillingUsageRecord> { ensureTenantInput(context, input); const row = await this.audit.append(context, { tenantId: input.tenantId, action: "BILLING_USAGE_RECORDED", targetType: "BILLING_USAGE", targetId: input.idempotencyKey, correlationId: input.correlation.correlationId, requestId: input.correlation.requestId, metadata: { ...input.metadata, usage: input } }); return billingUsageRecordSchema.parse({ id: row.id, tenantId: input.tenantId, usageId: input.usageId, metric: input.metric, quantity: input.quantity, occurredAt: input.occurredAt, idempotencyKey: input.idempotencyKey, metadata: input.metadata ?? {}, correlation: input.correlation, createdAt: row.occurredAt }); }
  async findUsageByIdempotencyKey(context: TenantScoped, idempotencyKey: string): Promise<BillingUsageRecord | null> { const page = await this.audit.listByTarget(context, "BILLING_USAGE", idempotencyKey, { limit: 100 }); const row = page.items.find((item) => item.action === "BILLING_USAGE_RECORDED"); if (row === undefined) return null; const metadata = (row.metadata ?? {}) as JsonObject; const usage = metadata.usage; return usage === undefined ? null : billingUsageRecordSchema.parse({ ...(usage as JsonObject), id: row.id, createdAt: row.occurredAt }); }
}

export class PrismaAuditLogRepository implements AuditLogRepository {
  constructor(private readonly prisma: PrismaPersistenceClient) {}
  async append(context: TenantScoped, input: CreateAuditLogInput): Promise<AuditLogRecord> { ensureTenantInput(context, input); return parseRecord(auditLogRecordSchema, await this.prisma.auditLog.create({ data: dataWithDefined({ occurredAt: new Date(), ...input }) })); }
  async listByTarget(context: TenantScoped, targetType: string, targetId: string, page?: PageRequest): Promise<Page<AuditLogRecord>> { ensureContext(context); const args = pageArgs(page); const rows = await this.prisma.auditLog.findMany({ where: cursorWhere(context, args.cursor, { targetType, targetId }), take: args.take, orderBy: { id: "asc" } }); return paginate(rows.map((row) => parseRecord(auditLogRecordSchema, row)), args.take - 1); }
}

export interface PrismaRepositories {
  readonly tenants: TenantRepository;
  readonly users: UserRepository;
  readonly contacts: ContactRepository;
  readonly campaigns: CampaignRepository;
  readonly workflows: WorkflowRepository;
  readonly approvals: ApprovalRepository;
  readonly executions: ExecutionRepository;
  readonly events: EventRepository;
  readonly billing: BillingRepository;
  readonly auditLogs: AuditLogRepository;
}

export const createPrismaRepositories = (prisma: PrismaPersistenceClient): PrismaRepositories => {
  const auditLogs = new PrismaAuditLogRepository(prisma);
  return {
    tenants: new PrismaTenantRepository(prisma),
    users: new PrismaUserRepository(prisma),
    contacts: new PrismaContactRepository(prisma),
    campaigns: new PrismaCampaignRepository(prisma),
    workflows: new PrismaWorkflowRepository(prisma),
    approvals: new PrismaApprovalRepository(auditLogs),
    executions: new PrismaExecutionRepository(prisma),
    events: new PrismaEventRepository(prisma),
    billing: new PrismaBillingRepository(auditLogs),
    auditLogs
  };
};

export const prismaTenantWhere = {
  byTenantId,
  byCompoundTenantId,
  withTenant,
  assertTenantScope: ensureTenantInput,
  dateToIso
} as const;
