import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export function paidPlanRequiredResponse(): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: {
        message: "Automated seller acquisition (campaigns and discovery) requires an active (paid) subscription. Manual capture stays available during your trial.",
        code: "PAID_PLAN_REQUIRED",
      },
    },
    { status: 402 },
  );
}

/**
 * Gates the *automated* half of seller acquisition (campaign creation, discovery runs,
 * bulk-invite) behind an ACTIVE (paid) subscription specifically -- not the more permissive
 * "active or unexpired trial" check used elsewhere (createRequireActiveSubscription in
 * @whisperm/billing-runtime), which would let trial workspaces through too. Manual single-listing
 * capture is deliberately not gated by this -- it stays available (subject to its own quota,
 * see require-manual-capture-quota.ts) throughout the trial, since proving the manual golden path
 * is how a trial workspace decides to upgrade.
 */
export async function requireActivePlanForApi(tenantId: string): Promise<NextResponse | null> {
  const subscription = await prisma.subscription.findFirst({
    where: { tenantId, status: "ACTIVE" },
  });

  return subscription === null ? paidPlanRequiredResponse() : null;
}
