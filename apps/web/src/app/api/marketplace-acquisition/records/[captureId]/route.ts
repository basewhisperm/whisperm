import { type NextRequest, NextResponse } from "next/server";

import { readJsonBody, RequestBodyError } from "@/lib/api/request-body";
import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { requireSellerAcquisitionFeatureForApi } from "@/lib/tenant-features";
import {
  PrismaMarketplaceAcquisitionRepository,
  type PrismaPersistenceClient,
} from "@whisperm/repositories";
import { MarketplaceRequalificationService, SellerAcquisitionEditService } from "@whisperm/services";
import { createAcquisitionServiceBundle } from "@/lib/marketplace-acquisition/acquisition-services";

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

  const { services } = createAcquisitionServiceBundle();
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
  const { repositories, services } = createAcquisitionServiceBundle();

  const requalification = new MarketplaceRequalificationService({
    marketplaceCaptures: repositories.marketplaceCaptures,
    canonicalCapture: services.marketplaceAcquisition,
    auditLogs: repositories.auditLogs,
    sellerAcquisitionCampaigns: repositories.sellerAcquisitionCampaigns,
  });

  const editService = new SellerAcquisitionEditService({
    marketplaceAcquisition: new PrismaMarketplaceAcquisitionRepository(prismaPersistenceClient),
    draftInventories: repositories.draftInventories,
    requalification,
  });

  let editResult: Awaited<ReturnType<SellerAcquisitionEditService["editExtract"]>>;
  try {
    editResult = await editService.editExtract(
      {
        tenantId: tenant.id,
        actorId: tenantContext.tenantUserId,
        correlation: {
          correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
          requestId: request.headers.get("x-request-id") ?? undefined,
        },
      },
      context.params.captureId,
      body,
    );
  } catch (error) {
    // NOTE: editExtractInputSchema is validated inside @whisperm/services, which pins a
    // different zod major version than this package, so `instanceof z.ZodError` never
    // matches across that boundary. Match by name instead -- both zod v3 and v4 set
    // `this.name = "ZodError"` and both expose the same `.issues` shape.
    if (error instanceof Error && error.name === "ZodError") {
      const issues = (error as { readonly issues?: readonly { readonly message?: string }[] }).issues;
      return errorResponse(issues?.[0]?.message ?? "Invalid input", 400);
    }
    const asErr = error as { readonly status?: number; readonly message?: string };
    if (asErr.status === 404) return errorResponse("Marketplace capture not found.", 404);
    if (typeof asErr.status === "number") return errorResponse(asErr.message ?? "Request failed", asErr.status);
    throw error;
  }

  // Re-fetch the full record so the client gets updated data in one round-trip.
  const record = await services.sellerAcquisitionRecords.findByCaptureId(
    { tenantId: tenant.id },
    context.params.captureId,
  );

  return NextResponse.json({ ok: true, data: { record, ...editResult } });
}
