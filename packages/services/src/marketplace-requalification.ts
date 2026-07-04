import { z } from "zod";

import type {
  AuditLogRepository,
  MarketplaceCaptureRecord,
  MarketplaceCaptureRepository,
  SellerAcquisitionCampaignMemberRecord,
  SellerAcquisitionCampaignRepository,
} from "@whisperm/repositories";
import type { TenantScoped } from "@whisperm/types";
import type {
  CanonicalMarketplaceCaptureContext,
  CanonicalMarketplaceCaptureCrmConversionStatus,
  CanonicalMarketplaceCaptureInput,
  CanonicalMarketplaceCapturePort,
  CanonicalMarketplaceCaptureQualificationStatus,
  CanonicalMarketplaceCaptureResult,
} from "./marketplace-acquisition/discovery-service.js";

export type {
  CanonicalMarketplaceCaptureContext,
  CanonicalMarketplaceCaptureInput,
  CanonicalMarketplaceCapturePort,
  CanonicalMarketplaceCaptureResult,
} from "./marketplace-acquisition/discovery-service.js";

const idSchema = z.string().min(1);
const contextSchema = z
  .object({
    tenantId: idSchema,
    actorId: idSchema.optional(),
    correlation: z.object({ correlationId: idSchema, requestId: idSchema.optional(), causationId: idSchema.optional() }).passthrough(),
  })
  .strict();

export type RequalificationContext = CanonicalMarketplaceCaptureContext;
export type MarketplaceRequalificationQualificationStatus = CanonicalMarketplaceCaptureQualificationStatus;
export type MarketplaceRequalificationCrmConversionStatus = CanonicalMarketplaceCaptureCrmConversionStatus;

export interface RequalifyMarketplaceCaptureResult {
  readonly captureId: string;
  readonly qualificationStatus: MarketplaceRequalificationQualificationStatus;
  readonly crmConversionStatus: MarketplaceRequalificationCrmConversionStatus;
  readonly requalified: boolean;
  readonly invitationEligible: boolean;
  readonly contactId?: string | undefined;
  readonly dealId?: string | undefined;
}

export class MarketplaceRequalificationError extends Error {
  readonly code: "CAPTURE_NOT_FOUND" | "TENANT_ISOLATION_VIOLATION";
  readonly status: number;
  constructor(input: { readonly code: "CAPTURE_NOT_FOUND" | "TENANT_ISOLATION_VIOLATION"; readonly message: string; readonly status: number }) {
    super(input.message);
    this.name = "MarketplaceRequalificationError";
    this.code = input.code;
    this.status = input.status;
  }
}

export interface MarketplaceRequalificationDependencies {
  readonly marketplaceCaptures: Pick<MarketplaceCaptureRepository, "findById">;
  readonly canonicalCapture: CanonicalMarketplaceCapturePort;
  readonly auditLogs: Pick<AuditLogRepository, "append">;
  readonly sellerAcquisitionCampaigns?: Pick<SellerAcquisitionCampaignRepository, "listMembersByCapture" | "updateMember"> | undefined;
}

const metadataText = (metadata: Readonly<Record<string, unknown>> | null | undefined, key: string): string | undefined => {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
};

/**
 * Rebuilds the canonical capture-pipeline input from an already-persisted MarketplaceCapture, the
 * same way discovery promotion rebuilds it from a DiscoveredSellerRecord (buildCanonicalCaptureInput
 * in discovery-service.ts). sellerPhone/sellerEmail/location come from capture.metadata because that
 * is where SellerAcquisitionEditService.editExtract stores enrichment edits.
 */
const buildCanonicalCaptureInput = (capture: MarketplaceCaptureRecord): CanonicalMarketplaceCaptureInput => ({
  tenantId: capture.tenantId,
  listingUrl: capture.listingUrl,
  title: capture.title,
  description: capture.description ?? undefined,
  price: capture.price ?? undefined,
  currency: capture.currency ?? undefined,
  sellerName: capture.sellerName ?? undefined,
  sellerPhone: metadataText(capture.metadata, "sellerPhone") ?? metadataText(capture.metadata, "phone"),
  sellerEmail: metadataText(capture.metadata, "sellerEmail") ?? metadataText(capture.metadata, "email"),
  sellerProfileUrl: capture.sellerProfileUrl ?? undefined,
  marketplaceSourceId: capture.marketplaceSourceId ?? undefined,
  category: metadataText(capture.metadata, "category"),
  location: metadataText(capture.metadata, "location"),
  metadata: capture.metadata ?? undefined,
});

