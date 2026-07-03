import { z } from "zod";

import type { ActivityRepository, DraftInventoryRecord, MarketplaceCaptureRecord } from "@whisperm/repositories";
import { type PersistenceCorrelationMetadata, type TenantScoped, assertTenantScope } from "@whisperm/types";

const idSchema = z.string().min(1);
const reminderTypeSchema = z.enum(["DAY_3", "DAY_6"]);
const claimTokenStatusSchema = z.enum(["PENDING", "SENT", "FAILED", "OPENED", "EXPIRED", "CLAIMED", "ABANDONED"]);
const channelSchema = z.enum(["WHATSAPP", "SMS", "EMAIL"]);
const nowMs = (date: Date): number => date.getTime();
const days = (count: number): number => count * 24 * 60 * 60 * 1000;

export interface ClaimLifecycleServiceContext {
  readonly tenantId: string;
  readonly actorId?: string | undefined;
  readonly correlation: PersistenceCorrelationMetadata;
}

export class ClaimLifecycleServiceError extends Error {
  readonly code: "SERVICE_NOT_FOUND" | "SERVICE_VALIDATION_FAILED";
  readonly status: number;
  readonly correlation?: PersistenceCorrelationMetadata | undefined;
  constructor(input: { readonly code: "SERVICE_NOT_FOUND" | "SERVICE_VALIDATION_FAILED"; readonly message: string; readonly status: number; readonly correlation?: PersistenceCorrelationMetadata | undefined }) {
    super(input.message);
    this.name = "ClaimLifecycleServiceError";
    this.code = input.code;
    this.status = input.status;
    this.correlation = input.correlation;
  }
}

export type ClaimReminderType = z.output<typeof reminderTypeSchema>;
export type ClaimTokenStatus = z.output<typeof claimTokenStatusSchema>;
export type ClaimInvitationChannel = z.output<typeof channelSchema>;

export interface MarketplaceClaimTokenRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly marketplaceCaptureId: string;
  readonly tokenHash: string;
  readonly status: ClaimTokenStatus;
  readonly sentAt?: string | null | undefined;
  readonly expiresAt: string;
  readonly reminderDay3SentAt?: string | null | undefined;
  readonly reminderDay6SentAt?: string | null | undefined;
  readonly expiredAt?: string | null | undefined;
  readonly claimedAt?: string | null | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | null | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ClaimLifecycleScheduleJob {
  readonly tenantId: string;
  readonly invitationId: string;
  readonly jobType: "marketplace.claim.reminder" | "marketplace.claim.expire" | "marketplace.claim.intelligence";
  readonly reminderType?: ClaimReminderType | undefined;
  readonly runAt: string;
  readonly dedupeKey: string;
  readonly correlation: PersistenceCorrelationMetadata;
}

export interface ClaimLifecycleTokenRepository {
  findById(context: TenantScoped, invitationId: string): Promise<MarketplaceClaimTokenRecord | null>;
  update(context: TenantScoped, invitationId: string, input: Partial<Pick<MarketplaceClaimTokenRecord, "status" | "sentAt" | "expiresAt" | "reminderDay3SentAt" | "reminderDay6SentAt" | "expiredAt" | "metadata">>): Promise<MarketplaceClaimTokenRecord>;
}

export interface ClaimLifecycleCaptureRepository {
  findById(context: TenantScoped, captureId: string): Promise<MarketplaceCaptureRecord | null>;
  update(context: TenantScoped, captureId: string, input: Partial<Pick<MarketplaceCaptureRecord, "status" | "metadata">>): Promise<MarketplaceCaptureRecord>;
}

export interface ClaimLifecycleDraftInventoryRepository {
  findByMarketplaceCaptureId(context: TenantScoped, marketplaceCaptureId: string): Promise<DraftInventoryRecord | null>;
  update(context: TenantScoped, draftInventoryId: string, input: Partial<Pick<DraftInventoryRecord, "status">>): Promise<DraftInventoryRecord>;
}

