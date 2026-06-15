import { sellerAcquisitionAnalyticsFiltersSchema } from "@whisperm/types";

import { ApiError } from "../errors.js";
import { firstHeaderValue, type FastifyReplyLike, type FastifyRequestLike } from "../http/fastify.js";

export interface MarketplaceAcquisitionAnalyticsServicePort {
  get(context: { readonly tenantId: string }, filters: unknown): Promise<unknown> | unknown;
}

export interface MarketplaceAcquisitionAnalyticsRouteDependencies {
  readonly analytics: MarketplaceAcquisitionAnalyticsServicePort;
}

const routeContext = (request: FastifyRequestLike): { readonly tenantId: string } => {
  const tenantId = firstHeaderValue(request.headers, "x-tenant-id")?.trim();
  const actorId = request.auth?.principal.userId ?? firstHeaderValue(request.headers, "x-user-id")?.trim();
  if (tenantId === undefined || tenantId.length === 0 || actorId === undefined || actorId.length === 0) {
    throw new ApiError({ code: "TENANT_CONTEXT_MISMATCH", message: "Marketplace analytics requires authenticated tenant and actor context", statusCode: 401 });
  }
  return { tenantId };
};

export const createMarketplaceAcquisitionAnalyticsHandler = (dependencies: MarketplaceAcquisitionAnalyticsRouteDependencies) => async (request: FastifyRequestLike, reply: FastifyReplyLike): Promise<void> => {
  const context = routeContext(request);
  const filters = sellerAcquisitionAnalyticsFiltersSchema.parse((request as { readonly query?: unknown }).query ?? {});
  const result = await dependencies.analytics.get(context, filters);
  reply.send({ ok: true, data: result, meta: { correlationId: request.correlationId ?? request.id ?? "unknown" } });
};
