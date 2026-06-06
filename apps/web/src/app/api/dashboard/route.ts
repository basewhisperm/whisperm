import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { PrismaDashboardRepository } from "@whisperm/repositories";

export async function GET() {
  const tenant = await getTenantForCurrentUser();
  if (!tenant) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const context = { tenantId: tenant.id };
  const repo = new PrismaDashboardRepository(prisma as any);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);

  const [activeContacts, pipelineValue, healthContacts, followUpAlerts, activities] = await Promise.all([
    repo.countActiveContacts(context),
    repo.sumOpenPipelineValue(context),
    repo.listContactsForHealth(context),
    repo.listContactsForFollowUpAlerts(context, cutoff),
    repo.listLatestActivities(context, 5),
  ]);

  return NextResponse.json({
    activeContacts,
    pipelineValue,
    healthContacts,
    followUpAlerts,
    activities,
  });
}
