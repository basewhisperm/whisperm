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
export type CaptureConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface SellerAcquisitionPortfolioSummary {
  readonly listingCount: number;
  readonly captureIds: readonly string[];
  readonly draftInventoryIds: readonly string[];
  readonly images: readonly string[];
}

export interface SellerAcquisitionRecord {
  readonly capture: MarketplaceCaptureRecord;
  readonly contact: ContactRecord | null;
  readonly deal: DealDetailRecord | null;
  readonly draftInventory: DraftInventoryRecord | null;
  readonly images: readonly string[];
  readonly portfolio: SellerAcquisitionPortfolioSummary;
  readonly latestInvitation: SellerInvitationRecord | null;
  readonly invitationHistory: readonly SellerInvitationRecord[];
  readonly claimTokenStatus: MarketplaceClaimTokenRecord | null;
  readonly ownershipAttestation: MarketplaceOwnershipAttestationRecord | null;
  readonly sellerConversion: RenderConversionRecord | null;
  readonly inventoryConversion: RenderConversionRecord | null;
  readonly activityTimeline: readonly ActivityRecord[];
  readonly currentStage: string;
  readonly captureConfidence: CaptureConfidence;
  readonly acquisitionScore: number;
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

const resolveLocation = (capture: MarketplaceCaptureRecord): string | null => {
  const metadata = metadataOf(capture);
  return nonEmpty(metadata.location) ?? nonEmpty(metadata.listingLocation);
};

const priceIsPresent = (capture: MarketplaceCaptureRecord, draft: DraftInventoryRecord | null): boolean => {
  const price = draft?.price ?? capture.price;
  return price !== null && price !== undefined && price !== "";
};

export const computeCaptureConfidence = (input: { readonly phonePresent: boolean; readonly imagePresent: boolean; readonly titlePresent: boolean; readonly pricePresent: boolean; readonly locationPresent: boolean }): CaptureConfidence => {
  if (!input.phonePresent) return "LOW";
  if (input.imagePresent && input.titlePresent && input.pricePresent) return "HIGH";
  if (input.titlePresent && (input.imagePresent || input.pricePresent || input.locationPresent)) return "MEDIUM";
  return "LOW";
};

export const computeAcquisitionScore = (input: { readonly phonePresent: boolean; readonly imagePresent: boolean; readonly pricePresent: boolean; readonly titlePresent: boolean; readonly locationPresent: boolean; readonly sourcePresent: boolean }): number => {
  let score = 0;
  if (input.phonePresent) score += 35;
  if (input.imagePresent) score += 20;
  if (input.pricePresent) score += 15;
  if (input.titlePresent) score += 15;
  if (input.locationPresent) score += 10;
  if (input.sourcePresent) score += 5;
  return Math.min(100, score);
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
    const records = await Promise.all(captures.map((capture) => this.buildFromCapture(context, capture)));
    const groups = new Map<string, SellerAcquisitionRecord[]>();

    for (const record of records) {
      const phone = resolvePhone(record.capture, record.contact);
      const groupKey =
        phone === null
          ? record.capture.dealId ?? record.capture.contactId ?? record.capture.sellerProfileUrl ?? `${record.capture.sellerName ?? "unknown"}:${record.capture.marketplaceSourceId ?? "unknown"}`
          : `phone:${phone}`;
      groups.set(groupKey, [...(groups.get(groupKey) ?? []), record]);
    }

    return [...groups.values()].map((group) => {
      const representative = [...group].sort((a, b) => {
        const aScore = (a.isQualifiedSellerLead ? 100 : 0) + (a.images.length > 0 ? 10 : 0);
        const bScore = (b.isQualifiedSellerLead ? 100 : 0) + (b.images.length > 0 ? 10 : 0);
        if (aScore !== bScore) return bScore - aScore;
        return Date.parse(b.capture.createdAt) - Date.parse(a.capture.createdAt);
      })[0];

      if (representative === undefined) {
        throw new Error("Seller acquisition record group unexpectedly empty");
      }

      const images = Array.from(new Set(group.flatMap((record) => record.images)));
      const draftInventoryIds = group
        .map((record) => record.draftInventory?.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);

      return {
        ...representative,
        images: images.length > 0 ? images : representative.images,
        portfolio: {
          listingCount: group.length,
          captureIds: group.map((record) => record.capture.id),
          draftInventoryIds,
          images,
        },
      };
    });
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
      this.deps.renderConversions?.findSuccessfulInventoryConversion(context, capture.id, draftInventory?.id ?? null) ?? Promise.resolve(null),
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
    const images = resolveImages(capture, draftInventory);
    const titlePresent = nonEmpty(draftInventory?.title ?? capture.title) !== null;
    const pricePresent = priceIsPresent(capture, draftInventory);
    const locationPresent = resolveLocation(capture) !== null;
    const sourcePresent = nonEmpty(draftInventory?.marketplaceSource) !== null || nonEmpty(capture.marketplaceSourceId) !== null;
    const confidenceInput = { phonePresent: phone !== null, imagePresent: images.length > 0, titlePresent, pricePresent, locationPresent };
    return {
      capture,
      contact,
      deal,
      draftInventory,
      images,
      portfolio: {
        listingCount: 1,
        captureIds: [capture.id],
        draftInventoryIds: draftInventory?.id === undefined ? [] : [draftInventory.id],
        images,
      },
      latestInvitation,
      invitationHistory,
      claimTokenStatus,
      ownershipAttestation,
      sellerConversion,
      inventoryConversion,
      activityTimeline,
      currentStage: stageFromDeal(deal, capture),
      captureConfidence: computeCaptureConfidence(confidenceInput),
      acquisitionScore: computeAcquisitionScore({ ...confidenceInput, sourcePresent }),
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
