import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody, RequestBodyError } from "@/lib/api/request-body";
import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import {
  PrismaMarketplaceAcquisitionRepository,
  createPrismaRepositories,
  type PrismaPersistenceClient,
} from "@whisperm/repositories";
import { createWhispeRMServices, SellerAcquisitionEditService } from "@whisperm/services";

const errorResponse = (message: string, status: number) =>
  NextResponse.json({ ok: false, error: { message } }, { status });

interface RouteContext {
  readonly params: { readonly captureId: string };
}

export async function GET(_request: Request, context: RouteContext) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return errorResponse("Unauthorized", 401);
  const { tenant } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  const repositories = createPrismaRepositories(prisma as unknown as PrismaPersistenceClient);
  const services = createWhispeRMServices(repositories);
  const record = await services.sellerAcquisitionRecords.findByCaptureId(
    { tenantId: tenant.id },
    context.params.captureId,
  );
  if (record === null) return errorResponse("Marketplace capture not found.", 404);

  return NextResponse.json({ ok: true, data: { record } });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return errorResponse("Unauthorized", 401);
  const { tenant } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  let body: unknown;
  try {
    body = await readJsonBody(request, { maxBytes: 32_000 });
  } catch (error) {
    if (error instanceof RequestBodyError) return errorResponse(error.message, error.status);
    body = {};
  }
  const prismaPersistenceClient = prisma as unknown as PrismaPersistenceClient;
  const repositories = createPrismaRepositories(prismaPersistenceClient);

  const editService = new SellerAcquisitionEditService({
    marketplaceAcquisition: new PrismaMarketplaceAcquisitionRepository(prismaPersistenceClient),
    draftInventories: repositories.draftInventories,
  });

  try {
    await editService.editExtract({ tenantId: tenant.id }, context.params.captureId, body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(error.issues[0]?.message ?? "Invalid input", 400);
    }
    const asErr = error as { readonly status?: number; readonly message?: string };
    if (asErr.status === 404) return errorResponse("Marketplace capture not found.", 404);
    throw error;
  }

  // Re-fetch the full record so the client gets updated data in one round-trip.
  const services = createWhispeRMServices(repositories);
  const record = await services.sellerAcquisitionRecords.findByCaptureId(
    { tenantId: tenant.id },
    context.params.captureId,
  );

  return NextResponse.json({ ok: true, data: { record } });
}