export interface ClaimLifecycleAuditPort {
  append(context: TenantScoped, input: { readonly tenantId: string; readonly action: string; readonly targetType: string; readonly targetId: string; readonly correlationId: string; readonly requestId?: string | undefined; readonly metadata?: Readonly<Record<string, unknown>> | undefined }): Promise<unknown>;
}

export interface ClaimLifecycleNotificationPort {
  sendClaimReminder(input: { readonly tenantId: string; readonly invitationId: string; readonly marketplaceCaptureId: string; readonly reminderType: ClaimReminderType; readonly purpose: string; readonly preferredChannel?: ClaimInvitationChannel | undefined; readonly correlation: PersistenceCorrelationMetadata }): Promise<{ readonly channel: ClaimInvitationChannel }>;
}

export interface ClaimLifecycleSchedulerPort { schedule(job: ClaimLifecycleScheduleJob): Promise<void>; }

export interface ClaimLifecycleDependencies {
  readonly claimTokens: ClaimLifecycleTokenRepository;
  readonly marketplaceCaptures: ClaimLifecycleCaptureRepository;
  readonly draftInventories: ClaimLifecycleDraftInventoryRepository;
  readonly notifications: ClaimLifecycleNotificationPort;
  readonly businessGrowthOpportunities?: {
    createOrUpdateFromMarketplaceCapture(context: TenantScoped, capture: MarketplaceCaptureRecord): Promise<unknown>;
  } | undefined;
  readonly scheduler: ClaimLifecycleSchedulerPort;
  readonly auditLogs: ClaimLifecycleAuditPort;
  readonly activities?: ActivityRepository | undefined;
  readonly clock?: (() => Date) | undefined;
}

const contextSchema = z.object({ tenantId: idSchema, actorId: idSchema.optional(), correlation: z.object({ correlationId: idSchema, requestId: idSchema.optional(), causationId: idSchema.optional() }).passthrough() }).strict();
const tenantScope = (context: ClaimLifecycleServiceContext): TenantScoped => ({ tenantId: context.tenantId });
const terminalCaptureStatuses = new Set(["CLAIMED", "CONVERTED", "EXPIRED"]);
const activeTokenStatuses = new Set<ClaimTokenStatus>(["SENT", "OPENED"]);
const completedCaptureStatuses = new Set(["CLAIMED", "CONVERTED"]);
const claimIntelligenceThresholds = { noViewMs: days(2), viewedNotCompletedMs: days(1), startedNotCompletedMs: days(1), maxRecoveryAttempts: 2 } as const;
type ClaimStalledReason = "NONE" | "DELIVERED_NO_VIEW" | "VIEWED_NOT_STARTED" | "STARTED_NOT_COMPLETED" | "EXPIRED_TOKEN" | "REPEATED_ABANDONED" | "SELLER_ALREADY_CLAIMED_OR_CONVERTED";
type ClaimRecoveryAction = "NONE" | "SEND_REMINDER" | "MARK_ABANDONED" | "SUPPRESS_CONTACT" | "MANUAL_REVIEW";
export interface ClaimIntelligenceResult { readonly status: "HEALTHY" | "STALLED" | "COMPLETED" | "EXPIRED" | "SUPPRESSED"; readonly stalledReason: ClaimStalledReason; readonly recoveryAction: ClaimRecoveryAction; readonly automatic: boolean; readonly recoveryAttemptCount: number; readonly claimAgeMs: number; readonly timeSinceDeliveryMs: number | null; readonly timeSinceViewMs: number | null; readonly evaluatedAt: string; }
const dateMeta = (metadata: Readonly<Record<string, unknown>> | null | undefined, key: string): string | null => { const value = metadata?.[key]; return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null; };
const numMeta = (metadata: Readonly<Record<string, unknown>> | null | undefined, key: string): number => { const value = metadata?.[key]; return typeof value === "number" && Number.isFinite(value) ? value : 0; };
const reminderField = (type: ClaimReminderType): "reminderDay3SentAt" | "reminderDay6SentAt" => type === "DAY_3" ? "reminderDay3SentAt" : "reminderDay6SentAt";
const reminderPurpose = (type: ClaimReminderType): string => type === "DAY_3" ? "Reminder: claim your seller listing/inventory." : "Final reminder: your claim link expires soon.";

