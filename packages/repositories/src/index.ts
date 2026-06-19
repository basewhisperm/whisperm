import { z } from "zod";

import { PrismaMarketplaceAcquisitionRepository, type MarketplaceAcquisitionRepository } from "./marketplace-acquisition.js";

import {
  PersistenceError,
  type PersistenceCorrelationMetadata,
  type ScheduledJob,
  type ScheduledJobRepository,
  scheduledJobSchema,
  assertTenantScope,
  contactStageSchema,
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
  findFirst(args: { readonly where: PrismaWhere; readonly orderBy?: PrismaOrderBy; readonly select?: PrismaData }): Promise<unknown | null>;
  findMany(args: { readonly where: PrismaWhere; readonly take?: number; readonly orderBy?: PrismaOrderBy; readonly select?: PrismaData }): Promise<readonly unknown[]>;
  createMany?(args: { readonly data: readonly PrismaData[] }): Promise<{ readonly count: number }>;
  count?(args: { readonly where: PrismaWhere }): Promise<number>;
  aggregate?(args: { readonly where: PrismaWhere; readonly _sum?: PrismaData; readonly _count?: PrismaData; readonly _avg?: PrismaData }): Promise<unknown>;
  groupBy?(args: PrismaData): Promise<readonly unknown[]>;
  deleteMany?(args: { readonly where: PrismaWhere }): Promise<{ readonly count: number }>;
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
  readonly pipeline: PrismaDelegate;
  readonly pipelineStage: PrismaDelegate;
  readonly deal: PrismaDelegate;
  readonly activity: PrismaDelegate;
  readonly marketplaceCapture: PrismaDelegate;
  readonly draftInventory: PrismaDelegate;
  readonly marketplaceSellerInvitation: PrismaDelegate;
  readonly marketplaceClaimToken: PrismaDelegate;
  readonly marketplaceOwnershipAttestation: PrismaDelegate;
  readonly marketplaceSellerVerification: PrismaDelegate;
  readonly renderConversion: PrismaDelegate;
  readonly subscription: PrismaDelegate;
  readonly scheduledJob: PrismaDelegate;
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

const colorSchema = z.string().regex(/^#[0-9A-F]{6}$/u);
const decimalLikeSchema = z.preprocess((value) => (typeof value === "object" && value !== null && "toString" in value) ? String(value) : value, z.union([z.number(), z.string()]));

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
  updatedAt: isoDateSchema,
  alertDigestEnabled: z.boolean().default(true)
}).strict();
export type Tenant = z.output<typeof tenantSchema>;
export type CreateTenantInput = Pick<Tenant, "slug" | "name"> & { readonly externalId?: string };
export type UpdateTenantInput = Partial<Pick<Tenant, "name" | "externalId" | "alertDigestEnabled">> & OptimisticLock;

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
  stage: contactStageSchema.default("PROSPECT"),
  metadata: metadataSchema.nullable().optional()
}).required({ updatedAt: true }).passthrough();
export type ContactRecord = z.output<typeof contactRecordSchema>;
export type CreateContactInput = TenantScoped & Partial<Pick<ContactRecord, "externalId" | "email" | "phone" | "firstName" | "lastName" | "stage" | "metadata">>;
export type UpdateContactInput = Partial<Pick<ContactRecord, "externalId" | "email" | "phone" | "firstName" | "lastName" | "stage" | "metadata">> & OptimisticLock;

export const pipelineStageRecordSchema = baseRecordSchema.extend({
  pipelineId: z.string().min(1),
  name: z.string().min(1),
  position: z.number().int().positive(),
  color: colorSchema.nullable().optional()
}).required({ updatedAt: true }).strict();
export type PipelineStageRecord = z.output<typeof pipelineStageRecordSchema>;

export const pipelineRecordSchema = baseRecordSchema.extend({
  name: z.string().min(1),
  isDefault: z.boolean(),
  defaultKey: z.string().min(1).nullable().optional(),
  stages: z.array(pipelineStageRecordSchema).default([])
}).required({ updatedAt: true }).strict();
export type PipelineRecord = z.output<typeof pipelineRecordSchema>;
export type UpdatePipelineStageInput = Pick<PipelineStageRecord, "name"> & Partial<Pick<PipelineStageRecord, "id" | "color">>;

export const dealRecordSchema = baseRecordSchema.extend({
  contactId: z.string().min(1).nullable().optional(),
  pipelineId: z.string().min(1),
  pipelineStageId: z.string().min(1),
  ownerId: z.string().min(1).nullable().optional(),
  externalId: z.string().min(1).nullable().optional(),
  title: z.string().min(1),
  value: decimalLikeSchema.nullable().optional(),
  currency: z.string().min(3),
  probability: z.number().int().min(0).max(100).nullable().optional(),
  closedAt: isoDateSchema.nullable().optional(),
  metadata: metadataSchema.nullable().optional()
}).required({ updatedAt: true }).strict();
export type DealRecord = z.output<typeof dealRecordSchema>;
export type CreateDealInput = TenantScoped & Pick<DealRecord, "title" | "pipelineStageId"> & Partial<Pick<DealRecord, "contactId" | "ownerId" | "externalId" | "value" | "currency" | "probability" | "closedAt" | "metadata">>;
export type DealFilters = Partial<Pick<DealRecord, "contactId" | "pipelineId" | "pipelineStageId">>;

export const dealOwnerRecordSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1).nullable().optional(),
  email: z.string().email().nullable().optional()
}).passthrough();
export type DealOwnerRecord = z.output<typeof dealOwnerRecordSchema>;

export const dealContactRecordSchema = z.object({
  id: z.string().min(1),
  firstName: z.string().min(1).nullable().optional(),
  lastName: z.string().min(1).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().min(1).nullable().optional(),
  company: z.string().min(1).nullable().optional()
}).passthrough();
export type DealContactRecord = z.output<typeof dealContactRecordSchema>;

export const activityRecordSchema = baseRecordSchema.extend({
  contactId: z.string().min(1).nullable().optional(),
  dealId: z.string().min(1).nullable().optional(),
  createdById: z.string().min(1),
  type: z.enum(["CALL", "EMAIL", "MEETING", "TASK", "NOTE"]),
  note: z.string().min(1).nullable().optional(),
  occurredAt: isoDateSchema,
  metadata: metadataSchema.nullable().optional()
}).required({ updatedAt: true }).strict();
export type ActivityRecord = z.output<typeof activityRecordSchema>;
export type CreateActivityInput = TenantScoped & Pick<ActivityRecord, "createdById" | "type" | "note"> & Partial<Pick<ActivityRecord, "contactId" | "dealId" | "occurredAt" | "metadata">>;
export interface ActivityListFilters {
  readonly contactId?: string | undefined;
  readonly dealId?: string | undefined;
  readonly type?: ActivityRecord["type"] | undefined;
  readonly createdById?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

export const marketplaceCaptureRecordSchema = baseRecordSchema.extend({
  marketplaceSourceId: z.string().min(1).nullable().optional(),
  contactId: z.string().min(1).nullable().optional(),
  dealId: z.string().min(1).nullable().optional(),
  externalId: z.string().min(1).nullable().optional(),
  listingUrl: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1).nullable().optional(),
  price: decimalLikeSchema.nullable().optional(),
  currency: z.string().min(1).nullable().optional(),
  sellerName: z.string().min(1).nullable().optional(),
  sellerProfileUrl: z.string().min(1).nullable().optional(),
  status: z.string().min(1),
  capturedAt: isoDateSchema,
  metadata: metadataSchema.nullable().optional()
}).required({ updatedAt: true }).strict();
export type MarketplaceCaptureRecord = z.output<typeof marketplaceCaptureRecordSchema>;
export type CreateMarketplaceCaptureInput = TenantScoped & Pick<MarketplaceCaptureRecord, "listingUrl" | "title"> & Partial<Pick<MarketplaceCaptureRecord, "marketplaceSourceId" | "contactId" | "dealId" | "externalId" | "description" | "price" | "currency" | "sellerName" | "sellerProfileUrl" | "status" | "capturedAt" | "metadata">>;
export type UpdateMarketplaceCaptureInput = Partial<Pick<MarketplaceCaptureRecord, "contactId" | "dealId" | "status" | "metadata">>;

export const sellerInvitationChannelSchema = z.enum(["WHATSAPP", "SMS", "EMAIL"]);
export const sellerInvitationStatusSchema = z.enum(["PENDING", "SENT", "FAILED", "OPENED", "EXPIRED"]);
export const sellerInvitationRecordSchema = baseRecordSchema.extend({
  marketplaceCaptureId: z.string().min(1),
  channel: sellerInvitationChannelSchema,
  status: sellerInvitationStatusSchema,
  inviteUrl: z.string().min(1),
  recipient: z.string().min(1),
  expiresAt: isoDateSchema,
  metadata: metadataSchema.nullable().optional(),
}).required({ updatedAt: true }).strict();
export type SellerInvitationRecord = z.output<typeof sellerInvitationRecordSchema>;
export type CreateSellerInvitationInput = TenantScoped & Pick<SellerInvitationRecord, "marketplaceCaptureId" | "channel" | "status" | "inviteUrl" | "recipient" | "expiresAt"> & Partial<Pick<SellerInvitationRecord, "metadata">>;
export type UpdateSellerInvitationInput = Partial<Pick<SellerInvitationRecord, "status" | "metadata">>;

