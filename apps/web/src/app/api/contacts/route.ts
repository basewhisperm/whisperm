import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { PrismaContactRepository } from "@whisperm/repositories";

export async function GET() {
  const tenant = await getTenantForCurrentUser();
  if (!tenant) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const context = { tenantId: tenant.id };
  const repo = new PrismaContactRepository(prisma as any);
  const page = await repo.list(context, { limit: 200 });
  const contacts = [...page.items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return NextResponse.json({ contacts, nextCursor: page.nextCursor });
}

export async function POST(request: NextRequest) {
  const tenant = await getTenantForCurrentUser();
  if (!tenant) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const context = { tenantId: tenant.id };
  const repo = new PrismaContactRepository(prisma as any);

  const contact = await repo.create(context, {
    tenantId: tenant.id,
    firstName: body.firstName || undefined,
    lastName: body.lastName || undefined,
    email: body.email || undefined,
    phone: body.phone || undefined,
    stage: body.stage || undefined,
  });

  return NextResponse.json(contact, { status: 201 });
}
