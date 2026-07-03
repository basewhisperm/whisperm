import type { SellerAcquisitionRecord, SellerAcquisitionRecordService } from "./seller-acquisition-records.js";
import type { TenantScoped } from "@whisperm/types";

export type SellerRelationshipEventKind =
  | "DISCOVERY"
  | "QUALIFICATION"
  | "INVITATION"
  | "CLAIM"
  | "CRM"
  | "REVENUE";

export interface SellerRelationshipTimelineEvent {
  readonly id: string;
  readonly occurredAt: string;
  readonly kind: SellerRelationshipEventKind;
  readonly label: string;
  readonly captureId: string;
  readonly campaignId?: string | undefined;
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
}

export interface SellerRelationshipMemory {
  readonly canonicalSellerKey: string;
  readonly captureIds: readonly string[];
  readonly marketplacesSeen: readonly string[];
  readonly campaignIds: readonly string[];
  readonly hasPriorInvitation: boolean;
  readonly hasClaimed: boolean;
  readonly wasPreviouslyDisqualified: boolean;
  readonly hasConverted: boolean;
  readonly hasRevenueAttributed: boolean;
  readonly attributedRevenueAmount?: string | undefined;
  readonly attributedRevenueCurrency?: string | undefined;
  readonly attributionCompleteness?: "COMPLETE" | "PARTIAL" | "FAILED" | undefined;
  readonly historyCompleteness: "COMPLETE" | "PARTIAL";
  readonly timelineGenerationStatus: "SUCCESS" | "PARTIAL";
  readonly timelineGenerationFailures: readonly string[];
  readonly identityResolutionConfidence?: string | undefined;
  readonly timeline: readonly SellerRelationshipTimelineEvent[];
}