export const marketplaceClaimTokenRecordSchema = baseRecordSchema.extend({
  marketplaceCaptureId: z.string().min(1),
  tokenHash: z.string().min(1),
  status: z.string().min(1),
  sentAt: isoDateSchema.nullable().optional(),
  expiresAt: isoDateSchema,
  reminderDay3SentAt: isoDateSchema.nullable().optional(),
  reminderDay6SentAt: isoDateSchema.nullable().optional(),
  expiredAt: isoDateSchema.nullable().optional(),
  claimedAt: isoDateSchema.nullable().optional(),
  metadata: metadataSchema.nullable().optional(),
}).required({ updatedAt: true }).strict();
export type MarketplaceClaimTokenRecord = z.output<typeof marketplaceClaimTokenRecordSchema>;
export type CreateMarketplaceClaimTokenInput = TenantScoped & Pick<MarketplaceClaimTokenRecord, "marketplaceCaptureId" | "tokenHash" | "expiresAt"> & Partial<Pick<MarketplaceClaimTokenRecord, "status" | "sentAt" | "reminderDay3SentAt" | "reminderDay6SentAt" | "expiredAt" | "claimedAt" | "metadata">>;
export type UpdateMarketplaceClaimTokenInput = Partial<Pick<MarketplaceClaimTokenRecord, "status" | "sentAt" | "expiresAt" | "reminderDay3SentAt" | "reminderDay6SentAt" | "expiredAt" | "claimedAt" | "metadata">>;

export const marketplaceOwnershipAttestationRecordSchema = baseRecordSchema.extend({
  marketplaceCaptureId: z.string().min(1),
  draftInventoryId: z.string().min(1),
  contactId: z.string().min(1).nullable().optional(),
  claimTokenId: z.string().min(1).nullable().optional(),
  invitationId: z.string().min(1).nullable().optional(),
  claimantName: z.string().min(1),
  claimantPhone: z.string().min(1).nullable().optional(),
  claimantEmail: z.string().email().nullable().optional(),
  marketplaceIdentity: z.string().min(1).nullable().optional(),
  attestationStatement: z.string().min(1),
  acceptedTerms: z.boolean(),
  ipAddress: z.string().min(1).nullable().optional(),
  userAgent: z.string().min(1).nullable().optional(),
  attestedAt: isoDateSchema,
  evidence: z.unknown().nullable().optional(),
  metadata: metadataSchema.nullable().optional(),
}).strict();
export type MarketplaceOwnershipAttestationRecord = z.output<typeof marketplaceOwnershipAttestationRecordSchema>;
export type CreateMarketplaceOwnershipAttestationInput = TenantScoped & Omit<MarketplaceOwnershipAttestationRecord, "id" | "createdAt">;

export const draftInventoryStatusValues = ["DRAFT", "CLAIM_PENDING", "CLAIMED", "CONVERTED", "EXPIRED"] as const;
export const draftInventoryStatusSchema = z.enum(draftInventoryStatusValues);
export type DraftInventoryStatus = z.output<typeof draftInventoryStatusSchema>;

export const draftInventoryRecordSchema = baseRecordSchema.extend({
  marketplaceCaptureId: z.string().min(1),
  contactId: z.string().min(1).nullable().optional(),
  dealId: z.string().min(1).nullable().optional(),
  title: z.string().min(1),
  description: z.string().min(1).nullable().optional(),
  price: decimalLikeSchema.nullable().optional(),
  currency: z.string().min(1).nullable().optional(),
  category: z.string().min(1).nullable().optional(),
  images: z.unknown().nullable().optional(),
  listingUrl: z.string().min(1).nullable().optional(),
  marketplaceSource: z.string().min(1).nullable().optional(),
  marketplaceListingId: z.string().min(1).nullable().optional(),
  status: draftInventoryStatusSchema,
}).required({ updatedAt: true }).strict();
export type DraftInventoryRecord = z.output<typeof draftInventoryRecordSchema>;
export type CreateDraftInventoryInput = TenantScoped & Pick<DraftInventoryRecord, "marketplaceCaptureId" | "title"> & Partial<Pick<DraftInventoryRecord, "contactId" | "dealId" | "description" | "price" | "currency" | "category" | "images" | "listingUrl" | "marketplaceSource" | "marketplaceListingId" | "status">>;
export type UpdateDraftInventoryInput = Partial<Pick<DraftInventoryRecord, "contactId" | "dealId" | "title" | "description" | "price" | "currency" | "category" | "images" | "listingUrl" | "marketplaceSource" | "marketplaceListingId" | "status">>;

export const renderConversionStatusSchema = z.enum(["PENDING", "PROCESSING", "SUCCESS", "FAILED", "RETRYING", "DEAD_LETTERED"]);
export const renderConversionRecordSchema = baseRecordSchema.extend({
  marketplaceCaptureId: z.string().min(1).nullable().optional(),
  sellerVerificationId: z.string().min(1).nullable().optional(),
  contactId: z.string().min(1).nullable().optional(),
  dealId: z.string().min(1).nullable().optional(),
  externalId: z.string().min(1).nullable().optional(),
  renderSellerId: z.string().min(1).nullable().optional(),
  conversionKind: z.string().min(1).nullable().optional(),
  status: renderConversionStatusSchema,
  startedAt: isoDateSchema.nullable().optional(),
  completedAt: isoDateSchema.nullable().optional(),
  failedAt: isoDateSchema.nullable().optional(),
  failureReason: z.string().min(1).nullable().optional(),
  failureCode: z.string().min(1).nullable().optional(),
  attemptCount: z.number().int().min(0).default(0),
  maxAttempts: z.number().int().min(1).default(3),
  nextAttemptAt: isoDateSchema.nullable().optional(),
  lastAttemptAt: isoDateSchema.nullable().optional(),
  deadLetteredAt: isoDateSchema.nullable().optional(),
  convertedAt: isoDateSchema.nullable().optional(),
  metadata: metadataSchema.nullable().optional(),
}).required({ updatedAt: true }).strict();
export type RenderConversionRecord = z.output<typeof renderConversionRecordSchema>;
export type CreateRenderConversionInput = TenantScoped & Pick<RenderConversionRecord, "marketplaceCaptureId" | "sellerVerificationId" | "contactId" | "status"> & Partial<Pick<RenderConversionRecord, "dealId" | "externalId" | "renderSellerId" | "conversionKind" | "startedAt" | "completedAt" | "failedAt" | "failureReason" | "failureCode" | "attemptCount" | "maxAttempts" | "nextAttemptAt" | "lastAttemptAt" | "deadLetteredAt" | "convertedAt" | "metadata">>;
export type UpdateRenderConversionInput = Partial<Pick<RenderConversionRecord, "status" | "renderSellerId" | "externalId" | "startedAt" | "completedAt" | "failedAt" | "failureReason" | "failureCode" | "attemptCount" | "maxAttempts" | "nextAttemptAt" | "lastAttemptAt" | "deadLetteredAt" | "convertedAt" | "metadata">>;

export interface ActivityCreateContext extends TenantScoped {
  readonly actorId?: string | undefined;
  readonly correlation?: PersistenceCorrelationMetadata | undefined;
}

export const dealCardRecordSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  contactName: z.string().min(1).nullable().optional(),
  dealValue: decimalLikeSchema.nullable().optional(),
  currency: z.string().min(3),
  owner: dealOwnerRecordSchema.nullable().optional(),
  probability: z.number().int().min(0).max(100).nullable().optional(),
  stageId: z.string().min(1),
  updatedAt: isoDateSchema
}).strict();
export type DealCardRecord = z.output<typeof dealCardRecordSchema>;

export interface BoardColumnPageRecord { readonly items: readonly DealCardRecord[]; readonly nextCursor?: string | undefined; readonly limit: number; }
export interface BoardColumnRecord { readonly id: string; readonly name: string; readonly position: number; readonly color?: string | null | undefined; readonly deals: BoardColumnPageRecord; }
export interface PipelineBoardRecord { readonly pipeline: { readonly id: string; readonly name: string }; readonly columns: readonly BoardColumnRecord[]; }
export interface BoardPaginationRequest { readonly limit?: number; readonly cursors?: Readonly<Record<string, string | undefined>>; }

