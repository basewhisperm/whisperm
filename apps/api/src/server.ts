import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { inboundWebhookRequestSchema } from "@whisperm/types";

import { ApiError, mapErrorToHttp } from "./errors.js";
import {
  createActivityCreateHandler,
  createActivityListHandler,
  createContactActivitiesHandler,
  createDealActivitiesHandler,
  type ActivityRouteDependencies,
} from "./crm/activities.js";
import { createDashboardHandler, type DashboardRouteDependencies } from "./crm/dashboard.js";
import { createReportsHandler, type ReportsRouteDependencies } from "./crm/reports.js";
import {
  createContactCreateHandler,
  createContactImportHandler,
  createContactListHandler,
  type ContactRouteDependencies,
} from "./crm/contacts.js";
import {
  createDealCreateHandler,
  createDealDetailHandler,
  createDealStageMoveHandler,
  createPipelineBoardHandler,
  type DealRouteDependencies,
} from "./crm/deals.js";
import { createInboundWebhookIngestionHandler, type InboundWebhookIngestionDependencies } from "./events/ingestion.js";
import { createRenderSellerConversionHandler, type RenderSellerConversionRouteDependencies } from "./marketplace-acquisition/render-seller-conversion.js";
import { correlationIdMiddleware } from "./http/correlation.js";
import { applySecurityHeaders, authRateLimiter, getClientIp, sanitizeRequestBody } from "./http/security.js";
import { firstHeaderValue, type FastifyReplyLike, type FastifyRequestLike, type RequestLogger } from "./http/fastify.js";
import type { PaystackWebhookDependencies, StripeWebhookDependencies } from "./billing/contracts.js";
import { createStripeWebhookHandler } from "./webhooks/stripe.js";
import { createPaystackWebhookHandler } from "./webhooks/paystack.js";
import type { WorkspaceTrialStore } from "./billing/trial-init.js";
import { createWorkspace, type CreateWorkspaceInput, type WorkspaceProvisioningPort } from "./billing/workspace-provisioning.js";
import { computeOnboardingChecklist, type OnboardingStatePort } from "./billing/onboarding.js";
import { initiateUpgrade, type UpgradeServicePorts, type UpgradeWorkspaceContext } from "./billing/upgrade.js";
import { createRequireActiveSubscription, type RequireActiveSubscription } from "./billing/require-active-subscription.js";
import type { TrialGateSubscriptionReader } from "./billing/trial.js";
import type { NotificationSchedulePort } from "@whisperm/notification-runtime";
import {
  createWorkspaceTeamManagementHandler,
  parseWorkspaceTeamRoute,
  type WorkspaceTeamManagementDependencies,
} from "./workspaces/team-management.js";

export interface ApiKeyAuthenticationInput {
  readonly apiKey: string;
  readonly tenantId: string;
  readonly correlationId: string;
}

export interface ApiKeyPrincipal {
  readonly tenantId: string;
  readonly apiKeyId?: string;
}

export interface ApiKeyAuthenticator {
  authenticate(input: ApiKeyAuthenticationInput): Promise<ApiKeyPrincipal>;
}

export interface HmacVerificationInput {
  readonly tenantId: string;
  readonly correlationId: string;
  readonly signature: string;
  readonly rawBody: string;
  readonly apiKeyId?: string;
}

export interface HmacVerifier {
  verify(input: HmacVerificationInput): Promise<boolean>;
}

export interface ReadinessCheck {
  check(): Promise<void>;
}

export interface StripeWebhookServerConfig extends StripeWebhookDependencies {
  readonly stripeSecretKey: string;
  readonly stripeWebhookSecret: string;
}

export interface PaystackWebhookServerConfig extends PaystackWebhookDependencies {
  readonly paystackSecretKey: string;
}

export interface ApiTelemetrySpan {
  setAttribute?(key: string, value: string | number | boolean): void;
  end(status: "OK" | "ERROR"): void;
}

export interface ApiTelemetry {
  startSpan?(name: string, attributes: Readonly<Record<string, string | number | boolean>>): ApiTelemetrySpan;
}

