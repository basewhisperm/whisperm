import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import type { ActivityRepository, AuditLogRepository, DealsRepository, DraftInventoryRecord, DraftInventoryRepository, MarketplaceCaptureRecord, MarketplaceCaptureRepository, MarketplaceOwnershipAttestationRepository, PipelineRepository } from "@whisperm/repositories";
import { OWNERSHIP_ATTESTATION_STATEMENT } from "@whisperm/types";
import type { PersistenceCorrelationMetadata, TenantScoped } from "@whisperm/types";


const idSchema = z.string().min(1);
const acceptInputSchema = z.object({
  claimantName: z.string().trim().min(1).max(120).optional(),
  claimantPhone: z.string().trim().min(1).max(64).optional(),
  claimantEmail: z.string().trim().email().optional(),
  marketplaceIdentity: z.string().trim().min(1).max(255).optional(),
  ipAddress: z.string().trim().min(1).max(255).optional(),
  userAgent: z.string().trim().min(1).max(1024).optional(),
  acceptedTerms: z.literal(true)
}).strict();
const statusSchema = z.enum(["PENDING", "SENT", "FAILED", "OPENED", "EXPIRED", "CLAIMED"]);
type TokenStatus = z.output<typeof statusSchema>;

export class SellerClaimPortalError extends Error {
  readonly code: string;
  readonly status: number;
  readonly correlation?: PersistenceCorrelationMetadata | undefined;
  constructor(input: { readonly code: string; readonly message: string; readonly status: number; readonly correlation?: PersistenceCorrelationMetadata | undefined }) {
    super(input.message);
    this.name = "SellerClaimPortalError";
    this.code = input.code;
    this.status = input.status;
    this.correlation = input.correlation;
  }
}

type StageName = "Captured" | "Invited" | "Claim Started" | "Claimed" | "Converted" | "Expired";
const stageStatus: Record<StageName, MarketplaceCaptureRecord["status"]> = { Captured: "CAPTURED", Invited: "INVITED", "Claim Started": "CLAIM_STARTED", Claimed: "CLAIMED", Converted: "CONVERTED", Expired: "EXPIRED" };
const statusStage: Record<string, StageName> = { CAPTURED: "Captured", INVITED: "Invited", CLAIM_STARTED: "Claim Started", CLAIMED: "Claimed", CONVERTED: "Converted", EXPIRED: "Expired" };
const terminal = new Set(["CLAIMED", "CONVERTED", "EXPIRED"]);

export interface ClaimTokenRecord { readonly id: string; readonly tenantId: string; readonly marketplaceCaptureId: string; readonly tokenHash: string; readonly status: TokenStatus; readonly expiresAt: string; readonly claimedAt?: string | null; readonly metadata?: Readonly<Record<string, unknown>> | null; }
export interface ClaimTokenRepository { findByTokenHash(tokenHash: string): Promise<ClaimTokenRecord | null>; update(context: TenantScoped, tokenId: string, input: Partial<Pick<ClaimTokenRecord, "status" | "claimedAt" | "metadata">>): Promise<ClaimTokenRecord>; }
export interface SellerClaimPortalDependencies { readonly claimTokens: ClaimTokenRepository; readonly marketplaceCaptures: MarketplaceCaptureRepository; readonly draftInventories: DraftInventoryRepository; readonly ownershipAttestations: MarketplaceOwnershipAttestationRepository; readonly pipelines: PipelineRepository; readonly deals: DealsRepository; readonly auditLogs: AuditLogRepository; readonly activities: ActivityRepository; readonly clock?: (() => Date) | undefined; }
export interface ClaimPreview { readonly tokenStatus: string; readonly expiresAt: string; readonly capture: { readonly id: string; readonly marketplaceSource: string | null; readonly listingUrl: string }; readonly seller: { readonly name: string | null; readonly phoneMasked: string | null; readonly emailMasked: string | null; readonly location: string | null }; readonly draftInventory: Pick<DraftInventoryRecord, "id" | "title" | "description" | "price" | "currency" | "category" | "images" | "listingUrl" | "marketplaceSource"> | null; readonly currentStage: StageName; }

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
const safeEqual = (left: string, right: string): boolean => { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); };
const maskEmail = (value: unknown): string | null => typeof value === "string" && value.includes("@") ? `${value.slice(0, 1)}***@${value.split("@").at(-1)}` : null;
const maskPhone = (value: unknown): string | null => typeof value === "string" && value.length >= 4 ? `***-***-${value.replace(/\D/gu, "").slice(-4)}` : null;
const stringMeta = (metadata: Readonly<Record<string, unknown>> | null | undefined, key: string): string | null => typeof metadata?.[key] === "string" ? metadata[key] : null;