export interface DealDetailRecord { readonly deal: DealRecord; readonly contact?: DealContactRecord | null | undefined; readonly owner?: DealOwnerRecord | null | undefined; readonly activity: readonly ActivityRecord[]; }

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
export interface ContactRepository { create(context: TenantScoped, input: CreateContactInput): Promise<ContactRecord>; createMany(context: TenantScoped, inputs: readonly CreateContactInput[]): Promise<number>; count(context: TenantScoped): Promise<number>; findById(context: TenantScoped, id: string): Promise<ContactRecord | null>; findByPhone(context: TenantScoped, phone: string): Promise<ContactRecord | null>; findByEmails(context: TenantScoped, emails: readonly string[]): Promise<readonly ContactRecord[]>; list(context: TenantScoped, page?: PageRequest): Promise<Page<ContactRecord>>; update(context: TenantScoped, id: string, input: UpdateContactInput): Promise<ContactRecord>; listLeadEvents(context: TenantScoped, contactId: string, page?: PageRequest): Promise<Page<LeadEventRecord>>; }
export interface PipelineRepository { findByWorkspace(workspaceId: string): Promise<PipelineRecord | null>; findByDefaultKey(workspaceId: string, defaultKey: string): Promise<PipelineRecord | null>; updateStages(workspaceId: string, pipelineId: string, stages: readonly UpdatePipelineStageInput[]): Promise<PipelineRecord>; }
export interface DealsRepository { create(workspaceId: string, input: CreateDealInput): Promise<DealRecord>; list(workspaceId: string, filters?: DealFilters): Promise<readonly DealRecord[]>; findById(workspaceId: string, dealId: string): Promise<DealRecord | null>; findByExternalId(workspaceId: string, externalId: string): Promise<DealRecord | null>; findBoardByPipeline(workspaceId: string, pipelineId: string, pagination?: BoardPaginationRequest): Promise<PipelineBoardRecord | null>; updateStageWithOptimisticLock(workspaceId: string, dealId: string, stageId: string, expectedUpdatedAt: string): Promise<{ readonly deal: DealRecord; readonly previousStageId: string }>; findDetailById(workspaceId: string, dealId: string): Promise<DealDetailRecord | null>; updateStage(workspaceId: string, dealId: string, stageId: string): Promise<DealRecord>; findByContact(workspaceId: string, contactId: string): Promise<readonly DealRecord[]>; }
export interface ActivityRepository { create(context: ActivityCreateContext, input: CreateActivityInput): Promise<ActivityRecord>; list(context: TenantScoped, filters?: ActivityListFilters, page?: PageRequest): Promise<Page<ActivityRecord>>; listByDeal(context: TenantScoped, dealId: string, page?: PageRequest): Promise<Page<ActivityRecord>>; }
export interface MarketplaceCaptureRepository { create(context: TenantScoped, input: CreateMarketplaceCaptureInput): Promise<MarketplaceCaptureRecord>; findByListingUrl(context: TenantScoped, listingUrl: string): Promise<MarketplaceCaptureRecord | null>; findByExternalId(context: TenantScoped, externalId: string): Promise<MarketplaceCaptureRecord | null>; findById(context: TenantScoped, captureId: string): Promise<MarketplaceCaptureRecord | null>; findByDealId(context: TenantScoped, dealId: string): Promise<MarketplaceCaptureRecord | null>; update(context: TenantScoped, captureId: string, input: UpdateMarketplaceCaptureInput): Promise<MarketplaceCaptureRecord>; }
export interface SellerInvitationRepository { create(context: TenantScoped, input: CreateSellerInvitationInput): Promise<SellerInvitationRecord>; update(context: TenantScoped, invitationId: string, input: UpdateSellerInvitationInput): Promise<SellerInvitationRecord>; }
export interface MarketplaceClaimTokenRepository { create(context: TenantScoped, input: CreateMarketplaceClaimTokenInput): Promise<MarketplaceClaimTokenRecord>; findByTokenHash(context: TenantScoped, tokenHash: string): Promise<MarketplaceClaimTokenRecord | null>; update(context: TenantScoped, tokenId: string, input: UpdateMarketplaceClaimTokenInput): Promise<MarketplaceClaimTokenRecord>; }
export interface MarketplaceOwnershipAttestationRepository { create(context: TenantScoped, input: CreateMarketplaceOwnershipAttestationInput): Promise<MarketplaceOwnershipAttestationRecord>; findByMarketplaceCaptureId(context: TenantScoped, marketplaceCaptureId: string): Promise<MarketplaceOwnershipAttestationRecord | null>; }
export interface DraftInventoryRepository { create(context: TenantScoped, input: CreateDraftInventoryInput): Promise<DraftInventoryRecord>; findByMarketplaceCaptureId(context: TenantScoped, marketplaceCaptureId: string): Promise<DraftInventoryRecord | null>; findByMarketplaceListing(context: TenantScoped, marketplaceSource: string, marketplaceListingId: string): Promise<DraftInventoryRecord | null>; upsertForCapture(context: TenantScoped, input: CreateDraftInventoryInput): Promise<DraftInventoryRecord>; update(context: TenantScoped, draftInventoryId: string, input: UpdateDraftInventoryInput): Promise<DraftInventoryRecord>; }
export interface RenderConversionRepository { findById(context: TenantScoped, conversionId: string): Promise<RenderConversionRecord | null>; findSuccessfulSellerConversion(context: TenantScoped, marketplaceCaptureId: string, contactId: string | null): Promise<RenderConversionRecord | null>; findSuccessfulInventoryConversion(context: TenantScoped, marketplaceCaptureId: string, externalId: string | null): Promise<RenderConversionRecord | null>; create(context: TenantScoped, input: CreateRenderConversionInput): Promise<RenderConversionRecord>; update(context: TenantScoped, conversionId: string, input: UpdateRenderConversionInput): Promise<RenderConversionRecord>; }

export interface DashboardContactRecord { readonly id: string; readonly firstName?: string | null | undefined; readonly lastName?: string | null | undefined; readonly company?: string | null | undefined; readonly email?: string | null | undefined; readonly lastTouchAt?: string | null | undefined; }
export interface DashboardActivityRecord { readonly id: string; readonly contactId?: string | null | undefined; readonly dealId?: string | null | undefined; readonly type: string; readonly note?: string | null | undefined; readonly createdById: string; readonly createdAt: string; }
export interface FollowUpDigestWorkspaceRecord { readonly tenantId: string; readonly workspaceId: string; readonly workspaceName: string; readonly alertDigestEnabled: boolean; }
export interface FollowUpDigestRecipientRecord { readonly email: string; readonly name?: string | undefined; }
export interface FollowUpDigestIdleContactRecord { readonly id: string; readonly lastTouchAt?: string | null | undefined; }
export interface FollowUpDigestRepository { listWorkspacesForFollowUpDigest(): Promise<readonly FollowUpDigestWorkspaceRecord[]>; listOwnerAndAdminRecipients(context: TenantScoped): Promise<readonly FollowUpDigestRecipientRecord[]>; listIdleContactsForFollowUpDigest(context: TenantScoped, cutoff: Date): Promise<readonly FollowUpDigestIdleContactRecord[]>; }
export interface DashboardRepository { countActiveContacts(context: TenantScoped): Promise<number>; sumOpenPipelineValue(context: TenantScoped): Promise<number>; sumWonValueForPeriod(context: TenantScoped, period: { readonly from: Date; readonly to: Date }): Promise<number>; listContactsForHealth(context: TenantScoped): Promise<readonly DashboardContactRecord[]>; listContactsForFollowUpAlerts(context: TenantScoped, cutoff: Date): Promise<readonly DashboardContactRecord[]>; getFollowUpReminderEnabled(context: TenantScoped): Promise<boolean>; listLatestActivities(context: TenantScoped, limit: number): Promise<readonly DashboardActivityRecord[]>; }
export interface ReportPeriodRange { readonly startDate: Date; readonly endDate: Date; }
export interface RevenueByStageReportRecord { readonly stageId: string; readonly stageName: string; readonly revenue: number; }
export interface ClientAcquisitionSourceReportRecord { readonly source: string; readonly count: number; }
export interface ReportsRepository { getCurrentPlan(context: TenantScoped): Promise<{ readonly plan: string } | null>; revenueByStage(context: TenantScoped, period: ReportPeriodRange): Promise<readonly RevenueByStageReportRecord[]>; clientAcquisitionSources(context: TenantScoped, period: ReportPeriodRange): Promise<readonly ClientAcquisitionSourceReportRecord[]>; averageDaysToClose(context: TenantScoped, period: ReportPeriodRange): Promise<{ readonly avgDaysToClose: number | null }>; renewalRate(context: TenantScoped, period: ReportPeriodRange): Promise<{ readonly rate: number | null }>; }
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
  const take = (parsed.limit ?? 25) + 1;
  return parsed.cursor === undefined ? { take } : { take, cursor: parsed.cursor };
};

const cursorWhere = (context: TenantScoped, cursor?: string, extra: PrismaWhere = {}): PrismaWhere => cursor === undefined
  ? withTenant(context, extra)
  : withTenant(context, { ...extra, id: { gt: cursor } });

const mapPrismaError = (error: unknown, conflictMessage: string): never => {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
  const meta = typeof error === "object" && error !== null && "meta" in error ? error.meta : undefined;
  const message = error instanceof Error ? error.message : String(error);

  if (code === "P2002") {
    throw new PersistenceError({
      code: "PERSISTENCE_CONFLICT",
      message: conflictMessage,
      status: 409,
      details: { prismaCode: code, prismaMeta: meta, prismaMessage: message },
    });
  }

  if (error instanceof PersistenceError) throw error;

  throw new PersistenceError({
    code: "PERSISTENCE_TRANSIENT",
    message: `Prisma repository operation failed${code === undefined ? "" : ` (${code})`}`,
    status: 503,
    details: { prismaCode: code, prismaMeta: meta, prismaMessage: message },
  });
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
  async createMany(context: TenantScoped, inputs: readonly CreateContactInput[]): Promise<number> { ensureContext(context); if (inputs.length === 0) return 0; const rows = inputs.map((input) => { ensureTenantInput(context, input); return dataWithDefined(input); }); try { const result = await this.prisma.contact.createMany?.({ data: rows }); if (result === undefined) throw new PersistenceError({ code: "PERSISTENCE_TRANSIENT", message: "Contact bulk insert is not supported by this Prisma client", status: 503 }); return result.count; } catch (error) { return mapPrismaError(error, "Contact bulk insert failed"); } }
  async count(context: TenantScoped): Promise<number> { ensureContext(context); const result = await this.prisma.contact.count?.({ where: { tenantId: context.tenantId } }); if (result === undefined) throw new PersistenceError({ code: "PERSISTENCE_TRANSIENT", message: "Contact count is not supported by this Prisma client", status: 503 }); return result; }
  async findById(context: TenantScoped, id: string): Promise<ContactRecord | null> { ensureContext(context); const result = await this.prisma.contact.findFirst({ where: byTenantId(context, id) }); return result === null ? null : parseRecord(contactRecordSchema, result); }
  async findByPhone(context: TenantScoped, phone: string): Promise<ContactRecord | null> { ensureContext(context); const result = await this.prisma.contact.findFirst({ where: withTenant(context, { phone }) }); return result === null ? null : parseRecord(contactRecordSchema, result); }
  async findByEmails(context: TenantScoped, emails: readonly string[]): Promise<readonly ContactRecord[]> { ensureContext(context); if (emails.length === 0) return []; const rows = await this.prisma.contact.findMany({ where: { tenantId: context.tenantId, email: { in: [...new Set(emails)] } } }); return rows.map((row) => parseRecord(contactRecordSchema, row)); }
  async list(context: TenantScoped, page?: PageRequest): Promise<Page<ContactRecord>> { ensureContext(context); const args = pageArgs(page); const rows = await this.prisma.contact.findMany({ where: cursorWhere(context, args.cursor), take: args.take, orderBy: { id: "asc" } }); return paginate(rows.map((row) => parseRecord(contactRecordSchema, row)), args.take - 1); }
  async update(context: TenantScoped, id: string, input: UpdateContactInput): Promise<ContactRecord> { ensureContext(context); return updateOptimistic(this.prisma.contact, contactRecordSchema, context, id, input); }
  async listLeadEvents(context: TenantScoped, contactId: string, page?: PageRequest): Promise<Page<LeadEventRecord>> { ensureContext(context); const args = pageArgs(page); const rows = await this.prisma.leadEvent.findMany({ where: cursorWhere(context, args.cursor, { contactId }), take: args.take, orderBy: { id: "asc" } }); return paginate(rows.map((row) => parseRecord(leadEventRecordSchema, row)), args.take - 1); }
}


