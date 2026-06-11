import {
  createMarketplaceCaptureRequestSchema,
  type CreateMarketplaceCaptureRequest,
  type MarketplaceCaptureResponse,
  type PersistenceCorrelationMetadata,
} from "@whisperm/types";

import { ApiError } from "../errors.js";
import { firstHeaderValue, type FastifyReplyLike, type FastifyRequestLike } from "../http/fastify.js";

export interface MarketplaceCaptureRouteContext {
  readonly tenantId: string;
  readonly actorId?: string | undefined;
  readonly correlation: PersistenceCorrelationMetadata;
}

export interface MarketplaceCaptureServicePort {
  create(context: MarketplaceCaptureRouteContext, input: CreateMarketplaceCaptureRequest): Promise<MarketplaceCaptureResponse> | MarketplaceCaptureResponse;
}

export interface MarketplaceCaptureRouteDependencies {
  readonly marketplaceCaptures: MarketplaceCaptureServicePort;
}

type MarketplaceCaptureFastifyRequest = FastifyRequestLike & {
  readonly body?: unknown;
};

const headerTenantId = (request: MarketplaceCaptureFastifyRequest): string => {
  const value = firstHeaderValue(request.headers, "x-tenant-id")?.trim();
  if (value === undefined || value.length === 0) {
    throw new ApiError({ code: "TENANT_CONTEXT_MISMATCH", message: "Workspace tenant context is required" });
  }
  return value;
};

const routeContext = (request: MarketplaceCaptureFastifyRequest): MarketplaceCaptureRouteContext => ({
  tenantId: headerTenantId(request),
  actorId: request.auth?.principal.userId,
  correlation: { correlationId: request.correlationId ?? request.id ?? "unknown" },
});

const sendSuccess = (reply: FastifyReplyLike, data: unknown, correlationId: string | undefined): void => {
  reply.send({ ok: true, data, meta: { correlationId: correlationId ?? "unknown" } });
};

export const createMarketplaceCaptureCreateHandler = (dependencies: MarketplaceCaptureRouteDependencies) => async (request: MarketplaceCaptureFastifyRequest, reply: FastifyReplyLike): Promise<void> => {
  const context = routeContext(request);
  const body = createMarketplaceCaptureRequestSchema.parse(request.body);
  if (body.tenantId !== context.tenantId) {
    throw new ApiError({ code: "TENANT_CONTEXT_MISMATCH", message: "Marketplace capture payload tenantId must match route tenantId" });
  }
  const result = await dependencies.marketplaceCaptures.create(context, body);
  reply.code(201);
  sendSuccess(reply, result, context.correlation.correlationId);
};
