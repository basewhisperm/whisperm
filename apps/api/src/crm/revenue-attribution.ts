import { ApiError } from "../errors.js";
import { firstHeaderValue, type FastifyReplyLike, type FastifyRequestLike } from "../http/fastify.js";

export interface RevenueAttributionRouteContext {
  readonly tenantId: string;
  readonly actorId?: string | undefined;
  readonly correlation: { readonly correlationId: string };
}

/**
 * API routes coordinate only: they expose attribution state and delegate an
 * explicit recompute command to runtime/service ownership. They never
 * compute attribution or mutate deals/opportunities directly.
 */
export interface RevenueAttributionServicePort {
  getState(context: RevenueAttributionRouteContext, dealId: string): Promise<unknown> | unknown;
  recompute(context: RevenueAttributionRouteContext, dealId: string): Promise<unknown> | unknown;
}

export interface RevenueAttributionRouteDependencies {
  readonly revenueAttribution: RevenueAttributionServicePort;
}

type RevenueAttributionFastifyRequest = FastifyRequestLike & {
  readonly params?: Readonly<Record<string, string | undefined>> | undefined;
};

const routeParam = (request: RevenueAttributionFastifyRequest, name: string): string => {
  const value = request.params?.[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new ApiError({ code: "TENANT_CONTEXT_MISMATCH", message: `${name} route parameter is required` });
  }
  return value;
};

const routeContext = (request: RevenueAttributionFastifyRequest): RevenueAttributionRouteContext => {
  const tenantId = firstHeaderValue(request.headers, "x-tenant-id")?.trim();
  if (tenantId === undefined || tenantId.length === 0) {
    throw new ApiError({ code: "TENANT_CONTEXT_MISMATCH", message: "Workspace tenant context is required" });
  }
  return {
    tenantId,
    actorId: request.auth?.principal.userId,
    correlation: { correlationId: request.correlationId ?? request.id ?? "unknown" },
  };
};

const sendSuccess = (reply: FastifyReplyLike, data: unknown, correlationId: string): void => {
  reply.send({ ok: true, data, meta: { correlationId } });
};

export const createRevenueAttributionStateHandler = (dependencies: RevenueAttributionRouteDependencies) => async (request: RevenueAttributionFastifyRequest, reply: FastifyReplyLike): Promise<void> => {
  const context = routeContext(request);
  const state = await dependencies.revenueAttribution.getState(context, routeParam(request, "dealId"));
  sendSuccess(reply, state, context.correlation.correlationId);
};

export const createRevenueAttributionRecomputeHandler = (dependencies: RevenueAttributionRouteDependencies) => async (request: RevenueAttributionFastifyRequest, reply: FastifyReplyLike): Promise<void> => {
  const context = routeContext(request);
  const result = await dependencies.revenueAttribution.recompute(context, routeParam(request, "dealId"));
  sendSuccess(reply, result, context.correlation.correlationId);
};
