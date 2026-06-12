import {
  createMarketplaceCaptureRequestSchema,
  type CreateMarketplaceCaptureRequest,
  type MarketplaceCaptureResponse,
  type PersistenceCorrelationMetadata,
} from "@whisperm/types";

import { AuthError } from "../auth/errors.js";
import { requirePermission } from "../auth/permissions.js";
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

const requireCapturePermission = (request: MarketplaceCaptureFastifyRequest, tenantId: string): void => {
  const auth = request.auth;
  if (auth === undefined) {
    throw new AuthError({ code: "AUTH_MISSING_TOKEN", message: "Authenticated marketplace capture access is required" });
  }

  if (!auth.principal.tenantIds.includes(tenantId)) {
    throw new AuthError({ code: "TENANT_CONTEXT_MISMATCH", message: "Access token is not scoped to tenant" });
  }

  const membership = auth.membership;
  if (membership === undefined) {
    throw new AuthError({ code: "AUTH_MEMBERSHIP_REQUIRED", message: "Tenant membership is required" });
  }
  if (!membership.isActive) {
    throw new AuthError({ code: "AUTH_MEMBERSHIP_INACTIVE", message: "Tenant membership is inactive" });
  }
  if (membership.tenantId !== tenantId || membership.userId !== auth.principal.userId) {
    throw new AuthError({ code: "TENANT_CONTEXT_MISMATCH", message: "Authenticated membership does not match tenant context" });
  }

  requirePermission(membership.role, "marketplace_acquisition.capture");
};

const routeContext = (request: MarketplaceCaptureFastifyRequest): MarketplaceCaptureRouteContext => {
  const tenantId = headerTenantId(request);
  requireCapturePermission(request, tenantId);
  return {
    tenantId,
    actorId: request.auth?.principal.userId,
    correlation: { correlationId: request.correlationId ?? request.id ?? "unknown" },
  };
};

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
