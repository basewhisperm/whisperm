export const createTrialEndsAt = (now = new Date()): Date => {
  const trialEndsAt = new Date(now);
  trialEndsAt.setDate(trialEndsAt.getDate() + 14);
  return trialEndsAt;
};

export const isTrialExpired = (trialEndsAt: Date | string, now = new Date()): boolean =>
  new Date(trialEndsAt).getTime() <= now.getTime();

export interface TrialGateSubscriptionReader {
  findActiveOrTrialingSubscription(input: {
    tenantId: string;
    now: Date;
  }): Promise<{ status: string; trialEndsAt?: string | Date | null } | null>;
}

export const createTrialGate = (
  reader: TrialGateSubscriptionReader,
  now: () => Date = () => new Date(),
) => async (tenantId: string): Promise<"allowed" | "payment_required"> => {
  const subscription = await reader.findActiveOrTrialingSubscription({
    tenantId,
    now: now(),
  });

  return subscription === null ? "payment_required" : "allowed";
};
