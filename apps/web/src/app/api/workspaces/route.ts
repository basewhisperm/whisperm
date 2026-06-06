import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaces = await prisma.tenant.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, slug: true },
  });

  return NextResponse.json({ workspaces });
}
