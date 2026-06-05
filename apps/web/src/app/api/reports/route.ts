import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PrismaReportsRepository } from "@whisperm/repositories";

export async function GET(request: NextRequest) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tenant = await prisma.tenant.findFirst({ orderBy: { createdAt: "asc" } });
  if (!tenant) return NextResponse.json({ error: "No workspace found" }, { status: 404 });

  const context = { tenantId: tenant.id };
  const repo = new PrismaReportsRepository(prisma as any);

  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") ?? "this_month";

  const now = new Date();
  let startDate: Date;
  let endDate: Date = new Date(now);

  switch (range) {
    case "last_month":
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case "quarter":
      startDate = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
      break;
    case "year":
      startDate = new Date(now.getFullYear(), 0, 1);
      break;
    default: // this_month
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  const period = { startDate, endDate };

  const [revenueByStage, acquisitionSources, avgDaysToClose, renewalRate] = await Promise.all([
    repo.revenueByStage(context, period),
    repo.clientAcquisitionSources(context, period),
    repo.averageDaysToClose(context, period),
    repo.renewalRate(context, period),
  ]);

  return NextResponse.json({
    revenueByStage,
    acquisitionSources,
    avgDaysToClose: avgDaysToClose.avgDaysToClose,
    renewalRate: renewalRate.rate,
  });
}
