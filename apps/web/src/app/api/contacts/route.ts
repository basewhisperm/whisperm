import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { PrismaContactRepository } from "@whisperm/repositories";

type ContactStage = "PROSPECT" | "QUALIFIED" | "PROPOSAL" | "ENGAGEMENT" | "RENEWAL" | "INACTIVE";

function nullableString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStage(value: unknown): ContactStage | undefined {
  if (typeof value !== "string") return undefined;

  switch (value.trim().toUpperCase()) {
    case "PROSPECT":
      return "PROSPECT";
    case "QUALIFIED":
      return "QUALIFIED";
    case "PROPOSAL":
      return "PROPOSAL";
    case "ENGAGEMENT":
      return "ENGAGEMENT";
    case "RENEWAL":
      return "RENEWAL";
    case "INACTIVE":
      return "INACTIVE";
    default:
      return undefined;
  }
}

export async function GET() {
  const tenant = await getTenantForCurrentUser();
  if (!tenant) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const context = { tenantId: tenant.id };
  const repo = new PrismaContactRepository(prisma as any);
  const page = await repo.list(context, { limit: 50 });

  return NextResponse.json({ contacts: page.items, nextCursor: page.nextCursor });
}

export async function POST(request: NextRequest) {
  const tenant = await getTenantForCurrentUser();
  if (!tenant) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const context = { tenantId: tenant.id };
  const repo = new PrismaContactRepository(prisma as any);

  const firstName = nullableString(body.firstName);
  const lastName = nullableString(body.lastName);
  const email = nullableString(body.email);
  const phone = nullableString(body.phone);
  const stage = normalizeStage(body.stage);

  const contact = await repo.create(context, {
    tenantId: tenant.id,
    ...(firstName !== undefined ? { firstName } : {}),
    ...(lastName !== undefined ? { lastName } : {}),
    ...(email !== undefined ? { email } : {}),
    ...(phone !== undefined ? { phone } : {}),
    ...(stage !== undefined ? { stage } : {}),
  });

  return NextResponse.json(contact, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const tenant = await getTenantForCurrentUser();
  if (!tenant) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const id = nullableString(body.id);
  const expectedUpdatedAt = nullableString(body.expectedUpdatedAt);

  if (!id) {
    return NextResponse.json({ error: "Contact id is required" }, { status: 400 });
  }

  if (!expectedUpdatedAt) {
    return NextResponse.json({ error: "expectedUpdatedAt is required" }, { status: 400 });
  }

  const context = { tenantId: tenant.id };
  const repo = new PrismaContactRepository(prisma as any);
  const existing = await repo.findById(context, id);

  if (!existing) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const firstName = nullableString(body.firstName);
  const lastName = nullableString(body.lastName);
  const email = nullableString(body.email);
  const phone = nullableString(body.phone);
  const stage = normalizeStage(body.stage);

  try {
    const contact = await repo.update(context, id, {
      expectedUpdatedAt,
      ...(firstName !== undefined ? { firstName } : {}),
      ...(lastName !== undefined ? { lastName } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(phone !== undefined ? { phone } : {}),
      ...(stage !== undefined ? { stage } : {}),
    });

    return NextResponse.json({ contact });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Contact update failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 409 },
    );
  }
}
