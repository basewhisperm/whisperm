"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { IconArchive, IconEdit, IconPlus, IconRefresh, IconRocket } from "@tabler/icons-react";
import { formatCampaignTargetingSummary, getCampaignTargetingReadiness } from "@whisperm/services/campaign-targeting";

type CampaignStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED";

interface SellerAcquisitionCampaign {
  id: string;
  name: string;
  description?: string | null;
  status: CampaignStatus;
  ownerId?: string | null;
  goalSellerCount?: number | null;
  goalRevenue?: number | string | null;
  currency?: string | null;
  createdAt: string;
  updatedAt: string;
  memberCount?: number | null;
  scheduleEnabled?: boolean | null;
  scheduleCadence?: "HOURLY" | "DAILY" | "WEEKLY" | null;
  scheduleTimezone?: string | null;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  metadata?: { readonly targeting?: CampaignTargetingState | null } | null;
}

interface CampaignTargetingState {
  readonly marketplaceSourceId?: string;
  readonly marketplaceSourceKey?: string;
  readonly category?: string;
  readonly location?: string;
  readonly keyword?: string;
  readonly executionLimit?: number;
  readonly exclusionTerms?: readonly string[];
}

interface CampaignFormState {
  name: string;
  description: string;
  ownerId: string;
  goalSellerCount: string;
  status: CampaignStatus;
  scheduleEnabled: boolean;
  scheduleCadence: "HOURLY" | "DAILY" | "WEEKLY";
  scheduleTimezone: string;
  nextRunAt: string;
  marketplaceSourceKey: string;
  category: string;
  location: string;
  keyword: string;
  executionLimit: string;
  exclusionTerms: string;
}

const EMPTY_FORM: CampaignFormState = {
  name: "",
  description: "",
  ownerId: "",
  goalSellerCount: "",
  status: "DRAFT",
  scheduleEnabled: false,
  scheduleCadence: "DAILY",
  scheduleTimezone: "UTC",
  nextRunAt: "",
  marketplaceSourceKey: "",
  category: "",
  location: "",
  keyword: "",
  executionLimit: "50",
  exclusionTerms: "",
};

const STATUSES: readonly CampaignStatus[] = ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"];

function campaignApiPath(campaignId?: string) {
  return campaignId
    ? `/api/marketplace-acquisition/campaigns/${campaignId}`
    : "/api/marketplace-acquisition/campaigns";
}

async function readError(response: Response) {
  const payload = await response.json().catch(() => ({}));
  return payload?.error?.message ?? "Campaign request failed.";
}

function formatDateTime(value?: string | null) {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function statusTone(status: CampaignStatus) {
  if (status === "ACTIVE") return "bg-emerald-50 text-emerald-700";
  if (status === "ARCHIVED") return "bg-red-50 text-red-700";
  if (status === "PAUSED") return "bg-amber-50 text-amber-700";
  return "bg-secondary text-muted-foreground";
}

function formPayload(form: CampaignFormState) {
  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    ownerId: form.ownerId.trim() || null,
    goalSellerCount: form.goalSellerCount.trim() ? Number.parseInt(form.goalSellerCount, 10) : null,
    status: form.status,
    scheduleEnabled: form.scheduleEnabled,
    scheduleCadence: form.scheduleEnabled ? form.scheduleCadence : null,
    scheduleTimezone: form.scheduleEnabled ? form.scheduleTimezone.trim() || "UTC" : null,
    nextRunAt: form.scheduleEnabled ? form.nextRunAt || null : null,
    targeting: {
      marketplaceSourceKey: form.marketplaceSourceKey.trim() || undefined,
      category: form.category.trim() || undefined,
      location: form.location.trim() || undefined,
      keyword: form.keyword.trim() || undefined,
      executionLimit: form.executionLimit.trim() ? Number.parseInt(form.executionLimit, 10) : 50,
      exclusionTerms: form.exclusionTerms.split(",").map((term) => term.trim()).filter(Boolean),
    },
  };
}