const workspaceContext = (workspaceId: string): TenantScoped => ({ tenantId: workspaceId });

const notFound = (message: string, details?: Readonly<Record<string, unknown>>): never => {
  throw new PersistenceError(details === undefined
    ? { code: "PERSISTENCE_NOT_FOUND", message, status: 404 }
    : { code: "PERSISTENCE_NOT_FOUND", message, status: 404, details });
};

export class PrismaPipelineRepository implements PipelineRepository {
  constructor(private readonly prisma: PrismaPersistenceClient) {}
  async findByWorkspace(workspaceId: string): Promise<PipelineRecord | null> {
    const context = workspaceContext(workspaceId);
    ensureContext(context);
    const pipeline = await this.prisma.pipeline.findFirst({ where: withTenant(context, { isDefault: true }), orderBy: { id: "asc" } });
    if (pipeline === null) return null;
    const parsed = parseRecord(pipelineRecordSchema.omit({ stages: true }), pipeline);
    const stages = await this.prisma.pipelineStage.findMany({ where: withTenant(context, { pipelineId: parsed.id }), orderBy: { position: "asc" } });
    return pipelineRecordSchema.parse({ ...parsed, stages: stages.map((stage) => parseRecord(pipelineStageRecordSchema, stage)) });
  }
  async findByDefaultKey(workspaceId: string, defaultKey: string): Promise<PipelineRecord | null> {
    const context = workspaceContext(workspaceId);
    ensureContext(context);
    const pipeline = await this.prisma.pipeline.findFirst({ where: withTenant(context, { defaultKey }) });
    if (pipeline === null) return null;
    const parsed = parseRecord(pipelineRecordSchema.omit({ stages: true }), pipeline);
    const stages = await this.prisma.pipelineStage.findMany({ where: withTenant(context, { pipelineId: parsed.id }), orderBy: { position: "asc" } });
    return pipelineRecordSchema.parse({ ...parsed, stages: stages.map((stage) => parseRecord(pipelineStageRecordSchema, stage)) });
  }
  async updateStages(workspaceId: string, pipelineId: string, stages: readonly UpdatePipelineStageInput[]): Promise<PipelineRecord> {
    const context = workspaceContext(workspaceId);
    ensureContext(context);
    if (stages.length === 0) throw new PersistenceError({ code: "PERSISTENCE_VALIDATION_FAILED", message: "Pipeline must include at least one stage", status: 400 });
    const work = async (client: PrismaPersistenceClient): Promise<PipelineRecord> => {
      const pipeline = await client.pipeline.findFirst({ where: byTenantId(context, pipelineId) });
      if (pipeline === null) notFound("Pipeline not found", { pipelineId });
      const existing = await client.pipelineStage.findMany({ where: withTenant(context, { pipelineId }) });
      for (const stage of existing) {
        const row = parseRecord(pipelineStageRecordSchema, stage);
        await client.pipelineStage.updateMany({ where: withTenant(context, { pipelineId, id: row.id }), data: { position: -row.position } });
      }
      const desiredIds = new Set(stages.flatMap((stage) => stage.id === undefined ? [] : [stage.id]));
      const desiredNames = new Set(stages.map((stage) => stage.name));
      if (client.pipelineStage.deleteMany !== undefined) {
        await client.pipelineStage.deleteMany({ where: withTenant(context, { pipelineId, id: { notIn: [...desiredIds] }, name: { notIn: [...desiredNames] } }) });
      }
      for (const [index, stage] of stages.entries()) {
        const data = dataWithDefined({ name: stage.name, color: stage.color, position: index + 1 });
        if (stage.id !== undefined) {
          const result = await client.pipelineStage.updateMany({ where: withTenant(context, { pipelineId, id: stage.id }), data });
          if (result.count !== 1) notFound("Pipeline stage not found", { pipelineId, stageId: stage.id });
        } else if (client.pipelineStage.upsert !== undefined) {
          await client.pipelineStage.upsert({
            where: { tenantId_pipelineId_name: { tenantId: context.tenantId, pipelineId, name: stage.name } },
            create: dataWithDefined({ tenantId: context.tenantId, pipelineId, ...data }),
            update: data
          });
        } else {
          await client.pipelineStage.create({ data: dataWithDefined({ tenantId: context.tenantId, pipelineId, ...data }) });
        }
      }
      const updated = await client.pipeline.findFirst({ where: byTenantId(context, pipelineId) });
      if (updated === null) notFound("Pipeline not found", { pipelineId });
      const orderedStages = await client.pipelineStage.findMany({ where: withTenant(context, { pipelineId }), orderBy: { position: "asc" } });
      return pipelineRecordSchema.parse({ ...parseRecord(pipelineRecordSchema.omit({ stages: true }), updated), stages: orderedStages.map((stage) => parseRecord(pipelineStageRecordSchema, stage)) });
    };
    return this.prisma.$transaction === undefined ? work(this.prisma) : this.prisma.$transaction(work);
  }
}

