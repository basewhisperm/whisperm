// ST1-013F -- the one thing an operator should be able to answer in under 3
// seconds: "what do I do next for this seller?" This is the single primary
// call-to-action on a Seller Card; every other action (view detail, edit) is
// visually secondary. The label always comes from the ST1-013D canonical
// workflow resolver -- never invented here.
export function SellerNextAction({ label, enabled, busy, onRun }: {
  readonly label: string;
  readonly enabled: boolean;
  readonly busy: boolean;
  readonly onRun: () => void;
}) {
  return (
    <div className="mt-3" data-testid="seller-next-action">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Next action</p>
      <button
        className="mt-1.5 flex h-11 w-full min-h-11 items-center justify-center rounded-2xl bg-whisper px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        data-testid="seller-primary-action"
        disabled={!enabled || busy}
        onClick={onRun}
        type="button"
      >
        {busy ? "Working…" : label}
      </button>
    </div>
  );
}
