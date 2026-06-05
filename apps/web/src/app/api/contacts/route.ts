import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PrismaContactRepository } from "@whisperm/repositories";

export async function GET() {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tenant = await prisma.tenant.findFirst({ orderBy: { createdAt: "asc" } });
  if (!tenant) return NextResponse.json({ error: "No workspace found" }, { status: 404 });

  const context = { tenantId: tenant.id };
  const repo = new PrismaContactRepository(prisma as any);

  const page = await repo.list(context, { limit: 50 });

  return NextResponse.json({ contacts: page.items, nextCursor: page.nextCursor });
}
