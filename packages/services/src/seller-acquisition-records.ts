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
  SellerAcquisitionCampaignMemberRecord,
  SellerAcquisitionCampaignRepository,
  MarketplaceOwnershipAttestationRecord,
  MarketplaceOwnershipAttestationRepository,
  PageRequest,
  RenderConversionRecord,
  RenderConversionRepository,
  SellerInvitationRecord,
  SellerInvitationRepository,
} from "@whisperm/repositories";
import type { TenantScoped } from "@whisperm/types";
import { buildSellerRelationshipMemory, type SellerRelationshipMemory } from "./seller-relationship-memory.js";

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
  readonly relationshipMemory?: SellerRelationshipMemory | undefined;
}

export interface SellerAcquisitionRecordPage {
  readonly records: readonly SellerAcquisitionRecord[];
  readonly nextCursor?: string | undefined;
}

export interface SellerAcquisitionRecordDependencies {
  readonly marketplaceCaptures: MarketplaceCaptureRepository;
  readonly sellerAcquisitionCampaigns?: SellerAcquisitionCampaignRepository | undefined;
  readonly contacts: {
    findById(context: TenantScoped, id: string): Promise<ContactRecord | null>;
    findByIds?(context: TenantScoped, ids: readonly string[]): Promise<readonly ContactRecord[]>;
  };
  readonly deals: DealsRepository;
  readonly draftInventories: DraftInventoryRepository;
  readonly sellerInvitations?: SellerInvitationRepository | undefined;
  readonly marketplaceClaimTokens?: MarketplaceClaimTokenRepository | undefined;
  readonly ownershipAttestations?: MarketplaceOwnershipAttestationRepository | undefined;
  readonly renderConversions?: RenderConversionRepository | undefined;
  readonly activities?: {
    listActivitiesByMarketplaceCaptureId?(context: TenantScoped, marketplaceCaptureId: string): Promise<readonly ActivityRecord[]>;
    listActivitiesByMarketplaceCaptureIds?(context: TenantScoped, marketplaceCaptureIds: readonly string[]): Promise<readonly ActivityRecord[]>;
  } | undefined;
}

type Context = TenantScoped;
type Metadata = Readonly<Record<string, unknown>>;

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 100;

const isRecord = (value: unknown): value is Metadata => typeof value === "object" && value !== null && !Array.isArray(value);
const metadataOf = (capture: MarketplaceCaptureRecord): Metadata => isRecord(capture.metadata) ? capture.metadata : {};
const nonEmpty = (value: unknown): string | null => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const normalizeIdentity = (value: unknown): string | null => nonEmpty(value)?.toLowerCase().replace(/\s+/gu, " ") ?? null;

const normalizeUrlIdentity = (value: unknown): string | null => {
  const input = nonEmpty(value);
  if (input === null) return null;
  try {
    const url = new URL(input);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/u, "").toLowerCase();
  } catch {
    return normalizeIdentity(input);
  }
};

const uniqueStrings = (values: readonly (string | null | undefined)[]): readonly string[] =>
  [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];

const limitOf = (page?: PageRequest): number => Math.min(Math.max(page?.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

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
  return nonEmpty(metadata.pipelineStageName) ?? nonEmpty(metadata.stageName) ?? stageFromCapture(capture.status);
};

const captureIdOf = (row: { readonly marketplaceCaptureId?: string | null | undefined; readonly metadata?: unknown }): string | null => {
  if (typeof row.marketplaceCaptureId === "string" && row.marketplaceCaptureId.length > 0) return row.marketplaceCaptureId;
  const metadata = isRecord(row.metadata) ? row.metadata : {};
  return nonEmpty(metadata.marketplaceCaptureId);
};

const byCaptureId = <T extends { readonly marketplaceCaptureId?: string | null | undefined; readonly metadata?: unknown }>(rows: readonly T[]): Map<string, readonly T[]> => {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const captureId = captureIdOf(row);
    if (captureId === null) continue;
    grouped.set(captureId, [...(grouped.get(captureId) ?? []), row]);
  }
  return grouped;
};