const originalChannel = (token: MarketplaceClaimTokenRecord): ClaimInvitationChannel | undefined => {
  const value = token.metadata?.successfulChannel;
  return typeof value === "string" ? channelSchema.safeParse(value).success ? value as ClaimInvitationChannel : undefined : undefined;
};

export class MarketplaceClaimLifecycleService {
  constructor(private readonly deps: ClaimLifecycleDependencies) {}

  async scheduleClaimLifecycle(contextInput: ClaimLifecycleServiceContext, invitationId: string): Promise<readonly ClaimLifecycleScheduleJob[]> {
    const context = contextSchema.parse(contextInput) as ClaimLifecycleServiceContext;
    const id = idSchema.parse(invitationId);
    const scope = tenantScope(context);
    const token = await this.deps.claimTokens.findById(scope, id);
    if (token === null) throw new ClaimLifecycleServiceError({ code: "SERVICE_NOT_FOUND", message: "Claim invitation not found", status: 404, correlation: context.correlation });
    assertTenantScope(scope, token);
    const sentAt = token.sentAt ?? this.now().toISOString();
    const expiresAt = new Date(Date.parse(sentAt) + days(7)).toISOString();
    if (token.sentAt === undefined || token.sentAt === null || token.expiresAt !== expiresAt) {
      await this.deps.claimTokens.update(scope, id, { sentAt, expiresAt, status: token.status === "PENDING" ? "SENT" : token.status });
    }
    const jobs: ClaimLifecycleScheduleJob[] = [
      this.job(context, id, "marketplace.claim.intelligence", new Date(Date.parse(sentAt) + days(2))),
      this.job(context, id, "marketplace.claim.reminder", new Date(Date.parse(sentAt) + days(3)), "DAY_3"),
      this.job(context, id, "marketplace.claim.reminder", new Date(Date.parse(sentAt) + days(6)), "DAY_6"),
      this.job(context, id, "marketplace.claim.expire", new Date(Date.parse(sentAt) + days(7))),
    ];
    for (const job of jobs) await this.deps.scheduler.schedule(job);
    await this.audit(context, "MARKETPLACE_CLAIM_LIFECYCLE_SCHEDULED", id, { invitationId: id, sentAt, expiresAt });
    return jobs;
  }

  async sendClaimReminder(contextInput: ClaimLifecycleServiceContext, invitationId: string, reminderTypeInput: ClaimReminderType): Promise<{ readonly sent: boolean; readonly channel?: ClaimInvitationChannel | undefined }> {
    const context = contextSchema.parse(contextInput) as ClaimLifecycleServiceContext;
    const reminderType = reminderTypeSchema.parse(reminderTypeInput);
    const id = idSchema.parse(invitationId);
    const scope = tenantScope(context);
    const token = await this.requireToken(scope, id, context);
    const capture = await this.requireCapture(scope, token.marketplaceCaptureId, context);
    if (!activeTokenStatuses.has(token.status) || terminalCaptureStatuses.has(capture.status)) return { sent: false };
    const field = reminderField(reminderType);
    if (token[field] !== undefined && token[field] !== null) return { sent: false };
    const result = await this.deps.notifications.sendClaimReminder({ tenantId: context.tenantId, invitationId: id, marketplaceCaptureId: token.marketplaceCaptureId, reminderType, purpose: reminderPurpose(reminderType), preferredChannel: originalChannel(token), correlation: context.correlation });
    const sentAt = this.now().toISOString();
    await this.deps.claimTokens.update(scope, id, { [field]: sentAt, metadata: { ...(token.metadata ?? {}), [`${field}Channel`]: result.channel } });
    await this.audit(context, reminderType === "DAY_3" ? "MARKETPLACE_CLAIM_DAY3_REMINDER_SENT" : "MARKETPLACE_CLAIM_DAY6_REMINDER_SENT", id, { marketplaceCaptureId: token.marketplaceCaptureId, channel: result.channel });
    return { sent: true, channel: result.channel };
  }

