import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenantForCurrentUser } from "@/lib/get-tenant";

const clean = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const iso = (value: unknown): string | null =>
  value instanceof Date
    ? value.toISOString()
    : typeof value === "string"
      ? value
      : null;

export async function GET() {
  const tenant = await getTenantForCurrentUser();
  if (!tenant) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await prisma.contact.findMany({
    where: { tenantId: tenant.id },
    take: 200,
    orderBy: { createdAt: "desc" },
  });

  const contacts = rows.map((contact) => ({
    id: contact.id,
    tenantId: contact.tenantId,
    firstName: clean(contact.firstName),
    lastName: clean(contact.lastName),
    company: clean(contact.company),
    email: clean(contact.email),
    phone: clean(contact.phone),
    stage: contact.stage,
    source: clean(contact.source),
    lastTouchAt: iso(contact.lastTouchAt),
    createdAt: iso(contact.createdAt) ?? new Date(0).toISOString(),
    updatedAt: iso(contact.updatedAt) ?? new Date(0).toISOString(),
  }));

  return NextResponse.json({ contacts, nextCursor: null });
}

export async function POST(request: NextRequest) {
  const tenant = await getTenantForCurrentUser();
  if (!tenant) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();

  const contact = await prisma.contact.create({
    data: {
      tenantId: tenant.id,
      firstName: clean(body.firstName),
      lastName: clean(body.lastName),
      company: clean(body.company),
      email: clean(body.email),
      phone: clean(body.phone),
      stage: body.stage || undefined,
      source: clean(body.source),
    },
  });

  return NextResponse.json({
    id: contact.id,
    tenantId: contact.tenantId,
    firstName: clean(contact.firstName),
    lastName: clean(contact.lastName),
    company: clean(contact.company),
    email: clean(contact.email),
    phone: clean(contact.phone),
    stage: contact.stage,
    source: clean(contact.source),
    lastTouchAt: iso(contact.lastTouchAt),
    createdAt: iso(contact.createdAt) ?? new Date(0).toISOString(),
    updatedAt: iso(contact.updatedAt) ?? new Date(0).toISOString(),
  }, { status: 201 });
}
