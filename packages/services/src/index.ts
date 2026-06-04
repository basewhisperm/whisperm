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
  type ContactRepository,
  type ActivityRepository,
  type ActivityListFilters,
  type ActivityRecord,
  activityRecordSchema,
  type ContactRecord,
  contactRecordSchema,
  type CreateContactInput,
  type CreateActivityInput,
  type CreateDealInput,
  type UpdateContactInput,
  type LeadEventRecord,
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
  type DealCardRecord,
  dealCardRecordSchema,
  type DealDetailRecord,
  type DealRecord,
  dealRecordSchema,
  type DealsRepository,
  type BoardPaginationRequest,
  type PipelineBoardRecord,
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
  buildScoreRecomputationIdempotencyKey,
  contactStageSchema,
  phoneE164Schema,
  type ContactStage,
  scoreRecomputationJobPayloadSchema,
  scoreRecomputationResultSchema,
  type ScoreRecomputationJobPayload,
  type ScoreRecomputationResult,
  trustBandSchema,
  type TrustBand,
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
  "SERVICE_PLAN_LIMIT_EXCEEDED",
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
  readonly contacts: ContactRepository;
  readonly deals: DealsRepository;
  readonly activities: ActivityRepository;
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

export interface ContactPlanReader {
  findCurrentPlan(context: TenantScoped): Promise<{ readonly plan: string } | null>;
}

export interface ServiceDependencies extends ServiceRepositories {
  readonly transactions?: ServiceTransactionManager | undefined;
  readonly contactPlans?: ContactPlanReader | undefined;
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
      await appendDomainEvent(repositories, { ...context, tenantId: tenant.id }, { aggregateType: "TENANT", aggregateId: tenant.id, eventType: "tenant.created", idempotencyKey: `tenant:${tenant.id}:created`, payload: { tenantId: tenant.id, workspaceId: tenant.id, workspaceName: tenant.name, slug: tenant.slug } });
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


export interface ContactImportRow {
  readonly email?: string | undefined;
  readonly firstName?: string | undefined;
  readonly lastName?: string | undefined;
  readonly phone?: string | undefined;
  readonly externalId?: string | undefined;
  readonly stage?: string | undefined;
  readonly metadata?: JsonObject | undefined;
}

export interface ContactImportRowError {
  readonly row: number;
  readonly field: string;
  readonly reason: string;
}

export interface ContactImportRequest {
  readonly tenantId: string;
  readonly rows: readonly ContactImportRow[];
}

export interface ContactImportResult {
  readonly imported: number;
  readonly skipped: number;
  readonly errors: readonly ContactImportRowError[];
}

const contactImportBatchSize = 500;
const starterContactLimit = 50;
const contactImportRowSchema = z.object({
  email: z.string().trim().min(1, "Email is required").email(),
  firstName: idSchema.optional(),
  lastName: idSchema.optional(),
  phone: phoneE164Schema.optional(),
  externalId: idSchema.optional(),
  stage: contactStageSchema,
  metadata: metadataSchema.optional(),
}).strict();
type ValidContactImportRow = z.output<typeof contactImportRowSchema>;

const normalizeOptionalText = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
};

const normalizeImportRow = (row: ContactImportRow): ContactImportRow => ({
  email: normalizeOptionalText(row.email)?.toLowerCase(),
  firstName: normalizeOptionalText(row.firstName),
  lastName: normalizeOptionalText(row.lastName),
  phone: normalizeOptionalText(row.phone),
  externalId: normalizeOptionalText(row.externalId),
  stage: normalizeOptionalText(row.stage),
  metadata: row.metadata,
});

const validationErrorForRow = (rowNumber: number, input: ContactImportRow, error: z.ZodError): ContactImportRowError => {
  const stageIssue = error.issues.find((issue) => issue.path[0] === "stage");
  if (stageIssue !== undefined) {
    return { row: rowNumber, field: "stage", reason: input.stage === undefined || input.stage.trim().length === 0 ? "Stage is required" : "Stage must match a supported contact stage" };
  }
  const emailIssue = error.issues.find((issue) => issue.path[0] === "email");
  if (emailIssue !== undefined) {
    return { row: rowNumber, field: "email", reason: input.email === undefined || input.email.trim().length === 0 ? "Email is required" : "Email must be valid" };
  }
  const firstIssue = error.issues[0];
  return { row: rowNumber, field: String(firstIssue?.path[0] ?? "row"), reason: firstIssue?.message ?? "Row is invalid" };
};

