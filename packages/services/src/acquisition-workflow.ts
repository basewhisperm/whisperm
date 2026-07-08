/**
 * ST1-013D — canonical acquisition workflow orchestration.
 *
 * This module is the single source of truth for "where is this seller in the
 * Golden Path, and what should happen next." No page, card, or panel should
 * invent its own stage label, next-action wording, or blocker copy — they all
 * call through here.
 *
 * Database state -> resolveAcquisitionWorkflowStage -> canonical stage -> UI.
 */

export const ACQUISITION_WORKFLOW_STAGES = [
  "DISCOVERY",
  "CAPTURED",
  "REVIEW",
  "PHONE_READY",
  "INVITATION_READY",
  "INVITATION_SENT",
  "WAITING_CLAIM",
  "CLAIMED",
  "READY_CONVERSION",
  "CONVERTED",
] as const;

export type AcquisitionWorkflowStage = typeof ACQUISITION_WORKFLOW_STAGES[number];

export type AcquisitionWorkflowCaptureStatus = "CAPTURED" | "INVITED" | "CLAIM_STARTED" | "CLAIMED" | "CONVERTED" | "EXPIRED";
export type AcquisitionWorkflowInvitationStatus = "PENDING" | "SENT" | "FAILED" | "OPENED" | "EXPIRED";
export type WorkflowActionPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type WorkflowBlockerSeverity = "info" | "warning" | "blocking";

/**
 * Normalized signals a seller's workflow stage is derived from. Callers build
 * this from whatever database rows they have (MarketplaceCapture,
 * DraftInventory, SellerInvitation, MarketplaceClaimToken,
 * MarketplaceOwnershipAttestation, RenderConversion) -- the resolver never
 * looks at raw DB enums directly, so this shape is the only coupling point.
 */
export interface AcquisitionWorkflowSignals {
  /** True when the seller exists only as a pre-capture discovered lead. */
  readonly discovered?: boolean | undefined;
  readonly captureStatus?: AcquisitionWorkflowCaptureStatus | undefined;
  readonly hasDraftInventory: boolean;
  readonly hasPhone: boolean;
  readonly invitationStatus?: AcquisitionWorkflowInvitationStatus | undefined;
  readonly hasOwnershipAttestation: boolean;
  readonly hasSellerConversion: boolean;
  readonly hasInventoryConversion: boolean;
}

export interface WorkflowNextAction {
  readonly label: string;
  readonly action: string;
  readonly priority: WorkflowActionPriority;
}

export interface WorkflowBlocker {
  readonly reason: string;
  readonly severity: WorkflowBlockerSeverity;
}

const STAGE_ORDER: Readonly<Record<AcquisitionWorkflowStage, number>> = Object.fromEntries(
  ACQUISITION_WORKFLOW_STAGES.map((stage, index) => [stage, index]),
) as Record<AcquisitionWorkflowStage, number>;

const laterStage = (a: AcquisitionWorkflowStage, b: AcquisitionWorkflowStage): AcquisitionWorkflowStage =>
  STAGE_ORDER[a] >= STAGE_ORDER[b] ? a : b;

/** The stage implied by capture status alone -- floors, never lowers, the resolved stage. */
const captureStatusFloor = (status: AcquisitionWorkflowCaptureStatus | undefined): AcquisitionWorkflowStage | null => {
  switch (status) {
    case "INVITED": return "INVITATION_SENT";
    case "CLAIM_STARTED": return "WAITING_CLAIM";
    case "CLAIMED": return "CLAIMED";
    case "CONVERTED": return "CONVERTED";
    default: return null;
  }
};

// Evaluated most-advanced-first: once a seller has reached a claim or
// conversion milestone, that milestone wins even if an earlier, no-longer-
// relevant sub-signal (e.g. an invitation that is still marked "OPENED")
// would otherwise imply an earlier stage.
const naturalStage = (signals: AcquisitionWorkflowSignals): AcquisitionWorkflowStage => {
  if (signals.hasSellerConversion && signals.hasInventoryConversion) return "CONVERTED";
  if (signals.hasSellerConversion) return "READY_CONVERSION";
  if (signals.hasOwnershipAttestation) return "CLAIMED";
  if (signals.discovered === true && signals.captureStatus === undefined) return "DISCOVERY";
  if (!signals.hasDraftInventory) return "CAPTURED";
  if (!signals.hasPhone) return "REVIEW";
  if (signals.invitationStatus === undefined) return "PHONE_READY";
  if (signals.invitationStatus === "PENDING" || signals.invitationStatus === "FAILED") return "INVITATION_READY";
  if (signals.invitationStatus === "SENT") return "INVITATION_SENT";
  return "WAITING_CLAIM";
};

