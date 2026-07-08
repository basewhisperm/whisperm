import { z } from "zod";

import { MarketplaceCaptureService } from "./marketplace-acquisition/capture-service.js";
import { SellerAcquisitionRecordService } from "./seller-acquisition-records.js";
import { SellerAcquisitionCampaignService } from "./seller-acquisition-campaigns.js";
import { recordUsageEventBestEffort, type AcquisitionUsageMeteringService } from "./acquisition-usage-metering.js";
export { SellerAcquisitionAnalyticsService } from "./acquisition-analytics.js";
export { AcquisitionUsageMeteringService, recordUsageEventBestEffort } from "./acquisition-usage-metering.js";
export type { AcquisitionUsageMeteringDependencies, RecordAcquisitionUsageEventInput, GetUsageSummaryInput, AcquisitionUsageEventRecord, AcquisitionUsageEventSummary, AcquisitionUsageEventTotal, AcquisitionUsageEventType } from "./acquisition-usage-metering.js";
export { BusinessGrowthOpportunityService } from "./business-growth-opportunity.js";
export type { BusinessGrowthOpportunityServiceDependencies } from "./business-growth-opportunity.js";
export { SellerAcquisitionRecordService } from "./seller-acquisition-records.js";
export { SellerRelationshipMemoryService, buildSellerRelationshipMemory, canonicalSellerKeyForRecord } from "./seller-relationship-memory.js";
export { SellerAcquisitionCampaignService } from "./seller-acquisition-campaigns.js";
export { CampaignRuntimeService, nextInvitationRetryAt } from "./campaign-runtime.js";
export { DiscoveryOptimizationWorker } from "./marketplace-acquisition/discovery-optimization-worker.js";
export { GrowthLoopWorker, growthRecommendationTypeValues } from "./marketplace-acquisition/growth-loop-worker.js";
export type { CampaignRuntimeServiceDependencies, StartCampaignExecutionInput, ExecuteInvitationInput, CampaignRuntimeInvitationQueue, CampaignRuntimeInvitationExecutor, CampaignRuntimeQualificationQueue, CampaignRuntimeOptimizationQueue, CampaignRuntimeGrowthLoopQueue, RecordInvitationResultInput, RecordQualificationResultInput } from "./campaign-runtime.js";
export type { GrowthLoopStatus, GrowthLoopTrigger, GrowthRecommendation, GrowthRecommendationType, GrowthRecommendationSeverity, GrowthRecommendationConfidence, GrowthRecommendationLifecycleStatus, GrowthSignalSnapshot, GrowthProviderPerformance, GrowthLoopAnalysisResult } from "./marketplace-acquisition/growth-loop-worker.js";
export type { SellerAcquisitionHealthStatus, SellerAcquisitionMissingRequirement, SellerAcquisitionNextAction, SellerAcquisitionRecord, SellerAcquisitionRecordDependencies } from "./seller-acquisition-records.js";
export type { SellerRelationshipMemory, SellerRelationshipMemoryServiceDependencies, SellerRelationshipTimelineEvent } from "./seller-relationship-memory.js";
export type { SellerAcquisitionAnalyticsDependencies, SellerAcquisitionAnalyticsRepository } from "./acquisition-analytics.js";
export { MarketplaceClaimLifecycleService, ClaimLifecycleServiceError } from "./claim-lifecycle.js";
export { CrmConversionRuntimeService, CrmConversionRuntimeError, crmConversionJobType, crmConversionQueueName } from "./crm-conversion-runtime.js";
export type { CrmConversionContext, CrmConversionJob, CrmConversionResult, CrmConversionRuntimeDependencies, CrmConversionStatus, CrmConversionFailureCode } from "./crm-conversion-runtime.js";
export { RevenueAttributionRuntimeService, RevenueAttributionRuntimeError, revenueAttributionJobType, revenueAttributionQueueName } from "./revenue-attribution.js";
export type {
  AttributionCompleteness,
  RevenueAttributionContext,
  RevenueAttributionFailureCode,
  RevenueAttributionJob,
  RevenueAttributionResult,
  RevenueAttributionRuntimeDependencies,
  RevenueAttributionScheduler,
  RevenueAttributionSnapshot,
  RevenueAttributionStatus,
  RevenueAttributionTriggerPort,
} from "./revenue-attribution.js";
export { SellerClaimPortalService, SellerClaimPortalError } from "./seller-claim-portal.js";
export { RenderSellerConversionService, RenderSellerConversionError } from "./render-seller-conversion.js";
export type { RenderSellerConversionContext, RenderSellerConversionDependencies, RenderSellerConversionResult } from "./render-seller-conversion.js";
export { RenderInventoryConversionService, RenderInventoryConversionError } from "./render-inventory-conversion.js";
export { MarketplaceCaptureCompletionService, MarketplaceCaptureCompletionError } from "./marketplace-capture-completion.js";
export type { RenderInventoryConnector as RenderInventoryConversionConnector, RenderInventoryConversionContext, RenderInventoryConversionDependencies, RenderInventoryConversionResult } from "./render-inventory-conversion.js";
export type { ClaimPreview, ClaimTokenRecord, ClaimTokenRepository, SellerClaimPortalDependencies } from "./seller-claim-portal.js";
export type { ClaimIntelligenceResult, ClaimLifecycleDependencies, ClaimLifecycleScheduleJob, ClaimReminderType, MarketplaceClaimTokenRecord } from "./claim-lifecycle.js";

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
  type MarketplaceCaptureRepository,
  type DraftInventoryRepository,
  type RenderConversionRepository,
  type SellerInvitationRepository,
  type SellerInvitationRecord,
  sellerInvitationRecordSchema,
  type MarketplaceClaimTokenRepository,
  type MarketplaceClaimTokenRecord,
  type MarketplaceOwnershipAttestationRepository,
  type ActivityListFilters,
  type ActivityRecord,
  activityRecordSchema,
  type MarketplaceCaptureRecord,
  marketplaceCaptureRecordSchema,
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
  type UpdateDealInput,
  type PipelineRepository,
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
  sellerInvitationChannelSchema,
  sellerInvitationCreateRequestSchema,
  sellerInvitationResponseSchema,
  type SellerInvitationChannel,
  type SellerInvitationResponse,
  MARKETPLACE_ACQUISITION_PIPELINE_KEY,
} from "@whisperm/types";
import { generateRawClaimToken, hashClaimToken } from "./claim-token-hash.js";
import type { RevenueAttributionResult, RevenueAttributionTriggerPort } from "./revenue-attribution.js";
export { generateRawClaimToken, hashClaimToken } from "./claim-token-hash.js";
export { MarketplaceDiscoveryService, DiscoveryPromotionError } from './marketplace-acquisition/discovery-service.js';
export type { DiscoveryServiceContext, DiscoveryServiceDependencies, DiscoveryRunResult, ManualSeedEntry, StartDiscoveryRunInput, DiscoveryCampaignRepository, PromoteDiscoveredSellerResult, DiscoveryPromotionErrorCode, CanonicalMarketplaceCapturePort, CanonicalMarketplaceCaptureContext, CanonicalMarketplaceCaptureInput, CanonicalMarketplaceCaptureResult, CanonicalMarketplaceCaptureQualificationStatus, CanonicalMarketplaceCaptureCrmConversionStatus } from './marketplace-acquisition/discovery-service.js';
export { SellerQualificationService, DEFAULT_QUALIFICATION_POLICY } from './marketplace-acquisition/qualification-service.js';
export { MarketplaceQualificationExecutionService } from './marketplace-acquisition/qualification-execution-service.js';
export type { QualificationPolicy, QualificationResult, SellerDataForQualification } from './marketplace-acquisition/qualification-service.js';
export type { DiscoveryOptimizationRecommendation, DiscoveryOptimizationResult } from './marketplace-acquisition/discovery-optimization-worker.js';
export { SellerDedupeService, computeSellerIdentityKey } from './marketplace-acquisition/dedupe-service.js';

export { MARKETPLACE_ACQUISITION_PIPELINE_KEY } from "@whisperm/types";

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
  "SERVICE_PROVIDER_UNAVAILABLE",
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

type MarketplaceAcquisitionStageName = "Captured" | "Invited" | "Claim Started" | "Claimed" | "Converted" | "Expired";

interface MarketplaceAcquisitionStageTransitionResult {
  readonly captureId: string;
  readonly dealId: string;
  readonly currentStage: MarketplaceAcquisitionStageName;
  readonly previousStage: MarketplaceAcquisitionStageName;
  readonly status: MarketplaceCaptureRecord["status"];
  readonly updatedAt: string;
}

const marketplaceStageTransitionInputSchema = z.object({
  dealId: z.string().min(1),
  stageName: z.enum(["Captured", "Invited", "Claim Started", "Claimed", "Converted", "Expired"]),
});

const allowedMarketplaceStageTransitions: Record<MarketplaceAcquisitionStageName, readonly MarketplaceAcquisitionStageName[]> = {
  Captured: ["Invited", "Expired"],
  Invited: ["Claim Started", "Expired"],
  "Claim Started": ["Claimed", "Expired"],
  Claimed: ["Converted"],
  Converted: [],
  Expired: [],
};

