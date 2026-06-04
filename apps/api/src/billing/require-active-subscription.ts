/**
 * require-active-subscription.ts — Centralized trial/subscription gate.
 * Allows: ACTIVE, TRIALING (unexpired).
 * Blocks: expired trial, CANCELED, PAST_DUE, missing subscription → HTTP 402.
 * Uses existing createTrialGate — no new logic.
 */
import { createTrialGate, type TrialGateSubscriptionReader } from "./trial.js";
import { ApiError } from "../errors.js";

export const TRIAL_EXPIRED = "TRIAL_EXPIRED" as const;

export const createRequireActiveSubscription = (
  reader: TrialGateSubscriptionReader,
  now: () => Date = () => new Date(),
) => {
  const gate = createTrialGate(reader, now);
  return async (tenantId: string): Promise<void> => {
    const result = await gate(tenantId);
    if (result === "payment_required") {
      throw new ApiError({
        code: TRIAL_EXPIRED,
        message: "Your trial has expired. Please upgrade to continue.",
        statusCode: 402,
      });
    }
  };
};

export type RequireActiveSubscription = (tenantId: string) => Promise<void>;
