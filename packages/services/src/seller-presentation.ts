/**
 * ST1-013F — canonical seller card presentation mapper.
 *
 * The Seller Card is the surface operators interact with more than any
 * other in WhispeRM, so it must never assemble display strings ad hoc in
 * JSX (`seller.firstName + " " + seller.lastName`, `price ?? "Price
 * missing"`, `phone || "-"`). This module is the single place that turns a
 * raw seller record into operator-friendly display values. The UI layer
 * (SellerCard and friends) only renders what this module returns.
 *
 * Workflow stage / next action / blockers are not recomputed here -- they
 * are read straight from the ST1-013D canonical resolvers in
 * ./acquisition-workflow.js, so this module can never disagree with the
 * rest of the app about where a seller sits in the Golden Path.
 */

import {
  getNextWorkflowAction,
  getWorkflowBlockers,
  resolveAcquisitionWorkflowStage,
  type AcquisitionWorkflowSignals,
  type AcquisitionWorkflowStage,
  type WorkflowBlocker,
  type WorkflowNextAction,
} from "./acquisition-workflow.js";

// ---------------------------------------------------------------------------
// Input shape -- structural subsets of whatever raw record the caller holds
// (server row, client SellerAcquisitionRecord, or a hand-built test fixture).
// Deliberately does not import SellerAcquisitionRecord from the web app: this
// package has no dependency on Next.js client types, and any object with
// this shape is a valid input.
// ---------------------------------------------------------------------------

export interface SellerPresentationCapture {
  readonly sellerName?: string | null | undefined;
  readonly title?: string | null | undefined;
  readonly price?: number | string | null | undefined;
  readonly currency?: string | null | undefined;
  readonly marketplaceSourceId?: string | null | undefined;
  readonly capturedAt?: string | null | undefined;
  readonly createdAt?: string | null | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | null | undefined;
}

export interface SellerPresentationContact {
  readonly firstName?: string | null | undefined;
  readonly lastName?: string | null | undefined;
  readonly company?: string | null | undefined;
  readonly phone?: string | null | undefined;
}

export interface SellerPresentationDraftInventory {
  readonly title?: string | null | undefined;
  readonly price?: number | string | null | undefined;
  readonly currency?: string | null | undefined;
  readonly marketplaceSource?: string | null | undefined;
  readonly category?: string | null | undefined;
}

export interface SellerPresentationInput {
  readonly capture: SellerPresentationCapture;
  readonly contact?: SellerPresentationContact | null | undefined;
  readonly draftInventory?: SellerPresentationDraftInventory | null | undefined;
  readonly images?: readonly (string | null | undefined)[] | undefined;
  readonly listingCount?: number | undefined;
  /** True when the phone requirement was explicitly flagged unmet upstream (e.g. missingRequirements includes PHONE_REQUIRED), even if a stale phone string is still present. */
  readonly phoneRequired?: boolean | undefined;
  /** ST1-013D workflow signals this card belongs to. See AcquisitionWorkflowSignals for field meaning. */
  readonly workflow: Omit<AcquisitionWorkflowSignals, "hasPhone">;
}

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

export interface SellerThumbnailPresentation {
  /** A well-formed http(s) URL, or null when no usable image exists and the caller should render the placeholder. */
  readonly imageUrl: string | null;
  readonly marketplace: string;
  readonly listingTitle: string;
}

export interface SellerPresentation {
  readonly displayName: string;
  readonly hasPhone: boolean;
  readonly displayPhone: string;
  readonly displayPrice: string;
  readonly displayMarketplace: string;
  readonly displayTitle: string;
  readonly displayLocation: string | null;
  readonly listingCount: number;
  readonly capturedAgeLabel: string;
  readonly thumbnail: SellerThumbnailPresentation;
  readonly workflowStage: AcquisitionWorkflowStage;
  readonly workflowStageLabel: string;
  readonly nextAction: WorkflowNextAction;
  readonly blockers: readonly WorkflowBlocker[];
  readonly primaryBlocker: WorkflowBlocker | null;
  readonly secondaryBlockerCount: number;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const nonEmptyText = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const metadataText = (metadata: SellerPresentationCapture["metadata"], key: string): string | null =>
  nonEmptyText((metadata ?? {})[key]);

/**
 * Presence-based phone resolution. Intentionally mirrors the fallback chain
 * the rest of the acquisition surface already uses (contact phone, then a
 * handful of known capture-metadata keys) so this module's notion of "does
 * this seller have a phone" never disagrees with the workflow resolver.
 */
function resolvePhoneValue(input: SellerPresentationInput): string | null {
  return nonEmptyText(input.contact?.phone)
    ?? metadataText(input.capture.metadata, "sellerPhone")
    ?? metadataText(input.capture.metadata, "phone")
    ?? metadataText(input.capture.metadata, "primaryPhoneNumber");
}

function resolveDisplayName(input: SellerPresentationInput): string {
  const contactName = [input.contact?.firstName, input.contact?.lastName]
    .filter((part): part is string => nonEmptyText(part) !== null)
    .join(" ")
    .trim();
  return nonEmptyText(contactName)
    ?? nonEmptyText(input.contact?.company)
    ?? nonEmptyText(input.capture.sellerName)
    ?? metadataText(input.capture.metadata, "sellerName")
    ?? "Unknown Seller";
}

function resolveDisplayTitle(input: SellerPresentationInput): string {
  return nonEmptyText(input.draftInventory?.title) ?? nonEmptyText(input.capture.title) ?? "Untitled listing";
}

/** Safety net for rows captured before extraction normalization -- some may carry the literal `[object Object]` stringification artifact. */
const isCorruptPrice = (value: unknown): boolean => typeof value === "string" && value.includes("[object");

function resolveDisplayPrice(input: SellerPresentationInput): string {
  const rawPrice = input.draftInventory?.price ?? input.capture.price;
  if (rawPrice === null || rawPrice === undefined || rawPrice === "" || isCorruptPrice(rawPrice)) {
    return "Price unavailable";
  }
  // `||` instead of `??` so an empty-string currency also falls through to "USD" --
  // an empty string is not a valid ISO 4217 code and makes Intl.NumberFormat throw.
  const currency = input.draftInventory?.currency || input.capture.currency || "USD";
  const numericPrice = typeof rawPrice === "number" ? rawPrice : Number(rawPrice);
  if (!Number.isFinite(numericPrice)) return `${currency} ${String(rawPrice)}`;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(numericPrice);
  } catch {
    return `${currency} ${numericPrice}`;
  }
}

