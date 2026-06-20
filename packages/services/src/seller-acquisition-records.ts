import type {
  ActivityRecord,
  ContactRecord,
  DealDetailRecord,
  DealsRepository,
  DraftInventoryRecord,
  DraftInventoryRepository,
  MarketplaceCaptureRecord,
  MarketplaceCaptureRepository,
  MarketplaceClaimTokenRecord,
  MarketplaceClaimTokenRepository,
  MarketplaceOwnershipAttestationRecord,
  MarketplaceOwnershipAttestationRepository,
  Page,
  RenderConversionRecord,
  RenderConversionRepository,
  SellerInvitationRecord,
  SellerInvitationRepository,
} from "@whisperm/repositories";
import type { TenantScoped } from "@whisperm/types";

export type SellerAcquisitionHealthStatus = "READY" | "ACTION_REQUIRED" | "BLOCKED" | "EXPIRED" | "COMPLETED";
export type SellerAcquisitionNextAction = "REVEAL_PHONE" | "SEND_INVITATION" | "RETRY_INVITATION" | "WAIT_FOR_CLAIM" | "CONVERT_SELLER" | "CONVERT_INVENTORY" | "COMPLETE_ACQUISITION" | "NONE";
export type SellerAcquisitionMissingRequirement = "PHONE_REQUIRED" | "DRAFT_INVENTORY_REQUIRED" | "CLAIM_REQUIRED" | "SELLER_CONVERSION_REQUIRED" | "INVENTORY_CONVERSION_REQUIRED";

export interface SellerAcquisitionRecord {
  readonly capture: MarketplaceCaptureRecord;
  readonly contact: ContactRecord | null;
  readonly deal: DealDetailRecord | null;
  readonly draftInventory: DraftInventoryRecord | null;
  readonly images: readonly string[];
  readonly latestInvitation: SellerInvitationRecord | null;
  readonly invitationHistory: readonly SellerInvitationRecord[];
  readonly claimTokenStatus: MarketplaceClaimTokenRecord | null;
  readonly ownershipAttestation: MarketplaceOwnershipAttestationRecord | null;
  readonly sellerConversion: RenderConversionRecord | null;
  readonly inventoryConversion: RenderConversionRecord | null;
  readonly activityTimeline: readonly ActivityRecord[];
  readonly currentStage: string;
  readonly healthStatus: SellerAcquisitionHealthStatus;
  readonly nextAction: SellerAcquisitionNextAction;
  readonly missingRequirements: readonly SellerAcquisitionMissingRequirement[];
  readonly isQualifiedSellerLead: boolean;
}

export interface SellerAcquisitionRecordDependencies {
  readonly marketplaceCaptures: MarketplaceCaptureRepository;
  readonly contacts: { findById(context: TenantScoped, id: string): Promise<ContactRecord | null> };
  readonly deals: DealsRepository;
  readonly draftInventories: DraftInventoryRepository;
  readonly sellerInvitations?: SellerInvitationRepository | undefined;
  readonly marketplaceClaimTokens?: MarketplaceClaimTokenRepository | undefined;
  readonly ownershipAttestations?: MarketplaceOwnershipAttestationRepository | undefined;
  readonly renderConversions?: RenderConversionRepository | undefined;
  readonly activities?: { listActivitiesByMarketplaceCaptureId?(context: TenantScoped, marketplaceCaptureId: string): Promise<readonly ActivityRecord[]> } | undefined;
}

type Context = TenantScoped;
type Metadata = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Metadata => typeof value === "object" && value !== null && !Array.isArray(value);
const metadataOf = (capture: MarketplaceCaptureRecord): Metadata => isRecord(capture.metadata) ? capture.metadata : {};
const nonEmpty = (value: unknown): string | null => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const resolvePhone = (capture: MarketplaceCaptureRecord, contact: ContactRecord | null): string | null => {
  const metadata = metadataOf(capture);
  return nonEmpty(contact?.phone) ?? nonEmpty(metadata.sellerPhone) ?? nonEmpty(metadata.phone) ?? nonEmpty(metadata.primaryPhoneNumber);
};

const stringArray = (value: unknown): readonly string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
const resolveImages = (capture: MarketplaceCaptureRecord, draftInventory: DraftInventoryRecord | null): readonly string[] => {
  const draftImages = stringArray(draftInventory?.images);
  if (draftImages.length > 0) return draftImages;
  const metadata = metadataOf(capture);
  const images = stringArray(metadata.images);
  return images.length > 0 ? images : stringArray(metadata.imageUrls);
};

const isExpired = (capture: MarketplaceCaptureRecord, draft: DraftInventoryRecord | null, token: MarketplaceClaimTokenRecord | null): boolean =>
  capture.status === "EXPIRED" || draft?.status === "EXPIRED" || token?.status === "EXPIRED";
const isCompleted = (capture: MarketplaceCaptureRecord): boolean => capture.status === "COMPLETED" || capture.status === "CONVERTED";
const isSentInvitation = (invitation: SellerInvitationRecord | null): boolean => invitation?.status === "SENT" || invitation?.status === "OPENED";

const stageFromCapture = (status: string): string => status;
const stageFromDeal = (deal: DealDetailRecord | null, capture: MarketplaceCaptureRecord): string => {
  const metadata = isRecord(deal?.deal.metadata) ? deal.deal.metadata : {};
  return nonEmpty(metadata.pipelineStageName) ?? nonEmpty(metadata.stageName) ?? deal?.deal.pipelineStageId ?? stageFromCapture(capture.status);
};

