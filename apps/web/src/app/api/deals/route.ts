import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PrismaDealsRepository, PrismaPipelineRepository } from "@whisperm/repositories";

export async function GET() {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tenant = await prisma.tenant.findFirst({ orderBy: { createdAt: "asc" } });
  if (!tenant) return NextResponse.json({ error: "No workspace found" }, { status: 404 });

  const workspaceId = tenant.id;
  const dealsRepo = new PrismaDealsRepository(prisma as any);
  const pipelineRepo = new PrismaPipelineRepository(prisma as any);

  const [pipeline, deals] = await Promise.all([
    pipelineRepo.findByWorkspace(workspaceId),
    dealsRepo.list(workspaceId),
  ]);

  return NextResponse.json({ pipeline, deals });
}
