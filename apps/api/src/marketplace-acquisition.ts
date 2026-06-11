import type { PersistenceCorrelationMetadata } from "@whisperm/types";

import { ApiError } from "./errors.js";
import { firstHeaderValue, type FastifyReplyLike, type FastifyRequestLike } from "./http/fastify.js";

export interface MarketplaceAcquisitionRouteContext {
  readonly tenantId: string;
  readonly actorId: string;
  readonly correlation: PersistenceCorrelationMetadata;
}

export interface MarketplaceCaptureResponse {
  readonly captureId: string;
  readonly contactId: string;
  readonly dealId: string;
  readonly contactMatchStrategy: string;
  readonly dealCreated: boolean;
  readonly dealMatched: boolean;
  readonly status: string;
}

export interface MarketplaceAcquisitionServicePort {
  capture(context: MarketplaceAcquisitionRouteContext, input: unknown): Promise<MarketplaceCaptureResponse> | MarketplaceCaptureResponse;
}

export interface MarketplaceAcquisitionRouteDependencies {
  readonly marketplaceAcquisition: MarketplaceAcquisitionServicePort;
}

type MarketplaceFastifyRequest = FastifyRequestLike;

const headerTenantId = (request: MarketplaceFastifyRequest): string => {
  const value = firstHeaderValue(request.headers, "x-tenant-id")?.trim();
  if (value === undefined || value.length === 0) {
    throw new ApiError({ code: "TENANT_CONTEXT_MISMATCH", message: "Workspace tenant context is required" });
  }
  return value;
};

const actorId = (request: MarketplaceFastifyRequest): string => {
  const value = request.auth?.principal.userId ?? firstHeaderValue(request.headers, "x-user-id")?.trim();
  if (value === undefined || value.length === 0) {
    throw new ApiError({ code: "TENANT_CONTEXT_MISMATCH", message: "Authenticated actor context is required", statusCode: 401 });
  }
  return value;
};

const routeContext = (request: MarketplaceFastifyRequest): MarketplaceAcquisitionRouteContext => ({
  tenantId: headerTenantId(request),
  actorId: actorId(request),
  correlation: { correlationId: request.correlationId ?? request.id ?? "unknown" },
});

const sendSuccess = (reply: FastifyReplyLike, data: unknown, correlationId: string | undefined): void => {
  reply.send({ ok: true, data, meta: { correlationId: correlationId ?? "unknown" } });
};

export const createMarketplaceCaptureHandler = (dependencies: MarketplaceAcquisitionRouteDependencies) => async (request: MarketplaceFastifyRequest, reply: FastifyReplyLike): Promise<void> => {
  const context = routeContext(request);
  const result = await dependencies.marketplaceAcquisition.capture(context, { ...(typeof request.body === "object" && request.body !== null ? request.body : {}), tenantId: context.tenantId });
  reply.code(201);
  sendSuccess(reply, result, context.correlation.correlationId);
};