export class PrismaDealsRepository implements DealsRepository {
  constructor(private readonly prisma: PrismaPersistenceClient) {}
  async create(workspaceId: string, input: CreateDealInput): Promise<DealRecord> {
    const context = workspaceContext(workspaceId);
    ensureTenantInput(context, input);
    const stage = await this.findStage(context, input.pipelineStageId);
    if (input.contactId !== undefined && input.contactId !== null) await this.ensureContact(context, input.contactId);
    if (input.ownerId !== undefined && input.ownerId !== null) await this.ensureOwner(context, input.ownerId);
    try {
      return parseRecord(dealRecordSchema, await this.prisma.deal.create({ data: dataWithDefined({ currency: "USD", ...input, pipelineId: stage.pipelineId, pipelineStageId: stage.id }) }));
    } catch (error) { return mapPrismaError(error, "Deal already exists"); }
  }
  async list(workspaceId: string, filters: DealFilters = {}): Promise<readonly DealRecord[]> {
    const context = workspaceContext(workspaceId);
    ensureContext(context);
    const rows = await this.prisma.deal.findMany({ where: withTenant(context, dataWithDefined(filters)), orderBy: { id: "asc" } });
    return rows.map((row) => parseRecord(dealRecordSchema, row));
  }
  async findById(workspaceId: string, dealId: string): Promise<DealRecord | null> {
    const context = workspaceContext(workspaceId);
    ensureContext(context);
    const row = await this.prisma.deal.findFirst({ where: byTenantId(context, dealId) });
    return row === null ? null : parseRecord(dealRecordSchema, row);
  }
  async findByExternalId(workspaceId: string, externalId: string): Promise<DealRecord | null> {
    const context = workspaceContext(workspaceId);
    ensureContext(context);
    const row = await this.prisma.deal.findFirst({ where: withTenant(context, { externalId }) });
    return row === null ? null : parseRecord(dealRecordSchema, row);
  }
  async findBoardByPipeline(workspaceId: string, pipelineId: string, pagination: BoardPaginationRequest = {}): Promise<PipelineBoardRecord | null> {
    const context = workspaceContext(workspaceId);
    ensureContext(context);
    const pipeline = await this.prisma.pipeline.findFirst({ where: byTenantId(context, pipelineId) });
    if (pipeline === null) return null;
    const parsedPipeline = parseRecord(pipelineRecordSchema.omit({ stages: true }), pipeline);
    const stages = (await this.prisma.pipelineStage.findMany({ where: withTenant(context, { pipelineId }), orderBy: { position: "asc" } }))
      .map((stage) => parseRecord(pipelineStageRecordSchema, stage));
    const limit = Math.min(Math.max(pagination.limit ?? 25, 1), 100);
    const columns = await Promise.all(stages.map(async (stage): Promise<BoardColumnRecord> => {
      const cursor = pagination.cursors?.[stage.id];
      const rows = await this.prisma.deal.findMany({
        where: cursorWhere(context, cursor, { pipelineId, pipelineStageId: stage.id }),
        take: limit + 1,
        orderBy: { id: "asc" },
      });
      const deals = rows.map((row) => parseRecord(dealRecordSchema, row));
      const page = paginate(deals, limit);
      const cards = await this.toCards(context, page.items);
      return { id: stage.id, name: stage.name, position: stage.position, color: stage.color, deals: { items: cards, nextCursor: page.nextCursor, limit } };
    }));
    return { pipeline: { id: parsedPipeline.id, name: parsedPipeline.name }, columns };
  }
  async updateStageWithOptimisticLock(workspaceId: string, dealId: string, stageId: string, expectedUpdatedAt: string): Promise<{ readonly deal: DealRecord; readonly previousStageId: string }> {
    const context = workspaceContext(workspaceId);
    ensureContext(context);
    const current = await this.findById(workspaceId, dealId);
    const currentDeal = current ?? notFound("Deal not found", { dealId });
    const stage = await this.findStage(context, stageId);
    if (stage.pipelineId !== currentDeal.pipelineId) {
      throw new PersistenceError({ code: "PERSISTENCE_NOT_FOUND", message: "Pipeline stage not found", status: 404, details: { stageId } });
    }
    const result = await this.prisma.deal.updateMany({
      where: { tenantId: context.tenantId, id: dealId, updatedAt: new Date(expectedUpdatedAt) },
      data: { pipelineStageId: stage.id },
    });
    if (result.count !== 1) {
      throw new PersistenceError({ code: "PERSISTENCE_CONFLICT", message: "Optimistic lock conflict", status: 409, details: { dealId } });
    }
    const row = await this.prisma.deal.findFirst({ where: byTenantId(context, dealId) });
    if (row === null) notFound("Deal not found", { dealId });
    return { deal: parseRecord(dealRecordSchema, row), previousStageId: currentDeal.pipelineStageId };
  }
  async findDetailById(workspaceId: string, dealId: string): Promise<DealDetailRecord | null> {
    const context = workspaceContext(workspaceId);
    const deal = await this.findById(workspaceId, dealId);
    if (deal === null) return null;
    const [contact, owner, activityPage] = await Promise.all([
      deal.contactId === undefined || deal.contactId === null ? Promise.resolve(null) : this.findContact(context, deal.contactId),
      deal.ownerId === undefined || deal.ownerId === null ? Promise.resolve(null) : this.findOwner(context, deal.ownerId),
      this.listActivities(context, deal.id),
    ]);
    return { deal, contact, owner, activity: activityPage.items };
  }
  async updateStage(workspaceId: string, dealId: string, stageId: string): Promise<DealRecord> {
    const context = workspaceContext(workspaceId);
    ensureContext(context);
    const stage = await this.findStage(context, stageId);
    const result = await this.prisma.deal.updateMany({ where: byTenantId(context, dealId), data: { pipelineId: stage.pipelineId, pipelineStageId: stage.id } });
    if (result.count !== 1) notFound("Deal not found", { dealId });
    const row = await this.prisma.deal.findFirst({ where: byTenantId(context, dealId) });
    if (row === null) notFound("Deal not found", { dealId });
    return parseRecord(dealRecordSchema, row);
  }
  async findByContact(workspaceId: string, contactId: string): Promise<readonly DealRecord[]> {
    const context = workspaceContext(workspaceId);
    ensureContext(context);
    await this.ensureContact(context, contactId);
    const rows = await this.prisma.deal.findMany({ where: withTenant(context, { contactId }), orderBy: { id: "asc" } });
    return rows.map((row) => parseRecord(dealRecordSchema, row));
  }
  private async toCards(context: TenantScoped, deals: readonly DealRecord[]): Promise<readonly DealCardRecord[]> {
    const contactIds = [...new Set(deals.flatMap((deal) => deal.contactId === undefined || deal.contactId === null ? [] : [deal.contactId]))];
    const ownerIds = [...new Set(deals.flatMap((deal) => deal.ownerId === undefined || deal.ownerId === null ? [] : [deal.ownerId]))];
    const [contacts, owners] = await Promise.all([
      contactIds.length === 0 ? Promise.resolve([]) : this.prisma.contact.findMany({ where: withTenant(context, { id: { in: contactIds } }) }),
      ownerIds.length === 0 ? Promise.resolve([]) : this.prisma.tenantUser.findMany({ where: withTenant(context, { id: { in: ownerIds } }) }),
    ]);
    const contactById = new Map(contacts.map((contact) => {
      const parsed = parseRecord(dealContactRecordSchema, contact);
      return [parsed.id, parsed] as const;
    }));
    const ownerById = new Map(owners.map((owner) => {
      const parsed = parseRecord(dealOwnerRecordSchema, owner);
      return [parsed.id, parsed] as const;
    }));
    return deals.map((deal) => {
      const contact = deal.contactId === undefined || deal.contactId === null ? undefined : contactById.get(deal.contactId);
      const contactName = contact === undefined ? undefined : [contact.firstName, contact.lastName].filter((value) => value !== undefined && value !== null && value.length > 0).join(" ") || contact.email || contact.company || undefined;
      const owner = deal.ownerId === undefined || deal.ownerId === null ? undefined : ownerById.get(deal.ownerId);
      return dealCardRecordSchema.parse({ id: deal.id, title: deal.title, contactName, dealValue: deal.value, currency: deal.currency, owner, probability: deal.probability, stageId: deal.pipelineStageId, updatedAt: deal.updatedAt });
    });
  }
  private async findStage(context: TenantScoped, stageId: string): Promise<PipelineStageRecord> {
    const row = await this.prisma.pipelineStage.findFirst({ where: byTenantId(context, stageId) });
    if (row === null) notFound("Pipeline stage not found", { stageId });
    return parseRecord(pipelineStageRecordSchema, row);
  }
  private async ensureContact(context: TenantScoped, contactId: string): Promise<void> {
    const contact = await this.prisma.contact.findFirst({ where: byTenantId(context, contactId) });
    if (contact === null) notFound("Contact not found", { contactId });
  }
  private async ensureOwner(context: TenantScoped, ownerId: string): Promise<void> {
    const owner = await this.prisma.tenantUser.findFirst({ where: byTenantId(context, ownerId) });
    if (owner === null) notFound("Owner not found", { ownerId });
  }
  private async findContact(context: TenantScoped, contactId: string): Promise<DealContactRecord | null> {
    const contact = await this.prisma.contact.findFirst({ where: byTenantId(context, contactId) });
    return contact === null ? null : parseRecord(dealContactRecordSchema, contact);
  }
  private async findOwner(context: TenantScoped, ownerId: string): Promise<DealOwnerRecord | null> {
    const owner = await this.prisma.tenantUser.findFirst({ where: byTenantId(context, ownerId) });
    return owner === null ? null : parseRecord(dealOwnerRecordSchema, owner);
  }
  private async listActivities(context: TenantScoped, dealId: string): Promise<Page<ActivityRecord>> {
    const rows = await this.prisma.activity.findMany({ where: withTenant(context, { dealId }), take: 51, orderBy: { id: "asc" } });
    return paginate(rows.map((row) => parseRecord(activityRecordSchema, row)), 50);
  }
}

const numberFromUnknown = (value: unknown): number => {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (typeof value === "object" && value !== null && "toString" in value) return Number(value.toString());
  return 0;
};

const aggregateSumValue = async (delegate: PrismaDelegate, where: PrismaWhere): Promise<number> => {
  const aggregated = await delegate.aggregate?.({ where, _sum: { value: true } });
  if (aggregated !== undefined && typeof aggregated === "object" && aggregated !== null && "_sum" in aggregated) {
    const sum = (aggregated as { readonly _sum?: Readonly<Record<string, unknown>> })._sum?.value;
    return Number.isFinite(numberFromUnknown(sum)) ? numberFromUnknown(sum) : 0;
  }
  const rows = await delegate.findMany({ where, select: { value: true } });
  return rows.reduce<number>((total, row) => {
    if (typeof row !== "object" || row === null || !("value" in row)) return total;
    return total + numberFromUnknown(row.value);
  }, 0);
};

export class PrismaDashboardRepository implements DashboardRepository {
  constructor(private readonly prisma: PrismaPersistenceClient) {}

  async countActiveContacts(context: TenantScoped): Promise<number> {
    ensureContext(context);
    const result = await this.prisma.contact.count?.({ where: withTenant(context, { stage: { not: "INACTIVE" } }) });
    if (result === undefined) throw new PersistenceError({ code: "PERSISTENCE_TRANSIENT", message: "Contact count is not supported by this Prisma client", status: 503 });
    return result;
  }

  async sumOpenPipelineValue(context: TenantScoped): Promise<number> {
    ensureContext(context);
    return aggregateSumValue(this.prisma.deal, withTenant(context, { closedAt: null }));
  }

  async sumWonValueForPeriod(context: TenantScoped, period: { readonly from: Date; readonly to: Date }): Promise<number> {
    ensureContext(context);
    return aggregateSumValue(this.prisma.deal, withTenant(context, { closedAt: { gte: period.from, lt: period.to } }));
  }

  async listContactsForHealth(context: TenantScoped): Promise<readonly DashboardContactRecord[]> {
    ensureContext(context);
    return this.listDashboardContacts(context, withTenant(context));
  }

  async listContactsForFollowUpAlerts(context: TenantScoped, cutoff: Date): Promise<readonly DashboardContactRecord[]> {
    ensureContext(context);
    return this.listDashboardContacts(context, withTenant(context, { OR: [{ lastTouchAt: null }, { lastTouchAt: { lt: cutoff } }] }));
  }