const marketplaceStageStatusByName: Record<MarketplaceAcquisitionStageName, MarketplaceCaptureRecord["status"]> = {
  Captured: "CAPTURED",
  Invited: "INVITED",
  "Claim Started": "CLAIM_STARTED",
  Claimed: "CLAIMED",
  Converted: "CONVERTED",
  Expired: "EXPIRED",
};

function isMarketplaceAcquisitionStageName(value: string): value is MarketplaceAcquisitionStageName {
  return value === "Captured" || value === "Invited" || value === "Claim Started" || value === "Claimed" || value === "Converted" || value === "Expired";
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
  readonly pipelines: PipelineRepository;
  readonly activities: ActivityRepository;
  readonly marketplaceCaptures: MarketplaceCaptureRepository;
  readonly marketplaceClaimTokens?: MarketplaceClaimTokenRepository;
  readonly ownershipAttestations?: MarketplaceOwnershipAttestationRepository;
  readonly draftInventories: DraftInventoryRepository;
  readonly sellerInvitations?: SellerInvitationRepository | undefined;
  readonly renderConversions?: RenderConversionRepository | undefined;
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
  readonly revenueAttribution?: RevenueAttributionTriggerPort | undefined;
  /** ST-005: best-effort billable-usage recording for the canonical capture-time CRM conversion; never blocks capture on failure. */
  readonly usageMetering?: Pick<AcquisitionUsageMeteringService, "recordUsageEvent"> | undefined;
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
    throw new ServiceError({ code, message: error.message, status: error.status, details: error.details, correlation, cause: error });
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

const normalizeSellerPhoneForMatching = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) return undefined;

  const digits = trimmed.replace(/\D/gu, "");
  if (digits.length < 9 || digits.length > 15) return undefined;

  if (digits.startsWith("233") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return `+233${digits.slice(1)}`;
  if (digits.length === 9) return `+233${digits}`;
  if (trimmed.startsWith("+")) return `+${digits}`;

  return undefined;
};


const normalizeSellerEmailForMatching = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim().toLowerCase();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
};

const extractSellerPhoneFromMetadata = (metadata: Readonly<Record<string, unknown>> | null | undefined): string | undefined => {
  if (metadata === undefined || metadata === null) return undefined;

  const candidates = [
    metadata.sellerPhone,
    metadata.phone,
    metadata.primaryPhoneNumber,
    metadata.phoneNumber,
    metadata.phoneNumbers,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const normalized = normalizeSellerPhoneForMatching(candidate);
      if (normalized !== undefined) return normalized;
    }

    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        if (typeof item === "string") {
          const normalized = normalizeSellerPhoneForMatching(item);
          if (normalized !== undefined) return normalized;
        }
      }
    }
  }

  return undefined;
};

const sellerPhoneForInput = (input: MarketplaceCaptureServiceInput): string | undefined =>
  normalizeSellerPhoneForMatching(input.sellerPhone ?? input.phone) ?? extractSellerPhoneFromMetadata(input.metadata);

const sellerEmailForInput = (input: MarketplaceCaptureServiceInput): string | undefined =>
  normalizeSellerEmailForMatching(input.sellerEmail ?? input.email);