  async expireClaimInvitation(contextInput: ClaimLifecycleServiceContext, invitationId: string): Promise<{ readonly expired: boolean }> {
    const context = contextSchema.parse(contextInput) as ClaimLifecycleServiceContext;
    const id = idSchema.parse(invitationId);
    const scope = tenantScope(context);
    const token = await this.requireToken(scope, id, context);
    if (token.status === "EXPIRED") return { expired: false };
    if (nowMs(this.now()) < Date.parse(token.expiresAt)) return { expired: false };
    const capture = await this.requireCapture(scope, token.marketplaceCaptureId, context);
    if (capture.status === "CLAIMED" || capture.status === "CONVERTED") return { expired: false };
    const expiredAt = this.now().toISOString();
    await this.deps.claimTokens.update(scope, id, { status: "EXPIRED", expiredAt });
    await this.deps.marketplaceCaptures.update(scope, capture.id, { status: "EXPIRED" });
    const draft = await this.deps.draftInventories.findByMarketplaceCaptureId(scope, capture.id);
    if (draft !== null && draft.status !== "CLAIMED" && draft.status !== "CONVERTED" && draft.status !== "EXPIRED") await this.deps.draftInventories.update(scope, draft.id, { status: "EXPIRED" });
    await this.audit(context, "MARKETPLACE_CLAIM_INVITATION_EXPIRED", id, { marketplaceCaptureId: capture.id, expiredAt });
    await this.appendActivity(context, capture, "Seller claim invitation expired", expiredAt, {
      eventType: "MARKETPLACE_CLAIM_INVITATION_EXPIRED",
      marketplaceCaptureId: capture.id,
      claimTokenId: id,
      draftInventoryId: draft?.id ?? null,
      expiredAt,
    });
    return { expired: true };
  }


  async evaluateClaimIntelligence(contextInput: ClaimLifecycleServiceContext, invitationId: string): Promise<ClaimIntelligenceResult> {
    const context = contextSchema.parse(contextInput) as ClaimLifecycleServiceContext;
    const id = idSchema.parse(invitationId);
    const scope = tenantScope(context);
    const token = await this.requireToken(scope, id, context);
    const capture = await this.requireCapture(scope, token.marketplaceCaptureId, context);
    const result = this.evaluateToken(token, capture);
    await this.deps.claimTokens.update(scope, id, { metadata: { ...(token.metadata ?? {}), claimIntelligence: result.status, claimIntelligenceLastEvaluatedAt: result.evaluatedAt, claimIntelligenceStalledReason: result.stalledReason, claimIntelligenceRecoveryAction: result.recoveryAction, claimIntelligenceRecoveryActionStatus: result.recoveryAction === "NONE" ? "NOT_REQUIRED" : "RECOMMENDED", claimIntelligenceRecoveryAttemptCount: result.recoveryAttemptCount, claimIntelligenceClaimAgeMs: result.claimAgeMs, claimIntelligenceTimeSinceDeliveryMs: result.timeSinceDeliveryMs, claimIntelligenceTimeSinceViewMs: result.timeSinceViewMs } });
    await this.audit(context, "MARKETPLACE_CLAIM_INTELLIGENCE_EVALUATED", id, { marketplaceCaptureId: token.marketplaceCaptureId, status: result.status, stalledReason: result.stalledReason, recoveryAction: result.recoveryAction });
    return result;
  }

