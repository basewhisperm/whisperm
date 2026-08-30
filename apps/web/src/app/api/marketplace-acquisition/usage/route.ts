import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import {
  createPrismaRepositories,
  type PrismaPersistenceClient,
} from "@whisperm/repositories";
import { AcquisitionUsageMeteringService } from "@whisperm/services";
import { getCurrentPlanUsage } from "@/lib/billing/plan-usage";

const errorResponse = (message: string, status: number) => NextResponse.json({ ok: false, error: { message } }, { status });

// CS-023: thin read-model route -- computation lives entirely in
// AcquisitionUsageMeteringService, which reads the centralized usage ledger.
// This route only authenticates, gates the seller-acquisition feature flag,
// validates the requested period, and delegates. No invoice or provider
// token data is returned here -- that is out of scope for this slice.
const usageMeteringService = () => {
  const persistence = prisma as unknown as PrismaPersistenceClient;
  const repositories = createPrismaRepositories(persistence);
  return new AcquisitionUsageMeteringService({ usageEvents: repositories.acquisitionUsageEvents });
};

const querySchema = z.object({
  periodStart: z.string().trim().min(1).datetime(),
  periodEnd: z.string().trim().min(1).datetime(),
}).strict().refine((input) => new Date(input.periodStart).getTime() <= new Date(input.periodEnd).getTime(), {
  message: "periodStart must not be after periodEnd",
  path: ["periodStart"],
});

const startOfCurrentUtcMonth = (now: Date): Date => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export async function GET(request: NextRequest) {
  const tenant = await getTenantForCurrentUser();
  if (!tenant) return errorResponse("Unauthorized", 401);
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  const now = new Date();
  const searchParams = request.nextUrl.searchParams;
  const rawPeriodStart = searchParams.get("periodStart") ?? startOfCurrentUtcMonth(now).toISOString();
  const rawPeriodEnd = searchParams.get("periodEnd") ?? now.toISOString();

  const parsed = querySchema.safeParse({ periodStart: rawPeriodStart, periodEnd: rawPeriodEnd });
  if (!parsed.success) return errorResponse("periodStart and periodEnd must be valid ISO 8601 timestamps with periodStart on or before periodEnd.", 400);

  try {
    const requestedPeriodStart = new Date(parsed.data.periodStart);
    const requestedPeriodEnd = new Date(parsed.data.periodEnd);
    const [summary, planUsage] = await Promise.all([
      usageMeteringService().getUsageSummary({ tenantId: tenant.id }, {
        periodStart: requestedPeriodStart,
        periodEnd: requestedPeriodEnd,
      }),
      getCurrentPlanUsage(tenant.id, now),
    ]);
    return NextResponse.json({
      ok: true,
      data: {
        periodStart: summary.periodStart,
        periodEnd: summary.periodEnd,
        totals: summary.totals.map((total) => ({ eventType: total.eventType, quantity: total.quantity, billableQuantity: total.billableQuantity })),
        billableTotalQuantity: summary.billableTotalQuantity,
        plan: planUsage.plan,
        includedBillableActions: planUsage.includedBillableActions,
        remainingBillableActions: planUsage.remainingBillableActions,
        generatedAt: now.toISOString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load acquisition usage summary.";
    return errorResponse(message, 500);
  }
}