/**
 * Resolves the single canonical stage for a seller. State machine integrity:
 * capture status acts as a floor so the resolved stage can never regress
 * behind a transition the database has already recorded (e.g. a stale or
 * missing sub-signal can never make a CLAIMED capture render as REVIEW).
 */
export const resolveAcquisitionWorkflowStage = (signals: AcquisitionWorkflowSignals): AcquisitionWorkflowStage => {
  const natural = naturalStage(signals);
  const floor = captureStatusFloor(signals.captureStatus);
  return floor === null ? natural : laterStage(natural, floor);
};

const NEXT_ACTIONS: Readonly<Record<AcquisitionWorkflowStage, WorkflowNextAction>> = {
  DISCOVERY: { label: "Run Discovery", action: "RUN_DISCOVERY", priority: "NORMAL" },
  CAPTURED: { label: "Review Seller", action: "REVIEW_SELLER", priority: "NORMAL" },
  REVIEW: { label: "Verify Contact", action: "VERIFY_CONTACT", priority: "HIGH" },
  PHONE_READY: { label: "Queue Invitation", action: "QUEUE_INVITATION", priority: "NORMAL" },
  INVITATION_READY: { label: "Send Invitation", action: "SEND_INVITATION", priority: "HIGH" },
  INVITATION_SENT: { label: "Monitor Claim", action: "MONITOR_CLAIM", priority: "LOW" },
  WAITING_CLAIM: { label: "Monitor Claim", action: "MONITOR_CLAIM", priority: "NORMAL" },
  CLAIMED: { label: "Convert Seller", action: "CONVERT_SELLER", priority: "HIGH" },
  READY_CONVERSION: { label: "Convert Inventory", action: "CONVERT_INVENTORY", priority: "HIGH" },
  CONVERTED: { label: "Open CRM Contact", action: "OPEN_CRM_CONTACT", priority: "LOW" },
};

/** The one canonical next action for a stage. No page invents its own wording. */
export const getNextWorkflowAction = (stage: AcquisitionWorkflowStage): WorkflowNextAction => NEXT_ACTIONS[stage];

/**
 * Explains every reason progress is blocked or stalled for the given
 * signals. Every disabled action in the UI should be able to point at one of
 * these -- an operator should never have to guess why they can't continue.
 */
export const getWorkflowBlockers = (signals: AcquisitionWorkflowSignals): readonly WorkflowBlocker[] => {
  const blockers: WorkflowBlocker[] = [];

  if (signals.captureStatus === "EXPIRED") {
    blockers.push({ reason: "Marketplace capture expired before the seller completed the workflow", severity: "blocking" });
  }
  if (!signals.hasPhone && signals.discovered !== true) {
    blockers.push({ reason: "Missing phone number", severity: "warning" });
  }
  if (signals.hasPhone && !signals.hasDraftInventory && signals.captureStatus !== undefined) {
    blockers.push({ reason: "Draft inventory not yet created", severity: "warning" });
  }
  if (signals.invitationStatus === "FAILED") {
    blockers.push({ reason: "Invitation delivery failed and needs a retry", severity: "blocking" });
  }
  if (signals.invitationStatus === "PENDING") {
    blockers.push({ reason: "Invitation already pending", severity: "info" });
  }
  if (signals.invitationStatus === "EXPIRED" && !signals.hasOwnershipAttestation) {
    blockers.push({ reason: "Claim link expired before the seller completed the claim", severity: "blocking" });
  }
  // Integrity guard: these combinations should be structurally impossible: an
  // inventory conversion cannot exist without a seller conversion, and a
  // seller conversion cannot exist without a completed claim. Surface them as
  // explicit recovery states instead of silently rendering a wrong stage.
  if (signals.hasInventoryConversion && !signals.hasSellerConversion) {
    blockers.push({ reason: "Inventory conversion recorded without a seller conversion — needs manual review", severity: "blocking" });
  }
  if (signals.hasSellerConversion && !signals.hasOwnershipAttestation) {
    blockers.push({ reason: "Seller conversion recorded without a completed claim — needs manual review", severity: "blocking" });
  }

  return blockers;
};

