import { NextRequest, NextResponse } from "next/server";

import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { createPrismaRepositories, type PrismaPersistenceClient } from "@whisperm/repositories";
import { createWhispeRMServices, ServiceError } from "@whisperm/services";

export async function POST(request: NextRequest) {
  const tenant = await getTenantForCurrentUser();

  if (!tenant) {
    return NextResponse.json({ ok: false, error: { message: "Unauthorized" } }, { status: 401 });
  }

  try {
    const body = await request.json();

    const repositories = createPrismaRepositories(prisma as unknown as PrismaPersistenceClient);
    const services = createWhispeRMServices(repositories);

    const result = await services.marketplaceAcquisition.capture(
      {
        tenantId: tenant.id,
        correlation: {
          correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
          requestId: request.headers.get("x-request-id") ?? undefined,
        },
      },
      {
        ...body,
        tenantId: tenant.id,
        images: Array.isArray(body.images) ? body.images : [],
        imageUrls: Array.isArray(body.imageUrls) ? body.imageUrls : [],
      },
    );

    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json(
        { ok: false, error: { message: error.message, code: error.code } },
        { status: error.status },
      );
    }

    return NextResponse.json({ ok: false, error: { message: "Capture failed." } }, { status: 500 });
  }
}
