import type { AcquisitionWorkflowStage, WorkflowBlocker } from "@whisperm/services/acquisition-workflow";

// ST1-013F -- badge hierarchy. Workflow stage is the largest, most prominent
// signal on the card; a blocker (when present) is second priority and reads
// as a warning; everything else on the card (age, marketplace, listing
// count) is muted metadata rendered by SellerMetadata, never competing with
// these two for attention.

const STAGE_TONE: Readonly<Record<AcquisitionWorkflowStage, string>> = {
  DISCOVERY: "bg-secondary text-muted-foreground",
  CAPTURED: "bg-secondary text-muted-foreground",
  REVIEW: "bg-amber-50 text-amber-700",
  PHONE_READY: "bg-emerald-50 text-emerald-700",
  INVITATION_READY: "bg-emerald-50 text-emerald-700",
  INVITATION_SENT: "bg-sky-50 text-sky-700",
  WAITING_CLAIM: "bg-sky-50 text-sky-700",
  CLAIMED: "bg-emerald-50 text-emerald-700",
  READY_CONVERSION: "bg-emerald-50 text-emerald-700",
  CONVERTED: "bg-emerald-50 text-emerald-700",
};

function blockerTone(severity: WorkflowBlocker["severity"]): string {
  if (severity === "blocking") return "bg-red-50 text-red-700";
  if (severity === "warning") return "bg-amber-50 text-amber-700";
  return "bg-secondary text-muted-foreground";
}

export function SellerStatusPill({ stage, stageLabel, primaryBlocker, secondaryBlockerCount }: {
  readonly stage: AcquisitionWorkflowStage;
  readonly stageLabel: string;
  readonly primaryBlocker: WorkflowBlocker | null;
  readonly secondaryBlockerCount: number;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="seller-status-pill">
      <span
        className={`max-w-full break-words rounded-full px-3 py-1 text-xs font-semibold ${STAGE_TONE[stage]}`}
        data-testid="seller-workflow-stage-badge"
      >
        {stageLabel}
      </span>
      {primaryBlocker !== null ? (
        <span
          className={`max-w-full break-words rounded-full px-2.5 py-1 text-[11px] font-semibold ${blockerTone(primaryBlocker.severity)}`}
          data-testid="seller-primary-blocker"
        >
          ⚠ {primaryBlocker.reason}
        </span>
      ) : null}
      {secondaryBlockerCount > 0 ? (
        <span className="text-[11px] font-medium text-muted-foreground" data-testid="seller-secondary-blocker-count">
          +{secondaryBlockerCount} more
        </span>
      ) : null}
    </div>
  );
}