const latestByCaptureId = <T extends { readonly marketplaceCaptureId?: string | null | undefined; readonly metadata?: unknown }>(rows: readonly T[]): Map<string, T> => {
  const grouped = byCaptureId(rows);
  return new Map([...grouped.entries()].flatMap(([captureId, group]) => group[0] === undefined ? [] : [[captureId, group[0]] as const]));
};

const successfulConversion = (rows: readonly RenderConversionRecord[], captureId: string, kind: "SELLER" | "INVENTORY", externalId?: string | null): RenderConversionRecord | null =>
  rows.find((row) =>
    row.marketplaceCaptureId === captureId &&
    row.conversionKind === kind &&
    row.status === "SUCCESS" &&
    (kind === "SELLER" || externalId == null || row.externalId === externalId)
  ) ?? null;

const sellerGroupKey = (record: SellerAcquisitionRecord): string => {
  const phone = resolvePhone(record.capture, record.contact);
  if (phone !== null) return `phone:${phone}`;

  const metadata = metadataOf(record.capture);
  const contactName = normalizeIdentity([record.contact?.firstName, record.contact?.lastName].filter(Boolean).join(" "));
  const profile = normalizeUrlIdentity(record.capture.sellerProfileUrl) ?? normalizeUrlIdentity(metadata.sellerProfileUrl);
  const marketplaceIdentity = normalizeIdentity(metadata.marketplaceIdentifier) ?? normalizeIdentity(metadata.marketplaceSellerId);
  const sellerName = normalizeIdentity(record.capture.sellerName) ?? normalizeIdentity(metadata.sellerName) ?? contactName;
  const source = normalizeIdentity(record.capture.marketplaceSourceId) ?? normalizeIdentity(metadata.marketplaceSource) ?? normalizeIdentity(metadata.sourceMarketplace);

  if (record.capture.dealId != null) return `deal:${record.capture.dealId}`;
  if (record.capture.contactId != null) return `contact:${record.capture.contactId}`;
  if (profile !== null) return `profile:${profile}`;
  if (marketplaceIdentity !== null) return `marketplace:${marketplaceIdentity}`;
  if (sellerName !== null && source !== null) return `seller:${source}:${sellerName}`;
  return `capture:${record.capture.id}`;
};

export class SellerAcquisitionRecordService {
  constructor(private readonly deps: SellerAcquisitionRecordDependencies) {}

