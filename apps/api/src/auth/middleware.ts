import { AuthError } from "./errors.js";
import { assertRequiredRole } from "./roles.js";
import type { AuditLogger, RefreshTokenService, TenantMembershipLoader, TenantRole } from "./types.js";
import type { FastifyHookHandler, FastifyRequestLike } from "../http/fastify.js";
import { firstHeaderValue } from "../http/fastify.js";

export type AccessTokenVerifier = (token: string) => Promise<NonNullable<FastifyRequestLike["auth"]>["principal"]>;

const bearerPrefix = "Bearer ";

const extractBearerToken = (request: FastifyRequestLike): string => {
  const authorization = firstHeaderValue(request.headers, "authorization");
  if (authorization === undefined || !authorization.startsWith(bearerPrefix)) {
    throw new AuthError({ code: "AUTH_MISSING_TOKEN", message: "Bearer access token is required" });
  }

  const token = authorization.slice(bearerPrefix.length).trim();
  if (token.length === 0) {
    throw new AuthError({ code: "AUTH_MISSING_TOKEN", message: "Bearer access token is empty" });
  }
  return token;
};

export const authMiddleware = (verifyAccessToken: AccessTokenVerifier): FastifyHookHandler => async (request) => {
  const principal = await verifyAccessToken(extractBearerToken(request));
  request.auth = { principal };
};

export const loadTenantMembershipMiddleware = (loader: TenantMembershipLoader): FastifyHookHandler => async (request) => {
  const tenantId = firstHeaderValue(request.headers, "x-tenant-id");
  const userId = request.auth?.principal.userId;
  const correlationId = request.correlationId ?? request.id ?? "unknown";

  const auth = request.auth;
  if (tenantId === undefined || tenantId.trim().length === 0 || userId === undefined || auth === undefined) {
    throw new AuthError({ code: "TENANT_CONTEXT_REQUIRED", message: "Tenant context and authenticated principal are required" });
  }

  if (!auth.principal.tenantIds.includes(tenantId)) {
    throw new AuthError({ code: "TENANT_CONTEXT_MISMATCH", message: "Access token is not scoped to tenant" });
  }

  const membership = await loader.loadMembership({ tenantId, userId, correlationId });
  if (membership === null) {
    throw new AuthError({ code: "AUTH_MEMBERSHIP_REQUIRED", message: "Tenant membership is required" });
  }
  if (!membership.isActive) {
    throw new AuthError({ code: "AUTH_MEMBERSHIP_INACTIVE", message: "Tenant membership is inactive" });
  }
  if (membership.tenantId !== tenantId || membership.userId !== userId) {
    throw new AuthError({ code: "TENANT_CONTEXT_MISMATCH", message: "Loaded membership does not match tenant context" });
  }

  auth.membership = membership;
  request.tenant = membership;
};

export const roleGuardMiddleware = (requiredRole: TenantRole): FastifyHookHandler => (request) => {
  assertRequiredRole(request.auth?.membership?.role, requiredRole);
};

export const tenantIsolationGuardMiddleware = (): FastifyHookHandler => (request) => {
  const headerTenantId = firstHeaderValue(request.headers, "x-tenant-id");
  const membershipTenantId = request.auth?.membership?.tenantId;

  if (headerTenantId === undefined || membershipTenantId === undefined || headerTenantId !== membershipTenantId) {
    throw new AuthError({ code: "TENANT_CONTEXT_MISMATCH", message: "Request tenant context is not isolated" });
  }
};

/**
 * STUB: Refresh-token rotation is not implemented yet.
 *
 * This fail-closed service exists only so auth routes can depend on the
 * RefreshTokenService interface before the real provider is wired. It is not
 * an operational implementation.
 *
 * Do not use this as a production or public refresh-token implementation.
 * It always records a denied audit event and returns AUTH_INVALID_TOKEN.
 */
export const createRefreshTokenPlaceholder = (auditLogger: AuditLogger): RefreshTokenService => ({
  async refresh(input) {
    await auditLogger.record({
      action: "auth.refresh_token.placeholder",
      correlationId: input.correlationId,
      outcome: "DENIED",
      reasonCode: "AUTH_INVALID_TOKEN",
      occurredAt: new Date(),
    });
    throw new AuthError({
      code: "AUTH_INVALID_TOKEN",
      message: "Refresh token provider is not configured",
      statusCode: 501,
    });
  },
});
