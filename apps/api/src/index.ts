export const packageName = "@whisperm/api" as const;

export { AuthError } from "./auth/errors.js";
export type { AuthErrorCode, AuthErrorOptions } from "./auth/errors.js";
export { createJwtAccessTokenVerifier } from "./auth/jwt.js";
export {
  authMiddleware,
  createRefreshTokenPlaceholder,
  loadTenantMembershipMiddleware,
  roleGuardMiddleware,
  tenantIsolationGuardMiddleware,
} from "./auth/middleware.js";
export { assertRequiredRole, hasRequiredRole, roleRank } from "./auth/roles.js";
export { noopAuditLogger, tenantRoles } from "./auth/types.js";
export type {
  AuditLogEntry,
  AuditLogger,
  AuthenticatedPrincipal,
  AuthenticatedRequestContext,
  JwtAccessTokenClaims,
  RefreshTokenInput,
  RefreshTokenResult,
  RefreshTokenService,
  TenantMembership,
  TenantMembershipLoader,
  TenantRole,
} from "./auth/types.js";
export { correlationIdMiddleware } from "./http/correlation.js";
export type { FastifyHookHandler, FastifyReplyLike, FastifyRequestLike, RequestLogger } from "./http/fastify.js";
