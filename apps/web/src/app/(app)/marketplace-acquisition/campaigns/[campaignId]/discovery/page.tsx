"use client";

import { useCallback, useEffect, useState } from "react";
import { IconCheck, IconLoader2, IconPlus, IconRefresh, IconX } from "@tabler/icons-react";

interface DiscoveryRun {
  readonly id: string;
  readonly mode: string;
  readonly status: string;
  readonly sellersFound: number;
  readonly sellersQualified: number;
  readonly sellersRejected: number;
  readonly sellersDuplicate: number;
  readonly createdAt: string;
  readonly completedAt?: string | null;
  readonly errorMessage?: string | null;
}

interface DiscoveredSeller {
  readonly id: string;
  readonly status: string;
  readonly qualificationScore: number;
  readonly sellerName?: string | null;
  readonly phone?: string | null;
  readonly sellerProfileUrl?: string | null;
  readonly listingUrl: string;
  readonly title?: string | null;
  readonly price?: string | number | null;
  readonly currency?: string | null;
  readonly location?: string | null;
  readonly images?: readonly string[] | null;
  readonly createdAt: string;
}

interface RunSummary {
  readonly totalRuns: number;
  readonly pendingReview: number;
  readonly qualified: number;
  readonly promoted: number;
}

interface DiscoveryPageProps {
  readonly params: { readonly campaignId: string };
}

const STATUS_COLORS: Record<string, string> = {
  QUALIFIED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
  DUPLICATE: "bg-yellow-100 text-yellow-700",
  PROMOTED: "bg-blue-100 text-blue-700",
  PENDING: "bg-gray-100 text-gray-600",
};

const RUN_STATUS_COLORS: Record<string, string> = {
  COMPLETED: "bg-green-100 text-green-700",
  FAILED: "bg-red-100 text-red-700",
  RUNNING: "bg-blue-100 text-blue-700",
  PENDING: "bg-gray-100 text-gray-600",
};

function ScoreBar({ score }: { readonly score: number }) {
  const color = score >= 80 ? "bg-green-500" : score >= 60 ? "bg-yellow-500" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 rounded-full bg-secondary overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-medium text-foreground">{score}</span>
    </div>
  );
}

