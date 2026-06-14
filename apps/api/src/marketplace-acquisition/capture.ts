import { marketplaceCaptureCreateRequestSchema } from "@whisperm/types";

import { ApiError } from "../errors.js";
import { firstHeaderValue, type FastifyReplyLike, type FastifyRequestLike } from "../http/fastify.js";

const capturePermission = "marketplace_acquisition.capture";
const maxCapturePayloadBytes = 64 * 1024;

export interface MarketplaceCaptureRouteContext {
  readonly tenantId: string;
  readonly actorId: string;
  readonly correlation: { readonly correlationId: string; readonly requestId?: string | undefined };
}

export interface MarketplaceCaptureServicePort {
  createCapture(context: MarketplaceCaptureRouteContext, input: unknown): Promise<{ readonly capture: unknown; readonly isNew: boolean; readonly duplicate?: boolean; readonly normalizationWarnings?: readonly string[] }> | { readonly capture: unknown; readonly isNew: boolean; readonly duplicate?: boolean; readonly normalizationWarnings?: readonly string[] };
}

export interface MarketplaceCaptureRouteDependencies {
  readonly captures: MarketplaceCaptureServicePort;
}

interface CaptureRequest extends FastifyRequestLike {
  readonly rawBody?: string | undefined;
}

const splitPermissions = (value: string | undefined): readonly string[] => value === undefined
  ? []
  : value.split(/[\s,]+/u).map((permission) => permission.trim()).filter((permission) => permission.length > 0);

const tokenPermissions = (request: FastifyRequestLike): readonly string[] => {
  const rawPermissions = request.auth?.principal.token.raw.permissions;
  if (!Array.isArray(rawPermissions)) return [];
  return rawPermissions.filter((permission): permission is string => typeof permission === "string" && permission.length > 0);
};

const hasCapturePermission = (request: FastifyRequestLike): boolean => {
  const headerPermissions = splitPermissions(firstHeaderValue(request.headers, "x-permissions"));
  return [...headerPermissions, ...tokenPermissions(request)].includes(capturePermission);
};

const routeContext = (request: FastifyRequestLike): MarketplaceCaptureRouteContext => {
  const tenantId = firstHeaderValue(request.headers, "x-tenant-id")?.trim();
  const actorId = request.auth?.principal.userId ?? firstHeaderValue(request.headers, "x-user-id")?.trim();
  if (tenantId === undefined || tenantId.length === 0) {
    throw new ApiError({ code: "TENANT_CONTEXT_MISMATCH", message: "Marketplace capture tenant context is required" });
  }
  if (actorId === undefined || actorId.length === 0) {
    throw new ApiError({ code: "AUTH_INVALID_TOKEN", message: "Authenticated user is required", statusCode: 401 });
  }
  if (!hasCapturePermission(request)) {
    throw new ApiError({ code: "TENANT_CONTEXT_MISMATCH", message: "Marketplace acquisition capture permission is required", statusCode: 403 });
  }
  return { tenantId, actorId, correlation: { correlationId: request.correlationId ?? request.id ?? "unknown" } };
};

export const createMarketplaceCaptureHandler = (dependencies: MarketplaceCaptureRouteDependencies) => async (request: CaptureRequest, reply: FastifyReplyLike): Promise<void> => {
  if ((request.rawBody?.length ?? 0) > maxCapturePayloadBytes) {
    throw new ApiError({ code: "REQUEST_BODY_INVALID", message: "Marketplace capture payload is too large", statusCode: 413 });
  }
  const context = routeContext(request);
  const body = marketplaceCaptureCreateRequestSchema.parse(request.body);
  const result = await dependencies.captures.createCapture(context, body);
  reply.code(result.isNew ? 201 : 200).send({ ok: true, data: result.capture, meta: { correlationId: context.correlation.correlationId, duplicate: result.duplicate ?? !result.isNew, normalizationWarnings: result.normalizationWarnings ?? [] } });
};