export default function SellerAcquisitionCampaignsPage() {
  const [campaigns, setCampaigns] = useState<readonly SellerAcquisitionCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | CampaignStatus>("ALL");
  const [modalMode, setModalMode] = useState<"create" | "edit" | null>(null);
  const [editingCampaign, setEditingCampaign] = useState<SellerAcquisitionCampaign | null>(null);
  const [form, setForm] = useState<CampaignFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  async function loadCampaigns() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(campaignApiPath(), { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response));
      const payload = await response.json();
      setCampaigns(payload?.data?.campaigns ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Campaigns could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCampaigns();
  }, []);

  const filteredCampaigns = useMemo(() => {
    const query = search.trim().toLowerCase();
    return campaigns.filter((campaign) => {
      if (statusFilter !== "ALL" && campaign.status !== statusFilter) return false;
      if (!query) return true;
      return [campaign.name, campaign.description, campaign.ownerId, campaign.status]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [campaigns, search, statusFilter]);

  const stats = [
    { label: "Total Campaigns", value: campaigns.length },
    { label: "Active Campaigns", value: campaigns.filter((campaign) => campaign.status === "ACTIVE").length },
    { label: "Draft Campaigns", value: campaigns.filter((campaign) => campaign.status === "DRAFT").length },
    { label: "Archived Campaigns", value: campaigns.filter((campaign) => campaign.status === "ARCHIVED").length },
  ] as const;

  function openCreate() {
    setEditingCampaign(null);
    setForm(EMPTY_FORM);
    setModalMode("create");
  }

  function openEdit(campaign: SellerAcquisitionCampaign) {
    setEditingCampaign(campaign);
    setForm({
      name: campaign.name,
      description: campaign.description ?? "",
      ownerId: campaign.ownerId ?? "",
      goalSellerCount: campaign.goalSellerCount == null ? "" : String(campaign.goalSellerCount),
      status: campaign.status,
      scheduleEnabled: campaign.scheduleEnabled === true,
      scheduleCadence: campaign.scheduleCadence ?? "DAILY",
      scheduleTimezone: campaign.scheduleTimezone ?? "UTC",
      nextRunAt: campaign.nextRunAt ?? "",
      marketplaceSourceKey: campaign.metadata?.targeting?.marketplaceSourceKey ?? campaign.metadata?.targeting?.marketplaceSourceId ?? "",
      category: campaign.metadata?.targeting?.category ?? "",
      location: campaign.metadata?.targeting?.location ?? "",
      keyword: campaign.metadata?.targeting?.keyword ?? "",
      executionLimit: campaign.metadata?.targeting?.executionLimit == null ? "50" : String(campaign.metadata.targeting.executionLimit),
      exclusionTerms: campaign.metadata?.targeting?.exclusionTerms?.join(", ") ?? "",
    });
    setModalMode("edit");
  }

  async function saveCampaign() {
    if (!form.name.trim()) {
      setError("Campaign name is required.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const isEdit = modalMode === "edit" && editingCampaign !== null;
      const response = await fetch(campaignApiPath(isEdit ? editingCampaign.id : undefined), {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formPayload(form)),
      });
      if (!response.ok) throw new Error(await readError(response));
      await loadCampaigns();
      setModalMode(null);
      setEditingCampaign(null);
      setForm(EMPTY_FORM);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Campaign could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function archiveCampaign(campaign: SellerAcquisitionCampaign) {
    if (!window.confirm(`Archive ${campaign.name}?`)) return;
    setError(null);
    const response = await fetch(campaignApiPath(campaign.id), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ARCHIVED" }),
    });
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    await loadCampaigns();
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 rounded-2xl bg-background p-5 sm:flex-row sm:items-center sm:justify-between" style={{ border: "0.5px solid var(--color-border)" }}>
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Seller Acquisition</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Campaigns</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Create and manage seller acquisition campaigns before running campaign-scoped workbench operations.
          </p>
        </div>
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-whisper px-4 text-sm font-semibold text-white"
          onClick={openCreate}
          type="button"
        >
          <IconPlus aria-hidden="true" className="size-4" stroke={1.8} />
          New Campaign
        </button>
      </section>

      <section className="grid gap-3 md:grid-cols-4" aria-label="Campaign KPI summary">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-2xl bg-background p-4" style={{ border: "0.5px solid var(--color-border)" }}>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{stat.label}</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">{stat.value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-3 rounded-2xl bg-background p-4 md:grid-cols-[1fr_220px_auto]" style={{ border: "0.5px solid var(--color-border)" }}>
        <input
          aria-label="Search campaigns"
          className="h-10 rounded-xl bg-secondary px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-pulse"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search campaigns"
          value={search}
        />
        <select
          aria-label="Filter campaigns by status"
          className="h-10 rounded-xl bg-secondary px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-pulse"
          onChange={(event) => setStatusFilter(event.target.value as "ALL" | CampaignStatus)}
          value={statusFilter}
        >
          <option value="ALL">All statuses</option>
          {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <button className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-secondary px-4 text-sm font-semibold text-foreground" onClick={() => void loadCampaigns()} type="button">
          <IconRefresh aria-hidden="true" className="size-4" stroke={1.8} />
          Retry
        </button>
      </section>

      {error ? (
        <div className="rounded-2xl bg-red-50 p-4 text-sm font-medium text-red-700">{error}</div>
      ) : null}

      {loading ? (
        <section className="grid gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-44 animate-pulse rounded-2xl bg-secondary" />
          ))}
        </section>
      ) : filteredCampaigns.length === 0 ? (
        <section className="flex flex-col items-center justify-center rounded-2xl bg-background px-6 py-16 text-center" style={{ border: "0.5px solid var(--color-border)" }}>
          <IconRocket aria-hidden="true" className="size-10 text-muted-foreground" stroke={1.5} />
          <h2 className="mt-4 text-base font-semibold text-foreground">No acquisition campaigns yet.</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">Create your first campaign to organize seller capture, invitation, claims, and conversion work.</p>
          <button className="mt-5 rounded-xl bg-whisper px-4 py-2 text-sm font-semibold text-white" onClick={openCreate} type="button">
            Create your first campaign
          </button>
        </section>
      ) : (
        <section className="grid gap-4 lg:grid-cols-2">
          {filteredCampaigns.map((campaign) => (
            <article key={campaign.id} className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">{campaign.name}</h2>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{campaign.description ?? "No description provided."}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusTone(campaign.status)}`}>{campaign.status}</span>
              </div>

              <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-muted-foreground">Owner</dt><dd className="font-medium text-foreground">{campaign.ownerId ?? "Unassigned"}</dd></div>
                <div><dt className="text-muted-foreground">Goal</dt><dd className="font-medium text-foreground">{campaign.goalSellerCount ?? "No seller goal"}</dd></div>
                <div><dt className="text-muted-foreground">Members</dt><dd className="font-medium text-foreground">{campaign.memberCount ?? 0}</dd></div>
                <div><dt className="text-muted-foreground">Created</dt><dd className="font-medium text-foreground">{formatDate(campaign.createdAt)}</dd></div>
                <div><dt className="text-muted-foreground">Updated</dt><dd className="font-medium text-foreground">{formatDate(campaign.updatedAt)}</dd></div>
                <div><dt className="text-muted-foreground">Schedule</dt><dd className="font-medium text-foreground">{campaign.scheduleEnabled ? campaign.scheduleCadence ?? "Enabled" : "Disabled"}</dd></div>
                <div><dt className="text-muted-foreground">Next Run</dt><dd className="font-medium text-foreground">{formatDateTime(campaign.nextRunAt)}</dd></div>
                <div><dt className="text-muted-foreground">Last Run</dt><dd className="font-medium text-foreground">{formatDateTime(campaign.lastRunAt)}</dd></div>
              </dl>
              {(() => {
                const targetingSummary = formatCampaignTargetingSummary(campaign.metadata);
                const readiness = getCampaignTargetingReadiness(campaign.metadata);
                const memberCount = campaign.memberCount ?? 0;
                const workbenchHref = `/marketplace-acquisition/campaigns/${campaign.id}/workbench`;

                return (
                  <>
                    <div className="mt-4 space-y-2 text-xs text-muted-foreground">
                      <div className="rounded-xl bg-secondary p-3">
                        <p className="font-semibold text-foreground">Targeting</p>
                        <p>{targetingSummary}</p>
                      </div>
                      <div className="rounded-xl bg-secondary p-3">
                        <p className="font-semibold text-foreground">Runtime</p>
                        <p>{readiness.status === "READY" ? "Ready to run discovery" : readiness.summary}</p>
                      </div>
                      <div className="rounded-xl bg-secondary p-3">
                        <p className="font-semibold text-foreground">Members</p>
                        <p>{memberCount} captured seller{memberCount === 1 ? "" : "s"}</p>
                      </div>
                    </div>

                    <div className="mt-5 flex flex-wrap gap-2">
                      {readiness.status === "NOT_CONFIGURED" ? (
                        <>
                          <button className="inline-flex h-9 items-center justify-center rounded-xl bg-whisper px-3 text-sm font-semibold text-white" onClick={() => openEdit(campaign)} type="button">
                            Configure targeting
                          </button>
                          <Link className="inline-flex h-9 items-center justify-center rounded-xl bg-secondary px-3 text-sm font-semibold text-foreground" href={workbenchHref}>
                            Open campaign
                          </Link>
                        </>
                      ) : memberCount > 0 ? (
                        <>
                          <Link className="inline-flex h-9 items-center justify-center rounded-xl bg-whisper px-3 text-sm font-semibold text-white" href={workbenchHref}>
                            Review sellers
                          </Link>
                          <Link className="inline-flex h-9 items-center justify-center rounded-xl bg-secondary px-3 text-sm font-semibold text-foreground" href={workbenchHref}>
                            Run discovery again
                          </Link>
                        </>
                      ) : (
                        <>
                          <Link className="inline-flex h-9 items-center justify-center rounded-xl bg-whisper px-3 text-sm font-semibold text-white" href={workbenchHref}>
                            Run discovery
                          </Link>
                          <Link className="inline-flex h-9 items-center justify-center rounded-xl bg-secondary px-3 text-sm font-semibold text-foreground" href={workbenchHref}>
                            Open workbench
                          </Link>
                        </>
                      )}
                    </div>
                  </>
                );
              })()}

              <div className="mt-2 flex flex-wrap gap-2">
                <button className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-secondary px-3 text-sm font-semibold text-foreground" onClick={() => openEdit(campaign)} type="button">
                  <IconEdit aria-hidden="true" className="size-4" stroke={1.8} />
                  Edit
                </button>
                <button className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-secondary px-3 text-sm font-semibold text-foreground disabled:opacity-50" disabled={campaign.status === "ARCHIVED"} onClick={() => void archiveCampaign(campaign)} type="button">
                  <IconArchive aria-hidden="true" className="size-4" stroke={1.8} />
                  Archive
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {modalMode ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-midnight/60 p-4">
          <section aria-modal="true" className="w-full max-w-lg rounded-2xl bg-background p-5 shadow-xl" role="dialog">
            <h2 className="text-lg font-semibold text-foreground">{modalMode === "create" ? "New Campaign" : "Edit Campaign"}</h2>
            <div className="mt-4 space-y-3">
              <Field label="Campaign Name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
              <Field label="Description" value={form.description} onChange={(value) => setForm({ ...form, description: value })} />
              <Field label="Owner" value={form.ownerId} onChange={(value) => setForm({ ...form, ownerId: value })} />
              <Field label="Goal" inputMode="numeric" value={form.goalSellerCount} onChange={(value) => setForm({ ...form, goalSellerCount: value })} />
              <label className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <input checked={form.scheduleEnabled} onChange={(event) => setForm({ ...form, scheduleEnabled: event.target.checked })} type="checkbox" />
                Schedule enabled
              </label>
              <label className="block text-sm font-medium text-muted-foreground">
                Cadence
                <select className="mt-1 h-10 w-full rounded-xl bg-secondary px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-pulse" disabled={!form.scheduleEnabled} value={form.scheduleCadence} onChange={(event) => setForm({ ...form, scheduleCadence: event.target.value as CampaignFormState["scheduleCadence"] })}>
                  <option value="HOURLY">Hourly</option>
                  <option value="DAILY">Daily</option>
                  <option value="WEEKLY">Weekly</option>
                </select>
              </label>
              <Field label="Timezone" value={form.scheduleTimezone} onChange={(value) => setForm({ ...form, scheduleTimezone: value })} />
              <Field label="Next Run (ISO)" value={form.nextRunAt} onChange={(value) => setForm({ ...form, nextRunAt: value })} />
              <div className="rounded-xl bg-secondary/60 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Discovery targeting</p>
                <Field label="Marketplace/source" placeholder="e.g. JIJI" value={form.marketplaceSourceKey} onChange={(value) => setForm({ ...form, marketplaceSourceKey: value })} />
                <Field label="Keyword/search phrase" value={form.keyword} onChange={(value) => setForm({ ...form, keyword: value })} />
                <Field label="Category" value={form.category} onChange={(value) => setForm({ ...form, category: value })} />
                <Field label="Location/region" value={form.location} onChange={(value) => setForm({ ...form, location: value })} />
                <Field label="Execution limit" inputMode="numeric" value={form.executionLimit} onChange={(value) => setForm({ ...form, executionLimit: value })} />
                <Field label="Exclusion terms (comma-separated)" value={form.exclusionTerms} onChange={(value) => setForm({ ...form, exclusionTerms: value })} />
              </div>
              <label className="block text-sm font-medium text-muted-foreground">
                Status
                <select className="mt-1 h-10 w-full rounded-xl bg-secondary px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-pulse" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as CampaignStatus })}>
                  {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="rounded-xl bg-secondary px-4 py-2 text-sm font-semibold text-foreground" onClick={() => setModalMode(null)} type="button">Cancel</button>
              <button className="rounded-xl bg-whisper px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={saving} onClick={() => void saveCampaign()} type="button">
                {saving ? "Saving…" : "Save Campaign"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, value, onChange, inputMode, placeholder }: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void; readonly inputMode?: "numeric"; readonly placeholder?: string }) {
  return (
    <label className="block text-sm font-medium text-muted-foreground">
      {label}
      <input
        className="mt-1 h-10 w-full rounded-xl bg-secondary px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-pulse"
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );
}
