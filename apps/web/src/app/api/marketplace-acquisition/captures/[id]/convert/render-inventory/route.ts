import { NextRequest, NextResponse } from "next/server";

import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { createPrismaRepositories, type PrismaPersistenceClient } from "@whisperm/repositories";
import {
  RenderInventoryConversionError,
  RenderInventoryConversionService,
  ServiceError,
} from "@whisperm/services";

interface RouteContext {
  readonly params: {
    readonly id: string;
  };
}

type RenderCategory = "VEHICLES" | "REAL_ESTATE" | "ELECTRONICS" | "JOBS" | "SERVICES" | "FASHION";
type RenderCondition = "NEW" | "LIKE_NEW" | "GOOD" | "FAIR";

const renderCategories = new Set<RenderCategory>([
  "VEHICLES",
  "REAL_ESTATE",
  "ELECTRONICS",
  "JOBS",
  "SERVICES",
  "FASHION",
]);

const renderConditions = new Set<RenderCondition>(["NEW", "LIKE_NEW", "GOOD", "FAIR"]);

const clean = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const numberValue = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.]/gu, ""));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
  if (typeof value === "object" && value !== null && "toString" in value) {
    const parsed = Number(String(value.toString()).replace(/[^\d.]/gu, ""));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
  return undefined;
};

const urlList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value.filter((item): item is string => {
        if (typeof item !== "string") return false;
        try {
          const parsed = new URL(item);
          return parsed.protocol === "http:" || parsed.protocol === "https:";
        } catch {
          return false;
        }
      }),
    ),
  ).slice(0, 10);
};

const normalizeCategory = (value: unknown): RenderCategory => {
  const raw = clean(value)?.toUpperCase().replace(/[\s-]+/gu, "_");
  if (raw !== undefined && renderCategories.has(raw as RenderCategory)) return raw as RenderCategory;
  return "SERVICES";
};

const normalizeCondition = (value: unknown): RenderCondition | undefined => {
  const raw = clean(value)?.toUpperCase().replace(/[\s-]+/gu, "_");
  if (raw !== undefined && renderConditions.has(raw as RenderCondition)) return raw as RenderCondition;
  return undefined;
};

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

const createRenderInventoryConnector = () => ({
  async createRenderInventory(
    input: Readonly<Record<string, unknown>> & { readonly idempotencyKey: string },
  ): Promise<{ readonly renderInventoryId: string; readonly status: "CREATED" | "EXISTS" }> {
    const baseUrl = process.env.RENDER_API_BASE_URL?.replace(/\/+$/u, "");
    const internalKey = process.env.RENDER_INTERNAL_API_KEY ?? process.env.WHISPERM_INTERNAL_API_KEY;

    if (baseUrl === undefined || baseUrl.length === 0 || internalKey === undefined || internalKey.length === 0) {
      throw new Error("Render inventory connector is not configured.");
    }

    const renderSellerId = clean(input.renderSellerId);
    if (renderSellerId === undefined) {
      throw new Error("Render seller conversion must succeed before inventory conversion.");
    }

    const price = numberValue(input.price);
    if (price === undefined) {
      throw new Error("Render inventory conversion requires a positive listing price.");
    }

    const response = await fetch(`${baseUrl}/internal/whisperm/listings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey,
        "x-whisperm-internal-key": internalKey,
      },
      body: JSON.stringify({
        renderSellerId,
        title: clean(input.title) ?? "Imported marketplace listing",
        description: clean(input.description),
        price,
        priceUnit: clean(input.currency),
        category: normalizeCategory(input.category),
        condition: normalizeCondition(input.condition),
        locationRegion: clean(input.locationRegion) ?? clean(input.sellerLocation),
        images: urlList(input.images),
        sourceCaptureId: clean(input.marketplaceCaptureId),
        sourceDraftInventoryId: clean(input.draftInventoryId),
      }),
    });

    const rawResponse = await response.json().catch(() => ({} as unknown));

    if (!response.ok) {
      throw new Error(`Render internal listing import failed with status ${response.status}.`);
    }

    const listing =
      typeof rawResponse === "object" && rawResponse !== null && "listing" in rawResponse
        ? (rawResponse as { readonly listing?: unknown }).listing
        : undefined;

    const renderInventoryId =
      typeof listing === "object" && listing !== null && typeof (listing as { readonly id?: unknown }).id === "string"
        ? (listing as { readonly id: string }).id
        : typeof rawResponse === "object" && rawResponse !== null && typeof (rawResponse as { readonly renderInventoryId?: unknown }).renderInventoryId === "string"
          ? (rawResponse as { readonly renderInventoryId: string }).renderInventoryId
          : undefined;

    if (renderInventoryId === undefined || renderInventoryId.trim().length === 0) {
      throw new Error("Render internal listing import response did not include a listing id.");
    }

    return {
      renderInventoryId,
      status: response.status === 200 ? "EXISTS" : "CREATED",
    };
  },
});

export async function POST(request: NextRequest, { params }: RouteContext) {
  const tenantContext = await getTenantContextForCurrentUser();
  if (!tenantContext) return errorResponse("Unauthorized", 401, "AUTH_REQUIRED");
  const { tenant, tenantUserId } = tenantContext;

  const marketplaceCaptureId = clean(params.id);
  if (marketplaceCaptureId === undefined) {
    return errorResponse("Marketplace capture id is required.", 400, "REQUEST_BODY_INVALID");
  }

  const repositories = createPrismaRepositories(prisma as unknown as PrismaPersistenceClient);
  const service = new RenderInventoryConversionService({
    marketplaceCaptures: repositories.marketplaceCaptures,
    draftInventories: repositories.draftInventories,
    renderConversions: repositories.renderConversions,
    auditLogs: repositories.auditLogs,
    activities: repositories.activities,
    connector: createRenderInventoryConnector(),
  });

  try {
    const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
    const requestId = request.headers.get("x-request-id") ?? undefined;

    const result = await service.convertClaimedInventoryToRender(
      {
        tenantId: tenant.id,
        actorId: tenantUserId,
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
        renderInventoryId: result.renderInventoryId,
        conversionStatus: result.conversionStatus,
        conversionId: result.conversionId,
        idempotent: result.idempotent,
        acquisitionConverted: result.acquisitionConverted,
      },
      meta: {
        correlationId,
      },
    });
  } catch (error) {
    if (error instanceof RenderInventoryConversionError || error instanceof ServiceError) {
      return errorResponse(error.message, error.status, error.code);
    }

    return errorResponse("Render inventory conversion failed.", 500, "RENDER_INVENTORY_CONVERSION_FAILED");
  }
}
