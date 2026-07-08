"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { type SellerAcquisitionRecord } from "@/lib/marketplace-acquisition/records-store";
import { isActionEnabled, sellerPresentationFromRecord } from "@/lib/marketplace-acquisition/workbench-domain";
import { SellerMetadata } from "@/components/marketplace-acquisition/seller-metadata";
import { SellerNextAction } from "@/components/marketplace-acquisition/seller-next-action";
import { SellerStatusPill } from "@/components/marketplace-acquisition/seller-status-pill";
import { SellerThumbnail } from "@/components/marketplace-acquisition/seller-thumbnail";

// ST1-013F -- the Seller Card is the primary operational surface of
// WhispeRM. Every card must answer, at a glance: WHO is this seller, WHAT
// are they selling, WHERE are they in the workflow, WHAT should I do next,
// and IS ANYTHING BLOCKING ME. This component only lays those five sections
// out; every display decision (fallback copy, formatting, workflow stage)
// comes from `sellerPresentationFromRecord`, never from raw record fields
// read inline here.
export function SellerCard({ record, listingCountOverride, selected, bulkSelected, bulkEligible, primaryActionEnabled, onBulkToggle, onSelect, onPrimaryAction }: {
  readonly record: SellerAcquisitionRecord;
  readonly listingCountOverride?: number | undefined;
  readonly selected: boolean;
  readonly bulkSelected: boolean;
  readonly bulkEligible: boolean;
  readonly primaryActionEnabled?: boolean | undefined;
  readonly onBulkToggle: () => void;
  readonly onSelect: () => void;
  readonly onPrimaryAction: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  // Presentation mapping only needs to rerun when the record itself (or the
  // rollup listing count) changes, not on every parent re-render -- keeps a
  // page of dozens of cards cheap to redraw on selection/filter changes.
  const presentation = useMemo(
    () => sellerPresentationFromRecord(record, listingCountOverride),
    [record, listingCountOverride],
  );
  const enabled = primaryActionEnabled ?? isActionEnabled(record);

  const runPrimaryAction = async () => {
    setBusy(true);
    try {
      await onPrimaryAction();
    } finally {
      setBusy(false);
    }
  };

  return (
    <article
      className={`w-full min-w-0 max-w-full rounded-2xl bg-background p-4 text-left transition hover:opacity-90 sm:p-5 ${selected ? "ring-2 ring-pulse" : ""}`}
      data-testid="seller-card"
      style={{ border: "0.5px solid var(--color-border)" }}
    >
      {/* Section 1 -- Identity: seller name, marketplace, phone. Highest priority. */}
      <div className="flex min-w-0 items-start gap-3">
        <input
          aria-label={`Select ${presentation.displayName} for bulk invite`}
          checked={bulkSelected}
          className="mt-1 size-4 shrink-0"
          disabled={!bulkEligible}
          onChange={onBulkToggle}
          type="checkbox"
        />
        <button className="min-w-0 flex-1 text-left" onClick={onSelect} type="button">
          <h3 className="break-words text-base font-semibold leading-snug text-foreground sm:text-lg" data-testid="seller-card-name">
            {presentation.displayName}
          </h3>
          <p className="mt-1 min-w-0 break-words text-xs text-muted-foreground" data-testid="seller-card-identity">
            {presentation.displayMarketplace} · {presentation.displayPhone}
            {presentation.displayLocation ? ` · ${presentation.displayLocation}` : ""}
          </p>
        </button>
      </div>

      {/* Section 2+3 -- Listing thumbnail, title, price. */}
      <button className="mt-3 grid w-full min-w-0 gap-3 text-left sm:grid-cols-[6rem_minmax(0,1fr)]" onClick={onSelect} type="button">
        <SellerThumbnail
          imageUrl={presentation.thumbnail.imageUrl}
          listingTitle={presentation.thumbnail.listingTitle}
          marketplace={presentation.thumbnail.marketplace}
        />
        <div className="min-w-0">
          <p className="line-clamp-2 break-words text-sm text-foreground" data-testid="seller-card-title">{presentation.displayTitle}</p>
          <p className="mt-1 text-sm font-semibold text-foreground" data-testid="seller-card-price">{presentation.displayPrice}</p>
        </div>
      </button>

      {/* Section 4+5 -- Workflow stage and primary blocker (if any). */}
      <div className="mt-3">
        <SellerStatusPill
          primaryBlocker={presentation.primaryBlocker}
          secondaryBlockerCount={presentation.secondaryBlockerCount}
          stage={presentation.workflowStage}
          stageLabel={presentation.workflowStageLabel}
        />
      </div>

      {/* Section 6 -- Primary action (large) and secondary action (small). */}
      <SellerNextAction busy={busy} enabled={enabled} label={presentation.nextAction.label} onRun={() => void runPrimaryAction()} />

      {record.deal?.deal.id ? (
        <Link
          className="mt-2 inline-flex min-h-10 w-full items-center justify-center rounded-2xl px-4 text-xs font-semibold text-whisper sm:w-auto"
          data-testid="seller-card-open-detail"
          href={`/marketplace-acquisition/${record.deal.deal.id}`}
          style={{ border: "0.5px solid var(--color-border)" }}
        >
          Open Detail
        </Link>
      ) : null}

      {/* Section 7 -- Metadata: marketplace, listing count, location, age. Muted, always last. */}
      <SellerMetadata
        capturedAgeLabel={presentation.capturedAgeLabel}
        listingCount={presentation.listingCount}
        location={presentation.displayLocation}
        marketplace={presentation.displayMarketplace}
      />
    </article>
  );
}
