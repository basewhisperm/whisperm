// ST1-013F -- metadata is context, not the point of the card. Target density
// is roughly 70% operational (identity, workflow, next action) to 30%
// metadata, so this section always renders muted and last.
export function SellerMetadata({ marketplace, listingCount, location, capturedAgeLabel }: {
  readonly marketplace: string;
  readonly listingCount: number;
  readonly location: string | null;
  readonly capturedAgeLabel: string;
}) {
  const parts = [
    marketplace,
    `${listingCount} listing${listingCount === 1 ? "" : "s"}`,
    location,
    capturedAgeLabel,
  ].filter((part): part is string => part !== null && part.trim().length > 0);

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground" data-testid="seller-metadata">
      {parts.map((part, index) => (
        <span key={`${index}:${part}`} className="flex items-center gap-2">
          {index > 0 ? <span aria-hidden="true">·</span> : null}
          {part}
        </span>
      ))}
    </div>
  );
}