function SellerCard({
  seller,
  onPromote,
  onReject,
  busy,
}: {
  readonly seller: DiscoveredSeller;
  readonly onPromote: (id: string) => void;
  readonly onReject: (id: string) => void;
  readonly busy: boolean;
}) {
  const canAct = seller.status === "QUALIFIED" && !busy;
  const image = seller.images?.[0];

  return (
    <article
      className="rounded-2xl bg-background p-4 space-y-3"
      style={{ border: "0.5px solid var(--color-border)" }}
    >
      <div className="flex items-start gap-3">
        {image ? (
          <img
            src={image}
            alt={seller.title ?? "Listing"}
            className="size-12 rounded-lg object-cover shrink-0 bg-secondary"
          />
        ) : (
          <div className="size-12 rounded-lg bg-secondary shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground truncate">
            {seller.sellerName ?? "Unknown seller"}
          </p>
          <p className="text-xs text-muted-foreground truncate">{seller.title ?? seller.listingUrl}</p>
          {seller.location ? (
            <p className="text-xs text-muted-foreground mt-0.5">{seller.location}</p>
          ) : null}
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLORS[seller.status] ?? "bg-gray-100 text-gray-600"}`}>
          {seller.status}
        </span>
      </div>

      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <ScoreBar score={seller.qualificationScore} />
          {seller.phone ? (
            <p className="text-xs text-muted-foreground">{seller.phone}</p>
          ) : (
            <p className="text-xs text-red-500">No phone</p>
          )}
        </div>
        {seller.price ? (
          <p className="text-sm font-semibold text-foreground">
            {seller.currency ?? ""} {seller.price}
          </p>
        ) : null}
      </div>

      {canAct ? (
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onPromote(seller.id)}
            disabled={busy}
            className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-xl bg-whisper text-white text-xs font-semibold disabled:opacity-50"
            type="button"
          >
            <IconCheck className="size-3.5" />
            Add to Campaign
          </button>
          <button
            onClick={() => onReject(seller.id)}
            disabled={busy}
            className="h-8 w-8 flex items-center justify-center rounded-xl bg-secondary text-muted-foreground disabled:opacity-50"
            type="button"
          >
            <IconX className="size-3.5" />
          </button>
        </div>
      ) : null}
    </article>
  );
}

function ManualSeedModal({
  campaignId,
  onClose,
  onSuccess,
}: {
  readonly campaignId: string;
  readonly onClose: () => void;
  readonly onSuccess: () => void;
}) {
  const [text, setText] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [sourceKey, setSourceKey] = useState("jiji");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) { setError("Enter at least one listing URL."); return; }
    if (!sourceId) { setError("Enter the marketplace source ID."); return; }

    setBusy(true);
    setError(null);
    try {
      const entries = lines.map((url) => ({ listingUrl: url }));
      const res = await fetch(`/api/marketplace-acquisition/campaigns/${campaignId}/discovery/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marketplaceSourceId: sourceId, marketplaceSourceKey: sourceKey, mode: "MANUAL_SEED", entries }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error?.message ?? "Discovery run failed.");
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-midnight/60 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-background p-6 space-y-4 shadow-xl" style={{ border: "0.5px solid var(--color-border)" }}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Manual Seed Discovery</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" type="button">
            <IconX className="size-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Marketplace Source ID
            </label>
            <input
              className="mt-1 w-full rounded-xl bg-secondary px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-pulse"
              placeholder="UUID of the marketplace source"
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Marketplace Key
            </label>
            <select
              className="mt-1 w-full rounded-xl bg-secondary px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-pulse"
              value={sourceKey}
              onChange={(e) => setSourceKey(e.target.value)}
            >
              <option value="jiji">Jiji.com.gh</option>
              <option value="tonaton">Tonaton.com</option>
              <option value="facebook">Facebook Marketplace</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Listing URLs (one per line, max 500)
            </label>
            <textarea
              className="mt-1 w-full h-36 rounded-xl bg-secondary px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-pulse resize-none font-mono"
              placeholder={"https://jiji.com.gh/accra/cars/...\nhttps://jiji.com.gh/accra/cars/..."}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {text.split("\n").filter(Boolean).length} URLs entered
            </p>
          </div>
        </div>

        {error ? (
          <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>
        ) : null}

        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            className="flex-1 h-10 rounded-xl bg-secondary text-sm font-semibold text-foreground"
            type="button"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy}
            className="flex-1 h-10 rounded-xl bg-whisper text-sm font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2"
            type="button"
          >
            {busy ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {busy ? "Running…" : "Start Discovery"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DiscoveryPage({ params }: DiscoveryPageProps) {
  const campaignId = decodeURIComponent(params.campaignId);

  const [runs, setRuns] = useState<readonly DiscoveryRun[]>([]);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [sellers, setSellers] = useState<readonly DiscoveredSeller[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("QUALIFIED");
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [showSeedModal, setShowSeedModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [runsRes, sellersRes] = await Promise.all([
        fetch(`/api/marketplace-acquisition/campaigns/${campaignId}/discovery/runs`),
        fetch(`/api/marketplace-acquisition/campaigns/${campaignId}/discovery/sellers?status=${statusFilter}`),
      ]);
      const [runsPayload, sellersPayload] = await Promise.all([
        runsRes.json(),
        sellersRes.json(),
      ]);
      setRuns(runsPayload?.data?.runs ?? []);
      setSummary(runsPayload?.data?.summary ?? null);
      setSellers(sellersPayload?.data?.sellers ?? []);
    } catch {
      setError("Failed to load discovery data.");
    } finally {
      setLoading(false);
    }
  }, [campaignId, statusFilter]);

  useEffect(() => { void loadData(); }, [loadData]);

  const handlePromote = async (sellerId: string) => {
    setActionBusy(true);
    try {
      const res = await fetch(
        `/api/marketplace-acquisition/campaigns/${campaignId}/discovery/sellers/${sellerId}/promote`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ captureId: sellerId }) },
      );
      if (!res.ok) throw new Error("Promote failed.");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleReject = async (sellerId: string) => {
    setActionBusy(true);
    try {
      const res = await fetch(
        `/api/marketplace-acquisition/campaigns/${campaignId}/discovery/sellers/${sellerId}/reject`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Reject failed.");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed.");
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      {showSeedModal ? (
        <ManualSeedModal
          campaignId={campaignId}
          onClose={() => setShowSeedModal(false)}
          onSuccess={() => { setShowSeedModal(false); void loadData(); }}
        />
      ) : null}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Seller Discovery</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Find and qualify marketplace sellers to feed into this campaign.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void loadData()}
            className="h-9 w-9 flex items-center justify-center rounded-xl bg-secondary text-muted-foreground hover:text-foreground"
            type="button"
          >
            <IconRefresh className="size-4" />
          </button>
          <button
            onClick={() => setShowSeedModal(true)}
            className="h-9 flex items-center gap-2 rounded-xl bg-whisper px-4 text-sm font-semibold text-white"
            type="button"
          >
            <IconPlus className="size-4" />
            New Discovery Run
          </button>
        </div>
      </div>

      {summary ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Total Runs", value: summary.totalRuns },
            { label: "Pending Review", value: summary.pendingReview },
            { label: "Qualified", value: summary.qualified },
            { label: "Promoted", value: summary.promoted },
          ].map((stat) => (
            <div key={stat.label} className="rounded-2xl bg-background p-4" style={{ border: "0.5px solid var(--color-border)" }}>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{stat.label}</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{stat.value}</p>
            </div>
          ))}
        </div>
      ) : null}

      {error ? (
        <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Run History</p>
          {loading ? (
            <div className="flex justify-center py-8">
              <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : runs.length === 0 ? (
            <div className="rounded-2xl bg-background p-6 text-center" style={{ border: "0.5px solid var(--color-border)" }}>
              <p className="text-sm text-muted-foreground">No discovery runs yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Start a run to find sellers automatically.</p>
            </div>
          ) : (
            runs.map((run) => (
              <div key={run.id} className="rounded-2xl bg-background p-4 space-y-2" style={{ border: "0.5px solid var(--color-border)" }}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground">{run.mode.replace("_", " ")}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${RUN_STATUS_COLORS[run.status] ?? "bg-gray-100 text-gray-600"}`}>
                    {run.status}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1 text-center">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{run.sellersFound}</p>
                    <p className="text-[10px] text-muted-foreground">Found</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-green-600">{run.sellersQualified}</p>
                    <p className="text-[10px] text-muted-foreground">Qualified</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-muted-foreground">{run.sellersRejected}</p>
                    <p className="text-[10px] text-muted-foreground">Rejected</p>
                  </div>
                </div>
                {run.errorMessage ? (
                  <p className="text-xs text-red-600 truncate">{run.errorMessage}</p>
                ) : null}
                <p className="text-[10px] text-muted-foreground">
                  {new Date(run.createdAt).toLocaleString()}
                </p>
              </div>
            ))
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Discovered Sellers
            </p>
            <select
              className="h-8 rounded-xl bg-secondary px-3 text-xs text-foreground outline-none"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="QUALIFIED">Qualified</option>
              <option value="PENDING">Pending</option>
              <option value="PROMOTED">Promoted</option>
              <option value="REJECTED">Rejected</option>
              <option value="DUPLICATE">Duplicate</option>
            </select>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : sellers.length === 0 ? (
            <div className="rounded-2xl bg-background p-8 text-center" style={{ border: "0.5px solid var(--color-border)" }}>
              <p className="text-sm text-muted-foreground">No {statusFilter.toLowerCase()} sellers.</p>
              {statusFilter === "QUALIFIED" ? (
                <p className="text-xs text-muted-foreground mt-1">
                  Start a discovery run to find and qualify sellers.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {sellers.map((seller) => (
                <SellerCard
                  key={seller.id}
                  seller={seller}
                  onPromote={(id) => void handlePromote(id)}
                  onReject={(id) => void handleReject(id)}
                  busy={actionBusy}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