// ---------------------------------------------------------------------------
// Progress visualization grouping (10 canonical stages collapsed into the 7
// Golden Path nodes shown by workflow-progress.tsx).
// ---------------------------------------------------------------------------

export interface AcquisitionWorkflowProgressNode {
  readonly id: string;
  readonly label: string;
  readonly stages: readonly AcquisitionWorkflowStage[];
}

export const ACQUISITION_WORKFLOW_PROGRESS_NODES: readonly AcquisitionWorkflowProgressNode[] = [
  { id: "discovery", label: "Discovery", stages: ["DISCOVERY"] },
  { id: "captured", label: "Captured", stages: ["CAPTURED"] },
  { id: "review", label: "Review", stages: ["REVIEW"] },
  { id: "phone-ready", label: "Phone Ready", stages: ["PHONE_READY"] },
  { id: "invitation", label: "Invitation", stages: ["INVITATION_READY", "INVITATION_SENT"] },
  { id: "claim", label: "Claim", stages: ["WAITING_CLAIM", "CLAIMED"] },
  { id: "conversion", label: "Conversion", stages: ["READY_CONVERSION", "CONVERTED"] },
];

// ---------------------------------------------------------------------------
// Campaign-level workflow (the "Campaign" and "Configure Targeting" nodes of
// the Golden Path sit above any individual seller).
// ---------------------------------------------------------------------------

export type CampaignWorkflowStage = "CONFIGURE_TARGETING" | "READY_FOR_DISCOVERY" | "SELLERS_CAPTURED";

export interface CampaignWorkflowSignals {
  readonly targetingReady: boolean;
  readonly memberCount: number;
}

export const resolveCampaignWorkflowStage = (signals: CampaignWorkflowSignals): CampaignWorkflowStage => {
  if (!signals.targetingReady) return "CONFIGURE_TARGETING";
  if (signals.memberCount <= 0) return "READY_FOR_DISCOVERY";
  return "SELLERS_CAPTURED";
};

const CAMPAIGN_NEXT_ACTIONS: Readonly<Record<CampaignWorkflowStage, WorkflowNextAction>> = {
  CONFIGURE_TARGETING: { label: "Configure Targeting", action: "CONFIGURE_TARGETING", priority: "HIGH" },
  READY_FOR_DISCOVERY: { label: "Run Discovery", action: "RUN_DISCOVERY", priority: "NORMAL" },
  SELLERS_CAPTURED: { label: "Open Workbench", action: "OPEN_WORKBENCH", priority: "NORMAL" },
};

export const getNextCampaignWorkflowAction = (stage: CampaignWorkflowStage): WorkflowNextAction => CAMPAIGN_NEXT_ACTIONS[stage];

const CAMPAIGN_STAGE_LABELS: Readonly<Record<CampaignWorkflowStage, string>> = {
  CONFIGURE_TARGETING: "Needs Targeting",
  READY_FOR_DISCOVERY: "Ready For Discovery",
  SELLERS_CAPTURED: "Review Sellers",
};

export const getCampaignWorkflowStageLabel = (stage: CampaignWorkflowStage): string => CAMPAIGN_STAGE_LABELS[stage];

export const getCampaignWorkflowBlockers = (signals: CampaignWorkflowSignals): readonly WorkflowBlocker[] =>
  signals.targetingReady ? [] : [{ reason: "Campaign targeting incomplete", severity: "blocking" }];

// ---------------------------------------------------------------------------
// Canonical CTA vocabulary. Every primary action button in the acquisition
// experience must render one of these labels -- no "New Record", "Open",
// "Go", "Continue", or "Manage".
// ---------------------------------------------------------------------------

export const ALLOWED_ACQUISITION_CTA_LABELS = [
  "Create Campaign",
  "Configure Targeting",
  "Run Discovery",
  "Review Seller",
  "Verify Contact",
  "Queue Invitation",
  "Send Invitation",
  "Monitor Claim",
  "Convert Seller",
  "Convert Inventory",
  "Open CRM Contact",
  "Open Workbench",
] as const;

export type AllowedAcquisitionCtaLabel = typeof ALLOWED_ACQUISITION_CTA_LABELS[number];