export interface ApiServerDependencies extends InboundWebhookIngestionDependencies {
  readonly contacts?: ContactRouteDependencies["contacts"] | undefined;
  readonly contactQuota?: ContactRouteDependencies["quota"] | undefined;
  readonly deals?: DealRouteDependencies["deals"] | undefined;
  readonly activities?: ActivityRouteDependencies["activities"] | undefined;
  readonly dashboard?: DashboardRouteDependencies["dashboard"] | undefined;
  readonly reports?: ReportsRouteDependencies["reports"] | undefined;
  readonly workspaceTeamManagement?: WorkspaceTeamManagementDependencies | undefined;
  readonly apiKeyAuthenticator: ApiKeyAuthenticator;
  readonly hmacVerifier: HmacVerifier;
  readonly readiness?: ReadinessCheck;
  readonly logger?: RequestLogger;
  readonly telemetry?: ApiTelemetry | undefined;
  readonly stripeWebhook?: StripeWebhookServerConfig;
  readonly paystackWebhook?: PaystackWebhookServerConfig;
  readonly trialStore?: WorkspaceTrialStore | undefined;
  readonly trialScheduler?: NotificationSchedulePort | undefined;
  readonly subscriptionReader?: TrialGateSubscriptionReader | undefined;
  readonly upgradePorts?: UpgradeServicePorts | undefined;
  readonly workspaceProvisioningPort?: WorkspaceProvisioningPort | undefined;
  readonly onboardingStatePort?: OnboardingStatePort | undefined;
    readonly renderSellerConversion?: RenderSellerConversionRouteDependencies["renderSellerConversion"] | undefined;
    readonly marketplaceAcquisition?: {
    capture(
      context: {
        readonly tenantId: string;
        readonly actorId?: string | undefined;
        readonly correlation: {
          readonly correlationId: string;
          readonly requestId?: string | undefined;
          readonly causationId?: string | undefined;
        };
      },
      input: Record<string, unknown>,
    ): Promise<unknown>;
  } | undefined;
}

export interface InjectOptions {
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly payload?: unknown;
}

export interface InjectResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly payload: string;
  json<T = unknown>(): T;
}

export interface ApiServer {
  inject(options: InjectOptions): Promise<InjectResponse>;
  listen(options: { readonly port: number; readonly host?: string }): Promise<string>;
  close(): Promise<void>;
}

interface MutableRequest extends FastifyRequestLike {
  method: string;
  url: string;
  params?: Readonly<Record<string, string>>;
  query?: Readonly<Record<string, string | undefined>>;
  rawBody?: string;
  sdkApiKey?: ApiKeyPrincipal;
}

interface ParsedUrl {
  readonly pathname: string;
  readonly query: Readonly<Record<string, string | undefined>>;
}

class MemoryReply implements FastifyReplyLike {
  private statusCode = 200;
  private readonly responseHeaders = new Map<string, string>();
  private responsePayload: unknown;

  code(statusCode: number): FastifyReplyLike {
    this.statusCode = statusCode;
    return this;
  }

  header(name: string, value: string): FastifyReplyLike {
    this.responseHeaders.set(name.toLowerCase(), value);
    return this;
  }

  send(payload: unknown): void {
    this.responsePayload = payload;
  }

  getStatusCode(): number {
    return this.statusCode;
  }

  toInjectResponse(): InjectResponse {
    const payload = this.responsePayload === undefined ? "" : JSON.stringify(this.responsePayload);

    return {
      statusCode: this.statusCode,
      headers: Object.fromEntries(this.responseHeaders.entries()),
      payload,
      json<T = unknown>(): T {
        return JSON.parse(payload) as T;
      },
    };
  }
}

const apiKeyHeaderName = "x-api-key";
const hmacSignatureHeaderName = "x-whisperm-signature";
const tenantHeaderName = "x-tenant-id";

const createRequestLogger = (logger: RequestLogger | undefined): RequestLogger => ({
  info(data, message) {
    logger?.info?.(data, message);
  },
  warn(data, message) {
    logger?.warn?.(data, message);
  },
  error(data, message) {
    logger?.error?.(data, message);
  },
});

const requestLoggingMiddleware = (request: MutableRequest): void => {
  request.log?.info?.(
    { correlationId: request.correlationId, method: request.method, url: request.url },
    "request received",
  );
};

const parseUrl = (url: string): ParsedUrl => {
  const parsed = new URL(url, "http://localhost");
  return { pathname: parsed.pathname, query: Object.fromEntries(parsed.searchParams.entries()) };
};

