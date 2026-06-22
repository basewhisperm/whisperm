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

function searchText(record: SellerAcquisitionRecord): string {
  return [sellerName(record), record.contact?.phone, title(record), source(record), record.capture.id]
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
  const stages = [...new Set(records.map((r) => r.currentStage).filter(Boolean))];

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

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading Marketplace Sellers…</p>
          ) : filteredRecords.length === 0 ? (
            <section className="flex flex-col items-center justify-center rounded-2xl bg-background px-6 py-16 text-center" style={{ border: "0.5px solid var(--color-border)" }}>
              <IconBookmark aria-hidden="true" className="size-8 text-muted-foreground" stroke={1.5} />
              <h2 className="mt-4 text-sm font-semibold text-foreground">No marketplace seller records match these filters</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">Use + Capture Seller to add a listing into this command center.</p>
            </section>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {filteredRecords.map((record) => (
                <RecordCard
                  key={record.capture.id}
                  record={record}
                  selected={selectedRecord?.capture.id === record.capture.id}
                  onSelect={() => setSelectedCaptureId(record.capture.id)}
                />
              ))}
            </div>
          )}
        </div>
        <Workbench
          record={selectedRecord}
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

function RecordCard({ record, selected, onSelect }: {
  readonly record: SellerAcquisitionRecord;
  readonly selected: boolean;
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
        <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-secondary text-xs text-muted-foreground">
          {record.images[0] ? <img alt="Captured inventory" className="size-full object-cover" src={record.images[0]} /> : "No image"}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-foreground">{title(record)}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{price(record)} · {source(record)}{location(record) ? ` · ${location(record)}` : ""}</p>
          <p className="mt-1 text-xs text-muted-foreground">{sellerName(record)} · {hasPhone(record) ? `Mobile ready: ${phone(record)}` : "Mobile required"}</p>
          <p className="mt-1 text-xs text-muted-foreground">{slaCopy(record)}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {blocked ? <Badge tone="bg-red-50 text-red-700">BLOCKED</Badge> : null}
        <Badge tone={badgeTone(record.healthStatus)}>{record.healthStatus}</Badge>
        <Badge tone={badgeTone(confidence(record))}>Capture Confidence: {confidence(record)}</Badge>
        <Badge>Acquisition Score: {String(acquisitionScore(record))}</Badge>
        <Badge>{record.currentStage}</Badge>
        <Badge>{nextActionLabels[record.nextAction]}</Badge>
      </div>
      {record.deal?.deal.id ? (
        <Link className="mt-3 inline-block text-xs font-semibold text-whisper" href={`/marketplace-acquisition/${record.deal.deal.id}`}>
          Open detail
        </Link>
      ) : null}
    </button>
  );
}

function Workbench({ record, actionError, onActionError, onRefresh, onRecordPatched }: {
  readonly record: SellerAcquisitionRecord | null;
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
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Workbench</p>
        <h2 className="mt-1 text-lg font-semibold text-foreground">{sellerName(record)}</h2>
        <p className="mt-1 text-xs text-muted-foreground">Contact Type: Seller · Source: Marketplace · Lifecycle: Acquisition Prospect</p>
      </div>

      <div className="space-y-2 text-sm text-muted-foreground">
        <p><strong className="text-foreground">Mobile status:</strong> {hasPhone(record) ? `Ready for WhatsApp candidate (${phone(record)})` : "Mobile required"}</p>
        {blocked ? <p className="font-semibold text-red-700">PHONE_REQUIRED blocks invitation. Next action: Reveal Phone.</p> : null}
        <p><strong className="text-foreground">Inventory:</strong> {title(record)} · {price(record)} · {source(record)}</p>
        <p><strong className="text-foreground">Latest invitation:</strong> {record.latestInvitation ? `${record.latestInvitation.channel} ${record.latestInvitation.status}` : "No invitation sent"}</p>
        <p><strong className="text-foreground">Current stage:</strong> {record.currentStage}</p>
        <p><strong className="text-foreground">Health:</strong> {record.healthStatus}</p>
        <p><strong className="text-foreground">Next action:</strong> {nextActionLabels[record.nextAction]}</p>
        <p><strong className="text-foreground">SLA:</strong> {slaCopy(record)}</p>
      </div>

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
      ) : (
        <button
          type="button"
          onClick={openEdit}
          className="w-full rounded-xl py-2 text-sm font-medium text-muted-foreground hover:bg-mist"
          style={{ border: "0.5px solid var(--color-border)" }}
        >
          Edit extract
        </button>
      )}
    </aside>
  );
}
