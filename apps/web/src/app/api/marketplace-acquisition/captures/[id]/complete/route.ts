import { NextRequest, NextResponse } from "next/server";

import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { createPrismaRepositories, type PrismaPersistenceClient } from "@whisperm/repositories";
import {
  MarketplaceCaptureCompletionError,
  MarketplaceCaptureCompletionService,
  ServiceError,
} from "@whisperm/services";

interface RouteContext {
  readonly params: {
    readonly id: string;
  };
}

const clean = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const errorResponse = (message: string, status: number, code?: string): NextResponse =>
  NextResponse.json(
    {
      ok: false,
      error: {
        message,
        ...(code === undefined ? {} : { code }),
      },
    },
    { status },
  );

export async function POST(request: NextRequest, { params }: RouteContext) {
  const tenant = await getTenantForCurrentUser();
  if (!tenant) return errorResponse("Unauthorized", 401, "AUTH_REQUIRED");

  const marketplaceCaptureId = clean(params.id);
  if (marketplaceCaptureId === undefined) {
    return errorResponse("Marketplace capture id is required.", 400, "REQUEST_BODY_INVALID");
  }

  const repositories = createPrismaRepositories(prisma as unknown as PrismaPersistenceClient);
  const service = new MarketplaceCaptureCompletionService({
    marketplaceCaptures: repositories.marketplaceCaptures,
    draftInventories: repositories.draftInventories,
    renderConversions: repositories.renderConversions,
    pipelines: repositories.pipelines,
    deals: repositories.deals,
    auditLogs: repositories.auditLogs,
  });

  try {
    const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
    const requestId = request.headers.get("x-request-id") ?? undefined;

    const result = await service.completeCapture(
      {
        tenantId: tenant.id,
        correlation: {
          correlationId,
          requestId,
        },
      },
      {
        tenantId: tenant.id,
        marketplaceCaptureId,
      },
    );

    return NextResponse.json({
      ok: true,
      data: {
        captureId: result.captureId,
        draftInventoryId: result.draftInventoryId,
        sellerConversionId: result.sellerConversionId,
        inventoryConversionId: result.inventoryConversionId,
        status: result.status,
        idempotent: result.idempotent,
      },
      meta: {
        correlationId,
      },
    });
  } catch (error) {
    if (error instanceof MarketplaceCaptureCompletionError || error instanceof ServiceError) {
      return errorResponse(error.message, error.status, error.code);
    }

    return errorResponse("Marketplace capture completion failed.", 500, "MARKETPLACE_CAPTURE_COMPLETION_FAILED");
  }
}
