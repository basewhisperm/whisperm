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
export { hasPermission, marketplaceAcquisitionPermissions, permissionMinimumRoles, requirePermission } from "./auth/permissions.js";
export type { MarketplaceAcquisitionPermission, Permission } from "./auth/permissions.js";
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
  ApiTelemetry,
  ApiTelemetrySpan,
  HmacVerificationInput,
  HmacVerifier,
  InjectOptions,
  InjectResponse,
  ReadinessCheck,
} from "./server.js";

export { createDealCreateHandler, createDealDetailHandler, createDealStageMoveHandler, createPipelineBoardHandler } from "./crm/deals.js";
export { createMarketplaceCaptureCreateHandler } from "./marketplace-acquisition/captures.js";
export type { MarketplaceCaptureRouteContext, MarketplaceCaptureRouteDependencies, MarketplaceCaptureServicePort } from "./marketplace-acquisition/captures.js";
export { createDashboardHandler, createDashboardService } from "./crm/dashboard.js";
export { createReportsHandler, createReportsService, resolveReportPeriod, reportPeriods } from "./crm/reports.js";
export type { ActivityRouteContext, ActivityRouteDependencies, ActivityServicePort } from "./crm/activities.js";
export type { DashboardActivityFeedItem, DashboardActivityRecord, DashboardContactRecord, DashboardFollowUpAlert, DashboardHealthPanelItem, DashboardReadModel, DashboardResponse, DashboardRouteContext, DashboardRouteDependencies, DashboardServicePort } from "./crm/dashboard.js";
export type { AverageDaysToCloseReport, ClientAcquisitionSourceItem, RenewalRateReport, ReportDateRange, ReportPeriod, ReportPeriodRange, ReportPlan, ReportRouteContext, ReportsReadModel, ReportsResponse, ReportsRouteDependencies, ReportsServicePort, RevenueByStageItem } from "./crm/reports.js";
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
export { evaluateContactCreateQuota, evaluatePipelineCreateQuota, evaluateTeamMemberQuota, planLimits } from "./billing/quota.js";
export type { BillingQuotaContext, BillingQuotaDecision, BillingQuotaPlan, BillingQuotaReader, PipelineQuotaReader, PlanLimits } from "./billing/quota.js";
export { createWorkspaceTeamManagementHandler, parseWorkspaceTeamRoute } from "./workspaces/team-management.js";
export type { TeamInviteMailer, TeamManagementStore, WorkspaceInvitationRecord, WorkspaceMemberRecord, WorkspaceRecord, WorkspaceTeamManagementDependencies } from "./workspaces/team-management.js";
export { createTrialEndsAt, createTrialGate, isTrialExpired } from "./billing/trial.js";
export type { TrialGateSubscriptionReader } from "./billing/trial.js";

export { createPaystackWebhookHandler } from "./webhooks/paystack.js";
export type { PaystackWebhookRequest } from "./webhooks/paystack.js";
export type { PaystackWebhookDependencies } from "./billing/contracts.js";
export {
  resolveBillingProvider,
  verifyPaystackSignature,
  mapPaystackSubscriptionEventToStatus,
  paystackEventToSnapshot,
  createPaystackSubscriptionChangedEvent,
  PAYSTACK_PRICING_GHS,
} from "@whisperm/billing-runtime";
export type { BillingProviderName, PaystackEventType, PaystackWebhookEvent } from "@whisperm/billing-runtime";

export { initWorkspaceTrial } from "./billing/trial-init.js";
export type { WorkspaceTrialStore, TrialSubscription, InitTrialInput, InitTrialResult } from "./billing/trial-init.js";
export { initiateUpgrade } from "./billing/upgrade.js";
export type { UpgradeServicePorts, UpgradeWorkspaceContext, UpgradeResult, StripeUpgradePort, PaystackUpgradePort } from "./billing/upgrade.js";
export { createRequireActiveSubscription, TRIAL_EXPIRED } from "./billing/require-active-subscription.js";
export type { RequireActiveSubscription } from "./billing/require-active-subscription.js";
export { buildTrialReminderJobs, scheduleTrialReminderJobs, executeTrialReminderJob } from "@whisperm/notification-runtime";
export type { TrialReminderMarker, TrialReminderJobPayload, NotificationServicePort, NotificationSchedulePort, TenantCreatedNotificationPayload } from "@whisperm/notification-runtime";

export { createWorkspace, generateWorkspaceSlug, currencyForCountry, DEFAULT_PIPELINE_STAGES } from "./billing/workspace-provisioning.js";
export type { WorkspaceProvisioningPort, CreateWorkspaceInput, CreateWorkspaceResult, CreatedTenant, CreatedPipeline } from "./billing/workspace-provisioning.js";
export { computeOnboardingChecklist, OnboardingAccessError } from "./billing/onboarding.js";
export type { OnboardingStatePort, OnboardingChecklist, OnboardingStep, OnboardingStepKey } from "./billing/onboarding.js";

export { sanitizeString, sanitizeRequestBody, createRateLimiter, authRateLimiter, applySecurityHeaders, getClientIp } from "./http/security.js";
export type { RateLimiter, RateLimiterOptions } from "./http/security.js";
export { OAuthError, buildGoogleAuthorizationUrl, createGoogleOAuthHandler, createOAuthCallbackRouteHandler, createOAuthInitiateRouteHandler, generateOAuthState } from "./auth/oauth.js";
export type { GoogleOAuthConfig, GoogleOAuthDependencies, GoogleOAuthHandler, GoogleUserInfo, OAuthCallbackResult, OAuthErrorCode, OAuthHttpClient, OAuthRouteResult, OAuthSessionService, OAuthSessionToken, OAuthStateStore, OAuthTenantRecord, OAuthTokenResponse, OAuthUserRecord, OAuthUserRepository } from "./auth/oauth.js";
