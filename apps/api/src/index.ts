export const packageName = "@whisperm/api" as const;

export { EventIngestionError } from "./events/errors.js";
export type { EventIngestionErrorCode, EventIngestionErrorOptions } from "./events/errors.js";
export { createInboundWebhookIngestionHandler } from "./events/ingestion.js";
export type { InboundWebhookIngestionDependencies } from "./events/ingestion.js";
export type {
  EventIdempotencyProtection,
  EventIdempotencyReservation,
  EventPersistenceService,
  EventQueue,
  EventQueueMessage,
  RetrySafeEventProcessor,
} from "./events/contracts.js";
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
export type { FastifyHookHandler, FastifyReplyLike, FastifyRequestLike, FastifyRouteHandler, RequestLogger } from "./http/fastify.js";

export { ApiError, mapErrorToHttp } from "./errors.js";
export type { ApiErrorCode, ApiErrorOptions, ErrorResponse } from "./errors.js";
export { createApiServer } from "./server.js";
export type {
  ApiKeyAuthenticationInput,
  ApiKeyAuthenticator,
  ApiKeyPrincipal,
  ApiServer,
  ApiServerDependencies,
  HmacVerificationInput,
  HmacVerifier,
  InjectOptions,
  InjectResponse,
  ReadinessCheck,
} from "./server.js";

export { createDealCreateHandler, createDealDetailHandler, createDealStageMoveHandler, createPipelineBoardHandler } from "./crm/deals.js";
export { createDashboardHandler, createDashboardService } from "./crm/dashboard.js";
export type { ActivityRouteContext, ActivityRouteDependencies, ActivityServicePort } from "./crm/activities.js";
export type { DashboardActivityFeedItem, DashboardActivityRecord, DashboardContactRecord, DashboardFollowUpAlert, DashboardHealthPanelItem, DashboardReadModel, DashboardResponse, DashboardRouteContext, DashboardRouteDependencies, DashboardServicePort } from "./crm/dashboard.js";
export type { DealRouteContext, DealRouteDependencies, DealServicePort } from "./crm/deals.js";
export { createStripeWebhookHandler } from "./webhooks/stripe.js";
export type { StripeWebhookRequest } from "./webhooks/stripe.js";
export type {
  BillingEventIngestionReservation,
  BillingEventIngestionStore,
  BillingOutbox,
  StripeWebhookDependencies,
  SubscriptionStore,
} from "./billing/contracts.js";
export { createTrialEndsAt, createTrialGate, isTrialExpired } from "./billing/trial.js";
export type { TrialGateSubscriptionReader } from "./billing/trial.js";
