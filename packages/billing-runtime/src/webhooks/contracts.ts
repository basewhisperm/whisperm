import type { BillingSubscriptionSnapshot } from "../providers/stripe.js";

export interface ApplySubscriptionChangeInput {
  readonly tenantId: string;
  readonly provider: "STRIPE" | "PAYSTACK";
  readonly providerEventId: string;
  readonly eventType: string;
  readonly snapshot: BillingSubscriptionSnapshot;
}

/**
 * A single atomic operation: record the dedup marker for (tenantId, provider, providerEventId)
 * AND apply the subscription snapshot, or do neither. There is deliberately no separate
 * reserve/apply/markSucceeded sequence here -- a webhook retry landing between two of those
 * steps is exactly how a subscription change can go missing forever while the dedup marker
 * insists the event was already handled. Implementations should do this inside one database
 * transaction.
 */
export interface BillingWebhookPort {
  applySubscriptionChange(input: ApplySubscriptionChangeInput): Promise<"applied" | "duplicate">;
}

export interface WebhookResult {
  readonly status: number;
  readonly body: Record<string, unknown>;
}
