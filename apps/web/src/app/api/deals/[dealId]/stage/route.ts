import { NextRequest, NextResponse } from "next/server";

import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { readJsonBody, RequestBodyError } from "@/lib/api/request-body";
import { createPrismaRepositories, PrismaDealsRepository, type PrismaPersistenceClient } from "@whisperm/repositories";
import { createWhispeRMServices, ServiceError } from "@whisperm/services";

interface RouteContext {
  readonly params: {
    readonly dealId: string;
  };
}

function requestedStageId(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("stageId" in body)) return null;
  const stageId = (body as { readonly stageId?: unknown }).stageId;
  return typeof stageId === "string" && stageId.trim().length > 0 ? stageId : null;
}

const errorResponse = (message: string, status: number, code?: string) =>
  NextResponse.json({ ok: false, error: { code: code ?? "REQUEST_FAILED", message } }, { status });

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return errorResponse("Unauthorized", 401, "UNAUTHORIZED");
  const { tenant, tenantUserId } = tenantContext;

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    if (error instanceof RequestBodyError) return errorResponse(error.message, error.status, error.code);
    return errorResponse("Request body must be valid JSON.", 400);
  }

  const stageId = requestedStageId(body);
  if (stageId === null) {
    return errorResponse("A stageId is required", 400, "REQUEST_BODY_INVALID");
  }

  const persistenceClient = prisma as unknown as PrismaPersistenceClient;
  const dealsRepo = new PrismaDealsRepository(persistenceClient);
  const deal = await dealsRepo.findById(tenant.id, params.dealId);
  if (!deal || deal.updatedAt === undefined) {
    return errorResponse("Deal not found", 404, "DEAL_NOT_FOUND");
  }

  const services = createWhispeRMServices(createPrismaRepositories(persistenceClient));

  try {
    const updated = await services.deals.moveStage(
      {
        tenantId: tenant.id,
        actorId: tenantUserId,
        correlation: {
          correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
          requestId: request.headers.get("x-request-id") ?? undefined,
        },
      },
      deal.id,
      { stageId, expectedUpdatedAt: deal.updatedAt },
    );

    return NextResponse.json({ ok: true, data: updated });
  } catch (error) {
    if (error instanceof ServiceError) {
      return errorResponse(error.message, error.status, error.code);
    }

    return errorResponse("Failed to update deal stage.", 500);
  }
}