const toCreateContactInput = (tenantId: string, row: ValidContactImportRow): CreateContactInput => exactInput({
  tenantId,
  email: row.email,
  firstName: row.firstName,
  lastName: row.lastName,
  phone: row.phone,
  externalId: row.externalId,
  stage: row.stage as ContactStage,
  metadata: row.metadata,
});

const chunk = <TItem>(items: readonly TItem[], size: number): readonly (readonly TItem[])[] => {
  const chunks: TItem[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const createContactInputSchema = z.object({ tenantId: idSchema, externalId: idSchema.nullable().optional(), email: z.string().email().nullable().optional(), phone: phoneE164Schema.nullable().optional(), firstName: idSchema.nullable().optional(), lastName: idSchema.nullable().optional(), stage: contactStageSchema.default("PROSPECT"), metadata: metadataSchema.nullable().optional() }).strict().refine((contact) => contact.email !== undefined || contact.phone !== undefined || contact.externalId !== undefined, { message: "Contact create requires at least one stable identifier", path: ["email"] });
const updateContactInputSchema = z.object({ externalId: idSchema.nullable().optional(), email: z.string().email().nullable().optional(), phone: phoneE164Schema.nullable().optional(), firstName: idSchema.nullable().optional(), lastName: idSchema.nullable().optional(), stage: contactStageSchema.optional(), metadata: metadataSchema.nullable().optional() }).merge(optimisticLockSchema).strict();

export class ContactService {
  constructor(private readonly deps: ServiceDependencies) {}

  async create(contextInput: ServiceContext, input: CreateContactInput): Promise<ContactRecord> {
    const context = ensureContext(contextInput);
    const data = ensureTenantInput(context, exactInput(parseContract(createContactInputSchema, input, context.correlation)));
    return runWrite(this.deps, context, async (repositories) => {
      const contact = contactRecordSchema.parse(await repositories.contacts.create(contextToTenantScope(context), data as CreateContactInput));
      await appendAudit(repositories, context, { action: "CONTACT_CREATED", targetType: "CONTACT", targetId: contact.id });
      await appendDomainEvent(repositories, context, { aggregateType: "CONTACT", aggregateId: contact.id, eventType: "contact.created", idempotencyKey: `contact:${contact.id}:created`, payload: { tenantId: contact.tenantId, contactId: contact.id } });
      return contact;
    });
  }


  async importCsvRows(contextInput: ServiceContext, input: ContactImportRequest): Promise<ContactImportResult> {
    const context = ensureContext(contextInput);
    const tenantInput = ensureTenantInput(context, { tenantId: input.tenantId });
    const errors: ContactImportRowError[] = [];
    const validRows: ValidContactImportRow[] = [];
    const seenEmails = new Set<string>();

    for (const [index, rawRow] of input.rows.entries()) {
      const rowNumber = index + 2;
      const normalized = normalizeImportRow(rawRow);
      const parsed = contactImportRowSchema.safeParse(normalized);
      if (!parsed.success) {
        errors.push(validationErrorForRow(rowNumber, normalized, parsed.error));
        continue;
      }
      if (seenEmails.has(parsed.data.email)) {
        errors.push({ row: rowNumber, field: "email", reason: "Duplicate email in uploaded CSV" });
        continue;
      }
      seenEmails.add(parsed.data.email);
      validRows.push(parsed.data);
    }

    const existing = await this.deps.contacts.findByEmails(contextToTenantScope(context), validRows.map((row) => row.email));
    const existingEmails = new Set(existing.flatMap((contact) => contact.email === undefined || contact.email === null ? [] : [contact.email.toLowerCase()]));
    const insertRows: ValidContactImportRow[] = [];
    for (const row of validRows) {
      if (existingEmails.has(row.email)) {
        errors.push({ row: input.rows.findIndex((candidate) => normalizeOptionalText(candidate.email)?.toLowerCase() === row.email) + 2, field: "email", reason: "Email already exists in workspace" });
        continue;
      }
      insertRows.push(row);
    }

    const plan = await this.deps.contactPlans?.findCurrentPlan(tenantInput);
    if (plan?.plan === "STARTER") {
      const currentCount = await this.deps.contacts.count(contextToTenantScope(context));
      if (currentCount + insertRows.length > starterContactLimit) {
        throw new ServiceError({
          code: "SERVICE_PLAN_LIMIT_EXCEEDED",
          message: "Starter plan contact limit exceeded",
          status: 402,
          details: { limit: starterContactLimit, currentCount, requestedImportCount: insertRows.length },
          correlation: context.correlation,
        });
      }
    }

    const imported = await runWrite(this.deps, context, async (repositories) => {
      let inserted = 0;
      for (const batch of chunk(insertRows.map((row) => toCreateContactInput(context.tenantId, row)), contactImportBatchSize)) {
        inserted += await repositories.contacts.createMany(contextToTenantScope(context), batch);
      }
      if (inserted > 0) {
        await appendAudit(repositories, context, { action: "CONTACTS_IMPORTED", targetType: "CONTACT_IMPORT", metadata: { imported: inserted, skipped: input.rows.length - inserted } });
        await appendDomainEvent(repositories, context, { aggregateType: "CONTACT_IMPORT", aggregateId: context.correlation.correlationId, eventType: "contacts.imported", idempotencyKey: `contacts-import:${context.tenantId}:${context.correlation.correlationId}`, payload: { tenantId: context.tenantId, imported: inserted } });
      }
      return inserted;
    });

    return { imported, skipped: input.rows.length - imported, errors: errors.sort((left, right) => left.row - right.row) };
  }

  async update(contextInput: ServiceContext, contactId: string, input: UpdateContactInput): Promise<ContactRecord> {
    const context = ensureContext(contextInput);
    const data = exactInput(parseContract(updateContactInputSchema, input, context.correlation));
    if (!nonEmptyPartial(data)) {
      throw new ServiceError({ code: "SERVICE_VALIDATION_FAILED", message: "Contact update must include at least one field", status: 400, correlation: context.correlation });
    }
    return runWrite(this.deps, context, async (repositories) => {
      const contact = contactRecordSchema.parse(await repositories.contacts.update(contextToTenantScope(context), idSchema.parse(contactId), data as UpdateContactInput));
      await appendAudit(repositories, context, { action: "CONTACT_UPDATED", targetType: "CONTACT", targetId: contact.id });
      await appendDomainEvent(repositories, context, { aggregateType: "CONTACT", aggregateId: contact.id, eventType: "contact.updated", idempotencyKey: `contact:${contact.id}:updated:${contact.updatedAt}`, payload: { tenantId: contact.tenantId, contactId: contact.id } });
      return contact;
    });
  }

  async get(contextInput: ServiceContext, contactId: string): Promise<ContactRecord> {
    const context = ensureContext(contextInput);
    return contactRecordSchema.parse(ensureFound(await this.deps.contacts.findById(contextToTenantScope(context), idSchema.parse(contactId)), context, "CONTACT", contactId));
  }

  async list(contextInput: ServiceContext, page?: PageRequest): Promise<Page<ContactRecord>> {
    const context = ensureContext(contextInput);
    return this.deps.contacts.list(contextToTenantScope(context), page);
  }
}

const scoreWeights: Readonly<Record<string, number>> = {
  "lead.created": 20,
  "contact.created": 10,
  "email.opened": 5,
  "email.clicked": 15,
  "form.submitted": 25,
  "meeting.booked": 35,
  "reply.received": 30,
  "unsubscribe": -40,
  "spam.complaint": -60,
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const eventWeight = (event: Pick<LeadEventRecord, "eventType">): number => scoreWeights[event.eventType] ?? 1;
const eventTotal = (events: readonly LeadEventRecord[]): number => events.reduce((total, event) => total + eventWeight(event), 0);

export const computeLeadScore = (contact: ContactRecord, events: readonly LeadEventRecord[]): ScoreRecomputationResult["leadScoreBreakdown"] => {
  const identityScore = clamp((contact.email === undefined || contact.email === null ? 0 : 10) + (contact.phone === undefined || contact.phone === null ? 0 : 5) + (contact.externalId === undefined || contact.externalId === null ? 0 : 5), 0, 20);
  const engagementScore = clamp(eventTotal(events), 0, 80);
  return { eventScore: clamp(identityScore + engagementScore, 0, 100), identityScore, engagementScore, eventCount: events.length };
};

export const computeTrajectoryScore = (events: readonly LeadEventRecord[], asOf: Date): ScoreRecomputationResult["trajectoryScoreBreakdown"] => {
  const recentStart = asOf.getTime() - 7 * 24 * 60 * 60 * 1000;
  const previousStart = asOf.getTime() - 14 * 24 * 60 * 60 * 1000;
  const recent = events.filter((event) => Date.parse(event.occurredAt) >= recentStart && Date.parse(event.occurredAt) <= asOf.getTime());
  const previous = events.filter((event) => Date.parse(event.occurredAt) >= previousStart && Date.parse(event.occurredAt) < recentStart);
  const recentScore = Math.max(0, eventTotal(recent));
  const previousScore = Math.max(0, eventTotal(previous));
  return { score: clamp(recentScore - previousScore, -100, 100), recentScore, previousScore, recentEventCount: recent.length, previousEventCount: previous.length };
};

export const deriveTrustBand = (leadScore: number, trajectoryScore: number): TrustBand => {
  const combined = clamp(leadScore + Math.trunc(trajectoryScore / 4), 0, 100);
  return trustBandSchema.parse(combined >= 70 ? "HIGH" : combined >= 40 ? "MEDIUM" : "LOW");
};

export class ScoringService {
  constructor(private readonly deps: ServiceDependencies, private readonly clock: { readonly now: () => Date } = { now: () => new Date() }) {}

  async recomputeContactScore(contextInput: ServiceContext, input: ScoreRecomputationJobPayload): Promise<ScoreRecomputationResult> {
    const context = ensureContext(contextInput);
    const data = ensureTenantInput(context, exactInput(parseContract(scoreRecomputationJobPayloadSchema, input, context.correlation)));
    const contact = contactRecordSchema.parse(ensureFound(await this.deps.contacts.findById(contextToTenantScope(context), data.contactId), context, "CONTACT", data.contactId));
    const events = (await this.deps.contacts.listLeadEvents(contextToTenantScope(context), contact.id, { limit: 100 })).items;
    const recomputedAt = this.clock.now();
    const leadBreakdown = computeLeadScore(contact, events);
    const trajectoryBreakdown = computeTrajectoryScore(events, recomputedAt);
    const result = scoreRecomputationResultSchema.parse({
      tenantId: context.tenantId,
      contactId: contact.id,
      leadScore: leadBreakdown.eventScore,
      trajectoryScore: trajectoryBreakdown.score,
      trustBand: deriveTrustBand(leadBreakdown.eventScore, trajectoryBreakdown.score),
      leadScoreBreakdown: leadBreakdown,
      trajectoryScoreBreakdown: trajectoryBreakdown,
      recomputedAt: recomputedAt.toISOString(),
      correlation: context.correlation,
    });
    await appendAudit(this.deps, context, { action: "CONTACT_SCORE_RECOMPUTED", targetType: "CONTACT", targetId: contact.id, metadata: { leadScore: result.leadScore, trajectoryScore: result.trajectoryScore, trustBand: result.trustBand, reason: data.reason } });
    return result;
  }

  buildRecomputationIdempotencyKey(input: Pick<ScoreRecomputationJobPayload, "tenantId" | "contactId">): string {
    return buildScoreRecomputationIdempotencyKey(input);
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


const boardPageInputSchema = z.object({ limit: z.number().int().min(1).max(100).optional(), cursors: z.record(idSchema, idSchema.optional()).optional() }).strict();
const createDealInputSchema = z.object({ tenantId: idSchema, pipelineStageId: idSchema, contactId: idSchema.nullable().optional(), ownerId: idSchema.nullable().optional(), externalId: idSchema.nullable().optional(), title: idSchema, value: z.union([z.number(), z.string()]).nullable().optional(), currency: z.string().min(3).max(3).optional(), probability: z.number().int().min(0).max(100).nullable().optional(), closedAt: isoDateSchema.nullable().optional(), metadata: metadataSchema.nullable().optional() }).strict();
const moveDealStageInputSchema = z.object({ stageId: idSchema, expectedUpdatedAt: isoDateSchema }).strict();

const dealToCard = (deal: DealRecord): DealCardRecord => dealCardRecordSchema.parse({
  id: deal.id,
  title: deal.title,
  contactName: undefined,
  dealValue: deal.value,
  currency: deal.currency,
  owner: undefined,
  probability: deal.probability,
  stageId: deal.pipelineStageId,
  updatedAt: deal.updatedAt,
});


const activityTypeSchema = z.enum(["CALL", "EMAIL", "MEETING", "TASK", "NOTE"]);
const createActivityInputSchema = z.object({
  tenantId: idSchema,
  contactId: idSchema.optional(),
  dealId: idSchema.optional(),
  type: activityTypeSchema,
  note: z.string().min(1).max(10000),
  metadata: metadataSchema.nullable().optional(),
}).strict().refine((activity) => activity.contactId !== undefined || activity.dealId !== undefined, {
  message: "Activity create requires contactId or dealId",
  path: ["contactId"],
});
const activityFiltersSchema = z.object({
  contactId: idSchema.optional(),
  dealId: idSchema.optional(),
  type: activityTypeSchema.optional(),
  createdById: idSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
}).strict();

export type CreateActivityServiceInput = z.output<typeof createActivityInputSchema>;
export type ActivityFilters = z.output<typeof activityFiltersSchema>;

export class ActivityService {
  constructor(private readonly deps: ServiceDependencies) {}

  async create(contextInput: ServiceContext, input: CreateActivityServiceInput): Promise<ActivityRecord> {
    const context = ensureContext(contextInput);
    const actorId = context.actorId;
    if (actorId === undefined) {
      throw new ServiceError({ code: "SERVICE_VALIDATION_FAILED", message: "Authenticated actor is required to create an activity", status: 400, correlation: context.correlation });
    }
    const data = ensureTenantInput(context, exactInput(parseContract(createActivityInputSchema, input, context.correlation)));
    return runWrite(this.deps, context, async (repositories) => {
      const activityInput: CreateActivityInput = { ...data, createdById: actorId };
      return activityRecordSchema.parse(await repositories.activities.create(context, activityInput));
    });
  }

  async list(contextInput: ServiceContext, filtersInput: ActivityFilters = {}, page?: PageRequest): Promise<Page<ActivityRecord>> {
    const context = ensureContext(contextInput);
    const filters = exactInput(parseContract(activityFiltersSchema, filtersInput, context.correlation)) as ActivityListFilters;
    return this.deps.activities.list(contextToTenantScope(context), filters, page);
  }
}

export class DealService {
  constructor(private readonly deps: ServiceDependencies) {}

  async board(contextInput: ServiceContext, pipelineId: string, paginationInput?: { readonly limit?: number; readonly cursors?: Readonly<Record<string, string | undefined>> }): Promise<PipelineBoardRecord> {
    const context = ensureContext(contextInput);
    const pagination = withoutUndefined(exactInput(parseContract(boardPageInputSchema, paginationInput ?? {}, context.correlation))) as BoardPaginationRequest;
    const board = await this.deps.deals.findBoardByPipeline(context.tenantId, idSchema.parse(pipelineId), pagination);
    return ensureFound(board, context, "PIPELINE", pipelineId);
  }

  async create(contextInput: ServiceContext, input: CreateDealInput): Promise<DealRecord> {
    const context = ensureContext(contextInput);
    const data = ensureTenantInput(context, exactInput(parseContract(createDealInputSchema, input, context.correlation)));
    return runWrite(this.deps, context, async (repositories) => {
      const deal = dealRecordSchema.parse(await repositories.deals.create(context.tenantId, data as CreateDealInput));
      await appendAudit(repositories, context, { action: "DEAL_CREATED", targetType: "DEAL", targetId: deal.id, metadata: { pipelineId: deal.pipelineId, stageId: deal.pipelineStageId } });
      await appendDomainEvent(repositories, context, { aggregateType: "DEAL", aggregateId: deal.id, eventType: "deal.created", idempotencyKey: `deal:${deal.id}:created`, payload: { tenantId: deal.tenantId, dealId: deal.id, pipelineId: deal.pipelineId, stageId: deal.pipelineStageId } });
      return deal;
    });
  }

  async createCard(contextInput: ServiceContext, input: CreateDealInput): Promise<DealCardRecord> {
    const deal = await this.create(contextInput, input);
    return dealToCard(deal);
  }

  async moveStage(contextInput: ServiceContext, dealId: string, input: { readonly stageId: string; readonly expectedUpdatedAt: string }): Promise<DealRecord> {
    const context = ensureContext(contextInput);
    const data = exactInput(parseContract(moveDealStageInputSchema, input, context.correlation));
    return runWrite(this.deps, context, async (repositories) => {
      const result = await repositories.deals.updateStageWithOptimisticLock(context.tenantId, idSchema.parse(dealId), data.stageId, data.expectedUpdatedAt);
      const occurredAt = new Date().toISOString();
      await appendDomainEvent(repositories, context, {
        aggregateType: "DEAL",
        aggregateId: result.deal.id,
        eventType: "deal.stage_changed",
        idempotencyKey: `deal:${result.deal.id}:stage_changed:${result.deal.updatedAt}`,
        payload: { workspaceId: context.tenantId, tenantId: context.tenantId, dealId: result.deal.id, previousStageId: result.previousStageId, newStageId: result.deal.pipelineStageId, changedBy: context.actorId, occurredAt },
      });
      if (context.actorId !== undefined) {
        const activityInput: CreateActivityInput = { tenantId: context.tenantId, dealId: result.deal.id, contactId: result.deal.contactId, createdById: context.actorId, type: "NOTE", note: "Deal stage changed", occurredAt, metadata: { previousStageId: result.previousStageId, newStageId: result.deal.pipelineStageId } };
        await repositories.activities.create(contextToTenantScope(context), activityInput);
      }
      await appendAudit(repositories, context, { action: "DEAL_STAGE_CHANGED", targetType: "DEAL", targetId: result.deal.id, metadata: { previousStageId: result.previousStageId, newStageId: result.deal.pipelineStageId } });
      return result.deal;
    });
  }

  async detail(contextInput: ServiceContext, dealId: string): Promise<DealDetailRecord> {
    const context = ensureContext(contextInput);
    const detail = await this.deps.deals.findDetailById(context.tenantId, idSchema.parse(dealId));
    return ensureFound(detail, context, "DEAL", dealId);
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
  readonly contacts: ContactService;
  readonly deals: DealService;
  readonly activities: ActivityService;
  readonly scoring: ScoringService;
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
  contacts: new ContactService(dependencies),
  deals: new DealService(dependencies),
  activities: new ActivityService(dependencies),
  scoring: new ScoringService(dependencies),
  campaigns: new CampaignService(dependencies),
  workflows: new WorkflowService(dependencies),
  approvals: new ApprovalService(dependencies),
  executions: new ExecutionService(dependencies),
  events: new EventService(dependencies),
  billing: new BillingService(dependencies),
  audit: new AuditService(dependencies),
});

export { NotificationService } from "./notifications/notification-service.js";
export type {
  NotificationRecipient,
  SendMonthlyPipelineDigestInput,
  SendTeamInviteInput,
  SendTrialEmailInput,
  SendWeeklyIdleContactDigestInput,
  SendWorkspaceEmailInput,
  WorkspaceNotificationContext,
} from "./notifications/notification-service.js";
export {
  monthlyPipelineDigestEmail,
  teamInviteEmail,
  trialExpiryEmail,
  weeklyIdleContactDigestEmail,
  welcomeEmail,
} from "./notifications/email-templates.js";
export type {
  IdleContactDigestInput,
  PipelineDigestInput,
  TeamInviteEmailInput,
  TrialEmailInput,
  WorkspaceEmailInput,
} from "./notifications/email-templates.js";

export {
  runWeeklyFollowUpDigest,
  type FollowUpDigestIdleContact,
  type FollowUpDigestNotificationPort,
  type FollowUpDigestRecipient,
  type FollowUpDigestRepositoryPort,
  type FollowUpDigestWorkspace,
  type WeeklyFollowUpDigestResult,
} from "./notifications/follow-up-digest.js";