  async getFollowUpReminderEnabled(context: TenantScoped): Promise<boolean> {
    ensureContext(context);
    const row = await this.prisma.tenant.findFirst({ where: { id: context.tenantId }, select: { alertDigestEnabled: true } });
    return z.object({ alertDigestEnabled: z.boolean().default(true) }).strict().parse(row ?? {}).alertDigestEnabled;
  }

  private async listDashboardContacts(context: TenantScoped, where: PrismaWhere): Promise<readonly DashboardContactRecord[]> {
    ensureContext(context);
    const rows = await this.prisma.contact.findMany({
      where,
      orderBy: { lastTouchAt: "asc" },
      select: { id: true, firstName: true, lastName: true, company: true, email: true, lastTouchAt: true },
    });
    return rows.map((row) => parseRecord(z.object({ id: z.string().min(1), firstName: z.string().nullable().optional(), lastName: z.string().nullable().optional(), company: z.string().nullable().optional(), email: z.string().nullable().optional(), lastTouchAt: isoDateSchema.nullable().optional() }).strict(), row));
  }

  async listLatestActivities(context: TenantScoped, limit: number): Promise<readonly DashboardActivityRecord[]> {
    ensureContext(context);
    const rows = await this.prisma.activity.findMany({
      where: withTenant(context),
      take: Math.min(Math.max(limit, 1), 10),
      orderBy: { createdAt: "desc" },
      select: { id: true, contactId: true, dealId: true, type: true, note: true, createdById: true, createdAt: true },
    });
    return rows.map((row) => parseRecord(z.object({ id: z.string().min(1), contactId: z.string().nullable().optional(), dealId: z.string().nullable().optional(), type: z.string().min(1), note: z.string().nullable().optional(), createdById: z.string().min(1), createdAt: isoDateSchema }).strict(), row));
  }
}


export class PrismaReportsRepository implements ReportsRepository {
  constructor(private readonly prisma: PrismaPersistenceClient) {}

  async getCurrentPlan(context: TenantScoped): Promise<{ readonly plan: string } | null> {
    ensureContext(context);
    const row = await this.prisma.subscription.findFirst({
      where: withTenant(context, { status: { in: ["ACTIVE", "TRIALING"] } }),
      orderBy: { createdAt: "desc" },
      select: { plan: true },
    });
    if (row === null) return null;
    return z.object({ plan: z.string().min(1) }).strict().parse(row);
  }

  async revenueByStage(context: TenantScoped, period: ReportPeriodRange): Promise<readonly RevenueByStageReportRecord[]> {
    ensureContext(context);
    const where = withTenant(context, { createdAt: { gte: period.startDate, lt: period.endDate } });
    const totals = new Map<string, number>();
    if (this.prisma.deal.groupBy !== undefined) {
      const grouped = await this.prisma.deal.groupBy({ by: ["pipelineStageId"], where, _sum: { value: true } });
      for (const row of grouped) {
        const parsed = z.object({ pipelineStageId: z.string().min(1), _sum: z.object({ value: decimalLikeSchema.nullable().optional() }).partial() }).passthrough().parse(row);
        totals.set(parsed.pipelineStageId, numberFromUnknown(parsed._sum.value));
      }
    } else {
      const rows = await this.prisma.deal.findMany({
        where,
        select: { pipelineStageId: true, value: true },
      });
      for (const row of rows) {
        const parsed = z.object({ pipelineStageId: z.string().min(1), value: decimalLikeSchema.nullable().optional() }).strict().parse(row);
        totals.set(parsed.pipelineStageId, (totals.get(parsed.pipelineStageId) ?? 0) + numberFromUnknown(parsed.value));
      }
    }
    if (totals.size === 0) return [];
    const stages = await this.prisma.pipelineStage.findMany({
      where: withTenant(context, { id: { in: [...totals.keys()] } }),
      orderBy: { position: "asc" },
      select: { id: true, name: true },
    });
    return stages.map((stage) => {
      const parsed = z.object({ id: z.string().min(1), name: z.string().min(1) }).strict().parse(stage);
      return { stageId: parsed.id, stageName: parsed.name, revenue: totals.get(parsed.id) ?? 0 };
    });
  }