export interface SellerRelationshipMemoryServiceDependencies {
  readonly sellerAcquisitionRecords: SellerAcquisitionRecordService;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const date = (value: unknown): string | null => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
const unique = (values: readonly (string | null | undefined)[]): readonly string[] => [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];

const sourceOf = (record: SellerAcquisitionRecord): string => {
  const metadata = isRecord(record.capture.metadata) ? record.capture.metadata : {};
  return text(record.draftInventory?.marketplaceSource) ?? text(metadata.marketplace) ?? text(metadata.sourceMarketplace) ?? text(record.capture.marketplaceSourceId) ?? "Marketplace";
};

export const canonicalSellerKeyForRecord = (record: SellerAcquisitionRecord): string => {
  const metadata = isRecord(record.capture.metadata) ? record.capture.metadata : {};
  const phone = text(record.contact?.phone) ?? text(metadata.sellerPhone) ?? text(metadata.phone) ?? text(metadata.primaryPhoneNumber);
  if (phone !== null) return `phone:${phone.replace(/\D/gu, "")}`;
  if (record.capture.contactId !== null && record.capture.contactId !== undefined) return `contact:${record.capture.contactId}`;
  const profile = text(record.capture.sellerProfileUrl) ?? text(metadata.sellerProfileUrl);
  if (profile !== null) return `profile:${profile.toLowerCase()}`;
  const marketplaceIdentity = text(metadata.marketplaceIdentifier) ?? text(metadata.marketplaceSellerId);
  if (marketplaceIdentity !== null) return `marketplace:${sourceOf(record).toLowerCase()}:${marketplaceIdentity.toLowerCase()}`;
  return `capture:${record.capture.id}`;
};

interface RevenueAttributionSummary {
  readonly attributionStatus: string;
  readonly attributedAt?: string | undefined;
  readonly evaluatedAt?: string | undefined;
  readonly revenueAmount?: string | undefined;
  readonly revenueCurrency?: string | undefined;
  readonly campaignId?: string | undefined;
  readonly marketplaceSource?: string | undefined;
  readonly opportunityId?: string | undefined;
  readonly attributionCompleteness: "COMPLETE" | "PARTIAL" | "FAILED";
}

const revenueAttributionOf = (record: SellerAcquisitionRecord): RevenueAttributionSummary | null => {
  const metadata = isRecord(record.deal?.deal.metadata) ? record.deal.deal.metadata : null;
  const snapshot = metadata !== null && isRecord(metadata.revenueAttribution) ? metadata.revenueAttribution : null;
  if (snapshot === null || typeof snapshot.attributionStatus !== "string" || typeof snapshot.attributionCompleteness !== "string") return null;
  return {
    attributionStatus: snapshot.attributionStatus,
    attributedAt: text(snapshot.attributedAt) ?? undefined,
    evaluatedAt: text(snapshot.evaluatedAt) ?? undefined,
    revenueAmount: text(snapshot.revenueAmount) ?? undefined,
    revenueCurrency: text(snapshot.revenueCurrency) ?? undefined,
    campaignId: text(snapshot.campaignId) ?? undefined,
    marketplaceSource: text(snapshot.marketplaceSource) ?? undefined,
    opportunityId: text(snapshot.opportunityId) ?? undefined,
    attributionCompleteness: snapshot.attributionCompleteness as "COMPLETE" | "PARTIAL" | "FAILED",
  };
};

const campaignIdOf = (record: SellerAcquisitionRecord): string | null => {
  const metadata = isRecord(record.capture.metadata) ? record.capture.metadata : {};
  return text(metadata.campaignId) ?? text(metadata.sellerAcquisitionCampaignId);
};

const qualificationStatusOf = (record: SellerAcquisitionRecord): string | null => {
  const metadata = isRecord(record.capture.metadata) ? record.capture.metadata : {};
  return text(metadata.qualificationStatus) ?? (record.isQualifiedSellerLead ? "QUALIFIED" : "DISQUALIFIED");
};

const timelineForRecord = (record: SellerAcquisitionRecord): readonly SellerRelationshipTimelineEvent[] => {
  const captureId = record.capture.id;
  const campaignId = campaignIdOf(record) ?? undefined;
  const captureMetadata = isRecord(record.capture.metadata) ? record.capture.metadata : {};
  const events: SellerRelationshipTimelineEvent[] = [];
  events.push({ id: `${captureId}:discovered`, occurredAt: record.capture.capturedAt ?? record.capture.createdAt, kind: "DISCOVERY", label: `Discovered on ${sourceOf(record)}`, captureId, campaignId, metadata: { status: record.capture.status, listingUrl: record.capture.listingUrl } });
  events.push({ id: `${captureId}:qualified`, occurredAt: record.capture.updatedAt ?? record.capture.createdAt, kind: "QUALIFICATION", label: qualificationStatusOf(record) === "DISQUALIFIED" ? "Previously disqualified" : "Qualified", captureId, campaignId, metadata: { status: qualificationStatusOf(record), score: record.acquisitionScore } });
  for (const invitation of record.invitationHistory) events.push({ id: `${captureId}:invitation:${invitation.id}`, occurredAt: invitation.createdAt, kind: "INVITATION", label: `${invitation.channel} invitation ${invitation.status.toLowerCase()}`, captureId, campaignId, metadata: { invitationId: invitation.id, channel: invitation.channel, status: invitation.status } });
  if (record.claimTokenStatus !== null) {
    events.push({ id: `${captureId}:claim-token`, occurredAt: date(record.claimTokenStatus.sentAt) ?? date(record.claimTokenStatus.createdAt) ?? record.capture.updatedAt ?? record.capture.createdAt, kind: "CLAIM", label: `Claim ${String(record.claimTokenStatus.status).toLowerCase()}`, captureId, campaignId, metadata: { status: String(record.claimTokenStatus.status) } });
    const metadata = isRecord(record.claimTokenStatus.metadata) ? record.claimTokenStatus.metadata : {};
    const intelligenceAt = date(metadata.claimIntelligenceLastEvaluatedAt);
    if (intelligenceAt !== null) events.push({ id: `${captureId}:claim-intelligence`, occurredAt: intelligenceAt, kind: "CLAIM", label: `Claim intelligence ${text(metadata.claimIntelligence) ?? "evaluated"}`, captureId, campaignId, metadata: { status: text(metadata.claimIntelligence), stalledReason: text(metadata.claimIntelligenceStalledReason), recoveryAction: text(metadata.claimIntelligenceRecoveryAction) } });
    const recoveryAt = date(metadata.claimIntelligenceLastRecoveryAt) ?? date(metadata.claimAbandonedAt);
    if (recoveryAt !== null) events.push({ id: `${captureId}:claim-recovery`, occurredAt: recoveryAt, kind: "CLAIM", label: text(metadata.claimAbandonedAt) !== null ? "Claim abandoned" : "Claim recovery reminder sent", captureId, campaignId, metadata: { action: text(metadata.claimIntelligenceRecoveryAction), status: text(metadata.claimIntelligenceRecoveryActionStatus) } });
  }
  if (record.ownershipAttestation !== null) events.push({ id: `${captureId}:claim-attested`, occurredAt: date((record.ownershipAttestation as { readonly attestedAt?: unknown }).attestedAt) ?? record.capture.updatedAt ?? record.capture.createdAt, kind: "CLAIM", label: "Seller claimed", captureId, campaignId, metadata: { status: "CLAIMED" } });
  if (record.contact !== null) events.push({ id: `${captureId}:crm-contact:${record.contact.id}`, occurredAt: date(record.contact.createdAt) ?? record.capture.createdAt, kind: "CRM", label: "CRM contact created", captureId, campaignId, metadata: { contactId: record.contact.id } });
  if (record.deal !== null) events.push({ id: `${captureId}:crm-deal:${record.deal.deal.id}`, occurredAt: date((record.deal.deal as { readonly createdAt?: unknown }).createdAt) ?? record.capture.createdAt, kind: "CRM", label: "CRM deal created", captureId, campaignId, metadata: { dealId: record.deal.deal.id } });
  const conversionStatus = text(captureMetadata.crmConversionStatus);
  if (conversionStatus === "CONVERTED") events.push({ id: `${captureId}:crm-converted`, occurredAt: date(captureMetadata.crmConversionCompletedAt) ?? record.capture.updatedAt ?? record.capture.createdAt, kind: "CRM", label: "CRM conversion completed", captureId, campaignId, metadata: { status: conversionStatus, contactId: text(captureMetadata.crmConversionContactId), dealId: text(captureMetadata.crmConversionDealId) } });
  if (conversionStatus === "CONVERSION_FAILED" || conversionStatus === "NEEDS_MANUAL_REVIEW") events.push({ id: `${captureId}:crm-conversion-failed`, occurredAt: date(captureMetadata.crmConversionFailedAt) ?? record.capture.updatedAt ?? record.capture.createdAt, kind: "CRM", label: conversionStatus === "NEEDS_MANUAL_REVIEW" ? "CRM conversion needs manual review" : "CRM conversion failed", captureId, campaignId, metadata: { status: conversionStatus, failureCode: text(captureMetadata.crmConversionFailureCode), failureMessage: text(captureMetadata.crmConversionFailureMessage) } });
  if (record.sellerConversion !== null) events.push({ id: `${captureId}:render-seller-converted`, occurredAt: date((record.sellerConversion as { readonly convertedAt?: unknown }).convertedAt) ?? date((record.sellerConversion as { readonly completedAt?: unknown }).completedAt) ?? record.capture.updatedAt ?? record.capture.createdAt, kind: "CRM", label: "Seller converted", captureId, campaignId, metadata: { status: "CONVERTED" } });
  const revenueAttribution = revenueAttributionOf(record);
  if (revenueAttribution !== null) events.push({ id: `${captureId}:revenue-attributed`, occurredAt: revenueAttribution.attributedAt ?? revenueAttribution.evaluatedAt ?? record.capture.updatedAt ?? record.capture.createdAt, kind: "REVENUE", label: `Revenue attributed (${revenueAttribution.attributionCompleteness.toLowerCase()})`, captureId, campaignId: revenueAttribution.campaignId ?? campaignId, metadata: { revenueAmount: revenueAttribution.revenueAmount ?? null, revenueCurrency: revenueAttribution.revenueCurrency ?? null, completeness: revenueAttribution.attributionCompleteness, marketplaceSource: revenueAttribution.marketplaceSource ?? null } });
  return events.sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
};

export const buildSellerRelationshipMemory = (records: readonly SellerAcquisitionRecord[]): SellerRelationshipMemory => {
  const first = records[0];
  const timeline = records.flatMap(timelineForRecord).sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const failures = first === undefined ? ["NO_SELLER_RECORDS"] : [];
  const revenueAttributions = records.flatMap((record) => revenueAttributionOf(record) ?? []);
  const latestRevenueAttribution = revenueAttributions[revenueAttributions.length - 1];
  return {
    canonicalSellerKey: first === undefined ? "seller:unknown" : canonicalSellerKeyForRecord(first),
    captureIds: unique(records.flatMap((record) => record.portfolio?.captureIds ?? [record.capture.id])),
    marketplacesSeen: unique(records.map(sourceOf)),
    campaignIds: unique(records.map(campaignIdOf)),
    hasPriorInvitation: records.some((record) => record.invitationHistory.length > 0),
    hasClaimed: records.some((record) => record.ownershipAttestation !== null || record.claimTokenStatus?.status === "CLAIMED" || record.claimTokenStatus?.status === "ACCEPTED"),
    wasPreviouslyDisqualified: records.some((record) => qualificationStatusOf(record) === "DISQUALIFIED"),
    hasConverted: records.some((record) => record.sellerConversion !== null || record.healthStatus === "COMPLETED"),
    hasRevenueAttributed: revenueAttributions.length > 0,
    attributedRevenueAmount: latestRevenueAttribution?.revenueAmount,
    attributedRevenueCurrency: latestRevenueAttribution?.revenueCurrency,
    attributionCompleteness: latestRevenueAttribution?.attributionCompleteness,
    historyCompleteness: failures.length === 0 ? "COMPLETE" : "PARTIAL",
    timelineGenerationStatus: failures.length === 0 ? "SUCCESS" : "PARTIAL",
    timelineGenerationFailures: failures,
    identityResolutionConfidence: first?.captureConfidence,
    timeline,
  };
};

export class SellerRelationshipMemoryService {
  constructor(private readonly deps: SellerRelationshipMemoryServiceDependencies) {}

  async findByCaptureId(context: TenantScoped, captureId: string): Promise<SellerRelationshipMemory | null> {
    const record = await this.deps.sellerAcquisitionRecords.findByCaptureId(context, captureId);
    if (record === null) return null;
    return buildSellerRelationshipMemory([record]);
  }

  async getRuntimeContextByCaptureId(context: TenantScoped, captureId: string): Promise<Pick<SellerRelationshipMemory, "hasPriorInvitation" | "hasClaimed" | "wasPreviouslyDisqualified" | "hasConverted" | "campaignIds"> | null> {
    const memory = await this.findByCaptureId(context, captureId);
    if (memory === null) return null;
    return {
      hasPriorInvitation: memory.hasPriorInvitation,
      hasClaimed: memory.hasClaimed,
      wasPreviouslyDisqualified: memory.wasPreviouslyDisqualified,
      hasConverted: memory.hasConverted,
      campaignIds: memory.campaignIds,
    };
  }
}
