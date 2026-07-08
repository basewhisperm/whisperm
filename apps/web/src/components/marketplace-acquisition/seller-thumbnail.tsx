"use client";

import { useEffect, useState } from "react";

// ST1-013F -- the Seller Card must never show a browser broken-image icon.
// This owns every failure mode an image can hit (missing url, invalid url,
// 404, slow load, timeout, corrupt payload) and always renders one of three
// intentional states: a loading skeleton, the real image, or a marketplace
// placeholder. There is no fourth state where a raw <img> is left to fail on
// its own.
export function SellerThumbnail({ imageUrl, marketplace, listingTitle }: {
  readonly imageUrl: string | null;
  readonly marketplace: string;
  readonly listingTitle: string;
}) {
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">(imageUrl === null ? "failed" : "loading");

  // Reset load state when the underlying record's image changes (e.g. a
  // different seller is scrolled into view or bulk data refreshes).
  useEffect(() => {
    setStatus(imageUrl === null ? "failed" : "loading");
  }, [imageUrl]);

  if (imageUrl === null || status === "failed") {
    return (
      <div
        aria-hidden="true"
        className="flex aspect-[4/3] w-full shrink-0 flex-col items-center justify-center gap-1 rounded-xl bg-secondary px-2 text-center sm:w-24"
        data-testid="seller-thumbnail-placeholder"
      >
        <span className="text-[11px] font-semibold text-foreground">{marketplace}</span>
        <span className="text-[11px] text-muted-foreground">No Preview</span>
      </div>
    );
  }

  return (
    <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden rounded-xl bg-secondary sm:w-24">
      {status === "loading" ? (
        <div aria-hidden="true" className="absolute inset-0 animate-pulse bg-secondary" data-testid="seller-thumbnail-skeleton" />
      ) : null}
      <img
        alt={`${listingTitle} — ${marketplace} listing photo`}
        className={`size-full object-cover transition-opacity ${status === "loaded" ? "opacity-100" : "opacity-0"}`}
        loading="lazy"
        onError={() => setStatus("failed")}
        onLoad={() => setStatus("loaded")}
        src={imageUrl}
      />
    </div>
  );
}
