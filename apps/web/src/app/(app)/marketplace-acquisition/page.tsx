"use client";

import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { IconArrowRight, IconBookmark } from "@tabler/icons-react";

import {
  marketplaceAcquisitionRecordsPath,
  type CaptureConfidence,
  type SellerAcquisitionHealthStatus,
  type SellerAcquisitionNextAction,
  type SellerAcquisitionRecord,
} from "@/lib/marketplace-acquisition/records-store";

type QueueBucketId = "all" | "needs-phone" | "needs-invitation" | "invitation-failed" | "waiting-claim" | "convert-seller" | "convert-inventory" | "complete" | "completed" | "expired";

interface QueueBucket {
  readonly id: QueueBucketId;
  readonly label: string;
  readonly matches: (record: SellerAcquisitionRecord) => boolean;
}

interface SellerRollup {
  readonly key: string;
  readonly primary: SellerAcquisitionRecord;
  readonly records: readonly SellerAcquisitionRecord[];
}

const queueBuckets: readonly QueueBucket[] = [
  { id: "needs-phone",       label: "Needs Phone Reveal",           matches: (r) => r.nextAction === "REVEAL_PHONE" },
  { id: "needs-invitation",  label: "Needs Invitation",             matches: (r) => r.nextAction === "SEND_INVITATION" },
  { id: "invitation-failed", label: "Invitation Failed",            matches: (r) => r.nextAction === "RETRY_INVITATION" },
  { id: "waiting-claim",     label: "Waiting For Claim",            matches: (r) => r.nextAction === "WAIT_FOR_CLAIM" },
  { id: "convert-seller",    label: "Ready For Seller Conversion",  matches: (r) => r.nextAction === "CONVERT_SELLER" },
  { id: "convert-inventory", label: "Ready For Inventory Conversion", matches: (r) => r.nextAction === "CONVERT_INVENTORY" },
  { id: "complete",          label: "Ready To Complete",            matches: (r) => r.nextAction === "COMPLETE_ACQUISITION" },
  { id: "completed",         label: "Completed",                    matches: (r) => r.healthStatus === "COMPLETED" },
  { id: "expired",           label: "Expired",                      matches: (r) => r.healthStatus === "EXPIRED" },
];

const nextActionLabels: Record<SellerAcquisitionNextAction, string> = {
  REVEAL_PHONE:         "Reveal Phone",
  SEND_INVITATION:      "Send WhatsApp-first Invite",
  RETRY_INVITATION:     "Retry Invitation",
  WAIT_FOR_CLAIM:       "Waiting for Seller Claim",
  CONVERT_SELLER:       "Convert Seller",
  CONVERT_INVENTORY:    "Convert Inventory",
  COMPLETE_ACQUISITION: "Complete Acquisition",
  NONE:                 "No Action",
};

