import {
  ACQUISITION_WORKFLOW_PROGRESS_NODES,
  type AcquisitionWorkflowStage,
  type WorkflowBlocker,
  type WorkflowNextAction,
} from "@whisperm/services/acquisition-workflow";

const STAGE_TO_NODE_INDEX: Readonly<Record<AcquisitionWorkflowStage, number>> = Object.fromEntries(
  ACQUISITION_WORKFLOW_PROGRESS_NODES.flatMap((node, index) => node.stages.map((stage) => [stage, index] as const)),
) as Record<AcquisitionWorkflowStage, number>;

function blockerTone(severity: WorkflowBlocker["severity"]): string {
  if (severity === "blocking") return "bg-red-50 text-red-700";
  if (severity === "warning") return "bg-amber-50 text-amber-700";
  return "bg-secondary text-muted-foreground";
}

/**
 * Canonical workflow cockpit: current lifecycle stage, progress through the
 * Golden Path, the single next required action, and why progress is blocked
 * (if it is). This is the one component every acquisition surface -- seller
 * detail, campaign workbench, campaign summary -- uses to answer "what is
 * the next action required to move this seller toward becoming a customer?"
 */
export function WorkflowProgress({ stage, nextAction, blockers = [], compact = false }: {
  readonly stage: AcquisitionWorkflowStage;
  readonly nextAction: WorkflowNextAction;
  readonly blockers?: readonly WorkflowBlocker[];
  readonly compact?: boolean;
}) {
  const currentIndex = STAGE_TO_NODE_INDEX[stage];

  return (
    <section aria-label="Acquisition workflow progress" className="space-y-3" data-testid="workflow-progress" data-workflow-stage={stage}>
      <ol className={`flex flex-wrap items-center gap-x-1 gap-y-2 ${compact ? "text-[11px]" : "text-xs"}`}>
        {ACQUISITION_WORKFLOW_PROGRESS_NODES.map((node, index) => {
          const status = index < currentIndex ? "done" : index === currentIndex ? "current" : "upcoming";
          return (
            <li key={node.id} className="flex items-center gap-1" data-testid={`workflow-node-${node.id}`} data-workflow-node-status={status}>
              <span
                aria-hidden="true"
                className={
                  status === "current"
                    ? "text-whisper"
                    : status === "done"
                      ? "text-emerald-600"
                      : "text-muted-foreground/40"
                }
              >
                {status === "done" ? "✓" : status === "current" ? "●" : "○"}
              </span>
              <span className={status === "current" ? "font-semibold text-foreground" : status === "done" ? "text-foreground" : "text-muted-foreground/60"}>
                {node.label}
              </span>
              {index < ACQUISITION_WORKFLOW_PROGRESS_NODES.length - 1 ? <span aria-hidden="true" className="mx-1 text-muted-foreground/40">→</span> : null}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-col gap-2 rounded-xl bg-secondary p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Next action</p>
          <p className="mt-0.5 text-sm font-semibold text-foreground" data-testid="workflow-next-action">{nextAction.label}</p>
        </div>
      </div>

      {blockers.length > 0 ? (
        <ul className="flex flex-wrap gap-2" data-testid="workflow-blockers">
          {blockers.map((blocker) => (
            <li key={blocker.reason} className={`max-w-full break-words rounded-full px-2.5 py-1 text-[11px] font-semibold ${blockerTone(blocker.severity)}`}>
              {blocker.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