  async executeClaimRecovery(contextInput: ClaimLifecycleServiceContext, invitationId: string): Promise<{ readonly executed: boolean; readonly action: ClaimRecoveryAction; readonly status: string }> {
    const context = contextSchema.parse(contextInput) as ClaimLifecycleServiceContext;
    const id = idSchema.parse(invitationId);
    const scope = tenantScope(context);
    const token = await this.requireToken(scope, id, context);
    const capture = await this.requireCapture(scope, token.marketplaceCaptureId, context);
    const result = this.evaluateToken(token, capture);
    if (!result.automatic || result.recoveryAction === "NONE") return { executed: false, action: result.recoveryAction, status: "SKIPPED" };
    if (result.recoveryAction === "SEND_REMINDER") {
      const key = `claimRecoveryReminder:${result.stalledReason}`;
      if (token.metadata?.[key] !== undefined) return { executed: false, action: result.recoveryAction, status: "ALREADY_EXECUTED" };
      const sent = await this.deps.notifications.sendClaimReminder({ tenantId: context.tenantId, invitationId: id, marketplaceCaptureId: token.marketplaceCaptureId, reminderType: "DAY_3", purpose: `Recovery reminder: ${result.stalledReason}`, preferredChannel: originalChannel(token), correlation: context.correlation });
      const sentAt = this.now().toISOString();
      await this.deps.claimTokens.update(scope, id, { metadata: { ...(token.metadata ?? {}), [key]: sentAt, claimIntelligence: result.status, claimIntelligenceRecoveryAction: result.recoveryAction, claimIntelligenceRecoveryActionStatus: "EXECUTED", claimIntelligenceRecoveryAttemptCount: result.recoveryAttemptCount + 1, claimIntelligenceLastRecoveryAt: sentAt, claimIntelligenceLastRecoveryChannel: sent.channel } });
      await this.audit(context, "MARKETPLACE_CLAIM_RECOVERY_REMINDER_SENT", id, { marketplaceCaptureId: token.marketplaceCaptureId, stalledReason: result.stalledReason, channel: sent.channel });
      return { executed: true, action: result.recoveryAction, status: "EXECUTED" };
    }
    if (result.recoveryAction === "MARK_ABANDONED") {
      const abandonedAt = this.now().toISOString();
      await this.deps.claimTokens.update(scope, id, { status: "ABANDONED", metadata: { ...(token.metadata ?? {}), claimIntelligence: "STALLED", claimIntelligenceRecoveryAction: result.recoveryAction, claimIntelligenceRecoveryActionStatus: "EXECUTED", claimAbandonedAt: abandonedAt } });
      await this.deps.marketplaceCaptures.update(scope, capture.id, { metadata: { ...(capture.metadata ?? {}), claimIntelligenceStatus: "ABANDONED", claimIntelligenceStalledReason: result.stalledReason } });
      await this.deps.businessGrowthOpportunities?.createOrUpdateFromMarketplaceCapture(scope, { ...capture, metadata: { ...(capture.metadata ?? {}), claimIntelligenceStatus: "ABANDONED" } });
      await this.audit(context, "MARKETPLACE_CLAIM_ABANDONED", id, { marketplaceCaptureId: capture.id, stalledReason: result.stalledReason });
      return { executed: true, action: result.recoveryAction, status: "EXECUTED" };
    }
    return { executed: false, action: result.recoveryAction, status: "MANUAL_REVIEW_REQUIRED" };
  }

