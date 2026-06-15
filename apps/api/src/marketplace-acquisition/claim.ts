import { ownershipClaimAcceptRequestSchema, type OwnershipClaimAcceptResponse, type PersistenceCorrelationMetadata } from "@whisperm/types";

import { ApiError } from "../errors.js";
import { firstHeaderValue, type FastifyReplyLike, type FastifyRequestLike } from "../http/fastify.js";
import { getClientIp } from "../http/security.js";

export interface OwnershipClaimRouteContext {
  readonly tenantId: string;
  readonly correlation: PersistenceCorrelationMetadata;
}

export interface OwnershipClaimServicePort {
  acceptClaim(context: OwnershipClaimRouteContext, input: unknown): Promise<OwnershipClaimAcceptResponse> | OwnershipClaimAcceptResponse;
}

export interface OwnershipClaimRouteDependencies {
  readonly ownershipAttestations: OwnershipClaimServicePort;
}

const headerTenantId = (request: FastifyRequestLike): string => {
  const value = firstHeaderValue(request.headers, "x-tenant-id")?.trim();
  if (value === undefined || value.length === 0) throw new ApiError({ code: "TENANT_CONTEXT_MISMATCH", message: "Workspace tenant context is required" });
  return value;
};

const routeContext = (request: FastifyRequestLike): OwnershipClaimRouteContext => ({
  tenantId: headerTenantId(request),
  correlation: { correlationId: request.correlationId ?? request.id ?? "unknown" },
});

export const createOwnershipClaimAcceptHandler = (dependencies: OwnershipClaimRouteDependencies) => async (request: FastifyRequestLike, reply: FastifyReplyLike): Promise<void> => {
  const context = routeContext(request);
  const token = firstHeaderValue(request.headers, "x-claim-token")?.trim();
  if (token === undefined || token.length === 0) throw new ApiError({ code: "REQUEST_BODY_INVALID", message: "Claim token is required", statusCode: 400 });
  const body = ownershipClaimAcceptRequestSchema.parse(typeof request.body === "object" && request.body !== null ? request.body : {});
  const result = await dependencies.ownershipAttestations.acceptClaim(context, {
    ...body,
    tenantId: context.tenantId,
    token,
    ipAddress: getClientIp(request),
    userAgent: firstHeaderValue(request.headers, "user-agent")?.trim(),
  });
  reply.send({ ok: true, data: result, meta: { correlationId: context.correlation.correlationId } });
};
