import { NextResponse } from "next/server";

import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const tenant = await getTenantForCurrentUser();
  if (!tenant) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const subscription = await prisma.subscription.findFirst({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: "desc" },
  });

  if (subscription === null) {
    return NextResponse.json({ ok: true, data: { plan: null, status: null, trialEndsAt: null } });
  }

  return NextResponse.json({
    ok: true,
    data: {
      plan: subscription.plan,
      status: subscription.status,
      trialEndsAt: subscription.trialEndsAt,
      currentPeriodEnd: subscription.currentPeriodEnd,
    },
  });
}
