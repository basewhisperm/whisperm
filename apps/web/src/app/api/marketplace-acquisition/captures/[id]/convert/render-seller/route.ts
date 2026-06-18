import { NextRequest, NextResponse } from "next/server";

import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { createPrismaRepositories, type PrismaPersistenceClient } from "@whisperm/repositories";
import {
  RenderSellerConversionError,
  RenderSellerConversionService,
  ServiceError,
} from "@whisperm/services";

interface RouteContext {
  readonly params: {
    readonly id: string;
  };
}

const clean = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const errorResponse = (
  message: string,
  status: number,
  code?: string,
): NextResponse =>
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

const createRenderSellerConnector = () => ({
  async createRenderSeller(input: {
    readonly name: string;
    readonly phone?: string | null | undefined;
    readonly email?: string | null | undefined;
    readonly location?: string | null | undefined;
    readonly marketplaceProfileUrl?: string | null | undefined;
    readonly marketplaceIdentifier: string;
    readonly marketplaceSource: string;
    readonly sourceCaptureId: string;
    readonly sourceTenantId: string;
    readonly idempotencyKey: string;
  }): Promise<{ readonly renderSellerId: string; readonly status: "CREATED" | "EXISTS"; readonly rawResponse?: unknown }> {
    const baseUrl = process.env.RENDER_API_BASE_URL?.replace(/\/+$/u, "");
    const apiKey = process.env.RENDER_API_KEY;

    if (baseUrl === undefined || baseUrl.length === 0 || apiKey === undefined || apiKey.length === 0) {
      throw new Error("Render seller connector is not configured.");
    }

    const response = await fetch(`${baseUrl}/seller-accounts`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey,
      },
      body: JSON.stringify(input),
    });

    const rawResponse = await response.json().catch(() => ({} as unknown));

    if (!response.ok) {
      throw new Error(`Render seller API request failed with status ${response.status}.`);
    }

    const parsed =
      typeof rawResponse === "object" && rawResponse !== null
        ? (rawResponse as { readonly renderSellerId?: unknown; readonly id?: unknown; readonly status?: unknown })
        : {};

    const renderSellerId =
      typeof parsed.renderSellerId === "string"
        ? parsed.renderSellerId
        : typeof parsed.id === "string"
          ? parsed.id
          : undefined;

    if (renderSellerId === undefined || renderSellerId.trim().length === 0) {
      throw new Error("Render seller API response did not include a seller id.");
    }

    return {
      renderSellerId,
      status: parsed.status === "EXISTS" || response.status === 200 ? "EXISTS" : "CREATED",
      rawResponse,
    };
  },
});

export async function POST(request: NextRequest, { params }: RouteContext) {
  const tenant = await getTenantForCurrentUser();
  if (!tenant) return errorResponse("Unauthorized", 401, "AUTH_REQUIRED");

  const marketplaceCaptureId = clean(params.id);
  if (marketplaceCaptureId === undefined) {
    return errorResponse("Marketplace capture id is required.", 400, "REQUEST_BODY_INVALID");
  }

  const repositories = createPrismaRepositories(prisma as unknown as PrismaPersistenceClient);
  const service = new RenderSellerConversionService({
    marketplaceCaptures: repositories.marketplaceCaptures,
    draftInventories: repositories.draftInventories,
    ownershipAttestations: repositories.ownershipAttestations,
    renderConversions: repositories.renderConversions,
    contacts: repositories.contacts,
    auditLogs: repositories.auditLogs,
    activities: repositories.activities,
    connector: createRenderSellerConnector(),
  });

  try {
    const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
    const requestId = request.headers.get("x-request-id") ?? undefined;

    const result = await service.convertClaimedSellerToRender(
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
        contactId: result.contactId,
        attestationId: result.attestationId,
        renderSellerId: result.renderSellerId,
        conversionStatus: result.conversionStatus,
        conversionId: result.conversionId,
        idempotent: result.idempotent,
      },
      meta: {
        correlationId,
      },
    });
  } catch (error) {
    if (error instanceof RenderSellerConversionError || error instanceof ServiceError) {
      return errorResponse(error.message, error.status, error.code);
    }

    return errorResponse("Render seller conversion failed.", 500, "RENDER_SELLER_CONVERSION_FAILED");
  }
}
