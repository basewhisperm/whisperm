import {
  type CaptureConfidence,
  type SellerAcquisitionHealthStatus,
  type SellerAcquisitionNextAction,
  type SellerAcquisitionRecord,
} from "@/lib/marketplace-acquisition/records-store";

export type QueueBucketId = "all" | "needs_human_review" | "needs-phone" | "needs-invitation" | "invitation-failed" | "waiting-claim" | "convert-seller" | "convert-inventory" | "complete" | "completed" | "expired";

export interface QueueBucket {
  readonly id: QueueBucketId;
  readonly label: string;
  readonly matches: (record: SellerAcquisitionRecord) => boolean;
}

export interface SellerRollup {
  readonly key: string;
  readonly primary: SellerAcquisitionRecord;
  readonly records: readonly SellerAcquisitionRecord[];
}

export const queueBuckets: readonly QueueBucket[] = [
  { id: "needs-phone",       label: "Needs Phone Reveal",                 matches: (r) => r.nextAction === "REVEAL_PHONE" },
  { id: "needs-invitation",  label: "Needs Invitation",             matches: (r) => r.nextAction === "SEND_INVITATION" },
  { id: "invitation-failed", label: "Invitation Failed",               matches: (r) => r.nextAction === "RETRY_INVITATION" },
  { id: "waiting-claim",     label: "Waiting For Claim",               matches: (r) => r.nextAction === "WAIT_FOR_CLAIM" },
  { id: "convert-seller",    label: "Ready For Seller Conversion",              matches: (r) => r.nextAction === "CONVERT_SELLER" },
  { id: "convert-inventory", label: "Ready For Inventory Conversion",           matches: (r) => r.nextAction === "CONVERT_INVENTORY" },
  { id: "complete",          label: "Ready To Complete",                    matches: (r) => r.nextAction === "COMPLETE_ACQUISITION" },
  { id: "completed",         label: "Completed",                    matches: (r) => r.healthStatus === "COMPLETED" },
  { id: "expired",           label: "Expired",                      matches: (r) => r.healthStatus === "EXPIRED" },
];

export const nextActionLabels: Record<SellerAcquisitionNextAction, string> = {
  REVEAL_PHONE:         "Reveal Phone",
  SEND_INVITATION:      "Send WhatsApp-first Invite",
  RETRY_INVITATION:     "Retry Invitation",
  WAIT_FOR_CLAIM:       "Waiting for Seller Claim",
  CONVERT_SELLER:       "Convert Seller",
  CONVERT_INVENTORY:    "Convert Inventory",
  COMPLETE_ACQUISITION: "Complete Acquisition",
  NONE:                 "No Action",
};

export function metadataText(record: SellerAcquisitionRecord, key: string): string | null {
  const value = record.capture.metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function sellerName(record: SellerAcquisitionRecord): string {
  const contactName = [record.contact?.firstName, record.contact?.lastName].filter(Boolean).join(" ");
  return contactName || record.contact?.company || record.capture.sellerName || metadataText(record, "sellerName") || "Marketplace seller";
}

export function phone(record: SellerAcquisitionRecord): string | null {
  return record.contact?.phone ?? metadataText(record, "sellerPhone") ?? metadataText(record, "phone") ?? metadataText(record, "primaryPhoneNumber");
}

export function hasPhone(record: SellerAcquisitionRecord): boolean {
  return phone(record) !== null && !record.missingRequirements.includes("PHONE_REQUIRED");
}

export function title(record: SellerAcquisitionRecord): string {
  return record.draftInventory?.title ?? record.capture.title ?? "Untitled marketplace listing";
}

export function price(record: SellerAcquisitionRecord): string {
  const rawPrice = record.draftInventory?.price ?? record.capture.price;
  if (rawPrice === null || rawPrice === undefined || rawPrice === "") return "Price missing";
  // Safety net for rows captured before the normalizeRecord fix -- those rows
  // may have the literal object-stringification artifact already persisted.
  if (typeof rawPrice === "string" && rawPrice.includes("[object")) return "Price missing";
  // `||` instead of `??` so empty-string currency also falls through to "USD".
  // An empty string is not a valid ISO 4217 code and makes Intl.NumberFormat throw.
  const currency = record.draftInventory?.currency || record.capture.currency || "USD";
  const numericPrice = typeof rawPrice === "number" ? rawPrice : Number(rawPrice);
  if (!Number.isFinite(numericPrice)) return `${currency} ${String(rawPrice)}`;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(numericPrice);
  } catch {
    return `${currency} ${numericPrice}`;
  }
}