export class SellerClaimPortalService {
  constructor(private readonly deps: SellerClaimPortalDependencies) {}

  async preview(context: { readonly correlation: PersistenceCorrelationMetadata }, rawToken: string): Promise<ClaimPreview> {
    const token = await this.resolveToken(context.correlation, rawToken);
    const scope = { tenantId: token.tenantId };
    const capture = await this.requireCapture(scope, token, context.correlation);
    const draft = await this.deps.draftInventories.findByMarketplaceCaptureId(scope, capture.id);
    if (this.isExpired(token)) return this.toPreview(token, capture, draft, "EXPIRED");
    if (capture.status === "INVITED") await this.moveStage({ tenantId: token.tenantId, correlation: context.correlation }, capture, "Claim Started", token.id);
    const refreshed = capture.status === "INVITED" ? { ...capture, status: "CLAIM_STARTED" as const } : capture;
    if (token.status === "SENT" || token.status === "PENDING") await this.deps.claimTokens.update(scope, token.id, { status: "OPENED", metadata: { ...(token.metadata ?? {}), openedAt: this.now().toISOString() } });
    return this.toPreview(token, refreshed, draft, token.status);
  }

  async accept(context: { readonly correlation: PersistenceCorrelationMetadata }, rawToken: string, input: unknown): Promise<{ readonly status: "CLAIMED"; readonly captureId: string; readonly draftInventoryId: string | null; readonly attestationId: string | null; readonly claimedAt: string }> {
    const data = acceptInputSchema.parse(input);
    const token = await this.resolveToken(context.correlation, rawToken);
    if (this.isExpired(token) || token.status === "EXPIRED") throw new SellerClaimPortalError({ code: "SERVICE_INVALID_STATE_TRANSITION", message: "Claim invitation is expired", status: 410, correlation: context.correlation });
    const scope = { tenantId: token.tenantId };
    const capture = await this.requireCapture(scope, token, context.correlation);
    if (capture.status === "CLAIMED") return this.claimedResponse(scope, token, capture);
    if (capture.status === "CONVERTED" || capture.status === "EXPIRED") throw new SellerClaimPortalError({ code: "SERVICE_INVALID_STATE_TRANSITION", message: "Marketplace capture cannot be claimed from its current state", status: 422, correlation: context.correlation });
    const draft = await this.deps.draftInventories.findByMarketplaceCaptureId(scope, capture.id);
    if (draft === null) throw new SellerClaimPortalError({ code: "SERVICE_NOT_FOUND", message: "Draft inventory not found", status: 404, correlation: context.correlation });
    const existingAttestation = await this.deps.ownershipAttestations.findByMarketplaceCaptureId(scope, capture.id);
    if (existingAttestation !== null) throw new SellerClaimPortalError({ code: "SERVICE_CONFLICT", message: "Ownership attestation already exists", status: 409, correlation: context.correlation });

    const claimedAt = this.now().toISOString();
    await this.moveStage({ tenantId: token.tenantId, correlation: context.correlation }, capture, "Claimed", token.id);
    await this.deps.claimTokens.update(scope, token.id, { status: "CLAIMED", claimedAt, metadata: { ...(token.metadata ?? {}), claimantName: data.claimantName ?? null, acceptedTerms: true } });
    if (draft.status !== "CLAIMED") await this.deps.draftInventories.update(scope, draft.id, { status: "CLAIMED" });

    const attestation = await this.deps.ownershipAttestations.create(scope, {
      tenantId: token.tenantId,
      marketplaceCaptureId: capture.id,
      draftInventoryId: draft.id,
      contactId: draft.contactId ?? capture.contactId ?? null,
      claimTokenId: token.id,
      invitationId: typeof token.metadata?.invitationId === "string" ? token.metadata.invitationId : null,
      claimantName: data.claimantName ?? capture.sellerName ?? "Seller",
      claimantPhone: data.claimantPhone ?? null,
      claimantEmail: data.claimantEmail ?? null,
      marketplaceIdentity: data.marketplaceIdentity ?? null,
      attestationStatement: OWNERSHIP_ATTESTATION_STATEMENT,
      acceptedTerms: true,
      ipAddress: data.ipAddress ?? null,
      userAgent: data.userAgent ?? null,
      attestedAt: claimedAt,
      evidence: { acceptedTerms: true },
      metadata: {}
    });

    await this.audit({ tenantId: token.tenantId, correlation: context.correlation }, "MARKETPLACE_CLAIM_ACCEPTED", token.id, { marketplaceCaptureId: capture.id, draftInventoryId: draft.id, attestationId: attestation.id });
    await this.appendActivity({ tenantId: token.tenantId, correlation: context.correlation }, capture, "Seller claim accepted", claimedAt, { eventType: "MARKETPLACE_CLAIM_ACCEPTED", marketplaceCaptureId: capture.id, draftInventoryId: draft.id, attestationId: attestation.id, claimTokenId: token.id });
    await this.deps.auditLogs.append(scope, { tenantId: token.tenantId, action: "OWNERSHIP_ATTESTED", targetType: "MARKETPLACE_OWNERSHIP_ATTESTATION", targetId: attestation.id, correlationId: context.correlation.correlationId, requestId: context.correlation.requestId, metadata: { marketplaceCaptureId: capture.id, draftInventoryId: draft.id, attestationId: attestation.id, claimTokenId: token.id } });
    return { status: "CLAIMED", captureId: capture.id, draftInventoryId: draft.id, attestationId: attestation.id, claimedAt };
  }

