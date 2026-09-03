import { type NextRequest } from "next/server";

import { apiFailure, apiSuccess } from "@/app/api/_lib/api-response";
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

interface RouteContext {
  readonly params: { readonly captureId: string };
}

const validCaptureId = (context: RouteContext): string | null => {
  const captureId = context.params.captureId?.trim();
  return captureId === undefined || captureId.length === 0 ? null : captureId;
};

export async function GET(_request: Request, context: RouteContext) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return apiFailure(401, "UNAUTHORIZED", "Unauthorized");
  const { tenant } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  const captureId = validCaptureId(context);
  if (captureId === null) return apiFailure(400, "VALIDATION_ERROR", "captureId is required.");

  const { services } = createAcquisitionServiceBundle();
  const record = await services.sellerAcquisitionRecords.findByCaptureId(
    { tenantId: tenant.id },
    captureId,
  );
  if (record === null) return apiFailure(404, "NOT_FOUND", "Marketplace capture not found.");

  return apiSuccess({ record });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return apiFailure(401, "UNAUTHORIZED", "Unauthorized");
  const { tenant } = tenantContext;
  const featureDenied = await requireSellerAcquisitionFeatureForApi(tenant.id);
  if (featureDenied) return featureDenied;

  const captureId = validCaptureId(context);
  if (captureId === null) return apiFailure(400, "VALIDATION_ERROR", "captureId is required.");

  let body: unknown;
  try {
    body = await readJsonBody(request, { maxBytes: 32_000 });
  } catch (error) {
    if (error instanceof RequestBodyError) return apiFailure(error.status, "VALIDATION_ERROR", error.message);
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
      captureId,
      body,
    );
  } catch (error) {
    // NOTE: editExtractInputSchema is validated inside @whisperm/services, which pins a
    // different zod major version than this package, so `instanceof z.ZodError` never
    // matches across that boundary. Match by name instead -- both zod v3 and v4 set
    // `this.name = "ZodError"` and both expose the same `.issues` shape.
    if (error instanceof Error && error.name === "ZodError") {
      const issues = (error as { readonly issues?: readonly { readonly message?: string }[] }).issues;
      return apiFailure(400, "VALIDATION_ERROR", issues?.[0]?.message ?? "Invalid input");
    }
    const asErr = error as { readonly status?: number; readonly message?: string };
    if (asErr.status === 404) return apiFailure(404, "NOT_FOUND", "Marketplace capture not found.");
    if (typeof asErr.status === "number") return apiFailure(asErr.status, "VALIDATION_ERROR", asErr.message ?? "Request failed");
    throw error;
  }

  // Re-fetch the full record so the client gets updated data in one round-trip.
  const record = await services.sellerAcquisitionRecords.findByCaptureId(
    { tenantId: tenant.id },
    captureId,
  );

  return apiSuccess({ record, ...editResult });
}