const qualificationOf = (capture: Pick<MarketplaceCaptureRecord, "contactId" | "dealId">): MarketplaceRequalificationQualificationStatus =>
  capture.contactId != null && capture.dealId != null ? "QUALIFIED" : "UNQUALIFIED";

/**
 * ST1-007: completes the acquisition lifecycle for sellers who are captured without a valid
 * communication channel and later enriched with one. Qualification is a state transition, not a
 * one-time event -- this is the single entry point that re-evaluates a MarketplaceCapture whenever
 * qualifying data (phone / WhatsApp) improves, reusing the ST1-004 qualification boundary and the
 * ST1-005/ST1-006 capture-time CRM conversion pipeline rather than forking either.
 */
export class MarketplaceRequalificationService {
  constructor(private readonly deps: MarketplaceRequalificationDependencies) {}

  async requalifyMarketplaceCapture(contextInput: RequalificationContext, captureId: string): Promise<RequalifyMarketplaceCaptureResult> {
    const context = contextSchema.parse(contextInput) as RequalificationContext;
    const scope: TenantScoped = { tenantId: context.tenantId };

    const capture = await this.deps.marketplaceCaptures.findById(scope, captureId);
    if (capture === null) {
      throw new MarketplaceRequalificationError({ code: "CAPTURE_NOT_FOUND", message: "Marketplace capture was not found", status: 404 });
    }
    if (capture.tenantId !== context.tenantId) {
      throw new MarketplaceRequalificationError({ code: "TENANT_ISOLATION_VIOLATION", message: "Marketplace capture tenant mismatch", status: 403 });
    }

    const previousQualification = qualificationOf(capture);

    const result = await this.deps.canonicalCapture.capture(context, buildCanonicalCaptureInput(capture));
    const requalified = previousQualification === "UNQUALIFIED" && result.qualificationStatus === "QUALIFIED";

    if (requalified) {
      await this.refreshCampaignEligibility(scope, capture.id, result);
    }

    await this.deps.auditLogs.append(scope, {
      tenantId: context.tenantId,
      actorId: context.actorId,
      action: "MARKETPLACE_CAPTURE_REQUALIFIED",
      targetType: "MARKETPLACE_CAPTURE",
      targetId: capture.id,
      correlationId: context.correlation.correlationId,
      requestId: context.correlation.requestId,
      metadata: {
        previousQualificationStatus: previousQualification,
        newQualificationStatus: result.qualificationStatus,
        requalified,
        crmConversionStatus: result.crmConversionStatus,
        reason: "SELLER_ENRICHMENT",
      },
    });

    return {
      captureId: capture.id,
      qualificationStatus: result.qualificationStatus,
      crmConversionStatus: result.crmConversionStatus,
      requalified,
      invitationEligible: result.qualificationStatus === "QUALIFIED",
      contactId: result.contactId,
      dealId: result.dealId,
    };
  }

  private async refreshCampaignEligibility(scope: TenantScoped, marketplaceCaptureId: string, result: CanonicalMarketplaceCaptureResult): Promise<void> {
    if (this.deps.sellerAcquisitionCampaigns === undefined) return;
    const members = await this.deps.sellerAcquisitionCampaigns.listMembersByCapture(scope, marketplaceCaptureId);
    for (const member of members) {
      const update = this.membershipRefresh(member, result);
      if (update !== undefined) await this.deps.sellerAcquisitionCampaigns.updateMember(scope, member.id, update);
    }
  }

  private membershipRefresh(
    member: SellerAcquisitionCampaignMemberRecord,
    result: CanonicalMarketplaceCaptureResult,
  ): { readonly contactId?: string; readonly dealId?: string; readonly status?: "QUALIFIED" } | undefined {
    if (member.status === "REMOVED") return undefined;
    const contactId = member.contactId == null && result.contactId !== undefined ? result.contactId : undefined;
    const dealId = member.dealId == null && result.dealId !== undefined ? result.dealId : undefined;
    const status = member.status === "ADDED" ? "QUALIFIED" : undefined;
    if (contactId === undefined && dealId === undefined && status === undefined) return undefined;
    return { ...(contactId === undefined ? {} : { contactId }), ...(dealId === undefined ? {} : { dealId }), ...(status === undefined ? {} : { status }) };
  }
}