const parseSdkEventsRoute = (method: string, pathname: string): Readonly<Record<string, string>> | null => {
  if (method !== "POST") return null;

  const match = /^\/sdk-events\/([^/?#]+)\/?$/u.exec(pathname);
  if (match === null) return null;

  return { tenantId: decodeURIComponent(match[1] ?? "") };
};

const parseCrmRoute = (
  method: string,
  pathname: string,
):
  | {
      readonly name:
        | "pipelineBoard"
        | "dealCreate"
        | "dealMoveStage"
        | "dealDetail"
        | "activityCreate"
        | "activityList"
        | "contactCreate"
        | "contactList"
        | "contactActivities"
        | "dealActivities";
      readonly params: Readonly<Record<string, string>>;
    }
  | null => {
  if (method === "POST" && pathname === "/deals") return { name: "dealCreate", params: {} };
  if (method === "POST" && pathname === "/activities") return { name: "activityCreate", params: {} };
  if (method === "POST" && pathname === "/contacts") return { name: "contactCreate", params: {} };
  if (method === "GET" && pathname === "/contacts") return { name: "contactList", params: {} };
  if (method === "GET" && pathname === "/activities") return { name: "activityList", params: {} };

  const pipelineBoard = /^\/pipelines\/([^/?#]+)\/board\/?$/u.exec(pathname);
  if (method === "GET" && pipelineBoard !== null) {
    return { name: "pipelineBoard", params: { pipelineId: decodeURIComponent(pipelineBoard[1] ?? "") } };
  }

  const dealMove = /^\/deals\/([^/?#]+)\/stage\/?$/u.exec(pathname);
  if (method === "PATCH" && dealMove !== null) {
    return { name: "dealMoveStage", params: { dealId: decodeURIComponent(dealMove[1] ?? "") } };
  }

  const contactActivities = /^\/contacts\/([^/?#]+)\/activities\/?$/u.exec(pathname);
  if (method === "GET" && contactActivities !== null) {
    return { name: "contactActivities", params: { contactId: decodeURIComponent(contactActivities[1] ?? "") } };
  }

  const dealActivities = /^\/deals\/([^/?#]+)\/activities\/?$/u.exec(pathname);
  if (method === "GET" && dealActivities !== null) {
    return { name: "dealActivities", params: { dealId: decodeURIComponent(dealActivities[1] ?? "") } };
  }

  const dealDetail = /^\/deals\/([^/?#]+)\/?$/u.exec(pathname);
  if (method === "GET" && dealDetail !== null) {
    return { name: "dealDetail", params: { dealId: decodeURIComponent(dealDetail[1] ?? "") } };
  }

  return null;
};

const routeTemplate = (method: string, pathname: string): string => {
  if (method === "GET" && pathname === "/healthz") return "/healthz";
  if (method === "POST" && pathname === "/marketplace-acquisition/captures") return "/marketplace-acquisition/captures";
  if (method === "POST" && /^\/marketplace-acquisition\/captures\/[^/?#]+\/convert\/render-seller\/?$/u.test(pathname)) return "/marketplace-acquisition/captures/:id/convert/render-seller";
  if (method === "GET" && pathname === "/readyz") return "/readyz";
  if (method === "POST" && pathname === "/contacts/import") return "/contacts/import";
  if (method === "POST" && pathname === "/webhooks/stripe") return "/webhooks/stripe";
  if (method === "POST" && pathname === "/webhooks/paystack") return "/webhooks/paystack";
  if (method === "GET" && pathname === "/dashboard") return "/dashboard";
  if (method === "GET" && pathname === "/reports") return "/reports";
  if (method === "POST" && pathname === "/workspaces") return "/workspaces";
  if (method === "POST" && pathname === "/billing/upgrade") return "/billing/upgrade";
  if (method === "GET" && /^\/workspaces\/[^/?#]+\/onboarding\/?$/u.test(pathname)) {
    return "/workspaces/:id/onboarding";
  }

  const crmRoute = parseCrmRoute(method, pathname);
  if (crmRoute?.name === "pipelineBoard") return "/pipelines/:id/board";
  if (crmRoute?.name === "dealMoveStage") return "/deals/:id/stage";
  if (crmRoute?.name === "dealDetail") return "/deals/:id";
  if (crmRoute?.name === "contactActivities") return "/contacts/:id/activities";
  if (crmRoute?.name === "dealActivities") return "/deals/:id/activities";
  if (crmRoute?.name === "dealCreate") return "/deals";
  if (crmRoute?.name === "activityCreate" || crmRoute?.name === "activityList") return "/activities";
  if (crmRoute?.name === "contactCreate" || crmRoute?.name === "contactList") return "/contacts";

  return parseSdkEventsRoute(method, pathname) === null ? "unknown" : "/sdk-events/:tenantId";
};

const normalizeHeaders = (headers: InjectOptions["headers"]): Readonly<Record<string, string>> => {
  const entries = Object.entries(headers ?? {}).map(([name, value]) => [name.toLowerCase(), value] as const);
  return Object.fromEntries(entries);
};

const serializePayload = (payload: unknown): string => {
  if (payload === undefined) return "";
  return typeof payload === "string" ? payload : JSON.stringify(payload);
};

const parseJsonPayload = (rawBody: string): unknown => {
  if (rawBody.length === 0) return undefined;

  try {
    return JSON.parse(rawBody) as unknown;
  } catch (cause) {
    throw new ApiError({ code: "REQUEST_BODY_INVALID", message: "Request body must be valid JSON", cause });
  }
};

const sendMappedError = (
  reply: MemoryReply,
  correlationId: string | undefined,
  error: unknown,
  logger: RequestLogger | undefined,
): InjectResponse => {
  const mapped = mapErrorToHttp(error);
  logger?.warn?.(
    { correlationId, code: mapped.payload.error.code, statusCode: mapped.statusCode },
    "request failed",
  );
  reply.code(mapped.statusCode).send({
    ...mapped.payload,
    meta: { correlationId: correlationId ?? "unknown" },
  });
  return reply.toInjectResponse();
};

const requireParam = (request: MutableRequest, name: string): string => {
  const value = request.params?.[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new ApiError({ code: "TENANT_CONTEXT_MISMATCH", message: "Route tenant context is required" });
  }
  return value;
};

const authenticateApiKey = (dependencies: ApiServerDependencies) => async (request: MutableRequest): Promise<void> => {
  const apiKey = firstHeaderValue(request.headers, apiKeyHeaderName)?.trim();
  if (apiKey === undefined || apiKey.length === 0) {
    throw new ApiError({ code: "API_KEY_MISSING", message: "SDK API key is required" });
  }

  const tenantId = requireParam(request, "tenantId");
  const principal = await dependencies.apiKeyAuthenticator.authenticate({
    apiKey,
    tenantId,
    correlationId: request.correlationId ?? request.id ?? "unknown",
  });

  if (principal.tenantId !== tenantId) {
    throw new ApiError({ code: "API_KEY_INVALID", message: "SDK API key is not scoped to tenant" });
  }

  request.sdkApiKey = principal;
};

const verifyHmac = (dependencies: ApiServerDependencies) => async (request: MutableRequest): Promise<void> => {
  const signature = firstHeaderValue(request.headers, hmacSignatureHeaderName)?.trim();
  if (signature === undefined || signature.length === 0) {
    throw new ApiError({ code: "HMAC_SIGNATURE_MISSING", message: "SDK event signature is required" });
  }

  const verified = await dependencies.hmacVerifier.verify({
    tenantId: requireParam(request, "tenantId"),
    correlationId: request.correlationId ?? request.id ?? "unknown",
    signature,
    rawBody: request.rawBody ?? "",
    ...(request.sdkApiKey?.apiKeyId !== undefined ? { apiKeyId: request.sdkApiKey.apiKeyId } : {}),
  });

  if (!verified) {
    throw new ApiError({ code: "HMAC_SIGNATURE_INVALID", message: "SDK event signature is invalid" });
  }
};

const tenantIsolationValidation = (request: MutableRequest): void => {
  const tenantId = requireParam(request, "tenantId");
  const parsed = inboundWebhookRequestSchema.safeParse(request.body);

  if (!parsed.success) {
    throw new ApiError({
      code: "REQUEST_BODY_INVALID",
      message: "SDK event payload is invalid",
      details: {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          code: issue.code,
        })),
      },
    });
  }

  if (
    parsed.data.tenantId !== tenantId ||
    parsed.data.event.tenantId !== tenantId ||
    request.sdkApiKey?.tenantId !== tenantId
  ) {
    throw new ApiError({
      code: "TENANT_CONTEXT_MISMATCH",
      message: "SDK event tenant context does not match",
    });
  }
};

const readHttpRequestBody = async (request: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });

export const createApiServer = (dependencies: ApiServerDependencies): ApiServer => {
  const ingestionHandler = createInboundWebhookIngestionHandler(dependencies);

  const stripeWebhookHandler =
    dependencies.stripeWebhook === undefined
      ? undefined
      : createStripeWebhookHandler(dependencies.stripeWebhook, {
          stripeSecretKey: dependencies.stripeWebhook.stripeSecretKey,
          stripeWebhookSecret: dependencies.stripeWebhook.stripeWebhookSecret,
        });

  const paystackWebhookHandler =
    dependencies.paystackWebhook === undefined
      ? undefined
      : createPaystackWebhookHandler(dependencies.paystackWebhook, {
          paystackSecretKey: dependencies.paystackWebhook.paystackSecretKey,
        });

  const teamManagementHandler =
    dependencies.workspaceTeamManagement === undefined
      ? undefined
      : createWorkspaceTeamManagementHandler(dependencies.workspaceTeamManagement);

  const requireActiveSubscription: RequireActiveSubscription | undefined =
    dependencies.subscriptionReader === undefined
      ? undefined
      : createRequireActiveSubscription(dependencies.subscriptionReader, () => dependencies.now?.() ?? new Date());

  const contactDependencies =
    dependencies.contacts === undefined
      ? undefined
      : { contacts: dependencies.contacts, quota: dependencies.contactQuota, now: dependencies.now };

  const contactCreateHandler =
    contactDependencies === undefined ? undefined : createContactCreateHandler(contactDependencies);
  const contactImportHandler =
    contactDependencies === undefined ? undefined : createContactImportHandler(contactDependencies);
  const contactListHandler =
    contactDependencies === undefined ? undefined : createContactListHandler(contactDependencies);

  const pipelineBoardHandler =
    dependencies.deals === undefined ? undefined : createPipelineBoardHandler({ deals: dependencies.deals });
  const dealCreateHandler =
    dependencies.deals === undefined ? undefined : createDealCreateHandler({ deals: dependencies.deals });
  const dealStageMoveHandler =
    dependencies.deals === undefined ? undefined : createDealStageMoveHandler({ deals: dependencies.deals });
  const dealDetailHandler =
    dependencies.deals === undefined ? undefined : createDealDetailHandler({ deals: dependencies.deals });

  const dashboardHandler =
    dependencies.dashboard === undefined ? undefined : createDashboardHandler({ dashboard: dependencies.dashboard });
  const reportsHandler =
    dependencies.reports === undefined ? undefined : createReportsHandler({ reports: dependencies.reports });
  const renderSellerConversionHandler = dependencies.renderSellerConversion === undefined ? undefined : createRenderSellerConversionHandler({ renderSellerConversion: dependencies.renderSellerConversion });

  const activityCreateHandler =
    dependencies.activities === undefined
      ? undefined
      : createActivityCreateHandler({ activities: dependencies.activities });
  const activityListHandler =
    dependencies.activities === undefined
      ? undefined
      : createActivityListHandler({ activities: dependencies.activities });
  const contactActivitiesHandler =
    dependencies.activities === undefined
      ? undefined
      : createContactActivitiesHandler({ activities: dependencies.activities });
  const dealActivitiesHandler =
    dependencies.activities === undefined
      ? undefined
      : createDealActivitiesHandler({ activities: dependencies.activities });

  let server: Server | undefined;

  const inject = async (options: InjectOptions): Promise<InjectResponse> => {
    const reply = new MemoryReply();
    const rawBody = serializePayload(options.payload);
    const request: MutableRequest = {
      method: options.method,
      url: options.url,
      headers: normalizeHeaders(options.headers),
      rawBody,
      log: createRequestLogger(dependencies.logger),
    };

    let span: ApiTelemetrySpan | undefined;

    try {
      const parsedUrl = parseUrl(options.url);
      const route = routeTemplate(options.method, parsedUrl.pathname);
      const startedAt = Date.now();
      const tenantPresent = (firstHeaderValue(request.headers, tenantHeaderName)?.trim().length ?? 0) > 0;

      span = dependencies.telemetry?.startSpan?.("api.request", {
        "http.method": options.method,
        "http.route": route,
        "workspace.present": tenantPresent,
        "tenant.present": tenantPresent,
      });

      const contentType = firstHeaderValue(request.headers, "content-type")?.toLowerCase() ?? "";
      request.body = contentType.startsWith("multipart/form-data") ? undefined : parseJsonPayload(rawBody);

      correlationIdMiddleware()(request, reply);
      applySecurityHeaders(reply);
      sanitizeRequestBody(request, options.method);
      requestLoggingMiddleware(request);

      if (options.method === "GET" && parsedUrl.pathname === "/healthz") {
        reply.send({ ok: true, data: { status: "ok" }, meta: { correlationId: request.correlationId } });
        return reply.toInjectResponse();
      }

      if (options.method === "GET" && parsedUrl.pathname === "/readyz") {
        try {
          await dependencies.readiness?.check();
        } catch (cause) {
          throw new ApiError({ code: "READY_CHECK_FAILED", message: "API service is not ready", cause });
        }

        reply.send({ ok: true, data: { status: "ready" }, meta: { correlationId: request.correlationId } });
        return reply.toInjectResponse();
      }

      const workspaceTeamRoute = parseWorkspaceTeamRoute(options.method, parsedUrl.pathname);
      if (workspaceTeamRoute !== null) {
        if (teamManagementHandler === undefined) {
          reply.code(503).send({
            ok: false,
            error: { code: "WORKSPACE_TEAM_NOT_CONFIGURED", message: "Workspace team management is not configured" },
            meta: { correlationId: request.correlationId },
          });
          return reply.toInjectResponse();
        }

        request.params = { ...workspaceTeamRoute.params, routeName: workspaceTeamRoute.name };
        await teamManagementHandler(request, reply);
        return reply.toInjectResponse();
      }

      if (options.method === "POST" && parsedUrl.pathname === "/contacts/import") {
        if (contactImportHandler === undefined) {
          reply.code(503).send({
            ok: false,
            error: { code: "CONTACT_IMPORT_NOT_CONFIGURED", message: "Contact import is not configured" },
            meta: { correlationId: request.correlationId },
          });
          return reply.toInjectResponse();
        }

        await contactImportHandler(request, reply);
        return reply.toInjectResponse();
      }

      if (options.method === "POST" && parsedUrl.pathname === "/webhooks/stripe") {
        if (stripeWebhookHandler === undefined) {
          reply.code(503).send({
            ok: false,
            error: { code: "STRIPE_WEBHOOK_NOT_CONFIGURED", message: "Stripe webhook is not configured" },
            meta: { correlationId: request.correlationId },
          });
          return reply.toInjectResponse();
        }

        await stripeWebhookHandler(request, reply);
        return reply.toInjectResponse();
      }

      if (options.method === "POST" && parsedUrl.pathname === "/webhooks/paystack") {
        if (paystackWebhookHandler === undefined) {
          reply.code(503).send({
            ok: false,
            error: { code: "PAYSTACK_WEBHOOK_NOT_CONFIGURED", message: "Paystack webhook is not configured" },
            meta: { correlationId: request.correlationId },
          });
          return reply.toInjectResponse();
        }

        await paystackWebhookHandler(request, reply);
        return reply.toInjectResponse();
      }

      if (options.method === "GET" && parsedUrl.pathname === "/dashboard") {
        if (dashboardHandler === undefined) {
          reply.code(503).send({
            ok: false,
            error: { code: "DASHBOARD_NOT_CONFIGURED", message: "Dashboard API is not configured" },
            meta: { correlationId: request.correlationId },
          });
          return reply.toInjectResponse();
        }

        await dashboardHandler(request, reply);
        return reply.toInjectResponse();
      }

      if (options.method === "GET" && parsedUrl.pathname === "/reports") {
        if (reportsHandler === undefined) {
          reply.code(503).send({
            ok: false,
            error: { code: "REPORTS_NOT_CONFIGURED", message: "Reports API is not configured" },
            meta: { correlationId: request.correlationId },
          });
          return reply.toInjectResponse();
        }

        request.query = parsedUrl.query;
        await reportsHandler(request, reply);
        return reply.toInjectResponse();
      }

      if (requireActiveSubscription !== undefined) {
        const tenantId = firstHeaderValue(request.headers, tenantHeaderName) ?? "";
        if (tenantId.length > 0) {
          await requireActiveSubscription(tenantId);
        }
      }

      const crmRoute = parseCrmRoute(options.method, parsedUrl.pathname);
      if (crmRoute !== null) {
        const isActivityRoute =
          crmRoute.name === "activityCreate" ||
          crmRoute.name === "activityList" ||
          crmRoute.name === "contactActivities" ||
          crmRoute.name === "dealActivities";
        const isContactRoute = crmRoute.name === "contactCreate" || crmRoute.name === "contactList";

        if (isContactRoute && dependencies.contacts === undefined) {
          reply.code(503).send({
            ok: false,
            error: { code: "CONTACTS_NOT_CONFIGURED", message: "Contacts API is not configured" },
            meta: { correlationId: request.correlationId },
          });
          return reply.toInjectResponse();
        }

        if (!isActivityRoute && !isContactRoute && dependencies.deals === undefined) {
          reply.code(503).send({
            ok: false,
            error: { code: "DEALS_NOT_CONFIGURED", message: "Deals API is not configured" },
            meta: { correlationId: request.correlationId },
          });
          return reply.toInjectResponse();
        }

        if (isActivityRoute && dependencies.activities === undefined) {
          reply.code(503).send({
            ok: false,
            error: { code: "ACTIVITIES_NOT_CONFIGURED", message: "Activities API is not configured" },
            meta: { correlationId: request.correlationId },
          });
          return reply.toInjectResponse();
        }

        request.params = crmRoute.params;
        request.query = parsedUrl.query;

        if (crmRoute.name === "pipelineBoard" && pipelineBoardHandler !== undefined) await pipelineBoardHandler(request, reply);
        if (crmRoute.name === "dealCreate" && dealCreateHandler !== undefined) await dealCreateHandler(request, reply);
        if (crmRoute.name === "dealMoveStage" && dealStageMoveHandler !== undefined) await dealStageMoveHandler(request, reply);
        if (crmRoute.name === "dealDetail" && dealDetailHandler !== undefined) await dealDetailHandler(request, reply);
        if (crmRoute.name === "activityCreate" && activityCreateHandler !== undefined) await activityCreateHandler(request, reply);
        if (crmRoute.name === "contactCreate" && contactCreateHandler !== undefined) await contactCreateHandler(request, reply);
        if (crmRoute.name === "contactList" && contactListHandler !== undefined) await contactListHandler(request, reply);
        if (crmRoute.name === "activityList" && activityListHandler !== undefined) await activityListHandler(request, reply);
        if (crmRoute.name === "contactActivities" && contactActivitiesHandler !== undefined) {
          await contactActivitiesHandler(request, reply);
        }
        if (crmRoute.name === "dealActivities" && dealActivitiesHandler !== undefined) {
          await dealActivitiesHandler(request, reply);
        }

        return reply.toInjectResponse();
      }

      const sdkEventParams = parseSdkEventsRoute(options.method, parsedUrl.pathname);
      if (sdkEventParams !== null) {
        request.params = sdkEventParams;
        request.headers = { ...request.headers, [tenantHeaderName]: sdkEventParams.tenantId };

        await authenticateApiKey(dependencies)(request);
        await verifyHmac(dependencies)(request);
        tenantIsolationValidation(request);
        await ingestionHandler(request, reply);

        return reply.toInjectResponse();
      }

      if (
        options.method === "POST" &&
        (parsedUrl.pathname === "/workspaces" ||
          parsedUrl.pathname === "/auth/login" ||
          parsedUrl.pathname === "/auth/signup" ||
          parsedUrl.pathname === "/auth/reset-password" ||
          parsedUrl.pathname === "/auth/accept-invite")
      ) {
        if (!authRateLimiter.check(getClientIp(request))) {
          reply.code(429).send({
            ok: false,
            error: { code: "RATE_LIMITED", message: "Too many requests. Please try again later." },
            meta: { correlationId: request.correlationId },
          });
          return reply.toInjectResponse();
        }
      }

      if (options.method === "POST" && parsedUrl.pathname === "/workspaces") {
        if (
          dependencies.workspaceProvisioningPort === undefined ||
          dependencies.trialStore === undefined ||
          dependencies.trialScheduler === undefined
        ) {
          reply.code(503).send({
            ok: false,
            error: { code: "WORKSPACE_CREATION_NOT_CONFIGURED", message: "Workspace creation is not configured" },
            meta: { correlationId: request.correlationId },
          });
          return reply.toInjectResponse();
        }

        const body = request.body as CreateWorkspaceInput;
        const result = await createWorkspace(
          dependencies.workspaceProvisioningPort,
          dependencies.trialStore,
          dependencies.trialScheduler,
          body,
          () => dependencies.now?.() ?? new Date(),
        );

        reply.code(result.isNew ? 201 : 200).send({
          ok: true,
          data: result,
          meta: { correlationId: request.correlationId },
        });
        return reply.toInjectResponse();
      }

      const onboardingMatch = /^\/workspaces\/([^/?#]+)\/onboarding\/?$/.exec(parsedUrl.pathname);
      if (options.method === "GET" && onboardingMatch !== null) {
        if (dependencies.onboardingStatePort === undefined) {
          reply.code(503).send({
            ok: false,
            error: { code: "ONBOARDING_NOT_CONFIGURED", message: "Onboarding API is not configured" },
            meta: { correlationId: request.correlationId },
          });
          return reply.toInjectResponse();
        }

        const workspaceId = decodeURIComponent(onboardingMatch[1] ?? "");
        const userId = firstHeaderValue(request.headers, "x-user-id") ?? "";
        const checklist = await computeOnboardingChecklist(dependencies.onboardingStatePort, workspaceId, userId);

        reply.send({ ok: true, data: checklist, meta: { correlationId: request.correlationId } });
        return reply.toInjectResponse();
      }

      if (options.method === "POST" && parsedUrl.pathname === "/billing/upgrade") {
        if (dependencies.upgradePorts === undefined) {
          reply.code(503).send({
            ok: false,
            error: { code: "UPGRADE_NOT_CONFIGURED", message: "Upgrade flow is not configured" },
            meta: { correlationId: request.correlationId },
          });
          return reply.toInjectResponse();
        }

        const body = request.body as { context: UpgradeWorkspaceContext; plan: string };
        const result = await initiateUpgrade(dependencies.upgradePorts, body.context, body.plan);

        reply.code(200).send({ ok: true, data: result, meta: { correlationId: request.correlationId } });
        return reply.toInjectResponse();
      }
      const renderSellerConversionMatch = /^\/marketplace-acquisition\/captures\/([^/?#]+)\/convert\/render-seller\/?$/u.exec(parsedUrl.pathname);
      if (options.method === "POST" && renderSellerConversionMatch !== null) {
        if (renderSellerConversionHandler === undefined) {
          reply.code(503).send({ ok: false, error: { code: "MARKETPLACE_ACQUISITION_NOT_CONFIGURED", message: "Render seller conversion is not configured" }, meta: { correlationId: request.correlationId } });
          return reply.toInjectResponse();
        }
        request.params = { id: decodeURIComponent(renderSellerConversionMatch[1] ?? "") };
        await renderSellerConversionHandler(request, reply);
        return reply.toInjectResponse();
      }
      if (options.method === "POST" && parsedUrl.pathname === "/marketplace-acquisition/captures") {
        if (dependencies.marketplaceAcquisition === undefined) {
          reply.code(503).send({
            ok: false,
            error: {
              code: "MARKETPLACE_ACQUISITION_NOT_CONFIGURED",
              message: "Marketplace Acquisition is not configured",
            },
            meta: { correlationId: request.correlationId },
          });
          return reply.toInjectResponse();
        }

        const tenantId = firstHeaderValue(request.headers, "x-tenant-id")?.trim();
        const actorId = firstHeaderValue(request.headers, "x-user-id")?.trim();

        if (!tenantId || !actorId) {
          reply.code(401).send({
            ok: false,
            error: {
              code: "TENANT_CONTEXT_MISMATCH",
              message: "Marketplace capture requires authenticated tenant and actor context",
            },
            meta: { correlationId: request.correlationId },
          });

          return reply.toInjectResponse();
       }

        if (requireActiveSubscription !== undefined) {
          await requireActiveSubscription(tenantId);
        }

        const result = (await dependencies.marketplaceAcquisition.capture(
          {
            tenantId,
            actorId,
            correlation: {
              correlationId: request.correlationId ?? "unknown",
            },
          },
          {
            ...(request.body as Record<string, unknown>),
            tenantId,
          },
        )) as {
          readonly isNew?: boolean;
          readonly duplicate?: boolean;
          readonly normalizationWarnings?: readonly string[];
        };

        reply.code(result.isNew === false || result.duplicate === true ? 200 : 201).send({
          ok: true,
          data: result,
          meta: {
            correlationId: request.correlationId,
            duplicate: result.duplicate ?? result.isNew === false,
            normalizationWarnings: result.normalizationWarnings ?? [],
          },
        });

        return reply.toInjectResponse();
      }
      reply.code(404).send({
        ok: false,
        error: { code: "NOT_FOUND", message: "Route not found" },
        meta: { correlationId: request.correlationId },
      });
      return reply.toInjectResponse();
    } catch (error) {
      return sendMappedError(reply, request.correlationId, error, request.log);
    } finally {
      span?.setAttribute?.("http.status_code", reply.getStatusCode());
      span?.end(reply.getStatusCode() >= 500 ? "ERROR" : "OK");
    }
  };

  return {
    inject,

    async listen(options) {
      server = createServer(async (incomingRequest: IncomingMessage, outgoingResponse: ServerResponse) => {
        const result = await inject({
          method:
            incomingRequest.method === "POST"
              ? "POST"
              : incomingRequest.method === "PATCH"
                ? "PATCH"
                : incomingRequest.method === "DELETE"
                  ? "DELETE"
                  : "GET",
          url: incomingRequest.url ?? "/",
          headers: Object.fromEntries(
            Object.entries(incomingRequest.headers).flatMap(([name, value]) => {
              if (typeof value === "string") return [[name, value] as const];
              if (Array.isArray(value) && value[0] !== undefined) return [[name, value[0]] as const];
              return [];
            }),
          ),
          payload: await readHttpRequestBody(incomingRequest),
        });

        outgoingResponse.statusCode = result.statusCode;

        for (const [name, value] of Object.entries(result.headers)) {
          outgoingResponse.setHeader(name, value);
        }

        outgoingResponse.setHeader("content-type", "application/json");
        outgoingResponse.end(result.payload);
      });

      await new Promise<void>((resolve) => server?.listen(options.port, options.host ?? "0.0.0.0", resolve));

      const address = server.address();
      return typeof address === "string"
        ? address
        : `http://${options.host ?? "0.0.0.0"}:${address?.port ?? options.port}`;
    },

    async close() {
      if (server === undefined) return;

      await new Promise<void>((resolve, reject) =>
        server?.close((error) => (error === undefined ? resolve() : reject(error))),
      );

      server = undefined;
    },
  };
};