function metadataText(record: SellerAcquisitionRecord, key: string): string | null {
  const value = record.capture.metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function sellerName(record: SellerAcquisitionRecord): string {
  const contactName = [record.contact?.firstName, record.contact?.lastName].filter(Boolean).join(" ");
  return contactName || record.contact?.company || record.capture.sellerName || metadataText(record, "sellerName") || "Marketplace seller";
}

function phone(record: SellerAcquisitionRecord): string | null {
  return record.contact?.phone ?? metadataText(record, "sellerPhone") ?? metadataText(record, "phone") ?? metadataText(record, "primaryPhoneNumber");
}

function hasPhone(record: SellerAcquisitionRecord): boolean {
  return phone(record) !== null && !record.missingRequirements.includes("PHONE_REQUIRED");
}

function title(record: SellerAcquisitionRecord): string {
  return record.draftInventory?.title ?? record.capture.title ?? "Untitled marketplace listing";
}

function price(record: SellerAcquisitionRecord): string {
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

function source(record: SellerAcquisitionRecord): string {
  return record.draftInventory?.marketplaceSource ?? metadataText(record, "marketplace") ?? metadataText(record, "source") ?? record.capture.marketplaceSourceId ?? "Marketplace";
}

function location(record: SellerAcquisitionRecord): string | null {
  return metadataText(record, "location") ?? metadataText(record, "listingLocation");
}

function ageFrom(dateValue?: string | null): string | null {
  if (!dateValue) return null;
  const elapsed = Date.now() - Date.parse(dateValue);
  if (!Number.isFinite(elapsed) || elapsed < 0) return null;
  const minutes = Math.max(1, Math.floor(elapsed / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function capturedAge(record: SellerAcquisitionRecord): string {
  return ageFrom(record.capture.capturedAt ?? record.capture.createdAt) ?? "Captured age unavailable";
}

function confidence(record: SellerAcquisitionRecord): CaptureConfidence {
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

function acquisitionScore(record: SellerAcquisitionRecord): number {
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

function slaCopy(record: SellerAcquisitionRecord): string {
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

function listingCount(record: SellerAcquisitionRecord): number {
  return Math.max(1, record.portfolio?.listingCount ?? 1);
}

function sellerRollupKey(record: SellerAcquisitionRecord): string {
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

function rollupRecords(records: readonly SellerAcquisitionRecord[]): readonly SellerRollup[] {
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

function rollupListingCount(rollup: SellerRollup): number {
  return Math.max(
    rollup.records.length,
    ...rollup.records.map((record) => listingCount(record)),
  );
}

function rollupListingTitles(rollup: SellerRollup): readonly string[] {
  return [...new Set(rollup.records.map(title).filter((value) => value.trim().length > 0))].slice(0, 4);
}

function rollupPriceSummary(rollup: SellerRollup): string {
  const values = [...new Set(rollup.records.map(price).filter((value) => value !== "Price missing"))];
  if (values.length === 0) return "Price missing";
  if (values.length === 1) return values[0] ?? "Price missing";
  return `${values[0]} + ${values.length - 1} more price${values.length === 2 ? "" : "s"}`;
}

function hasPrice(record: SellerAcquisitionRecord): boolean {
  const rawPrice = record.draftInventory?.price ?? record.capture.price;
  return rawPrice !== null && rawPrice !== undefined && rawPrice !== "" && !(typeof rawPrice === "string" && rawPrice.includes("[object"));
}

function readinessChecks(record: SellerAcquisitionRecord): readonly { readonly label: string; readonly passed: boolean }[] {
  return [
    { label: "Mobile number", passed: hasPhone(record) },
    { label: "Seller name", passed: sellerName(record) !== "Marketplace seller" },
    { label: "Listing title", passed: title(record) !== "Untitled marketplace listing" },
    { label: "Price", passed: hasPrice(record) },
    { label: "Images", passed: record.images.length > 0 },
  ];
}

function readinessScore(record: SellerAcquisitionRecord): number {
  return readinessChecks(record).reduce((score, item) => score + (item.passed ? 20 : 0), 0);
}

function readinessStatus(record: SellerAcquisitionRecord): "READY" | "REVIEW" | "BLOCKED" {
  if (!hasPhone(record)) return "BLOCKED";
  return readinessScore(record) >= 80 ? "READY" : "REVIEW";
}

function qualityIssues(record: SellerAcquisitionRecord): readonly string[] {
  return readinessChecks(record).filter((item) => !item.passed).map((item) => `${item.label} missing`);
}

function nextActionReason(record: SellerAcquisitionRecord): string {
  if (!hasPhone(record)) return "Mobile number is required before invitation.";
  if (record.nextAction === "SEND_INVITATION") return "Seller has a mobile number and is ready for WhatsApp-first invitation.";
  if (record.nextAction === "WAIT_FOR_CLAIM") return "Invitation has been sent. Waiting for seller claim.";
  if (record.nextAction === "RETRY_INVITATION") return "Latest invitation failed and should be retried.";
  if (record.nextAction === "CONVERT_SELLER") return "Seller claim is ready for Render seller conversion.";
  if (record.nextAction === "CONVERT_INVENTORY") return "Seller exists in Render. Inventory is ready for conversion.";
  if (record.nextAction === "COMPLETE_ACQUISITION") return "Seller and inventory are converted. Complete the acquisition.";
  return "No operator action is currently required.";
}

function timelineItems(record: SellerAcquisitionRecord): readonly { readonly label: string; readonly done: boolean }[] {
  return [
    { label: "Captured", done: true },
    { label: "Contact", done: record.contact !== null },
    { label: "Deal", done: record.deal !== null },
    { label: "Draft inventory", done: record.draftInventory !== null },
    { label: "Invited", done: record.latestInvitation !== null },
    { label: "Completed", done: record.healthStatus === "COMPLETED" },
  ];
}

function sellerTimelineItems(records: readonly SellerAcquisitionRecord[]): readonly { readonly label: string; readonly done: boolean }[] {
  const hasInvitation = records.some((r) => r.latestInvitation !== null);
  const hasClaim = records.some((r) => r.claimTokenStatus?.status === "CLAIMED" || r.claimTokenStatus?.status === "ACCEPTED");
  const sellerConverted = records.some((r) => r.sellerConversion !== null);
  const inventoryConverted = records.some((r) => r.inventoryConversion !== null);
  const completed = records.some((r) => r.healthStatus === "COMPLETED");

  return [
    { label: "Marketplace captured", done: true },
    { label: "Contact created", done: records.some((r) => r.contact !== null) },
    { label: "Deal created", done: records.some((r) => r.deal !== null) },
    { label: "Draft inventory created", done: records.some((r) => r.draftInventory !== null) },
    { label: "Invitation sent", done: hasInvitation },
    { label: "Seller claimed", done: hasClaim },
    { label: "Seller converted", done: sellerConverted },
    { label: "Inventory converted", done: inventoryConverted },
    { label: "Acquisition completed", done: completed },
  ];
}

function searchText(record: SellerAcquisitionRecord): string {
  return [sellerName(record), record.contact?.phone, title(record), source(record), record.capture.id, ...(record.portfolio?.captureIds ?? [])]
    .filter(Boolean).join(" ").toLowerCase();
}

function badgeTone(value: string): string {
  if (["BLOCKED", "LOW", "EXPIRED"].includes(value)) return "text-red-700 bg-red-50";
  if (["ACTION_REQUIRED", "MEDIUM"].includes(value)) return "text-amber-700 bg-amber-50";
  return "text-emerald-700 bg-emerald-50";
}

function isActionEnabled(record: SellerAcquisitionRecord): boolean {
  return ["SEND_INVITATION", "RETRY_INVITATION", "CONVERT_SELLER", "CONVERT_INVENTORY", "COMPLETE_ACQUISITION"]
    .includes(record.nextAction) && hasPhone(record);
}

function errorMessageFromPayload(payload: unknown): string | null {
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

async function fetchSellerAcquisitionRecords(): Promise<readonly SellerAcquisitionRecord[]> {
  const response = await fetch(marketplaceAcquisitionRecordsPath);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorMessageFromPayload(payload) ?? "Marketplace Sellers records could not be loaded.");
  return (payload as { readonly data?: { readonly records?: readonly SellerAcquisitionRecord[] } }).data?.records ?? [];
}

async function runPrimaryAction(record: SellerAcquisitionRecord): Promise<void> {
  const paths: Partial<Record<SellerAcquisitionNextAction, string>> = {
    SEND_INVITATION:      `/api/marketplace-acquisition/captures/${record.capture.id}/invite`,
    RETRY_INVITATION:     `/api/marketplace-acquisition/captures/${record.capture.id}/invite`,
    CONVERT_SELLER:       `/api/marketplace-acquisition/captures/${record.capture.id}/convert/render-seller`,
    CONVERT_INVENTORY:    `/api/marketplace-acquisition/captures/${record.capture.id}/convert/render-inventory`,
    COMPLETE_ACQUISITION: `/api/marketplace-acquisition/captures/${record.capture.id}/complete`,
  };
  const path = paths[record.nextAction];
  if (!path) throw new Error("This Marketplace Sellers action is not available.");
  const response = await fetch(path, { method: "POST" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorMessageFromPayload(payload) ?? "Marketplace Sellers action failed.");
}

// ---------------------------------------------------------------------------
// Edit extract helpers
// ---------------------------------------------------------------------------

interface EditFields {
  title:       string;
  sellerName:  string;
  sellerPhone: string;
  priceText:   string;
  currency:    string;
  description: string;
  location:    string;
  category:    string;
}

function editFieldsFromRecord(record: SellerAcquisitionRecord): EditFields {
  return {
    title:       title(record),
    sellerName:  record.capture.sellerName ?? sellerName(record),
    sellerPhone: phone(record) ?? "",
    priceText:   String(record.draftInventory?.price ?? record.capture.price ?? ""),
    currency:    record.draftInventory?.currency ?? record.capture.currency ?? "",
    description: record.draftInventory?.description ?? record.capture.description ?? "",
    location:    location(record) ?? "",
    category:    record.draftInventory?.category ?? "",
  };
}

const EDIT_FIELD_CONFIG: readonly { key: keyof EditFields; label: string; placeholder: string }[] = [
  { key: "title",       label: "Title",       placeholder: "Listing title" },
  { key: "sellerName",  label: "Seller name", placeholder: "Seller name" },
  { key: "sellerPhone", label: "Phone",       placeholder: "+233..." },
  { key: "priceText",   label: "Price",       placeholder: "GH₵ 250,000" },
  { key: "currency",    label: "Currency",    placeholder: "GHS" },
  { key: "description", label: "Description", placeholder: "Optional description" },
  { key: "location",    label: "Location",    placeholder: "Spintex, Accra" },
  { key: "category",    label: "Category",    placeholder: "Vehicles" },
];

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function MarketplaceAcquisitionPage() {
  const [records, setRecords] = useState<readonly SellerAcquisitionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null);
  const [selectedBulkIds, setSelectedBulkIds] = useState<readonly string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [queueFilter, setQueueFilter] = useState<QueueBucketId>("all");
  const [healthFilter, setHealthFilter] = useState("all");
  const [nextActionFilter, setNextActionFilter] = useState("all");
  const [confidenceFilter, setConfidenceFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const refreshRecords = useCallback(async () => {
    const nextRecords = await fetchSellerAcquisitionRecords();
    setRecords(nextRecords);
    setSelectedCaptureId((current) => current ?? nextRecords[0]?.capture.id ?? null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchSellerAcquisitionRecords()
      .then((nextRecords) => {
        if (!cancelled) {
          setRecords(nextRecords);
          setSelectedCaptureId(nextRecords[0]?.capture.id ?? null);
          setLoading(false);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setActionError(error instanceof Error ? error.message : "Marketplace Sellers records could not be loaded.");
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  const filteredRecords = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const bucket = queueBuckets.find((item) => item.id === queueFilter);
    return records.filter((record) => {
      if (bucket && !bucket.matches(record)) return false;
      if (healthFilter !== "all" && record.healthStatus !== healthFilter) return false;
      if (nextActionFilter !== "all" && record.nextAction !== nextActionFilter) return false;
      if (confidenceFilter !== "all" && confidence(record) !== confidenceFilter) return false;
      if (stageFilter !== "all" && record.currentStage !== stageFilter) return false;
      return query.length === 0 || searchText(record).includes(query);
    });
  }, [records, queueFilter, healthFilter, nextActionFilter, confidenceFilter, stageFilter, searchQuery]);

  const selectedRecord = filteredRecords.find((r) => r.capture.id === selectedCaptureId) ?? filteredRecords[0] ?? null;
  const filteredRollups = rollupRecords(filteredRecords);
  const selectedRollup = selectedRecord === null
    ? null
    : filteredRollups.find((rollup) => rollup.records.some((record) => record.capture.id === selectedRecord.capture.id)) ?? null;
  const visibleQueueGroups = queueBuckets
    .map((bucket) => ({ bucket, rollups: filteredRollups.filter((rollup) => rollup.records.some(bucket.matches)) }))
    .filter((group) => queueFilter === "all" ? group.rollups.length > 0 : group.bucket.id === queueFilter);
  const ungroupedVisibleRollups = queueFilter === "all"
    ? filteredRollups.filter((rollup) => !queueBuckets.some((bucket) => rollup.records.some(bucket.matches)))
    : [];
  const bulkEligibleRecords = filteredRecords.filter((record) =>
    ["SEND_INVITATION", "RETRY_INVITATION"].includes(record.nextAction) && hasPhone(record)
  );
  const selectedBulkRecords = bulkEligibleRecords.filter((record) => selectedBulkIds.includes(record.capture.id));
  const allEligibleSelected = bulkEligibleRecords.length > 0 && selectedBulkRecords.length === bulkEligibleRecords.length;
  const stages = [...new Set(records.map((r) => r.currentStage).filter(Boolean))];

  const toggleBulkRecord = useCallback((captureId: string) => {
    setSelectedBulkIds((current) =>
      current.includes(captureId) ? current.filter((id) => id !== captureId) : [...current, captureId],
    );
  }, []);

  const toggleBulkRollup = useCallback((recordsToToggle: readonly SellerAcquisitionRecord[]) => {
    const eligibleIds = recordsToToggle
      .filter((record) => ["SEND_INVITATION", "RETRY_INVITATION"].includes(record.nextAction) && hasPhone(record))
      .map((record) => record.capture.id);

    if (eligibleIds.length === 0) return;

    setSelectedBulkIds((current) => {
      const allSelected = eligibleIds.every((id) => current.includes(id));
      return allSelected
        ? current.filter((id) => !eligibleIds.includes(id))
        : [...new Set([...current, ...eligibleIds])];
    });
  }, []);

  const toggleAllEligible = useCallback(() => {
    setSelectedBulkIds(allEligibleSelected ? [] : bulkEligibleRecords.map((record) => record.capture.id));
  }, [allEligibleSelected, bulkEligibleRecords]);

  const runBulkInvites = useCallback(async () => {
    if (selectedBulkRecords.length === 0) return;
    setBulkBusy(true);
    setActionError(null);
    const failures: string[] = [];

    for (const record of selectedBulkRecords) {
      try {
        await runPrimaryAction(record);
      } catch (error) {
        failures.push(`${sellerName(record)}: ${error instanceof Error ? error.message : "Invite failed"}`);
      }
    }

    await refreshRecords();
    setSelectedBulkIds([]);

    if (failures.length > 0) {
      setActionError(`${failures.length} invite${failures.length === 1 ? "" : "s"} failed. ${failures.slice(0, 3).join(" · ")}`);
    }

    setBulkBusy(false);
  }, [refreshRecords, selectedBulkRecords]);

  // Patch a single updated record into the local list without a full reload
  const patchRecord = useCallback((updated: SellerAcquisitionRecord) => {
    setRecords((prev) => prev.map((r) => r.capture.id === updated.capture.id ? updated : r));
  }, []);

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 rounded-2xl bg-background p-5 sm:flex-row sm:items-center sm:justify-between" style={{ border: "0.5px solid var(--color-border)" }}>
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Seller Acquisition</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Marketplace Sellers</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Capture, qualify, invite, claim, and convert marketplace sellers into Render sellers.</p>
          <p className="mt-3 max-w-3xl text-xs leading-5 text-muted-foreground">Captured sellers are CRM contacts for this workspace, but they remain in the Seller Acquisition lifecycle until engaged, claimed, or manually qualified.</p>
        </div>
        <Link className="inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pulse" href="/marketplace-acquisition/capture" style={{ background: "var(--color-whisper)" }}>
          + Capture Seller
          <IconArrowRight aria-hidden="true" className="size-4" stroke={1.8} />
        </Link>
      </section>

      <section className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }}>
        <h2 className="text-sm font-semibold text-foreground">Mobile and WhatsApp qualification</h2>
        <div className="mt-3 grid gap-2 text-sm text-muted-foreground md:grid-cols-4">
          <p>Mobile required</p>
          <p>WhatsApp will be attempted first</p>
          <p>SMS is fallback</p>
          <p>Email is optional for non-cellphone-first markets</p>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-9" aria-label="Action queue">
        {queueBuckets.map((bucket) => {
          const count = records.filter(bucket.matches).length;
          return (
            <button key={bucket.id} className={`rounded-2xl bg-background p-4 text-left transition hover:opacity-90 ${queueFilter === bucket.id ? "ring-2 ring-pulse" : ""}`} onClick={() => setQueueFilter(bucket.id)} style={{ border: "0.5px solid var(--color-border)" }} type="button">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{bucket.label}</p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{count}</p>
              <p className="mt-1 text-xs text-muted-foreground">Oldest pending when available</p>
            </button>
          );
        })}
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <div className="grid gap-2 rounded-2xl bg-background p-4 md:grid-cols-5" style={{ border: "0.5px solid var(--color-border)" }}>
            <input aria-label="Search marketplace sellers" className="h-10 rounded-xl bg-secondary px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-pulse md:col-span-5" placeholder="Search by seller, contact, phone, title, marketplace, or capture id" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
            <Filter label="Queue"       value={queueFilter}       onChange={(value) => setQueueFilter(value as QueueBucketId)} options={["all", ...queueBuckets.map((b) => b.id)]} />
            <Filter label="Health"      value={healthFilter}      onChange={setHealthFilter}      options={["all", "READY", "ACTION_REQUIRED", "BLOCKED", "COMPLETED", "EXPIRED"]} />
            <Filter label="Next Action" value={nextActionFilter}  onChange={setNextActionFilter}  options={["all", ...Object.keys(nextActionLabels)]} />
            <Filter label="Confidence"  value={confidenceFilter}  onChange={setConfidenceFilter}  options={["all", "HIGH", "MEDIUM", "LOW"]} />
            <Filter label="Stage"       value={stageFilter}       onChange={setStageFilter}       options={["all", ...stages]} />
          </div>

          <div className="flex flex-col gap-3 rounded-2xl bg-background p-4 sm:flex-row sm:items-center sm:justify-between" style={{ border: "0.5px solid var(--color-border)" }}>
            <div>
              <p className="text-sm font-semibold text-foreground">Bulk invitation queue</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {selectedBulkRecords.length} selected · {bulkEligibleRecords.length} eligible in current view
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="h-10 rounded-xl bg-secondary px-4 text-sm font-semibold text-foreground disabled:opacity-50"
                disabled={bulkEligibleRecords.length === 0 || bulkBusy}
                onClick={toggleAllEligible}
                type="button"
              >
                {allEligibleSelected ? "Clear eligible" : "Select eligible"}
              </button>
              <button
                className="h-10 rounded-xl bg-whisper px-4 text-sm font-semibold text-white disabled:opacity-50"
                disabled={selectedBulkRecords.length === 0 || bulkBusy}
                onClick={runBulkInvites}
                type="button"
              >
                {bulkBusy ? "Sending…" : `Send Invites (${selectedBulkRecords.length})`}
              </button>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading Marketplace Sellers…</p>
          ) : filteredRecords.length === 0 ? (
            <section className="flex flex-col items-center justify-center rounded-2xl bg-background px-6 py-16 text-center" style={{ border: "0.5px solid var(--color-border)" }}>
              <IconBookmark aria-hidden="true" className="size-8 text-muted-foreground" stroke={1.5} />
              <h2 className="mt-4 text-sm font-semibold text-foreground">No marketplace seller records match these filters</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">Use + Capture Seller to add a listing into this command center.</p>
            </section>
          ) : (
            <div className="space-y-4">
              {visibleQueueGroups.map(({ bucket, rollups }) => (
                <section key={bucket.id} className="rounded-2xl bg-background p-4" style={{ border: "0.5px solid var(--color-border)" }}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{bucket.label}</p>
                      <h2 className="mt-1 text-sm font-semibold text-foreground">{rollups.length} seller{rollups.length === 1 ? "" : "s"}</h2>
                    </div>
                    <Badge>{rollups.filter((rollup) => rollup.records.some(hasPhone)).length} phone-ready</Badge>
                  </div>
                  <div className="grid gap-3 xl:grid-cols-2">
                    {rollups.map((rollup) => (
                      <SellerRollupCard
                        key={rollup.key}
                        rollup={rollup}
                        selectedCaptureId={selectedRecord?.capture.id ?? null}
                        selectedBulkIds={selectedBulkIds}
                        bulkEligibleRecords={bulkEligibleRecords}
                        onBulkToggle={() => toggleBulkRollup(rollup.records)}
                        onSelect={() => setSelectedCaptureId(rollup.primary.capture.id)}
                      />
                    ))}
                  </div>
                </section>
              ))}

              {ungroupedVisibleRollups.length > 0 ? (
                <section className="rounded-2xl bg-background p-4" style={{ border: "0.5px solid var(--color-border)" }}>
                  <div className="mb-3">
                    <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Other sellers</p>
                    <h2 className="mt-1 text-sm font-semibold text-foreground">{ungroupedVisibleRollups.length} seller{ungroupedVisibleRollups.length === 1 ? "" : "s"}</h2>
                  </div>
                  <div className="grid gap-3 xl:grid-cols-2">
                    {ungroupedVisibleRollups.map((rollup) => (
                      <SellerRollupCard
                        key={rollup.key}
                        rollup={rollup}
                        selectedCaptureId={selectedRecord?.capture.id ?? null}
                        selectedBulkIds={selectedBulkIds}
                        bulkEligibleRecords={bulkEligibleRecords}
                        onBulkToggle={() => toggleBulkRollup(rollup.records)}
                        onSelect={() => setSelectedCaptureId(rollup.primary.capture.id)}
                      />
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </div>
        <Workbench
          record={selectedRecord}
          rollupRecords={selectedRollup?.records ?? []}
          actionError={actionError}
          onActionError={setActionError}
          onRefresh={refreshRecords}
          onRecordPatched={patchRecord}
        />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Filter({ label, value, options, onChange }: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly string[];
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="text-xs font-medium text-muted-foreground">
      {label}
      <select
        className="mt-1 h-10 w-full rounded-xl bg-secondary px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-pulse"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option === "all" ? `All ${label.toLowerCase()}` : option}
          </option>
        ))}
      </select>
    </label>
  );
}

function Badge({ children, tone }: { readonly children: ReactNode; readonly tone?: string }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone ?? "bg-secondary text-muted-foreground"}`}>
      {children}
    </span>
  );
}

function WorkbenchSection({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-secondary p-4" style={{ border: "0.5px solid var(--color-border)" }}>
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{title}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function CheckLine({ label, passed }: { readonly label: string; readonly passed: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={passed ? "font-semibold text-emerald-700" : "font-semibold text-amber-700"}>{passed ? "✓" : "⚠"}</span>
    </div>
  );
}

function SellerRollupCard({ rollup, selectedCaptureId, selectedBulkIds, bulkEligibleRecords, onBulkToggle, onSelect }: {
  readonly rollup: SellerRollup;
  readonly selectedCaptureId: string | null;
  readonly selectedBulkIds: readonly string[];
  readonly bulkEligibleRecords: readonly SellerAcquisitionRecord[];
  readonly onBulkToggle: () => void;
  readonly onSelect: () => void;
}) {
  const eligibleIds = rollup.records
    .filter((record) => bulkEligibleRecords.some((item) => item.capture.id === record.capture.id))
    .map((record) => record.capture.id);
  const primary = rollup.primary;
  const selected = rollup.records.some((record) => record.capture.id === selectedCaptureId);
  const bulkEligible = eligibleIds.length > 0;
  const bulkSelected = bulkEligible && eligibleIds.every((id) => selectedBulkIds.includes(id));
  const childTitles = rollupListingTitles(rollup);

  return (
    <div className="space-y-2">
      <RecordCard
        record={primary}
        selected={selected}
        bulkSelected={bulkSelected}
        bulkEligible={bulkEligible}
        onBulkToggle={onBulkToggle}
        onSelect={onSelect}
      />
      {rollup.records.length > 1 || childTitles.length > 1 ? (
        <div className="rounded-2xl bg-secondary px-4 py-3 text-xs text-muted-foreground" style={{ border: "0.5px solid var(--color-border)" }}>
          <p className="font-semibold text-foreground">{rollupListingCount(rollup)} listings · {rollupPriceSummary(rollup)}</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {childTitles.map((item) => (
              <li key={item} className="truncate">{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function RecordCard({ record, selected, bulkSelected, bulkEligible, onBulkToggle, onSelect }: {
  readonly record: SellerAcquisitionRecord;
  readonly selected: boolean;
  readonly bulkSelected: boolean;
  readonly bulkEligible: boolean;
  readonly onBulkToggle: () => void;
  readonly onSelect: () => void;
}) {
  const blocked = record.missingRequirements.includes("PHONE_REQUIRED");
  return (
    <button
      className={`rounded-2xl bg-background p-4 text-left transition hover:opacity-90 ${selected ? "ring-2 ring-pulse" : ""}`}
      onClick={onSelect}
      style={{ border: "0.5px solid var(--color-border)" }}
      type="button"
    >
      <div className="flex gap-3">
        <input
          aria-label={`Select ${sellerName(record)} for bulk invite`}
          checked={bulkSelected}
          className="mt-1 size-4 shrink-0"
          disabled={!bulkEligible}
          onChange={onBulkToggle}
          onClick={(event) => event.stopPropagation()}
          type="checkbox"
        />
        <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-secondary text-xs text-muted-foreground">
          {record.images[0] ? <img alt="Captured inventory" className="size-full object-cover" src={record.images[0]} /> : "No image"}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-foreground">{sellerName(record)}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{hasPhone(record) ? phone(record) : "Mobile required"} · {source(record)}{location(record) ? ` · ${location(record)}` : ""}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{listingCount(record)} listing{listingCount(record) === 1 ? "" : "s"} · {title(record)}</p>
          <p className="mt-1 text-xs font-medium text-foreground">{price(record)}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge tone={blocked ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}>
          {blocked ? "BLOCKED" : "PHONE READY"}
        </Badge>
        <Badge>{queueBuckets.find((bucket) => bucket.matches(record))?.label ?? "All Sellers"}</Badge>
        <Badge>{capturedAge(record)}</Badge>
      </div>
      {record.deal?.deal.id ? (
        <Link className="mt-3 inline-block text-xs font-semibold text-whisper" href={`/marketplace-acquisition/${record.deal.deal.id}`}>
          Open detail
        </Link>
      ) : null}
    </button>
  );
}

function Workbench({ record, rollupRecords, actionError, onActionError, onRefresh, onRecordPatched }: {
  readonly record: SellerAcquisitionRecord | null;
  readonly rollupRecords: readonly SellerAcquisitionRecord[];
  readonly actionError: string | null;
  readonly onActionError: (message: string | null) => void;
  readonly onRefresh: () => Promise<void>;
  readonly onRecordPatched: (updated: SellerAcquisitionRecord) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editFields, setEditFields] = useState<EditFields>({
    title: "", sellerName: "", sellerPhone: "", priceText: "",
    currency: "", description: "", location: "", category: "",
  });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Reset edit mode whenever the selected record changes so the form does not
  // carry stale values from a previously-selected card.
  useEffect(() => {
    setEditMode(false);
    setEditError(null);
  }, [record?.capture.id]);

  if (record === null) {
    return (
      <aside className="rounded-2xl bg-background p-5 text-sm text-muted-foreground" style={{ border: "0.5px solid var(--color-border)" }}>
        Select a marketplace seller to triage.
      </aside>
    );
  }

  const blocked = record.missingRequirements.includes("PHONE_REQUIRED");
  const enabled = isActionEnabled(record);
  const sellerRecords = rollupRecords.length > 0 ? rollupRecords : [record];
  const sellerListingTitles = [...new Set(sellerRecords.map(title))].slice(0, 8);
  const sellerImageCount = sellerRecords.reduce((count, item) => count + item.images.length, 0);
  const sellerPhoneReadyCount = sellerRecords.filter(hasPhone).length;
  const sellerLatestInvitation = sellerRecords.find((item) => item.latestInvitation !== null)?.latestInvitation ?? null;

  const openEdit = () => {
    setEditFields(editFieldsFromRecord(record));
    setEditError(null);
    setEditMode(true);
  };

  const saveEdit = async () => {
    setEditSaving(true);
    setEditError(null);
    try {
      // Only send fields that have a non-empty value after trimming.
      const body: Record<string, string> = {};
      for (const { key } of EDIT_FIELD_CONFIG) {
        const val = editFields[key].trim();
        if (val.length > 0) body[key] = val;
      }
      if (Object.keys(body).length === 0) {
        setEditError("No changes to save.");
        return;
      }

      const response = await fetch(
        `/api/marketplace-acquisition/records/${encodeURIComponent(record.capture.id)}`,
        { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      );
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        setEditError(errorMessageFromPayload(result) ?? "Save failed. Please try again.");
        return;
      }

      const updated = (result as { readonly data?: { readonly record?: SellerAcquisitionRecord } }).data?.record;
      if (updated !== undefined) {
        onRecordPatched(updated);
      }
      setEditMode(false);
    } catch {
      setEditError("Save failed. Please try again.");
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <aside className="space-y-4 rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }}>
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Seller dossier</p>
        <h2 className="mt-1 text-lg font-semibold text-foreground">{sellerName(record)}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {hasPhone(record) ? phone(record) : "Mobile required"} · {source(record)} · {sellerRecords.length} capture{sellerRecords.length === 1 ? "" : "s"}
        </p>
      </div>

      <WorkbenchSection title="Seller portfolio">
        <div className="grid gap-2 text-sm text-muted-foreground">
          <p><strong className="text-foreground">Listings:</strong> {sellerListingTitles.length}</p>
          <p><strong className="text-foreground">Phone-ready captures:</strong> {sellerPhoneReadyCount}/{sellerRecords.length}</p>
          <p><strong className="text-foreground">Images captured:</strong> {sellerImageCount}</p>
          <p><strong className="text-foreground">Activity events:</strong> {sellerRecords.reduce((count, item) => count + item.activityTimeline.length, 0)}</p>
          <p><strong className="text-foreground">Latest invitation:</strong> {sellerLatestInvitation ? `${sellerLatestInvitation.channel} ${sellerLatestInvitation.status}` : "No invitation sent"}</p>
        </div>
        {sellerListingTitles.length > 0 ? (
          <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            {sellerListingTitles.map((item) => (
              <li key={item} className="truncate">{item}</li>
            ))}
          </ul>
        ) : null}
      </WorkbenchSection>
        <WorkbenchSection title="Acquisition readiness">
          <div className="space-y-2">
            {readinessChecks(record).map((item) => (
              <CheckLine key={item.label} label={item.label} passed={item.passed} />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Badge tone={badgeTone(readinessStatus(record))}>{readinessStatus(record)}</Badge>
            <Badge>{readinessScore(record)}/100</Badge>
          </div>
        </WorkbenchSection>

        <WorkbenchSection title="Next action">
          <p className="text-base font-semibold text-foreground">{nextActionLabels[record.nextAction]}</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{nextActionReason(record)}</p>
          {blocked ? <p className="mt-2 text-sm font-semibold text-red-700">PHONE_REQUIRED blocks invitation.</p> : null}
        </WorkbenchSection>

        <WorkbenchSection title="Invitation status">
          <p className="text-sm text-muted-foreground">
            {sellerLatestInvitation ? `${sellerLatestInvitation.channel} ${sellerLatestInvitation.status}` : "No invitation sent"}
          </p>
        </WorkbenchSection>

        <WorkbenchSection title="Seller timeline">
          <div className="space-y-2">
            {sellerTimelineItems(sellerRecords).map((item) => (
              <CheckLine key={item.label} label={item.label} passed={item.done} />
            ))}
          </div>
        </WorkbenchSection>

        <WorkbenchSection title="Extract quality issues">
          {qualityIssues(record).length === 0 ? (
            <p className="text-sm font-medium text-emerald-700">No major extract issues detected.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {qualityIssues(record).map((issue) => (
                <Badge key={issue} tone="bg-amber-50 text-amber-700">⚠ {issue}</Badge>
              ))}
            </div>
          )}
          <button
            className="mt-3 h-10 w-full rounded-xl bg-background px-4 text-sm font-semibold text-foreground"
            onClick={openEdit}
            style={{ border: "0.5px solid var(--color-border)" }}
            type="button"
          >
            Edit extract
          </button>
        </WorkbenchSection>

      <button
        className="h-10 w-full rounded-xl bg-whisper px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!enabled || busy}
        onClick={async () => {
          setBusy(true);
          onActionError(null);
          try {
            await runPrimaryAction(record);
            await onRefresh();
            onActionError(null);
          } catch (error) {
            onActionError(error instanceof Error ? error.message : "Marketplace Sellers action failed.");
          } finally {
            setBusy(false);
          }
        }}
        type="button"
      >
        {busy ? "Working…" : nextActionLabels[record.nextAction]}
      </button>

      {actionError ? <p className="text-xs font-semibold text-red-700" role="alert">{actionError}</p> : null}
      {!enabled ? <p className="text-xs text-muted-foreground">This action is disabled because it is either waiting-only, not wired safely in this slice, or blocked by missing mobile.</p> : null}

      {/* Edit extract -------------------------------------------------------- */}
      {editMode ? (
        <div
          className="space-y-3 rounded-2xl bg-secondary p-4"
          style={{ border: "0.5px solid var(--color-border)" }}
        >
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Edit extract</p>

          {EDIT_FIELD_CONFIG.map(({ key, label, placeholder }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-muted-foreground">{label}</label>
              <input
                className="mt-1 h-9 w-full rounded-xl bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pulse"
                style={{ border: "0.5px solid var(--color-border)" }}
                placeholder={placeholder}
                value={editFields[key]}
                onChange={(e) => setEditFields((prev) => ({ ...prev, [key]: e.target.value }))}
                disabled={editSaving}
              />
            </div>
          ))}

          {editError ? <p className="text-xs text-red-600" role="alert">{editError}</p> : null}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              disabled={editSaving}
              onClick={saveEdit}
              className="flex-1 rounded-xl bg-whisper py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {editSaving ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              disabled={editSaving}
              onClick={() => { setEditMode(false); setEditError(null); }}
              className="rounded-xl px-4 py-2 text-sm text-muted-foreground hover:bg-mist disabled:opacity-60"
              style={{ border: "0.5px solid var(--color-border)" }}
            >
              Cancel
            </button>
          </div>
        </div>
        ) : null}
    </aside>
  );
}