  private async resolveToken(correlation: PersistenceCorrelationMetadata, rawToken: string): Promise<ClaimTokenRecord> { const clean = idSchema.parse(rawToken); const hash = hashToken(clean); const token = await this.deps.claimTokens.findByTokenHash(hash); if (token === null || !safeEqual(token.tokenHash, hash)) throw new SellerClaimPortalError({ code: "SERVICE_NOT_FOUND", message: "Claim invitation not found", status: 404, correlation }); return token; }
  private async requireCapture(scope: TenantScoped, token: ClaimTokenRecord, correlation: PersistenceCorrelationMetadata): Promise<MarketplaceCaptureRecord> { const capture = await this.deps.marketplaceCaptures.findById(scope, token.marketplaceCaptureId); if (capture === null) throw new SellerClaimPortalError({ code: "SERVICE_NOT_FOUND", message: "Marketplace capture not found", status: 404, correlation }); return capture; }
  private isExpired(token: ClaimTokenRecord): boolean { return token.status === "EXPIRED" || this.now().getTime() >= Date.parse(token.expiresAt); }
  private now(): Date { return this.deps.clock?.() ?? new Date(); }
  private async moveStage(context: { readonly tenantId: string; readonly correlation: PersistenceCorrelationMetadata }, capture: MarketplaceCaptureRecord, stageName: StageName, tokenId: string): Promise<void> { if (capture.dealId == null || terminal.has(capture.status)) return; const currentStage = statusStage[capture.status] ?? "Captured"; if (currentStage === stageName) return; const pipeline = await this.deps.pipelines.findByDefaultKey(context.tenantId, "marketplace_acquisition"); const stage = pipeline?.stages.find((item) => item.name === stageName); if (stage === undefined) throw new SellerClaimPortalError({ code: "SERVICE_CONFLICT", message: `Marketplace Acquisition ${stageName} stage is missing`, status: 409, correlation: context.correlation }); await this.deps.deals.updateStage(context.tenantId, capture.dealId, stage.id); await this.deps.marketplaceCaptures.update({ tenantId: context.tenantId }, capture.id, { status: stageStatus[stageName] }); const action = stageName === "Claim Started" ? "MARKETPLACE_CLAIM_STARTED" : "MARKETPLACE_CLAIM_STAGE_CLAIMED"; await this.audit(context, action, tokenId, { marketplaceCaptureId: capture.id, previousStage: currentStage, currentStage: stageName }); await this.appendActivity(context, capture, stageName === "Claim Started" ? "Seller claim started" : "Seller claim stage claimed", this.now().toISOString(), { eventType: action, marketplaceCaptureId: capture.id, previousStage: currentStage, currentStage: stageName, claimTokenId: tokenId }); }
  private toPreview(token: ClaimTokenRecord, capture: MarketplaceCaptureRecord, draft: DraftInventoryRecord | null, tokenStatus: string): ClaimPreview { const metadata = capture.metadata ?? {}; return { tokenStatus: this.isExpired(token) ? "EXPIRED" : capture.status === "CLAIMED" ? "CLAIMED" : tokenStatus, expiresAt: token.expiresAt, capture: { id: capture.id, marketplaceSource: draft?.marketplaceSource ?? stringMeta(metadata, "marketplaceSource"), listingUrl: capture.listingUrl }, seller: { name: capture.sellerName ?? null, phoneMasked: maskPhone(metadata.sellerPhone), emailMasked: maskEmail(metadata.sellerEmail), location: stringMeta(metadata, "sellerLocation") }, draftInventory: draft === null ? null : { id: draft.id, title: draft.title, description: draft.description, price: draft.price, currency: draft.currency, category: draft.category, images: draft.images, listingUrl: draft.listingUrl, marketplaceSource: draft.marketplaceSource }, currentStage: statusStage[capture.status] ?? "Captured" }; }
  private async claimedResponse(scope: TenantScoped, token: ClaimTokenRecord, capture: MarketplaceCaptureRecord) { const draft = await this.deps.draftInventories.findByMarketplaceCaptureId(scope, capture.id); const attestation = await this.deps.ownershipAttestations.findByMarketplaceCaptureId(scope, capture.id); return { status: "CLAIMED" as const, captureId: capture.id, draftInventoryId: draft?.id ?? null, attestationId: attestation?.id ?? null, claimedAt: token.claimedAt ?? this.now().toISOString() }; }
  private async appendActivity(context: { readonly tenantId: string; readonly correlation: PersistenceCorrelationMetadata }, capture: MarketplaceCaptureRecord, note: string, occurredAt: string, metadata: Readonly<Record<string, unknown>>): Promise<void> {
    // Activity records are deal-scoped in CRM; captures without a deal intentionally have no activity target.
    if (capture.dealId == null) return;
    await this.deps.activities.create({ tenantId: context.tenantId, correlation: context.correlation }, {
      tenantId: context.tenantId,
      contactId: capture.contactId ?? null,
      dealId: capture.dealId,
      createdById: "system",
      type: "NOTE",
      note,
      occurredAt,
      metadata,
    });
  }

  private async audit(context: { readonly tenantId: string; readonly correlation: PersistenceCorrelationMetadata }, action: string, targetId: string, metadata: Readonly<Record<string, unknown>>): Promise<void> { await this.deps.auditLogs.append({ tenantId: context.tenantId }, { tenantId: context.tenantId, action, targetType: "MARKETPLACE_CLAIM_TOKEN", targetId, correlationId: context.correlation.correlationId, requestId: context.correlation.requestId, metadata }); }
}