  private now(): Date { return this.deps.clock?.() ?? new Date(); }
  private job(context: ClaimLifecycleServiceContext, invitationId: string, jobType: ClaimLifecycleScheduleJob["jobType"], runAt: Date, reminderType?: ClaimReminderType): ClaimLifecycleScheduleJob { return { tenantId: context.tenantId, invitationId, jobType, reminderType, runAt: runAt.toISOString(), dedupeKey: `${jobType}:${context.tenantId}:${invitationId}:${reminderType ?? "expire"}`, correlation: context.correlation }; }
  private evaluateToken(token: MarketplaceClaimTokenRecord, capture: MarketplaceCaptureRecord): ClaimIntelligenceResult {
    const evaluatedAt = this.now().toISOString();
    const nowTime = this.now().getTime();
    const createdTime = Date.parse(token.createdAt);
    const sentAt = dateMeta(token.metadata, "deliveredAt") ?? token.sentAt ?? dateMeta(token.metadata, "sentAt");
    const openedAt = dateMeta(token.metadata, "openedAt");
    const startedAt = capture.status === "CLAIM_STARTED" ? capture.updatedAt : dateMeta(token.metadata, "startedAt");
    const recoveryAttemptCount = numMeta(token.metadata, "claimIntelligenceRecoveryAttemptCount");
    const claimAgeMs = Math.max(0, nowTime - createdTime);
    const timeSinceDeliveryMs = sentAt === null || sentAt === undefined ? null : Math.max(0, nowTime - Date.parse(sentAt));
    const timeSinceViewMs = openedAt === null ? null : Math.max(0, nowTime - Date.parse(openedAt));
    const base = { recoveryAttemptCount, claimAgeMs, timeSinceDeliveryMs, timeSinceViewMs, evaluatedAt };
    if (completedCaptureStatuses.has(capture.status) || token.status === "CLAIMED" || token.claimedAt != null) return { ...base, status: "COMPLETED", stalledReason: "SELLER_ALREADY_CLAIMED_OR_CONVERTED", recoveryAction: "NONE", automatic: false };
    if (token.status === "EXPIRED" || nowTime >= Date.parse(token.expiresAt)) return { ...base, status: "EXPIRED", stalledReason: "EXPIRED_TOKEN", recoveryAction: "MARK_ABANDONED", automatic: true };
    if (recoveryAttemptCount >= claimIntelligenceThresholds.maxRecoveryAttempts) return { ...base, status: "SUPPRESSED", stalledReason: "REPEATED_ABANDONED", recoveryAction: "SUPPRESS_CONTACT", automatic: false };
    if (startedAt !== null && nowTime - Date.parse(startedAt) >= claimIntelligenceThresholds.startedNotCompletedMs) return { ...base, status: "STALLED", stalledReason: "STARTED_NOT_COMPLETED", recoveryAction: "SEND_REMINDER", automatic: true };
    if (openedAt !== null && nowTime - Date.parse(openedAt) >= claimIntelligenceThresholds.viewedNotCompletedMs) return { ...base, status: "STALLED", stalledReason: capture.status === "CLAIM_STARTED" ? "STARTED_NOT_COMPLETED" : "VIEWED_NOT_STARTED", recoveryAction: "SEND_REMINDER", automatic: true };
    if (timeSinceDeliveryMs !== null && openedAt === null && timeSinceDeliveryMs >= claimIntelligenceThresholds.noViewMs) return { ...base, status: "STALLED", stalledReason: "DELIVERED_NO_VIEW", recoveryAction: "SEND_REMINDER", automatic: true };
    return { ...base, status: "HEALTHY", stalledReason: "NONE", recoveryAction: "NONE", automatic: false };
  }

  private async requireToken(scope: TenantScoped, id: string, context: ClaimLifecycleServiceContext): Promise<MarketplaceClaimTokenRecord> { const token = await this.deps.claimTokens.findById(scope, id); if (token === null) throw new ClaimLifecycleServiceError({ code: "SERVICE_NOT_FOUND", message: "Claim invitation not found", status: 404, correlation: context.correlation }); assertTenantScope(scope, token); return token; }
  private async requireCapture(scope: TenantScoped, id: string, context: ClaimLifecycleServiceContext): Promise<MarketplaceCaptureRecord> { const capture = await this.deps.marketplaceCaptures.findById(scope, id); if (capture === null) throw new ClaimLifecycleServiceError({ code: "SERVICE_NOT_FOUND", message: "Marketplace capture not found", status: 404, correlation: context.correlation }); assertTenantScope(scope, capture); return capture; }
  private async appendActivity(context: ClaimLifecycleServiceContext, capture: MarketplaceCaptureRecord, note: string, occurredAt: string, metadata: Readonly<Record<string, unknown>>): Promise<void> {
    if (this.deps.activities === undefined || capture.dealId == null || context.actorId === undefined) return;
    await this.deps.activities.create({ ...tenantScope(context), actorId: context.actorId, correlation: context.correlation }, {
      tenantId: context.tenantId,
      contactId: capture.contactId ?? null,
      dealId: capture.dealId,
      createdById: context.actorId,
      type: "NOTE",
      note,
      occurredAt,
      metadata,
    });
  }

  private async audit(context: ClaimLifecycleServiceContext, action: string, targetId: string, metadata: Readonly<Record<string, unknown>>): Promise<void> { await this.deps.auditLogs.append(tenantScope(context), { tenantId: context.tenantId, action, targetType: "MARKETPLACE_CLAIM_TOKEN", targetId, correlationId: context.correlation.correlationId, requestId: context.correlation.requestId, metadata }); }
}