function resolveDisplayMarketplace(input: SellerPresentationInput): string {
  return nonEmptyText(input.draftInventory?.marketplaceSource)
    ?? metadataText(input.capture.metadata, "marketplace")
    ?? metadataText(input.capture.metadata, "source")
    ?? nonEmptyText(input.capture.marketplaceSourceId)
    ?? "Marketplace";
}

function resolveDisplayLocation(input: SellerPresentationInput): string | null {
  return metadataText(input.capture.metadata, "location") ?? metadataText(input.capture.metadata, "listingLocation");
}

function resolveThumbnail(input: SellerPresentationInput, marketplace: string, listingTitle: string): SellerThumbnailPresentation {
  const firstUsable = (input.images ?? []).find((src) => typeof src === "string" && /^https?:\/\//iu.test(src.trim()));
  return {
    imageUrl: typeof firstUsable === "string" ? firstUsable.trim() : null,
    marketplace,
    listingTitle,
  };
}

function resolveCapturedAgeLabel(input: SellerPresentationInput): string {
  const dateValue = input.capture.capturedAt ?? input.capture.createdAt;
  if (!dateValue) return "Captured age unavailable";
  const elapsed = Date.now() - Date.parse(dateValue);
  if (!Number.isFinite(elapsed) || elapsed < 0) return "Captured age unavailable";
  const minutes = Math.max(1, Math.floor(elapsed / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const STAGE_LABELS: Readonly<Record<AcquisitionWorkflowStage, string>> = {
  DISCOVERY: "Discovery",
  CAPTURED: "Captured",
  REVIEW: "Needs Review",
  PHONE_READY: "Phone Ready",
  INVITATION_READY: "Invitation Ready",
  INVITATION_SENT: "Invitation Sent",
  WAITING_CLAIM: "Waiting Claim",
  CLAIMED: "Claimed",
  READY_CONVERSION: "Ready For Conversion",
  CONVERTED: "Converted",
};

const BLOCKER_SEVERITY_RANK: Readonly<Record<WorkflowBlocker["severity"], number>> = {
  blocking: 0,
  warning: 1,
  info: 2,
};

/** Highest-severity blocker first, so the card can surface exactly one primary blocker and count the rest. */
function sortBlockersBySeverity(blockers: readonly WorkflowBlocker[]): readonly WorkflowBlocker[] {
  return [...blockers].sort((a, b) => BLOCKER_SEVERITY_RANK[a.severity] - BLOCKER_SEVERITY_RANK[b.severity]);
}

// ---------------------------------------------------------------------------
// The mapper
// ---------------------------------------------------------------------------

/**
 * Maps a raw seller record into operator-friendly display values. Every
 * missing-data case renders an intentional message ("Phone unavailable",
 * "Price unavailable", "Unknown Seller") instead of a blank, a dash, or a
 * broken-looking gap. Called once per record; callers that render many cards
 * at once should memoize the result per record id (see SellerCard).
 */
export function present(input: SellerPresentationInput): SellerPresentation {
  const phoneValue = resolvePhoneValue(input);
  const hasPhone = phoneValue !== null && input.phoneRequired !== true;

  const signals: AcquisitionWorkflowSignals = { ...input.workflow, hasPhone };
  const workflowStage = resolveAcquisitionWorkflowStage(signals);
  const nextAction = getNextWorkflowAction(workflowStage);
  const blockers = sortBlockersBySeverity(getWorkflowBlockers(signals));

  const displayMarketplace = resolveDisplayMarketplace(input);
  const displayTitle = resolveDisplayTitle(input);

  return {
    displayName: resolveDisplayName(input),
    hasPhone,
    // Governed by `hasPhone`, not raw presence: a phone string flagged as
    // still-required upstream (e.g. malformed) must never render as if it
    // were usable.
    displayPhone: hasPhone && phoneValue !== null ? phoneValue : "Phone unavailable",
    displayPrice: resolveDisplayPrice(input),
    displayMarketplace,
    displayTitle,
    displayLocation: resolveDisplayLocation(input),
    listingCount: Math.max(1, input.listingCount ?? 1),
    capturedAgeLabel: resolveCapturedAgeLabel(input),
    thumbnail: resolveThumbnail(input, displayMarketplace, displayTitle),
    workflowStage,
    workflowStageLabel: STAGE_LABELS[workflowStage],
    nextAction,
    blockers,
    primaryBlocker: blockers[0] ?? null,
    secondaryBlockerCount: Math.max(0, blockers.length - 1),
  };
}
