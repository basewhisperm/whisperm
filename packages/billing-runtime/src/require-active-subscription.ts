/**
 * require-active-subscription.ts — Centralized trial/subscription gate.
 * Allows: ACTIVE, TRIALING (unexpired).
 * Blocks: expired trial, CANCELED, PAST_DUE, missing subscription -> throws (HTTP 402).
 */
import { createTrialGate, type TrialGateSubscriptionReader } from "./trial.js";
import { BillingError } from "./errors.js";

export const TRIAL_EXPIRED = "TRIAL_EXPIRED" as const;

export const createRequireActiveSubscription = (
  reader: TrialGateSubscriptionReader,
  now: () => Date = () => new Date(),
) => {
  const gate = createTrialGate(reader, now);
  return async (tenantId: string): Promise<void> => {
    const result = await gate(tenantId);
    if (result === "payment_required") {
      throw new BillingError({
        code: TRIAL_EXPIRED,
        message: "Your trial has expired. Please upgrade to continue.",
        statusCode: 402,
      });
    }
  };
};

export type RequireActiveSubscription = (tenantId: string) => Promise<void>;