const sellerNameFingerprintForInput = (input: MarketplaceCaptureServiceInput): string | undefined => {
  const cleaned = cleanSellerIdentity(input.sellerName).cleaned;
  if (cleaned === undefined) return undefined;

  const normalized = cleaned
    .trim()
    .toLowerCase()
    .replace(/\b\d+?\s*(years?|months?)\s+on\s+jiji\b/giu, " ")
    .replace(/\bsaved\b/giu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  if (normalized.length < 3 || normalized === "saved") return undefined;

  const source = (input.marketplaceSource ?? input.sourceMarketplace ?? sourceHost(listingUrlForCapture(input))).trim().toLowerCase();
  return `${source}:${normalized}`;
};

const normalizeMarketplaceImageUrls = (value: unknown): readonly string[] | undefined => {
  if (!Array.isArray(value)) return undefined;

  const urls = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const unique = [...new Set(urls)];
  return unique.length === 0 ? undefined : unique;
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
const recordDealOutcomeInputSchema = z.object({
  value: z.union([z.number(), z.string()]).nullable().optional(),
  currency: z.string().min(3).max(3).optional(),
  closedAt: isoDateSchema.nullable().optional(),
  expectedUpdatedAt: isoDateSchema,
}).strict().refine((input) => input.value !== undefined || input.closedAt !== undefined, {
  message: "Deal outcome update requires a revenue value or a closedAt date",
  path: ["value"],
});

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
const marketplaceCaptureInputSchema = z.object({
  tenantId: idSchema,
  listingUrl: z.string().url().optional(),
  sourceUrl: z.string().url().optional(),
  title: z.string().min(1),
  description: z.string().min(1).nullable().optional(),
  price: z.union([z.number(), z.string()]).nullable().optional(),
  priceText: z.string().min(1).max(120).nullable().optional(),
  currency: z.string().min(1).nullable().optional(),
  sellerName: z.string().min(1).nullable().optional(),
  sellerEmail: z.string().email().nullable().optional(),
  email: z.string().email().nullable().optional(),
  sellerPhone: z.string().min(1).max(64).nullable().optional(),
  phone: z.string().min(1).max(64).nullable().optional(),
  sellerLocation: z.string().min(1).max(255).nullable().optional(),
  location: z.string().min(1).max(255).nullable().optional(),
  marketplaceIdentifier: z.string().min(1).max(255).nullable().optional(),
  sellerProfileUrl: z.string().url().nullable().optional(),
  marketplaceSourceId: idSchema.nullable().optional(),
  marketplaceSource: z.string().min(1).max(255).nullable().optional(),
  marketplaceListingId: z.string().min(1).max(255).nullable().optional(),
  category: z.string().min(1).max(255).nullable().optional(),
  images: z.array(z.string().url()).max(10).nullable().optional(),
  imageUrls: z.array(z.string().url()).max(10).nullable().optional(),
  capturedAt: z.string().datetime().nullable().optional(),
  capturedBy: z.string().min(1).max(255).nullable().optional(),
  pageUrl: z.string().url().nullable().optional(),
  sourceMarketplace: z.string().min(1).max(255).nullable().optional(),
  userAgent: z.string().min(1).max(1024).nullable().optional(),
  contactId: idSchema.nullable().optional(),
  externalId: z.string().min(1).nullable().optional(),
  metadata: metadataSchema.nullable().optional(),
  portfolioListings: z.array(z.object({
    listingUrl: z.string().url().optional(),
    marketplaceListingId: z.string().min(1).max(255).nullable().optional(),
    title: z.string().min(1).max(500),
    description: z.string().min(1).nullable().optional(),
    price: z.union([z.number(), z.string()]).nullable().optional(),
    priceText: z.string().min(1).max(120).nullable().optional(),
    currency: z.string().min(1).nullable().optional(),
    category: z.string().min(1).max(255).nullable().optional(),
    images: z.array(z.string().url()).max(10).nullable().optional(),
    imageUrls: z.array(z.string().url()).max(10).nullable().optional(),
    location: z.string().min(1).max(255).nullable().optional(),
    metadata: metadataSchema.nullable().optional()
  }).strict()).max(25).nullable().optional()
}).strict().refine((value) => value.listingUrl !== undefined || value.sourceUrl !== undefined, { message: "Marketplace capture requires listingUrl or sourceUrl", path: ["listingUrl"] });

export type MarketplaceCaptureServiceInput = z.output<typeof marketplaceCaptureInputSchema>;
export type MarketplaceCaptureQualificationStatus = "QUALIFIED" | "UNQUALIFIED";
export type MarketplaceCaptureQualificationReason = "PHONE_REQUIRED";
export type MarketplaceCaptureCrmConversionStatus = "CREATED" | "EXISTING" | "NOT_ELIGIBLE";
export interface MarketplaceCaptureServiceResult {
  readonly captureId: string;
  readonly contactId?: string | undefined;
  readonly dealId?: string | undefined;
  readonly draftInventoryId: string;
  readonly contactMatchStrategy: "provided" | "phone" | "profile" | "capture_identity" | "email" | "created" | "unqualified";
  readonly sellerIdentityStrategy?: "provided" | "phone" | "profile" | "capture_identity" | "email" | "created" | "unqualified" | undefined;
  readonly dealCreated: boolean;
  readonly dealMatched: boolean;
  readonly status: string;
  readonly qualificationStatus: MarketplaceCaptureQualificationStatus;
  readonly qualificationReason?: MarketplaceCaptureQualificationReason | undefined;
  /** ST-005: canonical CRM conversion signal -- capture-time Contact/Deal creation is the single conversion mechanism for V1. */
  readonly crmConversionStatus: MarketplaceCaptureCrmConversionStatus;
  readonly contactCreated: boolean;
  readonly portfolioCaptureCount?: number | undefined;
  readonly createdCaptureIds?: readonly string[] | undefined;
  readonly matchedCaptureIds?: readonly string[] | undefined;
  readonly draftInventoryIds?: readonly string[] | undefined;
  readonly sellerNameCleaned?: string | undefined;
  readonly sellerPortfolioValue?: string | undefined;
  readonly sellerListingCount?: number | undefined;
}

const marketplacePipelineDefaultKey = MARKETPLACE_ACQUISITION_PIPELINE_KEY;
const marketplaceCapturedStageName = "Captured";
const marketplaceInvitedStageName = "Invited";

const sourceHost = (listingUrl: string): string => {
  try { return new URL(listingUrl).host; } catch { return "marketplace"; }
};

const marketplaceDealExternalId = (listingUrl: string): string => `marketplace-listing:${listingUrl.trim().toLowerCase()}`;

const normalizeSellerDealIdentity = (value: string): string => value.trim().toLowerCase();
const marketplaceSellerDealExternalId = (input: MarketplaceCaptureServiceInput, contactId: string): string => {
  const sellerPhone = sellerPhoneForInput(input);
  const sellerEmail = sellerEmailForInput(input);
  const sellerIdentity =
    sellerPhone ??
    input.sellerProfileUrl ??
    input.marketplaceIdentifier ??
    sellerEmail ??
    contactId ??
    listingUrlForCapture(input);

  return `marketplace-seller:${normalizeSellerDealIdentity(sellerIdentity)}`;
};

const cleanSellerIdentity = (raw: string | null | undefined): { readonly cleaned?: string | undefined; readonly metadata: Readonly<Record<string, unknown>> } => {
  const rawText = raw?.trim();
  if (rawText === undefined || rawText.length === 0) return { metadata: {} };
  const badges: string[] = [];
  const tenure = /\bNew on Jiji\b/iu.exec(rawText)?.[0];
  const verifiedSeller = /\bVerified ID\b/iu.test(rawText);
  const lastSeen = /\bLast seen\s+(.+?)(?=\s+Typically replies|\s+Verified ID|\s+New on Jiji|$)/iu.exec(rawText)?.[1]?.trim();
  const responseTime = /\bTypically replies\s+(.+?)(?=\s+Last seen|\s+Verified ID|\s+New on Jiji|$)/iu.exec(rawText)?.[1]?.trim();
  if (verifiedSeller) badges.push("Verified ID");
  if (tenure !== undefined) badges.push(tenure);
  let cleaned = rawText
    .replace(/\bVerified ID\b/giu, " ")
    .replace(/\bNew on Jiji\b/giu, " ")
    .replace(/\bLast seen\s+.+?(?=\s+Typically replies|\s+Verified ID|\s+New on Jiji|$)/giu, " ")
    .replace(/\bTypically replies\s+.+?(?=\s+Last seen|\s+Verified ID|\s+New on Jiji|$)/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (cleaned.length === 0) cleaned = rawText;
  return {
    cleaned,
    metadata: exactInput({
      rawSellerText: rawText,
      marketplaceTenure: tenure,
      verifiedSeller: verifiedSeller ? true : undefined,
      lastSeen,
      responseTime,
      sellerBadges: badges.length === 0 ? undefined : badges,
    }),
  };
};

const contactMarketplaceMetadata = (input: MarketplaceCaptureServiceInput, sellerCleanup: ReturnType<typeof cleanSellerIdentity>): Readonly<Record<string, unknown>> => exactInput({
  type: "SELLER",
  source: "MARKETPLACE",
  lifecycle: "ACQUISITION_PROSPECT",
  marketingEligibility: "SELLER_ACQUISITION_ONLY",
  sellerProfileUrl: input.sellerProfileUrl ?? undefined,
  marketplaceIdentifier: input.marketplaceIdentifier ?? undefined,
  marketplaceSellerId: typeof input.metadata?.marketplaceSellerId === "string" ? input.metadata.marketplaceSellerId : undefined,
  sourceMarketplace: input.marketplaceSource ?? input.sourceMarketplace ?? undefined,
  sellerLocation: input.sellerLocation ?? input.location ?? undefined,
  ...sellerCleanup.metadata,
});

const sellerReadiness = (input: MarketplaceCaptureServiceInput, cleanedName: string | undefined, listingCount: number): "READY" | "REVIEW" | "BLOCKED" => {
  if (sellerPhoneForInput(input) === undefined) return "BLOCKED";
  if (cleanedName !== undefined && cleanedName.trim().length > 1 && listingCount > 0) return "READY";
  return "REVIEW";
};

interface MarketplaceCaptureQualificationDecision {
  readonly status: MarketplaceCaptureQualificationStatus;
  readonly reason?: MarketplaceCaptureQualificationReason | undefined;
}

const determineQualification = (input: MarketplaceCaptureServiceInput): MarketplaceCaptureQualificationDecision =>
  sellerPhoneForInput(input) === undefined
    ? { status: "UNQUALIFIED", reason: "PHONE_REQUIRED" }
    : { status: "QUALIFIED" };

const sellerQualityScore = (input: MarketplaceCaptureServiceInput, listingCount: number, verifiedSeller: boolean): number => Math.min(100,
  (sellerPhoneForInput(input) === undefined ? 0 : 35) +
  (sellerPhoneForInput(input) === undefined ? 0 : 10) +
  (verifiedSeller ? 10 : 0) +
  (listingCount > 1 ? 15 : 0) +
  (input.sellerProfileUrl === undefined || input.sellerProfileUrl === null ? 0 : 10) +
  ((input.sellerLocation ?? input.location) === undefined || (input.sellerLocation ?? input.location) === null ? 0 : 5) +
  (marketplacePriceForDecimal(input) === undefined ? 0 : 5) +
  (marketplaceImagesForDraft(input)?.length ? 5 : 0)
);

const mergedCaptureMetadata = (input: MarketplaceCaptureServiceInput): Readonly<Record<string, unknown>> => exactInput({
  ...(input.metadata ?? {}),
  sellerEmail: sellerEmailForInput(input),
  sellerPhone: sellerPhoneForInput(input),
  sellerLocation: input.sellerLocation ?? input.location ?? undefined,
  marketplaceSource: input.marketplaceSource ?? input.sourceMarketplace ?? undefined,
  marketplaceListingId: input.marketplaceListingId ?? input.externalId ?? undefined,
  imageUrls: marketplaceImagesForDraft(input),
  category: input.category ?? input.metadata?.category,
  capturedAt: input.capturedAt ?? undefined,
  capturedBy: input.capturedBy ?? undefined,
  pageUrl: input.pageUrl ?? input.sourceUrl ?? input.listingUrl ?? undefined,
  userAgent: input.userAgent ?? undefined,
  ...cleanSellerIdentity(input.sellerName).metadata,
  acquisitionReadiness: sellerReadiness(input, cleanSellerIdentity(input.sellerName).cleaned, 1),
  whatsappCandidate: sellerPhoneForInput(input) !== undefined,
  mobileRequiredForQualification: true,
});

const sellerDisplayName = (input: MarketplaceCaptureServiceInput): string => cleanSellerIdentity(input.sellerName).cleaned ?? input.title.trim();

const marketplacePriceForDecimal = (input: MarketplaceCaptureServiceInput): string | undefined => {
  const raw = input.price ?? input.priceText;

  if (typeof raw === "number") {
    return Number.isFinite(raw) ? String(raw) : undefined;
  }

  if (typeof raw !== "string") {
    return undefined;
  }

  const normalized = raw.replace(/[^\d.]/gu, "");

  if (normalized.length === 0) {
    return undefined;
  }

  const firstDot = normalized.indexOf(".");

  const decimal =
    firstDot === -1
      ? normalized
      : `${normalized.slice(0, firstDot + 1)}${normalized
          .slice(firstDot + 1)
          .replace(/\./gu, "")}`;

  return /^\d+(\.\d+)?$/u.test(decimal) ? decimal : undefined;
};
const listingUrlForCapture = (input: MarketplaceCaptureServiceInput): string => input.listingUrl ?? input.sourceUrl ?? "";
const externalIdForCapture = (input: MarketplaceCaptureServiceInput): string | undefined => input.externalId ?? input.marketplaceListingId ?? undefined;
const marketplaceSourceForDraft = (input: MarketplaceCaptureServiceInput): string | undefined => input.marketplaceSource ?? input.sourceMarketplace ?? input.marketplaceSourceId ?? sourceHost(listingUrlForCapture(input));

const marketplaceImagesForDraft = (input: MarketplaceCaptureServiceInput): readonly string[] | undefined =>
  normalizeMarketplaceImageUrls(input.images) ??
  normalizeMarketplaceImageUrls(input.imageUrls) ??
  normalizeMarketplaceImageUrls(input.metadata?.imageUrls) ??
  normalizeMarketplaceImageUrls(input.metadata?.images);

const marketplaceCategoryForDraft = (input: MarketplaceCaptureServiceInput): string | undefined => {
  if (input.category !== undefined && input.category !== null) return input.category;
  const category = input.metadata?.category;
  return typeof category === "string" && category.trim().length > 0 ? category : undefined;
};


const sellerInviteInputSchema = z.object({ tenantId: idSchema, captureId: idSchema, preferredChannel: sellerInvitationChannelSchema.optional() }).strict();
export type SellerInviteServiceInput = z.output<typeof sellerInviteInputSchema>;
export interface SellerInvitationProviderPorts {
  readonly whatsapp?: { send(message: { readonly to: string; readonly body: string }): Promise<void> } | undefined;
  readonly sms?: { send(message: { readonly to: string; readonly body: string }): Promise<void> } | undefined;
  readonly email?: { send(message: { readonly to: string; readonly subject: string; readonly html: string }): Promise<void> } | undefined;
  readonly whatsappEnabled?: boolean | undefined;
  readonly fallbackToSmsWhenWhatsappMissing?: boolean | undefined;
  readonly inviteBaseUrl?: string | undefined;
  readonly now?: (() => Date) | undefined;
}

const contactFromCapture = (capture: MarketplaceCaptureRecord, contact?: ContactRecord | null): { readonly phone?: string; readonly email?: string } => {
  const metadata = capture.metadata ?? {};
  const metadataPhone = typeof metadata.sellerPhone === "string" && metadata.sellerPhone.trim().length > 0 ? normalizeSellerPhoneForMatching(metadata.sellerPhone) : undefined;
  const contactPhone = normalizeSellerPhoneForMatching(contact?.phone ?? undefined);
  const metadataEmail = typeof metadata.sellerEmail === "string" && metadata.sellerEmail.trim().length > 0 ? metadata.sellerEmail.trim() : undefined;
  const contactEmail = typeof contact?.email === "string" && contact.email.trim().length > 0 ? contact.email.trim() : undefined;
  const phone = metadataPhone ?? contactPhone;
  const email = metadataEmail ?? contactEmail;
  return { ...(phone === undefined ? {} : { phone }), ...(email === undefined ? {} : { email }) };
};

const resolveInviteChannel = (contact: { readonly phone?: string; readonly email?: string }, preferred: SellerInvitationChannel | undefined, whatsappEnabled: boolean): SellerInvitationChannel => {
  if (preferred !== undefined) {
    if (preferred === "EMAIL" && contact.email !== undefined) return "EMAIL";
    if ((preferred === "SMS" || preferred === "WHATSAPP") && contact.phone !== undefined) return preferred;
    throw new ServiceError({ code: "SERVICE_VALIDATION_FAILED", message: preferred === "EMAIL" ? "Seller email is required for EMAIL invitations." : "Seller phone is required for cellphone invitations.", status: 400 });
  }
  if (contact.phone !== undefined) return whatsappEnabled ? "WHATSAPP" : "SMS";
  if (contact.email !== undefined) return "EMAIL";
  throw new ServiceError({ code: "SERVICE_VALIDATION_FAILED", message: "Seller has no reachable invitation channel.", status: 400 });
};

const recipientFor = (channel: SellerInvitationChannel, contact: { readonly phone?: string; readonly email?: string }): string => channel === "EMAIL" ? contact.email ?? "" : contact.phone ?? "";

const hasDeliveryProvider = (channel: SellerInvitationChannel, notifications: SellerInvitationProviderPorts | undefined): boolean => {
  if (channel === "WHATSAPP") return notifications?.whatsapp !== undefined;
  if (channel === "SMS") return notifications?.sms !== undefined;
  return notifications?.email !== undefined;
};


const redactProviderFailure = (message: string): string =>
  message
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/giu, "Bearer [REDACTED]")
    .replace(/access[_-]?token["'=:\s]+[^\s"',}]+/giu, "accessToken=[REDACTED]")
    .replace(/api[_-]?key["'=:\s]+[^\s"',}]+/giu, "apiKey=[REDACTED]")
    .slice(0, 300);

const canDeliverInvitation = (channel: SellerInvitationChannel, contact: { readonly phone?: string; readonly email?: string }, notifications: SellerInvitationProviderPorts | undefined): boolean =>
  hasDeliveryProvider(channel, notifications) ||
  (channel === "WHATSAPP" && contact.phone !== undefined && notifications?.fallbackToSmsWhenWhatsappMissing !== false && notifications?.sms !== undefined);

const assertInvitationProviderConfigured = (channel: SellerInvitationChannel, contact: { readonly phone?: string; readonly email?: string }, notifications: SellerInvitationProviderPorts | undefined, correlation: PersistenceCorrelationMetadata): void => {
  if (canDeliverInvitation(channel, contact, notifications)) return;
  throw new ServiceError({
    code: "SERVICE_PROVIDER_UNAVAILABLE",
    message: "Seller invitation delivery provider is not configured for the selected channel.",
    status: 503,
    retryable: true,
    correlation,
    details: { channel },
  });
};

export class SellerInvitationService {
  constructor(private readonly deps: ServiceDependencies & {
    readonly notifications?: SellerInvitationProviderPorts | undefined;
    readonly claimLifecycleScheduler?: {
      scheduleClaimLifecycle(context: ServiceContext, invitationId: string): Promise<readonly unknown[]> | readonly unknown[];
    } | undefined;
  }) {}

  async createSellerInvitation(contextInput: ServiceContext, input: SellerInviteServiceInput): Promise<SellerInvitationResponse> {
    const context = ensureContext(contextInput);
    const data = ensureTenantInput(context, exactInput(parseContract(sellerInviteInputSchema, input, context.correlation)));
    if (this.deps.sellerInvitations === undefined) throw new ServiceError({ code: "SERVICE_REPOSITORY_FAILED", message: "Seller invitation repository is not configured", status: 500, correlation: context.correlation });
    if (this.deps.marketplaceClaimTokens === undefined) throw new ServiceError({ code: "SERVICE_REPOSITORY_FAILED", message: "Marketplace claim token repository is not configured", status: 500, correlation: context.correlation });

    const scope = contextToTenantScope(context);
    const capture = await this.deps.marketplaceCaptures.findById(scope, data.captureId);
    if (capture === null) throw new ServiceError({ code: "SERVICE_NOT_FOUND", message: "Marketplace capture not found", status: 404, correlation: context.correlation });
    const linkedContact = capture.contactId === undefined || capture.contactId === null ? null : await this.deps.contacts.findById(scope, capture.contactId);
    const contact = contactFromCapture(capture, linkedContact);
    if (capture.contactId === undefined || capture.contactId === null || contact.phone === undefined) {
      throw new ServiceError({
        code: "SERVICE_INVALID_STATE_TRANSITION",
        message: "Seller phone is required before creating a Seller Acquisition invitation.",
        status: 422,
        correlation: context.correlation,
        details: { missingRequirements: ["PHONE_REQUIRED"] },
      });
    }
    const notifications = this.deps.notifications;
    const initialChannel = resolveInviteChannel(contact, data.preferredChannel, notifications?.whatsappEnabled !== false);
    const now = notifications?.now?.() ?? new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const base = notifications?.inviteBaseUrl ?? "https://app.whisperm.ai/claim";

    return runWrite(this.deps, context, async (repositories) => {
      if (repositories.marketplaceClaimTokens === undefined || repositories.sellerInvitations === undefined) {
        throw new ServiceError({ code: "SERVICE_REPOSITORY_FAILED", message: "Seller invitation repositories are not configured", status: 500, correlation: context.correlation });
      }

      const rawToken = generateRawClaimToken();
      const claimToken = await repositories.marketplaceClaimTokens.create(scope, {
        tenantId: context.tenantId,
        marketplaceCaptureId: capture.id,
        tokenHash: hashClaimToken(rawToken),
        expiresAt,
        status: "PENDING",
        metadata: { initialChannel }
      });
      const inviteUrl = `${base.replace(/\/$/, "")}/${rawToken}`;

      const invitation = await repositories.sellerInvitations.create(scope, {
        tenantId: context.tenantId,
        marketplaceCaptureId: capture.id,
        channel: initialChannel,
        status: "PENDING",
        recipient: recipientFor(initialChannel, contact),
        inviteUrl,
        expiresAt,
        metadata: { preferredChannel: data.preferredChannel ?? null, claimTokenId: claimToken.id }
      });

      await appendAudit(repositories, context, {
        action: "INVITATION_CREATED",
        targetType: "SELLER_INVITATION",
        targetId: invitation.id,
        metadata: { captureId: capture.id, channel: initialChannel, claimTokenId: claimToken.id }
      });

      const sent = await this.sendOrFallback(context, scope, repositories, invitation, contact, notifications);
      if (sent.status === "SENT") {
        const tokenSentAt = typeof sent.metadata?.sentAt === "string" ? sent.metadata.sentAt : new Date().toISOString();
        await repositories.marketplaceClaimTokens.update(scope, claimToken.id, { status: "SENT", sentAt: tokenSentAt, metadata: { ...(claimToken.metadata ?? {}), invitationId: sent.id, successfulChannel: sent.channel } });
        await this.moveToInvited(context, repositories, capture);
        await this.deps.claimLifecycleScheduler?.scheduleClaimLifecycle(context, claimToken.id);
      }

      return sellerInvitationResponseSchema.parse({
        captureId: capture.id,
        invitationId: sent.id,
        channel: sent.channel,
        status: sent.status,
        inviteUrl: sent.inviteUrl,
        expiresAt: sent.expiresAt
      });
    });
  }

  private async sendOrFallback(context: ServiceContext, scope: TenantScoped, repositories: ServiceRepositories, invitation: SellerInvitationRecord, contact: { readonly phone?: string; readonly email?: string }, notifications: SellerInvitationProviderPorts | undefined): Promise<SellerInvitationRecord> {
    let lastProviderFailureChannel: SellerInvitationChannel | undefined;
    let lastProviderFailureMessage: string | undefined;

    const trySend = async (channel: SellerInvitationChannel, record: SellerInvitationRecord): Promise<SellerInvitationRecord | null> => {
      const body = record.inviteUrl;
      try {
        if (channel === "WHATSAPP") { if (notifications?.whatsapp === undefined) return null; await notifications.whatsapp.send({ to: record.recipient, body }); }
        if (channel === "SMS") { if (notifications?.sms === undefined) return null; await notifications.sms.send({ to: record.recipient, body }); }
        if (channel === "EMAIL") { if (notifications?.email === undefined) return null; await notifications.email.send({ to: record.recipient, subject: "Seller Acquisition invitation", html: `<p>${body}</p>` }); }
      } catch (error) {
        const failureMessage = error instanceof Error ? error.message : "Invitation provider failed";
        lastProviderFailureChannel = channel;
        lastProviderFailureMessage = failureMessage;

        await this.deps.sellerInvitations!.update(scope, record.id, {
          status: "PENDING",
          metadata: {
            ...(record.metadata ?? {}),
            providerOutcome: "PROVIDER_FAILED",
            providerFailureChannel: channel,
            providerFailureMessage: redactProviderFailure(failureMessage),
          },
        });

        await appendAudit(repositories, context, {
          action: "INVITATION_PROVIDER_FAILED",
          targetType: "SELLER_INVITATION",
          targetId: record.id,
          metadata: {
            captureId: record.marketplaceCaptureId,
            channel,
            failureMessage: redactProviderFailure(failureMessage),
          },
        });

        return null;
      }
      const sentAt = new Date().toISOString();
      const sent = await this.deps.sellerInvitations!.update(scope, record.id, { status: "SENT", metadata: { ...(record.metadata ?? {}), sentAt, providerOutcome: "DELIVERED" } });
      const sentCapture = await repositories.marketplaceCaptures.findById(scope, sent.marketplaceCaptureId);
      if (repositories.activities !== undefined && context.actorId !== undefined && sentCapture?.dealId != null) {
        await repositories.activities.create({ ...scope, actorId: context.actorId, correlation: context.correlation }, {
          tenantId: context.tenantId,
          contactId: sentCapture.contactId ?? null,
          dealId: sentCapture.dealId,
          createdById: context.actorId,
          type: "NOTE",
          note: `Seller Acquisition invitation sent via ${channel}`,
          occurredAt: sentAt,
          metadata: { eventType: "INVITATION_SENT", marketplaceCaptureId: sent.marketplaceCaptureId, invitationId: sent.id, channel },
        });
      }
      await appendAudit(repositories, context, { action: "INVITATION_SENT", targetType: "SELLER_INVITATION", targetId: sent.id, metadata: { captureId: sent.marketplaceCaptureId, channel } });
      return sent;
    };
    const sent = await trySend(invitation.channel, invitation);
    if (sent !== null) return sent;
    if (invitation.channel === "WHATSAPP" && contact.phone !== undefined && notifications?.fallbackToSmsWhenWhatsappMissing !== false && notifications?.sms !== undefined) {
      await appendAudit(repositories, context, { action: "INVITATION_FALLBACK_USED", targetType: "SELLER_INVITATION", targetId: invitation.id, metadata: { from: "WHATSAPP", to: "SMS" } });
      const smsRecord = await this.deps.sellerInvitations!.create(scope, { tenantId: context.tenantId, marketplaceCaptureId: invitation.marketplaceCaptureId, channel: "SMS", status: "PENDING", recipient: contact.phone, inviteUrl: invitation.inviteUrl, expiresAt: invitation.expiresAt, metadata: { fallbackFrom: "WHATSAPP" } });
      const smsSent = await trySend("SMS", smsRecord);
      if (smsSent !== null) return smsSent;
    }
    const manualPending = await this.deps.sellerInvitations!.update(scope, invitation.id, {
      status: "PENDING",
      metadata: {
        ...(invitation.metadata ?? {}),
        providerOutcome: "MANUAL_DELIVERY_REQUIRED",
        failureReason: "INVITATION_PROVIDER_UNAVAILABLE",
        providerFailureChannel: lastProviderFailureChannel,
        providerFailureMessage: lastProviderFailureMessage?.slice(0, 500),
      },
    });

    await appendAudit(repositories, context, {
      action: "INVITATION_MANUAL_DELIVERY_REQUIRED",
      targetType: "SELLER_INVITATION",
      targetId: manualPending.id,
      metadata: {
        captureId: manualPending.marketplaceCaptureId,
        channel: manualPending.channel,
        reason: "PROVIDER_UNAVAILABLE",
      },
    });

    return manualPending;
  }

  private async moveToInvited(context: ServiceContext, repositories: ServiceRepositories, capture: MarketplaceCaptureRecord): Promise<void> {
    await repositories.marketplaceCaptures.update(contextToTenantScope(context), capture.id, { status: "INVITED" });
    if (capture.dealId === undefined || capture.dealId === null) return;
    const pipeline = await repositories.pipelines.findByDefaultKey(context.tenantId, marketplacePipelineDefaultKey);
    const invitedStage = pipeline?.stages.find((stage) => stage.name === marketplaceInvitedStageName);
    if (invitedStage !== undefined) await repositories.deals.updateStage(context.tenantId, capture.dealId, invitedStage.id);
  }
}

export class MarketplaceAcquisitionCaptureService {
  constructor(private readonly deps: ServiceDependencies) {}

  async capture(contextInput: ServiceContext, input: MarketplaceCaptureServiceInput): Promise<MarketplaceCaptureServiceResult> {
    const context = ensureContext(contextInput);
    const data = ensureTenantInput(context, exactInput(parseContract(marketplaceCaptureInputSchema, input, context.correlation)));
    const tenantScope = contextToTenantScope(context);
    const pipeline = await this.deps.pipelines.findByDefaultKey(context.tenantId, marketplacePipelineDefaultKey);
    if (pipeline === null) {
      throw new ServiceError({ code: "SERVICE_NOT_FOUND", message: "Marketplace Acquisition pipeline is missing; run the pipeline seed before capturing marketplace listings", status: 404, correlation: context.correlation });
    }
    const capturedStage = pipeline.stages.find((stage) => stage.name === marketplaceCapturedStageName);
    if (capturedStage === undefined) {
      throw new ServiceError({ code: "SERVICE_NOT_FOUND", message: "Marketplace Acquisition Captured stage is missing; run the pipeline seed before capturing marketplace listings", status: 404, correlation: context.correlation });
    }

    const qualification = determineQualification(data);

    return runWrite(this.deps, context, async (repositories) => {
      if (qualification.status === "UNQUALIFIED") {
        return this.captureUnqualifiedListing(repositories, context, tenantScope, data, qualification.reason);
      }

      const contactResult = await this.resolveContact(repositories, context, data);
      const listingInputs = this.listingInputs(data);
      const firstInput = listingInputs[0] ?? data;
      const firstCapture = await this.createOrMatchCapture(repositories, context, tenantScope, firstInput, contactResult.contact.id);
      const dealResult = await this.resolveDeal(repositories, context, data, firstCapture.capture, contactResult.contact.id, capturedStage.id, listingInputs.length);
      const finalCapture = firstCapture.capture.dealId === dealResult.deal.id
        ? firstCapture.capture
        : await repositories.marketplaceCaptures.update(tenantScope, firstCapture.capture.id, { dealId: dealResult.deal.id });
      const createdCaptureIds = firstCapture.created ? [finalCapture.id] : [];
      const matchedCaptureIds = firstCapture.created ? [] : [finalCapture.id];
      const draftInventoryIds: string[] = [];

      for (const [index, listingInput] of listingInputs.entries()) {
        const listingCapture =
          index === 0
            ? finalCapture
            : (await this.createOrMatchCapture(repositories, context, tenantScope, listingInput, contactResult.contact.id)).capture;

        if (index > 0) {
          if (listingCapture.dealId !== dealResult.deal.id) {
            await repositories.marketplaceCaptures.update(tenantScope, listingCapture.id, { dealId: dealResult.deal.id });
          }
          if (!createdCaptureIds.includes(listingCapture.id) && !matchedCaptureIds.includes(listingCapture.id)) {
            matchedCaptureIds.push(listingCapture.id);
          }
        }

        const draftInventory = await repositories.draftInventories.upsertForCapture(tenantScope, {
          tenantId: context.tenantId,
          marketplaceCaptureId: listingCapture.id,
          contactId: contactResult.contact.id,
          dealId: dealResult.deal.id,
          title: listingInput.title,
          description: listingInput.description,
          price: marketplacePriceForDecimal(listingInput),
          currency: listingInput.currency,
          category: marketplaceCategoryForDraft(listingInput),
          images: marketplaceImagesForDraft(listingInput),
          listingUrl: listingUrlForCapture(listingInput),
          marketplaceSource: marketplaceSourceForDraft(listingInput),
          marketplaceListingId: externalIdForCapture(listingInput),
          status: "DRAFT",
        });
        draftInventoryIds.push(draftInventory.id);
      }
      const draftInventoryId = draftInventoryIds[0] ?? "";
      const sellerNameCleaned = cleanSellerIdentity(data.sellerName).cleaned;
      const sellerPortfolioValue = listingInputs.reduce((sum, item) => sum + Number(marketplacePriceForDecimal(item) ?? 0), 0);
      if (context.actorId !== undefined && dealResult.created) {
        await repositories.activities.create({ ...tenantScope, actorId: context.actorId, correlation: context.correlation }, {
          tenantId: context.tenantId,
          contactId: contactResult.contact.id,
          dealId: dealResult.deal.id,
          createdById: context.actorId,
          type: "NOTE",
          note: `Captured marketplace listing from ${sourceHost(finalCapture.listingUrl)}: ${data.title}`,
          metadata: { eventType: "MARKETPLACE_CAPTURED", marketplaceCaptureId: finalCapture.id, sourceUrl: finalCapture.listingUrl, sellerListingCount: listingInputs.length }
        });
      }
      await appendAudit(repositories, context, { action: "MARKETPLACE_CAPTURED", targetType: "MARKETPLACE_CAPTURE", targetId: finalCapture.id, metadata: { contactId: contactResult.contact.id, dealId: dealResult.deal.id } });
      // ST1-009: this branch is only reached when determineQualification found the capture
      // QUALIFIED, and finalCapture.id is stable across retries/re-capture/requalification of the
      // same seller (createOrMatchCapture matches by listing URL/external id), so keying on it
      // records SELLER_QUALIFIED exactly once no matter how many times capture() runs afterward --
      // covers manual capture, URL capture, discovery promotion, and requalification alike.
      if (this.deps.usageMetering !== undefined) {
        await recordUsageEventBestEffort(this.deps.usageMetering, tenantScope, {
          eventType: "SELLER_QUALIFIED",
          captureId: finalCapture.id,
          contactId: contactResult.contact.id,
          dealId: dealResult.deal.id,
          idempotencyKey: `usage:SELLER_QUALIFIED:${context.tenantId}:${finalCapture.id}`,
        });
      }
      // ST-005: capture-time Contact/Deal creation is the single canonical CRM conversion mechanism for V1 --
      // it is CREATED the first time a qualified seller gets a Contact/Deal pair, EXISTING on every idempotent
      // re-capture of the same seller/listing afterward.
      const crmConversionStatus: MarketplaceCaptureCrmConversionStatus = contactResult.strategy === "created" || dealResult.created ? "CREATED" : "EXISTING";
      if (crmConversionStatus === "CREATED" && this.deps.usageMetering !== undefined) {
        await recordUsageEventBestEffort(this.deps.usageMetering, tenantScope, {
          eventType: "CRM_CONVERSION_CREATED",
          captureId: finalCapture.id,
          contactId: contactResult.contact.id,
          dealId: dealResult.deal.id,
          idempotencyKey: `usage:CRM_CONVERSION_CREATED:${context.tenantId}:${finalCapture.id}:${contactResult.contact.id}:${dealResult.deal.id}`,
        });
      }
      return {
        captureId: finalCapture.id,
        contactId: contactResult.contact.id,
        dealId: dealResult.deal.id,
        contactMatchStrategy: contactResult.strategy,
        dealCreated: dealResult.created,
        dealMatched: !dealResult.created,
        draftInventoryId,
        status: finalCapture.status,
        qualificationStatus: "QUALIFIED",
        crmConversionStatus,
        contactCreated: contactResult.strategy === "created",
        sellerIdentityStrategy: contactResult.strategy,
        portfolioCaptureCount: listingInputs.length,
        createdCaptureIds,
        matchedCaptureIds,
        draftInventoryIds,
        sellerNameCleaned,
        sellerPortfolioValue: sellerPortfolioValue > 0 ? String(sellerPortfolioValue) : undefined,
        sellerListingCount: listingInputs.length,
      };
    });
  }

  private listingInputs(input: MarketplaceCaptureServiceInput): readonly MarketplaceCaptureServiceInput[] {
    const baseUrl = listingUrlForCapture(input);
    const listings = [{}, ...(input.portfolioListings ?? [])].map((listing) => {
      const item = listing as Readonly<Record<string, unknown>>;
      return marketplaceCaptureInputSchema.parse({
        ...input,
        portfolioListings: undefined,
        listingUrl: typeof item.listingUrl === "string" ? item.listingUrl : baseUrl,
        sourceUrl: typeof item.listingUrl === "string" ? item.listingUrl : input.sourceUrl,
        title: typeof item.title === "string" ? item.title : input.title,
        description: item.description ?? input.description,
        price: item.price ?? input.price,
        priceText: item.priceText ?? input.priceText,
        currency: item.currency ?? input.currency,
        category: item.category ?? input.category,
        images: item.images ?? input.images,
        imageUrls: item.imageUrls ?? input.imageUrls,
        location: item.location ?? input.location,
        marketplaceListingId: item.marketplaceListingId ?? input.marketplaceListingId,
        externalId: item.marketplaceListingId ?? input.externalId,
        metadata: { ...(input.metadata ?? {}), ...((item.metadata as Readonly<Record<string, unknown>> | null | undefined) ?? {}) },
      });
    });
    const seen = new Set<string>();
    return listings.filter((listing) => {
      const key = `${listingUrlForCapture(listing)}:${externalIdForCapture(listing) ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return listingUrlForCapture(listing).length > 0;
    });
  }

  private async captureUnqualifiedListing(repositories: ServiceRepositories, context: ServiceContext, tenantScope: TenantScoped, data: MarketplaceCaptureServiceInput, reason: MarketplaceCaptureQualificationReason = "PHONE_REQUIRED"): Promise<MarketplaceCaptureServiceResult> {
    const listingInputs = this.listingInputs(data);
    const captures: MarketplaceCaptureRecord[] = [];
    const createdCaptureIds: string[] = [];
    const matchedCaptureIds: string[] = [];
    const draftInventoryIds: string[] = [];

    for (const listingInput of listingInputs) {
      const captured = await this.createOrMatchCapture(repositories, context, tenantScope, listingInput);
      if (captured.created) createdCaptureIds.push(captured.capture.id); else matchedCaptureIds.push(captured.capture.id);
      captures.push(captured.capture);
      const draftInventory = await repositories.draftInventories.upsertForCapture(tenantScope, {
        tenantId: context.tenantId,
        marketplaceCaptureId: captured.capture.id,
        title: captured.capture.title,
        description: captured.capture.description,
        price: marketplacePriceForDecimal(listingInput),
        currency: captured.capture.currency,
        category: marketplaceCategoryForDraft(listingInput),
        images: marketplaceImagesForDraft(listingInput),
        listingUrl: captured.capture.listingUrl,
        marketplaceSource: marketplaceSourceForDraft(listingInput),
        marketplaceListingId: captured.capture.externalId ?? undefined,
        status: "DRAFT",
      });
      draftInventoryIds.push(draftInventory.id);
    }

    const finalCapture = captures[0];
    if (finalCapture === undefined) {
      throw new ServiceError({ code: "SERVICE_VALIDATION_FAILED", message: "Marketplace capture requires a valid listing URL.", status: 400, correlation: context.correlation });
    }
    await appendAudit(repositories, context, { action: "MARKETPLACE_CAPTURE_BLOCKED_PHONE_REQUIRED", targetType: "MARKETPLACE_CAPTURE", targetId: finalCapture.id, metadata: { missingRequirements: ["PHONE_REQUIRED"] } });
    return {
      captureId: finalCapture.id,
      contactMatchStrategy: "unqualified",
      dealCreated: false,
      dealMatched: false,
      draftInventoryId: draftInventoryIds[0] ?? "",
      status: finalCapture.status,
      qualificationStatus: "UNQUALIFIED",
      qualificationReason: reason,
      crmConversionStatus: "NOT_ELIGIBLE",
      contactCreated: false,
      sellerIdentityStrategy: "unqualified",
      portfolioCaptureCount: listingInputs.length,
      createdCaptureIds,
      matchedCaptureIds,
      draftInventoryIds,
      sellerNameCleaned: cleanSellerIdentity(data.sellerName).cleaned,
      sellerPortfolioValue: listingInputs.reduce((sum, item) => sum + Number(marketplacePriceForDecimal(item) ?? 0), 0) > 0 ? String(listingInputs.reduce((sum, item) => sum + Number(marketplacePriceForDecimal(item) ?? 0), 0)) : undefined,
      sellerListingCount: listingInputs.length,
    };
  }

  private async createOrMatchCapture(repositories: ServiceRepositories, context: ServiceContext, tenantScope: TenantScoped, data: MarketplaceCaptureServiceInput, contactId?: string | undefined): Promise<{ readonly capture: MarketplaceCaptureRecord; readonly created: boolean }> {
    const listingUrl = listingUrlForCapture(data);
    const externalId = externalIdForCapture(data);
    const existingByListingUrl = await repositories.marketplaceCaptures.findByListingUrl(tenantScope, listingUrl);
    const existingByExternalId = existingByListingUrl === null && externalId !== undefined && externalId !== null ? await repositories.marketplaceCaptures.findByExternalId(tenantScope, externalId) : null;
    const existingCapture = existingByListingUrl ?? existingByExternalId;
    const capture = existingCapture ?? await repositories.marketplaceCaptures.create(tenantScope, {
      tenantId: context.tenantId,
      marketplaceSourceId: data.marketplaceSourceId,
      contactId,
      externalId,
      listingUrl,
      title: data.title,
      description: data.description,
      price: marketplacePriceForDecimal(data),
      currency: data.currency,
      sellerName: cleanSellerIdentity(data.sellerName).cleaned,
      sellerProfileUrl: data.sellerProfileUrl,
      status: "CAPTURED",
      metadata: { ...mergedCaptureMetadata(data), sellerListingCount: 1, sourceMarketplace: data.marketplaceSource ?? data.sourceMarketplace ?? undefined }
    });
    const linkedCapture =
      contactId === undefined || capture.contactId === contactId
        ? capture
        : await repositories.marketplaceCaptures.update(tenantScope, capture.id, {
            contactId,
            metadata: { ...(capture.metadata ?? {}), ...mergedCaptureMetadata(data) },
          });
    return { capture: linkedCapture, created: existingCapture === null };
  }



  async transitionStage(contextInput: ServiceContext, input: { readonly dealId: string; readonly stageName: MarketplaceAcquisitionStageName }): Promise<MarketplaceAcquisitionStageTransitionResult> {
    const context = ensureContext(contextInput);
    const data = exactInput(parseContract(marketplaceStageTransitionInputSchema, input, context.correlation));
    const tenantScope = contextToTenantScope(context);
    const pipeline = await this.deps.pipelines.findByDefaultKey(context.tenantId, marketplacePipelineDefaultKey);
    if (pipeline === null) {
      throw new ServiceError({ code: "SERVICE_NOT_FOUND", message: "Marketplace Acquisition pipeline is missing; run the pipeline seed before moving marketplace acquisition stages", status: 404, correlation: context.correlation });
    }
    const deal = await this.deps.deals.findById(context.tenantId, data.dealId);
    if (deal === null || deal.pipelineId !== pipeline.id) {
      throw new ServiceError({ code: "SERVICE_NOT_FOUND", message: "Marketplace acquisition deal not found", status: 404, correlation: context.correlation });
    }
    const currentStage = pipeline.stages.find((stage) => stage.id === deal.pipelineStageId);
    if (currentStage === undefined || !isMarketplaceAcquisitionStageName(currentStage.name)) {
      throw new ServiceError({ code: "SERVICE_CONFLICT", message: "Deal is not on a supported Marketplace Acquisition lifecycle stage", status: 409, correlation: context.correlation });
    }
    const nextStage = pipeline.stages.find((stage) => stage.name === data.stageName);
    if (nextStage === undefined) {
      throw new ServiceError({ code: "SERVICE_CONFLICT", message: `Marketplace Acquisition ${data.stageName} stage is missing`, status: 409, correlation: context.correlation });
    }
    if (!allowedMarketplaceStageTransitions[currentStage.name].includes(data.stageName)) {
      throw new ServiceError({ code: "SERVICE_INVALID_STATE_TRANSITION", message: `Marketplace Acquisition stage transition ${currentStage.name} → ${data.stageName} is not allowed`, status: 422, correlation: context.correlation });
    }

    return runWrite(this.deps, context, async (repositories) => {
      const capture = await repositories.marketplaceCaptures.findByDealId(tenantScope, deal.id);
      if (capture === null) {
        throw new ServiceError({ code: "SERVICE_NOT_FOUND", message: "Marketplace capture not found for acquisition deal", status: 404, correlation: context.correlation });
      }
      const updatedDeal = await repositories.deals.updateStage(context.tenantId, deal.id, nextStage.id);
      const updatedCapture = await repositories.marketplaceCaptures.update(tenantScope, capture.id, { status: marketplaceStageStatusByName[data.stageName] });
      await appendAudit(repositories, context, { action: "MARKETPLACE_ACQUISITION_STAGE_CHANGED", targetType: "MARKETPLACE_CAPTURE", targetId: capture.id, metadata: { dealId: deal.id, previousStage: currentStage.name as MarketplaceAcquisitionStageName, currentStage: data.stageName } });
      return {
        captureId: updatedCapture.id,
        dealId: updatedDeal.id,
        currentStage: data.stageName,
        previousStage: currentStage.name as MarketplaceAcquisitionStageName,
        status: updatedCapture.status,
        updatedAt: updatedDeal.updatedAt,
      };
    });
  }

  private async resolveContact(repositories: ServiceRepositories, context: ServiceContext, input: MarketplaceCaptureServiceInput): Promise<{ readonly contact: ContactRecord; readonly strategy: MarketplaceCaptureServiceResult["contactMatchStrategy"] }> {
    const tenantScope = contextToTenantScope(context);
    if (input.contactId !== undefined && input.contactId !== null) {
      const existingById = await repositories.contacts.findById(tenantScope, input.contactId);
      if (existingById === null) {
        throw new ServiceError({ code: "SERVICE_NOT_FOUND", message: "Marketplace capture contact not found", status: 404, correlation: context.correlation });
      }
      return { contact: existingById, strategy: "provided" };
    }
    const sellerPhone = sellerPhoneForInput(input);
    if (sellerPhone !== undefined) {
      const existingByPhone = await repositories.contacts.findByPhone(tenantScope, sellerPhone);
      if (existingByPhone !== null) return { contact: existingByPhone, strategy: "phone" };
    }
    const profileIdentity = this.marketplaceIdentity(input);
    if (profileIdentity !== undefined) {
      const contacts = await repositories.contacts.list(tenantScope, { limit: 100 });
      const existingByProfile = contacts.items.find((contact) => {
        const metadata = contact.metadata ?? {};
        const acquisition = typeof metadata.marketplaceAcquisition === "object" && metadata.marketplaceAcquisition !== null ? metadata.marketplaceAcquisition as Readonly<Record<string, unknown>> : {};
        return [metadata.sellerProfileUrl, metadata.marketplaceIdentifier, metadata.marketplaceSellerId, acquisition.sellerProfileUrl, acquisition.marketplaceIdentifier, acquisition.marketplaceSellerId]
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim().toLowerCase())
          .includes(profileIdentity);
      });
      if (existingByProfile !== undefined) return { contact: existingByProfile, strategy: "profile" };

      const captures = await repositories.marketplaceCaptures.list(tenantScope, { limit: 100 });
      const existingCapture = captures.items.find((capture) => {
        const metadata = capture.metadata ?? {};
        return [capture.sellerProfileUrl, metadata.sellerProfileUrl, metadata.marketplaceIdentifier, metadata.marketplaceSellerId]
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim().toLowerCase())
          .includes(profileIdentity);
      });
      if (existingCapture?.contactId !== undefined && existingCapture.contactId !== null) {
        const contact = await repositories.contacts.findById(tenantScope, existingCapture.contactId);
        if (contact !== null) return { contact, strategy: "capture_identity" };
      }
    }
    const sellerEmail = sellerEmailForInput(input);
    if (sellerEmail !== undefined && sellerEmail !== null) {
      const [existing] = await repositories.contacts.findByEmails(tenantScope, [sellerEmail]);
      if (existing !== undefined) return { contact: existing, strategy: "email" };
    }
    const sellerNameFingerprint = sellerNameFingerprintForInput(input);
    if (sellerNameFingerprint !== undefined) {
      const contacts = await repositories.contacts.list(tenantScope, { limit: 100 });
      const existingBySellerName = contacts.items.find((contact) => {
        const metadata = contact.metadata ?? {};
        const acquisition = typeof metadata.marketplaceAcquisition === "object" && metadata.marketplaceAcquisition !== null
          ? metadata.marketplaceAcquisition as Readonly<Record<string, unknown>>
          : {};
        return acquisition.sellerNameFingerprint === sellerNameFingerprint;
      });
      if (existingBySellerName !== undefined) return { contact: existingBySellerName, strategy: "profile" };
    }

    const contact = contactRecordSchema.parse(await repositories.contacts.create(tenantScope, {
      tenantId: context.tenantId,
      email: sellerEmail ?? undefined,
      phone: sellerPhone,
      firstName: cleanSellerIdentity(input.sellerName).cleaned ?? undefined,
      metadata: { marketplaceAcquisition: { ...contactMarketplaceMetadata(input, cleanSellerIdentity(input.sellerName)), sellerNameFingerprint: sellerNameFingerprintForInput(input) } }
    }));
    return { contact, strategy: "created" };
  }

  private marketplaceIdentity(input: MarketplaceCaptureServiceInput): string | undefined {
    const metadata = input.metadata ?? {};
    const candidate = input.sellerProfileUrl ?? input.marketplaceIdentifier ??
      (typeof metadata.marketplaceSellerId === "string" ? metadata.marketplaceSellerId : undefined) ??
      (typeof metadata.sellerProfileUrl === "string" ? metadata.sellerProfileUrl : undefined);
    const trimmed = candidate?.trim().toLowerCase();
    return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
  }

  private async resolveDeal(repositories: ServiceRepositories, context: ServiceContext, input: MarketplaceCaptureServiceInput, capture: MarketplaceCaptureRecord, contactId: string, capturedStageId: string, listingCount = 1): Promise<{ readonly deal: DealRecord; readonly created: boolean }> {
    if (capture.dealId !== undefined && capture.dealId !== null) {
      const existingByCapture = await repositories.deals.findById(context.tenantId, capture.dealId);
      if (existingByCapture !== null) return { deal: existingByCapture, created: false };
    }
    const externalId = marketplaceSellerDealExternalId(input, contactId);
    const existing = await repositories.deals.findByExternalId(context.tenantId, externalId);
    if (existing !== null) return { deal: existing, created: false };
    const deal = dealRecordSchema.parse(await repositories.deals.create(context.tenantId, {
      tenantId: context.tenantId,
      contactId,
      ownerId: context.actorId,
      externalId,
      title: `Marketplace seller: ${sellerDisplayName(input)}`,
      pipelineStageId: capturedStageId,
      value: marketplacePriceForDecimal(input),
      currency: input.currency ?? "USD",
      metadata: {
        marketplaceCaptureId: capture.id,
        sourceUrl: listingUrlForCapture(input),
        marketplaceSourceId: input.marketplaceSourceId ?? null,
        marketplaceSource: input.marketplaceSource ?? input.sourceMarketplace ?? null,
        sellerListingCount: listingCount,
        sellerPortfolioValue: marketplacePriceForDecimal(input) ?? null,
        firstCapturedAt: capture.capturedAt,
        lastCapturedAt: new Date().toISOString(),
        sourceMarketplace: input.marketplaceSource ?? input.sourceMarketplace ?? null,
        sellerProfileUrl: input.sellerProfileUrl ?? null,
        sellerQualityScore: sellerQualityScore(input, listingCount, cleanSellerIdentity(input.sellerName).metadata.verifiedSeller === true),
        acquisitionReadiness: sellerReadiness(input, cleanSellerIdentity(input.sellerName).cleaned, listingCount),
        whatsappCandidate: sellerPhoneForInput(input) !== undefined,
        mobileRequiredForQualification: true,
      }
    }));
    return { deal, created: true };
  }
}

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

  /**
   * Deal ownership records won/closed outcomes and revenue amounts. This is the
   * only write path that flips a deal into revenue-attribution eligibility
   * (closedAt set and/or value present), so it is the canonical trigger for
   * revenue attribution: it triggers evaluation afterward and returns the
   * resulting attribution outcome so callers never need to compute it themselves.
   */
  async recordOutcome(contextInput: ServiceContext, dealId: string, input: { readonly value?: number | string | null | undefined; readonly currency?: string | undefined; readonly closedAt?: string | null | undefined; readonly expectedUpdatedAt: string }): Promise<{ readonly deal: DealRecord; readonly attribution?: RevenueAttributionResult | undefined }> {
    const context = ensureContext(contextInput);
    const data = exactInput(parseContract(recordDealOutcomeInputSchema, input, context.correlation));
    const deal = await runWrite(this.deps, context, async (repositories) => {
      const updated = dealRecordSchema.parse(await repositories.deals.update(context.tenantId, idSchema.parse(dealId), data as UpdateDealInput));
      await appendAudit(repositories, context, { action: "DEAL_OUTCOME_RECORDED", targetType: "DEAL", targetId: updated.id, metadata: { value: updated.value ?? null, currency: updated.currency, closedAt: updated.closedAt ?? null } });
      await appendDomainEvent(repositories, context, { aggregateType: "DEAL", aggregateId: updated.id, eventType: "deal.outcome_recorded", idempotencyKey: `deal:${updated.id}:outcome_recorded:${updated.updatedAt}`, payload: { tenantId: updated.tenantId, dealId: updated.id, value: updated.value ?? null, currency: updated.currency, closedAt: updated.closedAt ?? null } });
      return updated;
    });
    const attribution = this.deps.revenueAttribution === undefined
      ? undefined
      : await this.deps.revenueAttribution.evaluateForDeal({ tenantId: context.tenantId, actorId: context.actorId, correlation: context.correlation }, { tenantId: context.tenantId, dealId: deal.id });
    return { deal, attribution };
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
  readonly marketplaceAcquisition: MarketplaceAcquisitionCaptureService;
  readonly sellerAcquisitionRecords: SellerAcquisitionRecordService;
  readonly sellerInvitations: SellerInvitationService;
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
  marketplaceAcquisition: new MarketplaceAcquisitionCaptureService(dependencies),
  sellerAcquisitionRecords: new SellerAcquisitionRecordService(dependencies),
  sellerInvitations: new SellerInvitationService(dependencies),
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

export {
  MarketplaceCaptureService,
  MarketplaceCaptureServiceError,
} from "./marketplace-acquisition/capture-service.js";

export type {
  MarketplaceCaptureServiceContext,
  MarketplaceCaptureServiceDependencies,
  MarketplaceCaptureRepositoryPort,
} from "./marketplace-acquisition/capture-service.js";
export { RenderConversionRetryService, RenderConversionRetryError, nextRenderConversionRetryAt } from "./render-conversion-retry.js";
export type { RenderConversionRetryContext, RenderConversionRetryDependencies, RenderConversionRetryResult, RenderInventoryConnector } from "./render-conversion-retry.js";

export { SellerAcquisitionEditService } from "./seller-acquisition-edit.js";
export type { EditExtractInput, EditExtractResult, SellerAcquisitionEditDependencies } from "./seller-acquisition-edit.js";

export { MarketplaceRequalificationService, MarketplaceRequalificationError } from "./marketplace-requalification.js";
export type {
  MarketplaceRequalificationCrmConversionStatus,
  MarketplaceRequalificationDependencies,
  MarketplaceRequalificationQualificationStatus,
  RequalificationContext,
  RequalifyMarketplaceCaptureResult,
} from "./marketplace-requalification.js";

export { evaluateCaptureQuality } from "./seller-acquisition/capture-quality.js";
export { DiscoveryExecutionWorker, normalizeProviderResultForDiscovery } from './marketplace-acquisition/discovery-execution-worker.js';
export type { DiscoveryExecutionWorkerDependencies } from './marketplace-acquisition/discovery-execution-worker.js';

export { campaignTargetingConfigSchema, validateCampaignTargeting, mergeCampaignTargetingMetadata, formatCampaignTargetingSummary, getCampaignTargetingReadiness } from "./campaign-targeting.js";
export type { CampaignTargetingConfig, CampaignTargetingReadiness } from "./campaign-targeting.js";

export { AcquisitionCommandCenterService } from "./acquisition-command-center.js";
export type {
  AcquisitionActionSeverity,
  AcquisitionActionType,
  AcquisitionCommandCenterAction,
  AcquisitionCommandCenterDependencies,
  AcquisitionCommandCenterSnapshot,
  AcquisitionReadinessWarning,
  AcquisitionReadinessWarningCode,
  AcquisitionSourcePerformance,
  GetCommandCenterSnapshotInput,
} from "./acquisition-command-center.js";

export { AcquisitionRuntimeHealthService } from "./acquisition-runtime-health.js";
export type {
  AcquisitionRuntimeHealthDependencies,
  AcquisitionRuntimeHealthSnapshot,
  OperationsAction,
  OperationsActionType,
  ProviderHealth,
  RuntimeFailure,
  RuntimeFailureSeverity,
  RuntimeHealthStatus,
  RuntimeProvider,
  RuntimeUnit,
  RuntimeUnitHealth,
} from "./acquisition-runtime-health.js";

export { AcquisitionGovernanceService } from "./acquisition-governance.js";
export type {
  AcquisitionGovernanceAuditEvent,
  AcquisitionGovernanceAuthorizationInput,
  AcquisitionGovernanceCapability,
  AcquisitionGovernanceCapabilitySnapshot,
  AcquisitionGovernanceCapabilityStatus,
  AcquisitionGovernanceDecision,
  AcquisitionGovernanceDecisionStatus,
  AcquisitionGovernanceDenialReason,
  AcquisitionGovernanceDependencies,
  AcquisitionGovernanceLimit,
  AcquisitionGovernanceLimitPeriod,
  AcquisitionGovernanceLimitStatus,
  AcquisitionGovernanceOverallStatus,
  AcquisitionGovernanceSnapshot,
  AcquisitionGovernanceWarning,
  AcquisitionGovernanceWarningSeverity,
} from "./acquisition-governance.js";