export function source(record: SellerAcquisitionRecord): string {
  return record.draftInventory?.marketplaceSource ?? metadataText(record, "marketplace") ?? metadataText(record, "source") ?? record.capture.marketplaceSourceId ?? "Marketplace";
}

export function location(record: SellerAcquisitionRecord): string | null {
  return metadataText(record, "location") ?? metadataText(record, "listingLocation");
}

export function ageFrom(dateValue?: string | null): string | null {
  if (!dateValue) return null;
  const elapsed = Date.now() - Date.parse(dateValue);
  if (!Number.isFinite(elapsed) || elapsed < 0) return null;
  const minutes = Math.max(1, Math.floor(elapsed / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function capturedAge(record: SellerAcquisitionRecord): string {
  return ageFrom(record.capture.capturedAt ?? record.capture.createdAt) ?? "Captured age unavailable";
}

export function confidence(record: SellerAcquisitionRecord): CaptureConfidence {
  if (record.captureConfidence) return record.captureConfidence;
  const phonePresent = hasPhone(record);
  const imagePresent = record.images.length > 0;
  const titlePresent = title(record).trim().length > 0;
  const pricePresent =
    (record.draftInventory?.price ?? record.capture.price) !== null &&
    (record.draftInventory?.price ?? record.capture.price) !== undefined;
  const locationPresent = location(record) !== null;
  if (!phonePresent) return "LOW";
  if (imagePresent && titlePresent && pricePresent) return "HIGH";
  if (titlePresent && (imagePresent || pricePresent || locationPresent)) return "MEDIUM";
  return "LOW";
}

export function acquisitionScore(record: SellerAcquisitionRecord): number {
  if (typeof record.acquisitionScore === "number") return Math.min(100, Math.max(0, Math.round(record.acquisitionScore)));
  let score = 0;
  if (hasPhone(record)) score += 35;
  if (record.images.length > 0) score += 20;
  if ((record.draftInventory?.price ?? record.capture.price) !== null &&
      (record.draftInventory?.price ?? record.capture.price) !== undefined) score += 15;
  if (title(record).trim().length > 0) score += 15;
  if (location(record) !== null) score += 10;
  if (source(record).trim().length > 0) score += 5;
  return Math.min(100, score);
}

export function slaCopy(record: SellerAcquisitionRecord): string {
  if (record.slaStatus) return record.slaStatus;
  if (record.healthStatus === "COMPLETED") return "Completed";
  if (record.healthStatus === "EXPIRED") return "Expired";
  const captured = ageFrom(record.capture.capturedAt ?? record.capture.createdAt);
  const invited  = ageFrom(record.latestInvitation?.createdAt);
  const expires  = record.latestInvitation?.expiresAt ? ageFrom(record.latestInvitation.expiresAt) : null;
  return [
    captured ? `Captured ${captured}` : null,
    invited  ? `Invited ${invited}`   : null,
    expires  ? `Claim expires ${expires}` : null,
  ].filter(Boolean).join(" · ") || "Oldest pending";
}

export function listingCount(record: SellerAcquisitionRecord): number {
  return Math.max(1, record.portfolio?.listingCount ?? 1);
}

export function sellerRollupKey(record: SellerAcquisitionRecord): string {
  const contactId = record.contact?.id;
  if (contactId) return `contact:${contactId}`;

  const phoneValue = phone(record);
  if (phoneValue) return `phone:${phoneValue}`;

  const profileUrl = metadataText(record, "sellerProfileUrl");
  if (profileUrl) return `profile:${profileUrl.toLowerCase()}`;

  const marketplaceIdentifier = metadataText(record, "marketplaceIdentifier");
  if (marketplaceIdentifier) return `marketplace:${source(record).toLowerCase()}:${marketplaceIdentifier.toLowerCase()}`;

  const name = sellerName(record);
  if (name !== "Marketplace seller") return `name:${source(record).toLowerCase()}:${name.toLowerCase()}`;

  return `capture:${record.capture.id}`;
}

export function rollupRecords(records: readonly SellerAcquisitionRecord[]): readonly SellerRollup[] {
  const bySeller = new Map<string, SellerAcquisitionRecord[]>();

  for (const record of records) {
    const key = sellerRollupKey(record);
    const current = bySeller.get(key) ?? [];
    current.push(record);
    bySeller.set(key, current);
  }

  return [...bySeller.entries()].flatMap(([key, grouped]) => {
    const primary = grouped[0];
    if (primary === undefined) return [];
    return [{ key, primary, records: grouped }];
  });
}

export function rollupListingCount(rollup: SellerRollup): number {
  return Math.max(
    rollup.records.length,
    ...rollup.records.map((record) => listingCount(record)),
  );
}

export function rollupListingTitles(rollup: SellerRollup): readonly string[] {
  return [...new Set(rollup.records.map(title).filter((value) => value.trim().length > 0))].slice(0, 4);
}

export function rollupPriceSummary(rollup: SellerRollup): string {
  const values = [...new Set(rollup.records.map(price).filter((value) => value !== "Price missing"))];
  if (values.length === 0) return "Price missing";
  if (values.length === 1) return values[0] ?? "Price missing";
  return `${values[0]} + ${values.length - 1} more price${values.length === 2 ? "" : "s"}`;
}

export function hasPrice(record: SellerAcquisitionRecord): boolean {
  const rawPrice = record.draftInventory?.price ?? record.capture.price;
  return rawPrice !== null && rawPrice !== undefined && rawPrice !== "" && !(typeof rawPrice === "string" && rawPrice.includes("[object"));
}

export function readinessChecks(record: SellerAcquisitionRecord): readonly { readonly label: string; readonly passed: boolean }[] {
  return [
    { label: "Mobile number", passed: hasPhone(record) },
    { label: "Seller name", passed: sellerName(record) !== "Marketplace seller" },
    { label: "Listing title", passed: title(record) !== "Untitled marketplace listing" },
    { label: "Price", passed: hasPrice(record) },
    { label: "Images", passed: record.images.length > 0 },
  ];
}

export function readinessScore(record: SellerAcquisitionRecord): number {
  return readinessChecks(record).reduce((score, item) => score + (item.passed ? 20 : 0), 0);
}

export function readinessStatus(record: SellerAcquisitionRecord): "READY" | "REVIEW" | "BLOCKED" {
  if (!hasPhone(record)) return "BLOCKED";
  return readinessScore(record) >= 80 ? "READY" : "REVIEW";
}

export function qualityIssues(record: SellerAcquisitionRecord): readonly string[] {
  return readinessChecks(record).filter((item) => !item.passed).map((item) => `${item.label} missing`);
}

export function nextActionReason(record: SellerAcquisitionRecord): string {
  if (!hasPhone(record)) return "Mobile number is required before invitation.";
  if (record.nextAction === "SEND_INVITATION") return "Seller has a mobile number and is ready for WhatsApp-first invitation.";
  if (record.nextAction === "WAIT_FOR_CLAIM") return "Invitation has been sent. Waiting for seller claim.";
  if (record.nextAction === "RETRY_INVITATION") return "Latest invitation failed and should be retried.";
  if (record.nextAction === "CONVERT_SELLER") return "Seller claim is ready for Render seller conversion.";
  if (record.nextAction === "CONVERT_INVENTORY") return "Seller exists in Render. Inventory is ready for conversion.";
  if (record.nextAction === "COMPLETE_ACQUISITION") return "Seller and inventory are converted. Complete the acquisition.";
  return "No operator action is currently required.";
}

export function timelineItems(record: SellerAcquisitionRecord): readonly { readonly label: string; readonly done: boolean }[] {
  return [
    { label: "Captured", done: true },
    { label: "Contact", done: record.contact !== null },
    { label: "Deal", done: record.deal !== null },
    { label: "Draft inventory", done: record.draftInventory !== null },
    { label: "Invited", done: record.latestInvitation !== null },
    { label: "Completed", done: record.healthStatus === "COMPLETED" },
  ];
}

export function sellerTimelineItems(records: readonly SellerAcquisitionRecord[]): readonly { readonly label: string; readonly detail: string; readonly done: boolean }[] {
  const captureCount = records.length;
  const contactCount = records.filter((r) => r.contact !== null).length;
  const dealCount = records.filter((r) => r.deal !== null).length;
  const draftCount = records.filter((r) => r.draftInventory !== null).length;
  const invitationCount = records.reduce((count, r) => count + r.invitationHistory.length, 0);
  const claimCount = records.filter((r) => r.ownershipAttestation !== null || r.claimTokenStatus?.status === "CLAIMED" || r.claimTokenStatus?.status === "ACCEPTED").length;
  const sellerConversionCount = records.filter((r) => r.sellerConversion !== null).length;
  const inventoryConversionCount = records.filter((r) => r.inventoryConversion !== null).length;
  const completedCount = records.filter((r) => r.healthStatus === "COMPLETED").length;

  return [
    { label: "Marketplace captured", detail: `${captureCount} capture${captureCount === 1 ? "" : "s"}`, done: captureCount > 0 },
    { label: "CRM contact created", detail: `${contactCount}/${captureCount} linked`, done: contactCount > 0 },
    { label: "Acquisition deal created", detail: `${dealCount}/${captureCount} linked`, done: dealCount > 0 },
    { label: "Draft inventory created", detail: `${draftCount}/${captureCount} draft${draftCount === 1 ? "" : "s"}`, done: draftCount > 0 },
    { label: "Invitation sent", detail: `${invitationCount} attempt${invitationCount === 1 ? "" : "s"}`, done: invitationCount > 0 },
    { label: "Seller claimed", detail: `${claimCount}/${captureCount} claimed`, done: claimCount > 0 },
    { label: "Seller converted", detail: `${sellerConversionCount}/${captureCount} converted`, done: sellerConversionCount > 0 },
    { label: "Inventory converted", detail: `${inventoryConversionCount}/${captureCount} converted`, done: inventoryConversionCount > 0 },
    { label: "Acquisition completed", detail: `${completedCount}/${captureCount} completed`, done: completedCount > 0 },
  ];
}

export function searchText(record: SellerAcquisitionRecord): string {
  return [sellerName(record), record.contact?.phone, title(record), source(record), record.capture.id, ...(record.portfolio?.captureIds ?? [])]
    .filter(Boolean).join(" ").toLowerCase();
}

export function badgeTone(value: string): string {
  if (["BLOCKED", "LOW", "EXPIRED"].includes(value)) return "text-red-700 bg-red-50";
  if (["ACTION_REQUIRED", "MEDIUM"].includes(value)) return "text-amber-700 bg-amber-50";
  return "text-emerald-700 bg-emerald-50";
}

export function isActionEnabled(record: SellerAcquisitionRecord): boolean {
  return ["SEND_INVITATION", "RETRY_INVITATION", "CONVERT_SELLER", "CONVERT_INVENTORY", "COMPLETE_ACQUISITION"]
    .includes(record.nextAction) && hasPhone(record);
}

export function errorMessageFromPayload(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const error = (payload as { readonly error?: unknown }).error;
  if (typeof error === "object" && error !== null &&
      typeof (error as { readonly message?: unknown }).message === "string") {
    return (error as { readonly message: string }).message;
  }
  if (typeof (payload as { readonly message?: unknown }).message === "string") {
    return (payload as { readonly message: string }).message;
  }
  return null;
}