export class SellerAcquisitionRecordService {
  constructor(private readonly deps: SellerAcquisitionRecordDependencies) {}

  async list(context: Context): Promise<readonly SellerAcquisitionRecord[]> {
    const page = await this.deps.marketplaceCaptures.list(context, { limit: 100 });
    const captures = [...page.items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return Promise.all(captures.map((capture) => this.buildFromCapture(context, capture)));
  }

  async findByCaptureId(context: Context, captureId: string): Promise<SellerAcquisitionRecord | null> {
    const capture = await this.deps.marketplaceCaptures.findById(context, captureId);
    return capture === null ? null : this.buildFromCapture(context, capture);
  }

  private async buildFromCapture(context: Context, capture: MarketplaceCaptureRecord): Promise<SellerAcquisitionRecord> {
    const [contact, draftInventory, invitationHistory, claimTokens, ownershipAttestation, activityTimeline] = await Promise.all([
      capture.contactId == null ? Promise.resolve(null) : this.deps.contacts.findById(context, capture.contactId),
      this.deps.draftInventories.findByMarketplaceCaptureId(context, capture.id),
      this.deps.sellerInvitations?.listSellerInvitationsByMarketplaceCaptureId?.(context, capture.id) ?? Promise.resolve([]),
      this.deps.marketplaceClaimTokens?.listClaimTokensByMarketplaceCaptureId?.(context, capture.id) ?? Promise.resolve([]),
      this.deps.ownershipAttestations?.findByMarketplaceCaptureId(context, capture.id) ?? Promise.resolve(null),
      this.deps.activities?.listActivitiesByMarketplaceCaptureId?.(context, capture.id) ?? Promise.resolve([]),
    ]);
    const [deal, sellerConversion, inventoryConversion] = await Promise.all([
      capture.dealId == null ? Promise.resolve(null) : this.deps.deals.findDetailById(context.tenantId, capture.dealId),
      this.deps.renderConversions?.findSuccessfulSellerConversion(context, capture.id, capture.contactId ?? null) ?? Promise.resolve(null),
      this.deps.renderConversions?.findSuccessfulInventoryConversion(context, capture.id, capture.externalId ?? null) ?? Promise.resolve(null),
    ]);
    const latestInvitation = invitationHistory[0] ?? null;
    const claimTokenStatus = claimTokens[0] ?? null;
    const phone = resolvePhone(capture, contact);
    const missingRequirements: SellerAcquisitionMissingRequirement[] = [];
    if (phone === null) missingRequirements.push("PHONE_REQUIRED");
    if (draftInventory === null) missingRequirements.push("DRAFT_INVENTORY_REQUIRED");
    if (ownershipAttestation === null) missingRequirements.push("CLAIM_REQUIRED");
    if (sellerConversion === null) missingRequirements.push("SELLER_CONVERSION_REQUIRED");
    if (inventoryConversion === null) missingRequirements.push("INVENTORY_CONVERSION_REQUIRED");
    const decision = this.decide(capture, draftInventory, latestInvitation, claimTokenStatus, ownershipAttestation, sellerConversion, inventoryConversion, phone);
    return {
      capture,
      contact,
      deal,
      draftInventory,
      images: resolveImages(capture, draftInventory),
      latestInvitation,
      invitationHistory,
      claimTokenStatus,
      ownershipAttestation,
      sellerConversion,
      inventoryConversion,
      activityTimeline,
      currentStage: stageFromDeal(deal, capture),
      healthStatus: decision.healthStatus,
      nextAction: decision.nextAction,
      missingRequirements,
      isQualifiedSellerLead: phone !== null,
    };
  }

  private decide(capture: MarketplaceCaptureRecord, draft: DraftInventoryRecord | null, invitation: SellerInvitationRecord | null, token: MarketplaceClaimTokenRecord | null, attestation: MarketplaceOwnershipAttestationRecord | null, sellerConversion: RenderConversionRecord | null, inventoryConversion: RenderConversionRecord | null, phone: string | null): Pick<SellerAcquisitionRecord, "healthStatus" | "nextAction"> {
    if (isExpired(capture, draft, token)) return { healthStatus: "EXPIRED", nextAction: "NONE" };
    if (phone === null) return { healthStatus: "BLOCKED", nextAction: "REVEAL_PHONE" };
    if (invitation?.status === "FAILED") return { healthStatus: "ACTION_REQUIRED", nextAction: "RETRY_INVITATION" };
    if (draft !== null && invitation === null) return { healthStatus: "READY", nextAction: "SEND_INVITATION" };
    if (isSentInvitation(invitation) && attestation === null) return { healthStatus: "READY", nextAction: "WAIT_FOR_CLAIM" };
    if (attestation !== null && sellerConversion === null) return { healthStatus: "READY", nextAction: "CONVERT_SELLER" };
    if (sellerConversion !== null && inventoryConversion === null) return { healthStatus: "READY", nextAction: "CONVERT_INVENTORY" };
    if (sellerConversion !== null && inventoryConversion !== null && !isCompleted(capture)) return { healthStatus: "READY", nextAction: "COMPLETE_ACQUISITION" };
    if (sellerConversion !== null && inventoryConversion !== null && isCompleted(capture)) return { healthStatus: "COMPLETED", nextAction: "NONE" };
    return { healthStatus: "BLOCKED", nextAction: "NONE" };
  }
}
