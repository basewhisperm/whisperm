import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

/**
 * Manual capture is the free/trial-tier acquisition path (see require-paid-plan.ts for the
 * automated-acquisition gate) -- it stays available throughout the trial, just capped, so a
 * trial workspace can prove the golden path before deciding to upgrade.
 */
export const MANUAL_CAPTURE_TRIAL_LIMIT = 10;

export function manualCaptureQuotaExceededResponse(): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: {
        message: `Trial workspaces can manually capture up to ${MANUAL_CAPTURE_TRIAL_LIMIT} sellers. Upgrade for unlimited manual capture and automated discovery/campaigns.`,
        code: "QUOTA_EXCEEDED",
      },
    },
    { status: 402 },
  );
}

export async function requireManualCaptureQuota(tenantId: string): Promise<NextResponse | null> {
  const subscription = await prisma.subscription.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  });

  // No subscription, or already past trial (ACTIVE/PAST_DUE/etc): not this gate's concern --
  // ACTIVE is unlimited, and a missing/expired subscription is caught by requireActivePlanForApi
  // wherever that's already enforced.
  if (subscription === null || subscription.status !== "TRIALING") return null;

  const captureCount = await prisma.marketplaceCapture.count({ where: { tenantId } });
  if (captureCount >= MANUAL_CAPTURE_TRIAL_LIMIT) return manualCaptureQuotaExceededResponse();

  return null;
}
