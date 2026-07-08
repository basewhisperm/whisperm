import { z } from "zod";

/**
 * ST1-013E -- canonical acquisition metrics contracts.
 *
 * These shapes are the only acquisition metric contracts any layer of
 * WhispeRM should use. Dashboard, Workbench, Campaigns, Bulk Invitation, and
 * Command Center all render values that originate from these types --
 * nothing recomputes them with its own filter/reduce logic.
 */

export const queueStateValues = [
  "REVIEW",
  "PHONE_READY",
  "INVITATION_READY",
  "INVITATION_PENDING",
  "WAITING_CLAIM",
  "CLAIMED",
  "READY_CONVERSION",
  "CONVERTED",
  "BLOCKED",
] as const;
export const queueStateSchema = z.enum(queueStateValues);
export type QueueState = z.output<typeof queueStateSchema>;

/**
 * The result of classifying a single seller. `blockedReason` is populated
 * only when `state` is `"BLOCKED"` -- a blocked seller must always expose
 * why it cannot advance.
 */
export interface QueueStateSummary {
  readonly state: QueueState;
  readonly blockedReason?: string | undefined;
}

/**
 * The canonical acquisition domain facts. Every acquisition count rendered
 * anywhere in WhispeRM (Dashboard, Workbench, Campaigns, Bulk Invitation,
 * Command Center) must trace back to one of these fields.
 */
export interface AcquisitionMetrics {
  readonly totalCaptured: number;
  readonly needsReview: number;
  readonly phoneReady: number;
  readonly invitationReady: number;
  readonly invitationPending: number;
  readonly waitingClaim: number;
  readonly claimed: number;
  readonly readyConversion: number;
  readonly converted: number;
  readonly blocked: number;
  readonly totalCampaignMembers: number;
}

/** Dashboard cards render this directly -- no filtering, no counting, no map/reduce. */
export type DashboardMetrics = AcquisitionMetrics;

/** Workbench header and queue tiles render this directly. */
export type QueueMetrics = AcquisitionMetrics;

/** A single campaign's metrics -- same domain facts, scoped to campaign membership. */
export interface CampaignMetrics extends AcquisitionMetrics {
  readonly campaignId: string;
  readonly campaignName: string;
}

/**
 * Development-mode provenance metadata. Attaching this to a metrics response
 * makes it obvious every screen is reading from the same engine, which is
 * useful when diagnosing a reported mismatch.
 */
export interface MetricsProvenance {
  readonly generatedAt: string;
  readonly source: "AcquisitionMetricsService";
  readonly version: 1;
}

export interface MetricsEnvelope<T> {
  readonly metrics: T;
  readonly provenance: MetricsProvenance;
}