  async clientAcquisitionSources(context: TenantScoped, period: ReportPeriodRange): Promise<readonly ClientAcquisitionSourceReportRecord[]> {
    ensureContext(context);
    // TODO(S2.3): keep returning [] if source tracking is removed or replaced by a dedicated acquisition model.
    const where = withTenant(context, { createdAt: { gte: period.startDate, lt: period.endDate }, source: { not: null } });
    const counts = new Map<string, number>();
    if (this.prisma.contact.groupBy !== undefined) {
      const grouped = await this.prisma.contact.groupBy({ by: ["source"], where, _count: { source: true } });
      for (const row of grouped) {
        const parsed = z.object({ source: z.string().min(1).nullable().optional(), _count: z.object({ source: z.number().int().nonnegative().optional() }).partial() }).passthrough().parse(row);
        if (parsed.source === undefined || parsed.source === null || parsed.source.trim().length === 0) continue;
        counts.set(parsed.source, parsed._count.source ?? 0);
      }
    } else {
      const rows = await this.prisma.contact.findMany({
        where,
        select: { source: true },
      });
      for (const row of rows) {
        const parsed = z.object({ source: z.string().min(1).nullable().optional() }).strict().parse(row);
        if (parsed.source === undefined || parsed.source === null || parsed.source.trim().length === 0) continue;
        counts.set(parsed.source, (counts.get(parsed.source) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([source, count]) => ({ source, count }));
  }

  async averageDaysToClose(context: TenantScoped, period: ReportPeriodRange): Promise<{ readonly avgDaysToClose: number | null }> {
    ensureContext(context);
    const rows = await this.prisma.deal.findMany({
      where: withTenant(context, { closedAt: { gte: period.startDate, lt: period.endDate } }),
      select: { createdAt: true, closedAt: true },
    });
    if (rows.length === 0) return { avgDaysToClose: null };
    const totalDays = rows.reduce<number>((total, row) => {
      const parsed = parseRecord(z.object({ createdAt: isoDateSchema, closedAt: isoDateSchema }).strict(), row);
      return total + ((new Date(parsed.closedAt).getTime() - new Date(parsed.createdAt).getTime()) / 86_400_000);
    }, 0);
    return { avgDaysToClose: totalDays / rows.length };
  }

  async renewalRate(context: TenantScoped, period: ReportPeriodRange): Promise<{ readonly rate: number | null }> {
    ensureContext(context);
    // TODO(S2.3): return renewed / eligible renewals when renewal outcome data is modeled.
    void period;
    return { rate: null };
  }
}

export class PrismaFollowUpDigestRepository implements FollowUpDigestRepository {
  constructor(private readonly prisma: PrismaPersistenceClient) {}

  async listWorkspacesForFollowUpDigest(): Promise<readonly FollowUpDigestWorkspaceRecord[]> {
    const rows = await this.prisma.tenant.findMany({
      where: { alertDigestEnabled: true },
      orderBy: { id: "asc" },
      select: { id: true, name: true, alertDigestEnabled: true },
    });
    return rows.map((row) => {
      const parsed = z.object({ id: z.string().min(1), name: z.string().min(1), alertDigestEnabled: z.boolean().default(true) }).strict().parse(row);
      return { tenantId: parsed.id, workspaceId: parsed.id, workspaceName: parsed.name, alertDigestEnabled: parsed.alertDigestEnabled };
    });
  }

  async listOwnerAndAdminRecipients(context: TenantScoped): Promise<readonly FollowUpDigestRecipientRecord[]> {
    ensureContext(context);
    const rows = await this.prisma.tenantUser.findMany({
      where: withTenant(context, { isActive: true, role: { in: ["OWNER", "ADMIN"] } }),
      orderBy: { id: "asc" },
      select: { email: true, displayName: true },
    });
    return rows.map((row) => {
      const parsed = z.object({ email: z.string().email(), displayName: z.string().min(1).nullable().optional() }).strict().parse(row);
      return { email: parsed.email, name: parsed.displayName ?? undefined };
    });
  }

  async listIdleContactsForFollowUpDigest(context: TenantScoped, cutoff: Date): Promise<readonly FollowUpDigestIdleContactRecord[]> {
    ensureContext(context);
    const rows = await this.prisma.contact.findMany({
      where: withTenant(context, { OR: [{ lastTouchAt: null }, { lastTouchAt: { lt: cutoff } }] }),
      orderBy: { lastTouchAt: "asc" },
      select: { id: true, lastTouchAt: true },
    });
    return rows.map((row) => parseRecord(z.object({ id: z.string().min(1), lastTouchAt: isoDateSchema.nullable().optional() }).strict(), row));
  }
}

export class PrismaMarketplaceCaptureRepository implements MarketplaceCaptureRepository {
  constructor(private readonly prisma: PrismaPersistenceClient) {}

  async create(context: TenantScoped, input: CreateMarketplaceCaptureInput): Promise<MarketplaceCaptureRecord> {
    ensureTenantInput(context, input);
    try {
      return parseRecord(marketplaceCaptureRecordSchema, await this.prisma.marketplaceCapture.create({ data: dataWithDefined({ status: "CAPTURED", ...input }) }));
    } catch (error) { return mapPrismaError(error, "Marketplace capture already exists"); }
  }

  async findByListingUrl(context: TenantScoped, listingUrl: string): Promise<MarketplaceCaptureRecord | null> {
    ensureContext(context);
    const row = await this.prisma.marketplaceCapture.findFirst({ where: withTenant(context, { listingUrl }) });
    return row === null ? null : parseRecord(marketplaceCaptureRecordSchema, row);
  }

  async findByExternalId(context: TenantScoped, externalId: string): Promise<MarketplaceCaptureRecord | null> {
    ensureContext(context);
    const row = await this.prisma.marketplaceCapture.findFirst({ where: withTenant(context, { externalId }) });
    return row === null ? null : parseRecord(marketplaceCaptureRecordSchema, row);
  }

  async findById(context: TenantScoped, captureId: string): Promise<MarketplaceCaptureRecord | null> {
    ensureContext(context);
    const row = await this.prisma.marketplaceCapture.findFirst({ where: byTenantId(context, captureId) });
    return row === null ? null : parseRecord(marketplaceCaptureRecordSchema, row);
  }

  async findByDealId(context: TenantScoped, dealId: string): Promise<MarketplaceCaptureRecord | null> {
    ensureContext(context);
    const row = await this.prisma.marketplaceCapture.findFirst({ where: withTenant(context, { dealId }) });
    return row === null ? null : parseRecord(marketplaceCaptureRecordSchema, row);
  }

  async update(context: TenantScoped, captureId: string, input: UpdateMarketplaceCaptureInput): Promise<MarketplaceCaptureRecord> {
    ensureContext(context);
    const result = await this.prisma.marketplaceCapture.updateMany({ where: byTenantId(context, captureId), data: dataWithDefined(input) });
    if (result.count !== 1) notFound("Marketplace capture not found", { captureId });
    const row = await this.prisma.marketplaceCapture.findFirst({ where: byTenantId(context, captureId) });
    if (row === null) notFound("Marketplace capture not found", { captureId });
    return parseRecord(marketplaceCaptureRecordSchema, row);
  }
}



export class PrismaSellerInvitationRepository implements SellerInvitationRepository {
  constructor(private readonly prisma: PrismaPersistenceClient) {}

  async create(context: TenantScoped, input: CreateSellerInvitationInput): Promise<SellerInvitationRecord> {
    ensureTenantInput(context, input);
    try {
      return parseRecord(sellerInvitationRecordSchema, await this.prisma.marketplaceSellerInvitation.create({ data: dataWithDefined(input) }));
    } catch (error) { return mapPrismaError(error, "Seller invitation already exists"); }
  }

  async update(context: TenantScoped, invitationId: string, input: UpdateSellerInvitationInput): Promise<SellerInvitationRecord> {
    ensureContext(context);
    const result = await this.prisma.marketplaceSellerInvitation.updateMany({ where: byTenantId(context, invitationId), data: dataWithDefined(input) });
    if (result.count !== 1) notFound("Seller invitation not found", { invitationId });
    const row = await this.prisma.marketplaceSellerInvitation.findFirst({ where: byTenantId(context, invitationId) });
    if (row === null) notFound("Seller invitation not found", { invitationId });
    return parseRecord(sellerInvitationRecordSchema, row);
  }
}

export class PrismaMarketplaceClaimTokenRepository implements MarketplaceClaimTokenRepository {
  constructor(private readonly prisma: PrismaPersistenceClient) {}

  async create(context: TenantScoped, input: CreateMarketplaceClaimTokenInput): Promise<MarketplaceClaimTokenRecord> {
    ensureTenantInput(context, input);
    try {
      return parseRecord(marketplaceClaimTokenRecordSchema, await this.prisma.marketplaceClaimToken.create({
        data: dataWithDefined({ ...input, status: input.status ?? "PENDING" })
      }));
    } catch (error) {
      return mapPrismaError(error, "Marketplace claim token already exists");
    }
  }

  async findByTokenHash(context: TenantScoped, tokenHash: string): Promise<MarketplaceClaimTokenRecord | null> {
    ensureContext(context);
    const row = await this.prisma.marketplaceClaimToken.findFirst({ where: withTenant(context, { tokenHash }) });
    return row === null ? null : parseRecord(marketplaceClaimTokenRecordSchema, row);
  }

  async update(context: TenantScoped, tokenId: string, input: UpdateMarketplaceClaimTokenInput): Promise<MarketplaceClaimTokenRecord> {
    ensureContext(context);
    const result = await this.prisma.marketplaceClaimToken.updateMany({ where: byTenantId(context, tokenId), data: dataWithDefined(input) });
    if (result.count !== 1) notFound("Marketplace claim token not found", { tokenId });
    const row = await this.prisma.marketplaceClaimToken.findFirst({ where: byTenantId(context, tokenId) });
    if (row === null) notFound("Marketplace claim token not found", { tokenId });
    return parseRecord(marketplaceClaimTokenRecordSchema, row);
  }
}

export class PrismaMarketplaceOwnershipAttestationRepository implements MarketplaceOwnershipAttestationRepository {
  constructor(private readonly prisma: PrismaPersistenceClient) {}

  async create(context: TenantScoped, input: CreateMarketplaceOwnershipAttestationInput): Promise<MarketplaceOwnershipAttestationRecord> {
    ensureTenantInput(context, input);
    try {
      return parseRecord(marketplaceOwnershipAttestationRecordSchema, await this.prisma.marketplaceOwnershipAttestation.create({ data: dataWithDefined(input) }));
    } catch (error) { return mapPrismaError(error, "Ownership attestation already exists"); }
  }

  async findByMarketplaceCaptureId(context: TenantScoped, marketplaceCaptureId: string): Promise<MarketplaceOwnershipAttestationRecord | null> {
    ensureContext(context);
    const row = await this.prisma.marketplaceOwnershipAttestation.findFirst({ where: withTenant(context, { marketplaceCaptureId }) });
    return row === null ? null : parseRecord(marketplaceOwnershipAttestationRecordSchema, row);
  }
}

export class PrismaDraftInventoryRepository implements DraftInventoryRepository {
  constructor(private readonly prisma: PrismaPersistenceClient) {}

  async create(context: TenantScoped, input: CreateDraftInventoryInput): Promise<DraftInventoryRecord> {
    ensureTenantInput(context, input);
    try {
      return parseRecord(draftInventoryRecordSchema, await this.prisma.draftInventory.create({ data: dataWithDefined({ status: "DRAFT", ...input }) }));
    } catch (error) { return mapPrismaError(error, "Draft inventory already exists"); }
  }

  async findByMarketplaceCaptureId(context: TenantScoped, marketplaceCaptureId: string): Promise<DraftInventoryRecord | null> {
    ensureContext(context);
    const row = await this.prisma.draftInventory.findFirst({ where: withTenant(context, { marketplaceCaptureId }) });
    return row === null ? null : parseRecord(draftInventoryRecordSchema, row);
  }

  async findByMarketplaceListing(context: TenantScoped, marketplaceSource: string, marketplaceListingId: string): Promise<DraftInventoryRecord | null> {
    ensureContext(context);
    const row = await this.prisma.draftInventory.findFirst({ where: withTenant(context, { marketplaceSource, marketplaceListingId }) });
    return row === null ? null : parseRecord(draftInventoryRecordSchema, row);
  }

  async upsertForCapture(context: TenantScoped, input: CreateDraftInventoryInput): Promise<DraftInventoryRecord> {
    ensureTenantInput(context, input);
    const existingByCapture = await this.findByMarketplaceCaptureId(context, input.marketplaceCaptureId);
    if (existingByCapture !== null) return existingByCapture;
    if (input.marketplaceSource !== undefined && input.marketplaceSource !== null && input.marketplaceListingId !== undefined && input.marketplaceListingId !== null) {
      const existingByListing = await this.findByMarketplaceListing(context, input.marketplaceSource, input.marketplaceListingId);
      if (existingByListing !== null) return this.update(context, existingByListing.id, input);
    }
    return this.create(context, input);
  }

  async update(context: TenantScoped, draftInventoryId: string, input: UpdateDraftInventoryInput): Promise<DraftInventoryRecord> {
    ensureContext(context);
    const result = await this.prisma.draftInventory.updateMany({ where: byTenantId(context, draftInventoryId), data: dataWithDefined(input) });
    if (result.count !== 1) notFound("Draft inventory not found", { draftInventoryId });
    const row = await this.prisma.draftInventory.findFirst({ where: byTenantId(context, draftInventoryId) });
    if (row === null) notFound("Draft inventory not found", { draftInventoryId });
    return parseRecord(draftInventoryRecordSchema, row);
  }
}


export class PrismaRenderConversionRepository implements RenderConversionRepository {
  constructor(private readonly prisma: PrismaPersistenceClient) {}
  async findById(context: TenantScoped, conversionId: string): Promise<RenderConversionRecord | null> {
    ensureContext(context);
    const row = await this.prisma.renderConversion.findFirst({ where: byTenantId(context, conversionId) });
    return row === null ? null : parseRecord(renderConversionRecordSchema, row);
  }
  async findSuccessfulSellerConversion(context: TenantScoped, marketplaceCaptureId: string, contactId: string | null): Promise<RenderConversionRecord | null> {
    ensureContext(context);
    const row = await this.prisma.renderConversion.findFirst({ where: withTenant(context, dataWithDefined({ marketplaceCaptureId, contactId, conversionKind: "SELLER", status: "SUCCESS" })), orderBy: { createdAt: "desc" } });
    return row === null ? null : parseRecord(renderConversionRecordSchema, row);
  }
  async findSuccessfulInventoryConversion(context: TenantScoped, marketplaceCaptureId: string, externalId: string | null): Promise<RenderConversionRecord | null> {
    ensureContext(context);
    const row = await this.prisma.renderConversion.findFirst({ where: withTenant(context, dataWithDefined({ marketplaceCaptureId, externalId, conversionKind: "INVENTORY", status: "SUCCESS" })), orderBy: { createdAt: "desc" } });
    return row === null ? null : parseRecord(renderConversionRecordSchema, row);
  }
  async create(context: TenantScoped, input: CreateRenderConversionInput): Promise<RenderConversionRecord> {
    ensureTenantInput(context, input);
    try { return parseRecord(renderConversionRecordSchema, await this.prisma.renderConversion.create({ data: dataWithDefined({ conversionKind: "SELLER", ...input }) })); } catch (error) { return mapPrismaError(error, "Render conversion already exists"); }
  }
  async update(context: TenantScoped, conversionId: string, input: UpdateRenderConversionInput): Promise<RenderConversionRecord> {
    ensureContext(context);
    const result = await this.prisma.renderConversion.updateMany({ where: byTenantId(context, conversionId), data: dataWithDefined(input) });
    if (result.count !== 1) notFound("Render conversion not found", { conversionId });
    const row = await this.prisma.renderConversion.findFirst({ where: byTenantId(context, conversionId) });
    if (row === null) notFound("Render conversion not found", { conversionId });
    return parseRecord(renderConversionRecordSchema, row);
  }
}

export class PrismaActivityRepository implements ActivityRepository {
  constructor(private readonly prisma: PrismaPersistenceClient) {}

  async create(context: ActivityCreateContext, input: CreateActivityInput): Promise<ActivityRecord> {
    ensureTenantInput(context, input);
    const correlation = context.correlation ?? { correlationId: "unknown" };
    const createdById = context.actorId ?? input.createdById;
    const occurredAt = input.occurredAt === undefined ? new Date() : new Date(input.occurredAt);
    const work = async (client: PrismaPersistenceClient): Promise<ActivityRecord> => {
      if (input.contactId != null) {
        const result = await client.contact.updateMany({ where: byTenantId(context, input.contactId), data: { lastTouchAt: occurredAt } });
        if (result.count !== 1) notFound("Contact not found", { contactId: input.contactId });
      }
      if (input.dealId != null) {
        const deal = await client.deal.findFirst({ where: byTenantId(context, input.dealId) });
        if (deal === null) notFound("Deal not found", { dealId: input.dealId });
      }
      const activity = parseRecord(activityRecordSchema, await client.activity.create({ data: dataWithDefined({ ...input, createdById, occurredAt }) }));
      await client.auditLog.create({ data: dataWithDefined({ tenantId: context.tenantId, actorId: createdById, action: "ACTIVITY_CREATED", targetType: "ACTIVITY", targetId: activity.id, correlationId: correlation.correlationId, requestId: correlation.requestId, metadata: { contactId: activity.contactId ?? null, dealId: activity.dealId ?? null, type: activity.type } }) });
      await client.outboxEvent.create({ data: dataWithDefined({ tenantId: context.tenantId, aggregateType: "ACTIVITY", aggregateId: activity.id, eventType: "activity.created", eventVersion: 1, idempotencyKey: `activity:${activity.id}:created`, payload: { tenantId: context.tenantId, activityId: activity.id, contactId: activity.contactId ?? null, dealId: activity.dealId ?? null, type: activity.type, createdById }, headers: {}, state: "PENDING", availableAt: occurredAt, correlationId: correlation.correlationId }) });
      return activity;
    };
    if (this.prisma.$transaction === undefined) return work(this.prisma);
    return this.prisma.$transaction(work);
  }

  async list(context: TenantScoped, filters?: ActivityListFilters, page?: PageRequest): Promise<Page<ActivityRecord>> {
    ensureContext(context);
    const args = pageArgs(page);
    const createdAt = dataWithDefined({ gte: filters?.from === undefined ? undefined : new Date(filters.from), lte: filters?.to === undefined ? undefined : new Date(filters.to) });
    const rows = await this.prisma.activity.findMany({
      where: cursorWhere(context, args.cursor, dataWithDefined({ contactId: filters?.contactId, dealId: filters?.dealId, type: filters?.type, createdById: filters?.createdById, ...(Object.keys(createdAt).length === 0 ? {} : { createdAt }) })),
      take: args.take,
      orderBy: { createdAt: "desc" }
    });
    return paginate(rows.map((row) => parseRecord(activityRecordSchema, row)), args.take - 1);
  }

  async listByDeal(context: TenantScoped, dealId: string, page?: PageRequest): Promise<Page<ActivityRecord>> {
    return this.list(context, { dealId }, page);
  }
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


const scheduledJobToContract = (row: unknown): ScheduledJob => {
  const data = row as Readonly<Record<string, unknown>>;
  const runAt = data.runAt instanceof Date ? data.runAt.toISOString() : data.runAt;
  const correlationId = typeof data.correlationId === "string" ? data.correlationId : undefined;

  return scheduledJobSchema.parse({
    tenantId: data.tenantId,
    scheduleName: data.scheduleName,
    jobName: data.jobName,
    cron: data.cron ?? undefined,
    runAt: runAt ?? undefined,
    payload: data.payload ?? {},
    correlation: correlationId === undefined ? undefined : { correlationId },
  });
};

export class PrismaScheduledJobRepository implements ScheduledJobRepository {
  constructor(private readonly prisma: PrismaPersistenceClient) {}

  async upsert(input: ScheduledJob): Promise<ScheduledJob> {
    ensureTenantInput(input, input);
    const parsed = scheduledJobSchema.parse(input);
    const runAt = parsed.runAt === undefined ? undefined : new Date(parsed.runAt);

    const row = await this.prisma.scheduledJob.upsert?.({
      where: { tenantId_scheduleName: { tenantId: parsed.tenantId, scheduleName: parsed.scheduleName } },
      create: dataWithDefined({
        tenantId: parsed.tenantId,
        scheduleName: parsed.scheduleName,
        jobName: parsed.jobName,
        cron: parsed.cron,
        runAt,
        nextRunAt: runAt,
        payload: parsed.payload,
        correlationId: parsed.correlation?.correlationId,
      }),
      update: dataWithDefined({
        jobName: parsed.jobName,
        cron: parsed.cron,
        runAt,
        nextRunAt: runAt,
        payload: parsed.payload,
        correlationId: parsed.correlation?.correlationId,
      }),
    });

    if (row === undefined) {
      throw new PersistenceError({
        code: "PERSISTENCE_VALIDATION_FAILED",
        message: "Scheduled job upsert is not available",
        status: 500,
      });
    }

    return scheduledJobToContract(row);
  }

  async cancel(input: TenantScoped & { readonly scheduleName: string }): Promise<void> {
    ensureContext(input);
    const result = await this.prisma.scheduledJob.deleteMany?.({
      where: withTenant(input, { scheduleName: input.scheduleName }),
    });

    if (result === undefined) {
      throw new PersistenceError({
        code: "PERSISTENCE_VALIDATION_FAILED",
        message: "Scheduled job cancellation is not available",
        status: 500,
      });
    }
  }
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
  readonly pipelines: PipelineRepository;
  readonly deals: DealsRepository;
  readonly campaigns: CampaignRepository;
  readonly workflows: WorkflowRepository;
  readonly approvals: ApprovalRepository;
  readonly executions: ExecutionRepository;
  readonly events: EventRepository;
  readonly billing: BillingRepository;
  readonly auditLogs: AuditLogRepository;
  readonly activities: ActivityRepository;
  readonly marketplaceCaptures: MarketplaceCaptureRepository;
  readonly draftInventories: DraftInventoryRepository;
  readonly renderConversions: RenderConversionRepository;
  readonly dashboard: DashboardRepository;
  readonly followUpDigest: FollowUpDigestRepository;
  readonly reports: ReportsRepository;
  readonly marketplaceAcquisition: MarketplaceAcquisitionRepository;
  readonly marketplaceClaimTokens: MarketplaceClaimTokenRepository;
  readonly ownershipAttestations: MarketplaceOwnershipAttestationRepository;
  readonly scheduledJobs: ScheduledJobRepository;
}

export const createPrismaRepositories = (prisma: PrismaPersistenceClient): PrismaRepositories => {
  const auditLogs = new PrismaAuditLogRepository(prisma);
  return {
    tenants: new PrismaTenantRepository(prisma),
    users: new PrismaUserRepository(prisma),
    contacts: new PrismaContactRepository(prisma),
    pipelines: new PrismaPipelineRepository(prisma),
    deals: new PrismaDealsRepository(prisma),
    activities: new PrismaActivityRepository(prisma),
    marketplaceCaptures: new PrismaMarketplaceCaptureRepository(prisma),
    draftInventories: new PrismaDraftInventoryRepository(prisma),
    renderConversions: new PrismaRenderConversionRepository(prisma),
    dashboard: new PrismaDashboardRepository(prisma),
    reports: new PrismaReportsRepository(prisma),
    followUpDigest: new PrismaFollowUpDigestRepository(prisma),
    campaigns: new PrismaCampaignRepository(prisma),
    workflows: new PrismaWorkflowRepository(prisma),
    approvals: new PrismaApprovalRepository(auditLogs),
    executions: new PrismaExecutionRepository(prisma),
    events: new PrismaEventRepository(prisma),
    billing: new PrismaBillingRepository(auditLogs),
    marketplaceAcquisition: new PrismaMarketplaceAcquisitionRepository(prisma),
    marketplaceClaimTokens: new PrismaMarketplaceClaimTokenRepository(prisma),
    ownershipAttestations: new PrismaMarketplaceOwnershipAttestationRepository(prisma),
    scheduledJobs: new PrismaScheduledJobRepository(prisma),
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

export * from "./marketplace-acquisition.js";
