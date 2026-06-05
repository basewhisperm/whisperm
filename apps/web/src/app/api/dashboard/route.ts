import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PrismaDashboardRepository } from "@whisperm/repositories";

export async function GET() {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // For now use the first tenant — workspace selection comes later
  const tenant = await prisma.tenant.findFirst({ orderBy: { createdAt: "asc" } });
  if (!tenant) return NextResponse.json({ error: "No workspace found" }, { status: 404 });

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
