"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { IconArrowRight, IconBookmark } from "@tabler/icons-react";

import { computeAcquisitionSummary, formatAcquisitionConversionRate } from "@/lib/acquisition-summary";
import { AcquisitionBoard } from "@/components/seller-acquisition/acquisition-board";
import { acquisitionStages, stageKey, useAcquisitionBoardData } from "@/lib/marketplace-acquisition/board-store";

interface AcquisitionAnalytics {
  readonly acquisition: {
    readonly captures: number;
    readonly invitationsSent: number;
    readonly claimRate: number;
    readonly conversionRate: number;
    readonly expiredCount: number;
  };
  readonly inventory: {
    readonly listingsCaptured: number;
    readonly listingsClaimed: number;
    readonly listingsConverted: number;
    readonly listingsExpired: number;
  };
  readonly conversion: {
    readonly sellerConversionsSucceeded: number;
    readonly inventoryConversionsSucceeded: number;
    readonly conversionFailures: number;
    readonly deadLetteredConversions: number;
  };
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function searchText(deal: { readonly title?: string | null; readonly currency?: string | null; readonly id: string; readonly marketplaceSource?: string | null }): string {
  return [deal.title, deal.currency, deal.id, marketplaceSource(deal)].filter(Boolean).join(" ").toLowerCase();
}

function marketplaceSource(deal: { readonly marketplaceSource?: string | null; readonly currency?: string | null }): string {
  return deal.marketplaceSource ?? deal.currency ?? "";
}

export default function MarketplaceAcquisitionPage() {
  const { pipeline, deals, loading, error: boardError, refresh, updateDealStage } = useAcquisitionBoardData();
  const [analytics, setAnalytics] = useState<AcquisitionAnalytics | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("all");

  useEffect(() => {
    let cancelled = false;

    fetch("/api/marketplace-acquisition/analytics")
      .then(async (response) => {
        if (!response.ok) return null;
        const payload = await response.json() as { readonly data?: AcquisitionAnalytics };
        return payload.data ?? null;
      })
      .then((analyticsData) => {
        if (!cancelled) setAnalytics(analyticsData);
      })
      .catch(() => {
        if (!cancelled) setAnalytics(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredDeals = useMemo(() => {
    const normalizedSearchQuery = searchQuery.trim().toLowerCase();

    return deals.filter((deal) => {
      const matchesSearch =
        normalizedSearchQuery.length === 0 || searchText(deal).includes(normalizedSearchQuery);
      const dealStageName =
        pipeline?.stages.find((stage) => stage.id === deal.pipelineStageId)?.name ?? "";
      if (stageFilter !== "all" && stageKey(dealStageName) !== stageKey(stageFilter)) return false;

      return matchesSearch;
    });
  }, [deals, searchQuery, stageFilter, pipeline?.stages]);

  const summary = useMemo(() => computeAcquisitionSummary(pipeline, filteredDeals), [pipeline, filteredDeals]);
  const fullyConverted = Math.min(
    analytics?.conversion.sellerConversionsSucceeded ?? 0,
    analytics?.conversion.inventoryConversionsSucceeded ?? 0,
  );
  const expirationRate = analytics?.acquisition.captures
    ? (analytics.acquisition.expiredCount / analytics.acquisition.captures)
    : 0;

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 rounded-2xl bg-background p-5 sm:flex-row sm:items-center sm:justify-between" style={{ border: "0.5px solid var(--color-border)" }}>
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Seller Acquisition</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Seller Acquisition</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Capture, invite, and convert marketplace sellers into Render sellers
          </p>
        </div>
        <Link className="inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pulse" href="/marketplace-acquisition/capture" style={{ background: "var(--color-whisper)" }}>
          Capture setup
          <IconArrowRight aria-hidden="true" className="size-4" stroke={1.8} />
        </Link>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Seller acquisition summary">
        <SummaryCard label="Captured" value={String(summary.captured)} description="Deals in the Captured stage" />
        <SummaryCard label="Invited" value={String(summary.invited)} description="Deals in the Invited stage" />
        <SummaryCard label="Claim Started" value={String(summary.claimStarted)} description="Deals in the Claim Started stage" />
        <SummaryCard label="Claimed" value={String(summary.claimed)} description="Deals in the Claimed stage" />
        <SummaryCard label="Converted" value={String(summary.converted)} description="Deals in the Converted stage" />
        <SummaryCard label="Expired" value={String(summary.expired)} description="Deals in the Expired stage" />
        <SummaryCard label="Conversion rate" value={formatAcquisitionConversionRate(summary.conversionRate)} description="Converted divided by captured" />
        <SummaryCard label="Recent opportunities" value={String(summary.recentCount)} description="Opportunities currently loaded from the board" />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Seller acquisition lifecycle analytics">
        <SummaryCard label="Captures" value={String(analytics?.acquisition.captures ?? 0)} description="Captured seller opportunities" />
        <SummaryCard label="Invitations sent" value={String(analytics?.acquisition.invitationsSent ?? 0)} description="Seller invitations sent" />
        <SummaryCard label="Claim started" value={String(summary.claimStarted)} description="Claim links opened or started" />
        <SummaryCard label="Claimed" value={String(analytics?.inventory.listingsClaimed ?? summary.claimed)} description="Seller inventory claimed" />
        <SummaryCard label="Seller converted" value={String(analytics?.conversion.sellerConversionsSucceeded ?? 0)} description="Sellers created in Render" />
        <SummaryCard label="Listings converted" value={String(analytics?.conversion.inventoryConversionsSucceeded ?? 0)} description="Inventory converted into Render listings" />
        <SummaryCard label="Fully converted" value={String(fullyConverted)} description="Seller and inventory both converted" />
        <SummaryCard label="Expired" value={String(analytics?.acquisition.expiredCount ?? 0)} description="Expired captures or invitations" />
        <SummaryCard label="Claim rate" value={formatPercent(analytics?.acquisition.claimRate ?? 0)} description="Claims divided by invitations" />
        <SummaryCard label="Conversion rate" value={formatPercent(analytics?.acquisition.conversionRate ?? 0)} description="Converted divided by claimed" />
        <SummaryCard label="Expiration rate" value={formatPercent(expirationRate)} description="Expired divided by captured" />
        <SummaryCard label="Failed conversions" value={String(analytics?.conversion.conversionFailures ?? 0)} description="Render conversion failures" />
      </section>

      <input
        aria-label="Search acquisitions"
        className="h-10 w-full rounded-xl bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-pulse"
        placeholder="Search by deal or contact"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        style={{ border: "0.5px solid var(--color-border)" }}
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by acquisition stage">
        <button
          type="button"
          aria-pressed={stageFilter === "all"}
          className="rounded-full px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pulse"
          onClick={() => setStageFilter("all")}
          style={{ border: "0.5px solid var(--color-border)", background: stageFilter === "all" ? "var(--color-whisper)" : "var(--color-background)", color: stageFilter === "all" ? "white" : "var(--color-foreground)" }}
        >
          All stages
        </button>
        {acquisitionStages.map((stageName) => (
          <button
            key={stageName}
            type="button"
            aria-pressed={stageFilter === stageName}
            className="rounded-full px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pulse"
            onClick={() => setStageFilter(stageName)}
            style={{ border: "0.5px solid var(--color-border)", background: stageFilter === stageName ? "var(--color-whisper)" : "var(--color-background)", color: stageFilter === stageName ? "white" : "var(--color-foreground)" }}
          >
            {stageName}
          </button>
        ))}
      </div>

      {!loading && pipeline !== null && filteredDeals.length === 0 && (
        <p className="rounded-xl bg-background px-4 py-6 text-center text-sm text-muted-foreground" style={{ border: "0.5px solid var(--color-border)" }}>
          No acquisition opportunities match these filters.
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading Seller Acquisition…</p>
      ) : pipeline === null ? (
        <section className="flex flex-col items-center justify-center rounded-2xl bg-background px-6 py-16 text-center" style={{ border: "0.5px solid var(--color-border)" }}>
          <IconBookmark aria-hidden="true" className="size-8 text-muted-foreground" stroke={1.5} />
          <h2 className="mt-4 text-sm font-semibold text-foreground">No seller acquisition deals yet</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">Start by configuring marketplace capture, then captured sellers will appear on this acquisition board.</p>
        </section>
      ) : (
        <>
          {boardError !== null && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{boardError}</p>}
          <AcquisitionBoard pipeline={pipeline} deals={filteredDeals} onStageUpdated={updateDealStage} onRefresh={refresh} />
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value, description }: { readonly label: string; readonly value: string; readonly description: string }) {
  return (
    <div className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }}>
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
