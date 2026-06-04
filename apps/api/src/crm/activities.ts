import {
  createActivityRequestSchema,
  listActivitiesQuerySchema,
  type CreateActivityRequest,
  type ListActivitiesQuery,
  type PersistenceCorrelationMetadata,
} from "@whisperm/types";

import { ApiError } from "../errors.js";
import { firstHeaderValue, type FastifyReplyLike, type FastifyRequestLike } from "../http/fastify.js";
import type { Page, PageRequest } from "./contacts.js";

export interface ActivityRouteContext {
  readonly tenantId: string;
  readonly actorId?: string | undefined;
  readonly correlation: PersistenceCorrelationMetadata;
}

export interface ActivityServicePort {
  create(context: ActivityRouteContext, input: CreateActivityRequest & { readonly tenantId: string }): Promise<unknown> | unknown;
  list(context: ActivityRouteContext, filters?: ListActivitiesQuery, page?: PageRequest): Promise<Page<unknown>> | Page<unknown>;
}

export interface ActivityRouteDependencies {
  readonly activities: ActivityServicePort;
}

type ActivityFastifyRequest = FastifyRequestLike & {
  readonly params?: Readonly<Record<string, string | undefined>> | undefined;
  readonly query?: Readonly<Record<string, string | undefined>> | undefined;
};

const routeParam = (request: ActivityFastifyRequest, name: string): string => {
  const value = request.params?.[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new ApiError({ code: "TENANT_CONTEXT_MISMATCH", message: `${name} route parameter is required` });
  }
  return value;
};

const headerTenantId = (request: ActivityFastifyRequest): string => {
  const value = firstHeaderValue(request.headers, "x-tenant-id")?.trim();
  if (value === undefined || value.length === 0) {
    throw new ApiError({ code: "TENANT_CONTEXT_MISMATCH", message: "Workspace tenant context is required" });
  }
  return value;
};

const actorId = (request: ActivityFastifyRequest): string => {
  const value = request.auth?.principal.userId ?? firstHeaderValue(request.headers, "x-user-id")?.trim();
  if (value === undefined || value.length === 0) {
    throw new ApiError({ code: "TENANT_CONTEXT_MISMATCH", message: "Authenticated actor context is required", statusCode: 401 });
  }
  return value;
};

const routeContext = (request: ActivityFastifyRequest): ActivityRouteContext => ({
  tenantId: headerTenantId(request),
  actorId: actorId(request),
  correlation: { correlationId: request.correlationId ?? request.id ?? "unknown" },
});

const pageRequest = (request: ActivityFastifyRequest): PageRequest => {
  const query = request.query ?? {};
  const limit = typeof query.limit === "string" ? Number(query.limit) : undefined;
  const cursor = typeof query.cursor === "string" && query.cursor.length > 0 ? query.cursor : undefined;
  return {
    ...(limit === undefined ? {} : { limit }),
    ...(cursor === undefined ? {} : { cursor }),
  };
};

const sendSuccess = (reply: FastifyReplyLike, data: unknown, correlationId: string | undefined): void => {
  reply.send({ ok: true, data, meta: { correlationId: correlationId ?? "unknown" } });
};

export const createActivityCreateHandler = (dependencies: ActivityRouteDependencies) => async (request: ActivityFastifyRequest, reply: FastifyReplyLike): Promise<void> => {
  const context = routeContext(request);
  const body = createActivityRequestSchema.parse(request.body);
  const activity = await dependencies.activities.create(context, { ...body, tenantId: context.tenantId });
  reply.code(201);
  sendSuccess(reply, activity, context.correlation.correlationId);
};

export const createActivityListHandler = (dependencies: ActivityRouteDependencies) => async (request: ActivityFastifyRequest, reply: FastifyReplyLike): Promise<void> => {
  const context = routeContext(request);
  const filters = listActivitiesQuerySchema.parse(request.query ?? {});
  sendSuccess(reply, await dependencies.activities.list(context, filters, pageRequest(request)), context.correlation.correlationId);
};

export const createContactActivitiesHandler = (dependencies: ActivityRouteDependencies) => async (request: ActivityFastifyRequest, reply: FastifyReplyLike): Promise<void> => {
  const context = routeContext(request);
  sendSuccess(reply, await dependencies.activities.list(context, { ...listActivitiesQuerySchema.parse(request.query ?? {}), contactId: routeParam(request, "contactId") }, pageRequest(request)), context.correlation.correlationId);
};

export const createDealActivitiesHandler = (dependencies: ActivityRouteDependencies) => async (request: ActivityFastifyRequest, reply: FastifyReplyLike): Promise<void> => {
  const context = routeContext(request);
  sendSuccess(reply, await dependencies.activities.list(context, { ...listActivitiesQuerySchema.parse(request.query ?? {}), dealId: routeParam(request, "dealId") }, pageRequest(request)), context.correlation.correlationId);
};
