import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { PrismaContactRepository } from "@whisperm/repositories";

const CONTACT_STAGES = new Set(["PROSPECT", "QUALIFIED", "PROPOSAL", "ENGAGEMENT", "RENEWAL", "INACTIVE"]);

function nullableString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStage(
  value: unknown,
): "PROSPECT" | "QUALIFIED" | "PROPOSAL" | "ENGAGEMENT" | "RENEWAL" | "INACTIVE" | undefined {
  if (typeof value !== "string") return undefined;

  const normalized = value.trim().toUpperCase();
  return CONTACT_STAGES.has(normalized) ? normalized : undefined;
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

  const contact = await repo.create(context, {
    tenantId: tenant.id,
    firstName: nullableString(body.firstName) ?? undefined,
    lastName: nullableString(body.lastName) ?? undefined,
    email: nullableString(body.email) ?? undefined,
    phone: nullableString(body.phone) ?? undefined,
    stage: normalizeStage(body.stage),
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

  try {
    const contact = await repo.update(context, id, {
      expectedUpdatedAt,
      firstName: nullableString(body.firstName),
      lastName: nullableString(body.lastName),
      email: nullableString(body.email),
      phone: nullableString(body.phone),
      stage: normalizeStage(body.stage),
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