  async list(context: Context, page?: PageRequest): Promise<SellerAcquisitionRecordPage> {
    const capturePage = page === undefined
      ? await this.deps.marketplaceCaptures.list(context, { limit: 100 })
      : await this.deps.marketplaceCaptures.list(
        context,
        page.cursor === undefined ? { limit: limitOf(page) } : { limit: limitOf(page), cursor: page.cursor },
      );
    const captures = [...capturePage.items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const records = await this.buildFromCaptures(context, captures);
    const groupedRecords = this.groupPortfolio(records);
    return Object.assign([...groupedRecords], {
      records: groupedRecords,
      nextCursor: capturePage.nextCursor,
    });
  }

  async listByCampaignId(context: Context, campaignId: string, page?: PageRequest): Promise<SellerAcquisitionRecordPage> {
    if (this.deps.sellerAcquisitionCampaigns === undefined) {
      return { records: [] };
    }

    const campaign = await this.deps.sellerAcquisitionCampaigns.findById(context, campaignId);
    if (campaign === null) {
      return { records: [] };
    }

    const memberPage = await this.deps.sellerAcquisitionCampaigns.listMembers(context, campaignId, page);
    const captureIds = uniqueStrings(memberPage.items.map((member: SellerAcquisitionCampaignMemberRecord) => member.marketplaceCaptureId));
    const captures = await Promise.all(captureIds.map((captureId) => this.deps.marketplaceCaptures.findById(context, captureId)));
    const records = await this.buildFromCaptures(
      context,
      captures.filter((capture): capture is MarketplaceCaptureRecord => capture !== null),
    );

    return {
      records: this.groupPortfolio(records),
      nextCursor: memberPage.nextCursor,
    };
  }

  async findByCaptureId(context: Context, captureId: string): Promise<SellerAcquisitionRecord | null> {
    const capture = await this.deps.marketplaceCaptures.findById(context, captureId);
    if (capture === null) return null;
    const records = await this.buildFromCaptures(context, [capture]);
    const record = records[0] ?? null;
    return record === null ? null : { ...record, relationshipMemory: buildSellerRelationshipMemory([record]) };
  }

  private async buildFromCaptures(context: Context, captures: readonly MarketplaceCaptureRecord[]): Promise<readonly SellerAcquisitionRecord[]> {
    if (captures.length === 0) return [];

    const captureIds = uniqueStrings(captures.map((capture) => capture.id));
    const contactIds = uniqueStrings(captures.map((capture) => capture.contactId));
    const dealIds = uniqueStrings(captures.map((capture) => capture.dealId));

    const [
      contacts,
      deals,
      drafts,
      invitations,
      claimTokens,
      attestations,
      activities,
    ] = await Promise.all([
      this.loadContacts(context, contactIds),
      this.deps.deals.findDetailsByIds === undefined
        ? Promise.all(dealIds.map((dealId) => this.deps.deals.findDetailById(context.tenantId, dealId))).then((rows) => rows.filter((row): row is DealDetailRecord => row !== null))
        : this.deps.deals.findDetailsByIds(context.tenantId, dealIds),
      this.deps.draftInventories.listByMarketplaceCaptureIds === undefined
        ? Promise.all(captureIds.map((id) => this.deps.draftInventories.findByMarketplaceCaptureId(context, id))).then((rows) => rows.filter((row): row is DraftInventoryRecord => row !== null))
        : this.deps.draftInventories.listByMarketplaceCaptureIds(context, captureIds),
      this.deps.sellerInvitations?.listSellerInvitationsByMarketplaceCaptureIds?.(context, captureIds)
        ?? Promise.all(captureIds.map((id) => this.deps.sellerInvitations?.listSellerInvitationsByMarketplaceCaptureId?.(context, id) ?? Promise.resolve([]))).then((rows) => rows.flat()),
      this.deps.marketplaceClaimTokens?.listClaimTokensByMarketplaceCaptureIds?.(context, captureIds)
        ?? Promise.all(captureIds.map((id) => this.deps.marketplaceClaimTokens?.listClaimTokensByMarketplaceCaptureId?.(context, id) ?? Promise.resolve([]))).then((rows) => rows.flat()),
      this.deps.ownershipAttestations?.listByMarketplaceCaptureIds?.(context, captureIds)
        ?? Promise.all(captureIds.map((id) => this.deps.ownershipAttestations?.findByMarketplaceCaptureId(context, id) ?? Promise.resolve(null))).then((rows) => rows.filter((row): row is MarketplaceOwnershipAttestationRecord => row !== null)),
      this.deps.activities?.listActivitiesByMarketplaceCaptureIds?.(context, captureIds)
        ?? Promise.all(captureIds.map((id) => this.deps.activities?.listActivitiesByMarketplaceCaptureId?.(context, id) ?? Promise.resolve([]))).then((rows) => rows.flat()),
    ]);

    const draftByCaptureId = latestByCaptureId(drafts);
    const conversions = await this.loadConversions(context, captures, draftByCaptureId);

    const contactById = new Map(contacts.map((contact) => [contact.id, contact] as const));
    const dealById = new Map(deals.map((deal) => [deal.deal.id, deal] as const));
    const invitationsByCaptureId = byCaptureId(invitations);
    const claimTokensByCaptureId = byCaptureId(claimTokens);
    const attestationByCaptureId = latestByCaptureId(attestations);
    const activitiesByCaptureId = byCaptureId(activities);
    const conversionsByCaptureId = byCaptureId(conversions);

    return captures.map((capture) => {
      const contact = capture.contactId == null ? null : contactById.get(capture.contactId) ?? null;
      const draftInventory = draftByCaptureId.get(capture.id) ?? null;
      const invitationHistory = invitationsByCaptureId.get(capture.id) ?? [];
      const claimTokenRows = claimTokensByCaptureId.get(capture.id) ?? [];
      const ownershipAttestation = attestationByCaptureId.get(capture.id) ?? null;
      const activityTimeline = activitiesByCaptureId.get(capture.id) ?? [];
      const conversionRows = conversionsByCaptureId.get(capture.id) ?? [];
      const deal = capture.dealId == null ? null : dealById.get(capture.dealId) ?? null;
      const sellerConversion = successfulConversion(conversionRows, capture.id, "SELLER");
      const inventoryConversion = successfulConversion(conversionRows, capture.id, "INVENTORY", draftInventory?.id ?? null);

      return this.buildRecord({
        capture,
        contact,
        deal,
        draftInventory,
        invitationHistory,
        claimTokens: claimTokenRows,
        ownershipAttestation,
        sellerConversion,
        inventoryConversion,
        activityTimeline,
      });
    });
  }

  private async loadContacts(context: Context, contactIds: readonly string[]): Promise<readonly ContactRecord[]> {
    if (contactIds.length === 0) return [];
    if (this.deps.contacts.findByIds !== undefined) return this.deps.contacts.findByIds(context, contactIds);
    const rows = await Promise.all(contactIds.map((id) => this.deps.contacts.findById(context, id)));
    return rows.filter((row): row is ContactRecord => row !== null);
  }

  private async loadConversions(context: Context, captures: readonly MarketplaceCaptureRecord[], draftByCaptureId: Map<string, DraftInventoryRecord>): Promise<readonly RenderConversionRecord[]> {
    if (captures.length === 0 || this.deps.renderConversions === undefined) return [];

    const captureIds = uniqueStrings(captures.map((capture) => capture.id));

    if (this.deps.renderConversions.listRenderConversionsByMarketplaceCaptureIds !== undefined) {
      return this.deps.renderConversions.listRenderConversionsByMarketplaceCaptureIds(context, captureIds);
    }

    if (this.deps.renderConversions.listRenderConversionsByMarketplaceCaptureId !== undefined) {
      const rows = await Promise.all(captureIds.map((id) => this.deps.renderConversions?.listRenderConversionsByMarketplaceCaptureId?.(context, id) ?? Promise.resolve([])));
      const flat = rows.flat();
      if (flat.length > 0) return flat;
    }

    const rows = await Promise.all(captures.flatMap((capture) => [
      this.deps.renderConversions?.findSuccessfulSellerConversion(context, capture.id, capture.contactId ?? null) ?? Promise.resolve(null),
      this.deps.renderConversions?.findSuccessfulInventoryConversion(context, capture.id, draftByCaptureId.get(capture.id)?.id ?? null) ?? Promise.resolve(null),
    ]));

    return rows.filter((row): row is RenderConversionRecord => row !== null);
  }


  private buildRecord(input: {
    readonly capture: MarketplaceCaptureRecord;
    readonly contact: ContactRecord | null;
    readonly deal: DealDetailRecord | null;
    readonly draftInventory: DraftInventoryRecord | null;
    readonly invitationHistory: readonly SellerInvitationRecord[];
    readonly claimTokens: readonly MarketplaceClaimTokenRecord[];
    readonly ownershipAttestation: MarketplaceOwnershipAttestationRecord | null;
    readonly sellerConversion: RenderConversionRecord | null;
    readonly inventoryConversion: RenderConversionRecord | null;
    readonly activityTimeline: readonly ActivityRecord[];
  }): SellerAcquisitionRecord {
    const latestInvitation = input.invitationHistory[0] ?? null;
    const claimTokenStatus = input.claimTokens[0] ?? null;
    const phone = resolvePhone(input.capture, input.contact);
    const missingRequirements: SellerAcquisitionMissingRequirement[] = [];

    if (phone === null) missingRequirements.push("PHONE_REQUIRED");
    if (input.draftInventory === null) missingRequirements.push("DRAFT_INVENTORY_REQUIRED");
    if (input.ownershipAttestation === null) missingRequirements.push("CLAIM_REQUIRED");
    if (input.sellerConversion === null) missingRequirements.push("SELLER_CONVERSION_REQUIRED");
    if (input.inventoryConversion === null) missingRequirements.push("INVENTORY_CONVERSION_REQUIRED");

    const decision = this.decide(input.capture, input.draftInventory, latestInvitation, claimTokenStatus, input.ownershipAttestation, input.sellerConversion, input.inventoryConversion, phone);
    const images = resolveImages(input.capture, input.draftInventory);
    const titlePresent = nonEmpty(input.draftInventory?.title ?? input.capture.title) !== null;
    const pricePresent = priceIsPresent(input.capture, input.draftInventory);
    const locationPresent = resolveLocation(input.capture) !== null;
    const sourcePresent = nonEmpty(input.draftInventory?.marketplaceSource) !== null || nonEmpty(input.capture.marketplaceSourceId) !== null;
    const confidenceInput = { phonePresent: phone !== null, imagePresent: images.length > 0, titlePresent, pricePresent, locationPresent };

    return {
      capture: input.capture,
      contact: input.contact,
      deal: input.deal,
      draftInventory: input.draftInventory,
      images,
      portfolio: {
        listingCount: 1,
        captureIds: [input.capture.id],
        draftInventoryIds: input.draftInventory?.id === undefined ? [] : [input.draftInventory.id],
        images,
      },
      latestInvitation,
      invitationHistory: input.invitationHistory,
      claimTokenStatus,
      ownershipAttestation: input.ownershipAttestation,
      sellerConversion: input.sellerConversion,
      inventoryConversion: input.inventoryConversion,
      activityTimeline: input.activityTimeline,
      currentStage: stageFromDeal(input.deal, input.capture),
      captureConfidence: computeCaptureConfidence(confidenceInput),
      acquisitionScore: computeAcquisitionScore({ ...confidenceInput, sourcePresent }),
      healthStatus: decision.healthStatus,
      nextAction: decision.nextAction,
      missingRequirements,
      isQualifiedSellerLead: phone !== null,
    };
  }

  private groupPortfolio(records: readonly SellerAcquisitionRecord[]): readonly SellerAcquisitionRecord[] {
    const groups = new Map<string, SellerAcquisitionRecord[]>();
    for (const record of records) {
      const groupKey = sellerGroupKey(record);
      groups.set(groupKey, [...(groups.get(groupKey) ?? []), record]);
    }

    return [...groups.values()].map((group) => {
      const representative = [...group].sort((a, b) => {
        const aScore = (a.isQualifiedSellerLead ? 100 : 0) + (a.images.length > 0 ? 10 : 0);
        const bScore = (b.isQualifiedSellerLead ? 100 : 0) + (b.images.length > 0 ? 10 : 0);
        if (aScore !== bScore) return bScore - aScore;
        return Date.parse(b.capture.createdAt) - Date.parse(a.capture.createdAt);
      })[0];

      if (representative === undefined) throw new Error("Seller acquisition record group unexpectedly empty");

      const images = Array.from(new Set(group.flatMap((record) => record.images)));
      const draftInventoryIds = group
        .map((record) => record.draftInventory?.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);

      const relationshipMemory = buildSellerRelationshipMemory(group);

      return {
        ...representative,
        relationshipMemory,
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
