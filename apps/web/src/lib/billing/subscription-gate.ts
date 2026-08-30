import { prisma } from "@/lib/prisma";

/** Mirrors apps/api's createTrialGate semantics: TRIALING only counts once trialEndsAt is in the future. */
export function isTrialExpired(trialEndsAt: Date | string, now: Date): boolean {
  return new Date(trialEndsAt).getTime() <= now.getTime();
}

/**
 * Whether a tenant currently has paid-feature entitlement from billing
 * alone -- ACTIVE, or TRIALING with an unexpired trial. Everything else
 * (PAST_DUE, CANCELED, UNPAID, an expired trial, or no subscription row at
 * all) is not entitled. Fails closed: any lookup error is treated the same
 * as "not entitled" by the caller, never as "entitled".
 */
export async function hasActiveOrTrialingSubscription(
  tenantId: string,
  now: () => Date = () => new Date(),
): Promise<boolean> {
  const subscription = await prisma.subscription.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
    select: { status: true, trialEndsAt: true },
  });

  if (!subscription) return false;
  if (subscription.status === "ACTIVE") return true;
  if (subscription.status === "TRIALING" && subscription.trialEndsAt !== null) {
    return !isTrialExpired(subscription.trialEndsAt, now());
  }

  return false;
}
