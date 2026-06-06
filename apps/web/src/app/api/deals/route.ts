import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { PrismaDealsRepository, PrismaPipelineRepository } from "@whisperm/repositories";

export async function GET() {
  const tenant = await getTenantForCurrentUser();
  if (!tenant) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaceId = tenant.id;
  const dealsRepo = new PrismaDealsRepository(prisma as any);
  const pipelineRepo = new PrismaPipelineRepository(prisma as any);

  const [pipeline, deals] = await Promise.all([
    pipelineRepo.findByWorkspace(workspaceId),
    dealsRepo.list(workspaceId),
  ]);

  return NextResponse.json({ pipeline, deals });
}
