import { z } from "zod";

import type { DraftInventoryRecord, MarketplaceCaptureRecord } from "@whisperm/repositories";
import { type PersistenceCorrelationMetadata, type TenantScoped, assertTenantScope } from "@whisperm/types";

const idSchema = z.string().min(1);
const reminderTypeSchema = z.enum(["DAY_3", "DAY_6"]);
const claimTokenStatusSchema = z.enum(["PENDING", "SENT", "FAILED", "OPENED", "EXPIRED"]);
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
  readonly jobType: "marketplace.claim.reminder" | "marketplace.claim.expire";
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
  readonly scheduler: ClaimLifecycleSchedulerPort;
  readonly auditLogs: ClaimLifecycleAuditPort;
  readonly clock?: (() => Date) | undefined;
}

const contextSchema = z.object({ tenantId: idSchema, actorId: idSchema.optional(), correlation: z.object({ correlationId: idSchema, requestId: idSchema.optional(), causationId: idSchema.optional() }).passthrough() }).strict();
const tenantScope = (context: ClaimLifecycleServiceContext): TenantScoped => ({ tenantId: context.tenantId });
const terminalCaptureStatuses = new Set(["CLAIMED", "CONVERTED", "EXPIRED"]);
const activeTokenStatuses = new Set<ClaimTokenStatus>(["SENT", "OPENED"]);
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
    return { expired: true };
  }

  private now(): Date { return this.deps.clock?.() ?? new Date(); }
  private job(context: ClaimLifecycleServiceContext, invitationId: string, jobType: ClaimLifecycleScheduleJob["jobType"], runAt: Date, reminderType?: ClaimReminderType): ClaimLifecycleScheduleJob { return { tenantId: context.tenantId, invitationId, jobType, reminderType, runAt: runAt.toISOString(), dedupeKey: `${jobType}:${context.tenantId}:${invitationId}:${reminderType ?? "expire"}`, correlation: context.correlation }; }
  private async requireToken(scope: TenantScoped, id: string, context: ClaimLifecycleServiceContext): Promise<MarketplaceClaimTokenRecord> { const token = await this.deps.claimTokens.findById(scope, id); if (token === null) throw new ClaimLifecycleServiceError({ code: "SERVICE_NOT_FOUND", message: "Claim invitation not found", status: 404, correlation: context.correlation }); assertTenantScope(scope, token); return token; }
  private async requireCapture(scope: TenantScoped, id: string, context: ClaimLifecycleServiceContext): Promise<MarketplaceCaptureRecord> { const capture = await this.deps.marketplaceCaptures.findById(scope, id); if (capture === null) throw new ClaimLifecycleServiceError({ code: "SERVICE_NOT_FOUND", message: "Marketplace capture not found", status: 404, correlation: context.correlation }); assertTenantScope(scope, capture); return capture; }
  private async audit(context: ClaimLifecycleServiceContext, action: string, targetId: string, metadata: Readonly<Record<string, unknown>>): Promise<void> { await this.deps.auditLogs.append(tenantScope(context), { tenantId: context.tenantId, action, targetType: "MARKETPLACE_CLAIM_TOKEN", targetId, correlationId: context.correlation.correlationId, requestId: context.correlation.requestId, metadata }); }
}
