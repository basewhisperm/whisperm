import {
  createDealRequestSchema,
  moveDealStageRequestSchema,
  type CreateDealRequest,
  type MoveDealStageRequest,
  type PersistenceCorrelationMetadata,
} from "@whisperm/types";

import { ApiError } from "../errors.js";
import { firstHeaderValue, type FastifyReplyLike, type FastifyRequestLike } from "../http/fastify.js";

export interface DealRouteContext {
  readonly tenantId: string;
  readonly actorId?: string | undefined;
  readonly correlation: PersistenceCorrelationMetadata;
}

export interface DealPageRequest {
  readonly limit?: number;
  readonly cursors?: Readonly<Record<string, string | undefined>>;
}

export interface DealServicePort {
  board(context: DealRouteContext, pipelineId: string, pagination?: DealPageRequest): Promise<unknown> | unknown;
  createCard(context: DealRouteContext, input: {
    readonly tenantId: string;
    readonly pipelineStageId: string;
    readonly contactId?: string | undefined;
    readonly title: string;
    readonly value: number;
    readonly currency: string;
    readonly ownerId?: string | undefined;
    readonly probability: number;
  }): Promise<unknown> | unknown;
  moveStage(context: DealRouteContext, dealId: string, input: { readonly stageId: string; readonly expectedUpdatedAt: string }): Promise<unknown> | unknown;
  detail(context: DealRouteContext, dealId: string): Promise<unknown> | unknown;
}

export interface DealRouteDependencies {
  readonly deals: DealServicePort;
}

type DealFastifyRequest = FastifyRequestLike & {
  readonly params?: Readonly<Record<string, string | undefined>> | undefined;
  readonly query?: Readonly<Record<string, string | undefined>> | undefined;
};

const routeParam = (request: DealFastifyRequest, name: string): string => {
  const value = request.params?.[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new ApiError({ code: "TENANT_CONTEXT_MISMATCH", message: `${name} route parameter is required` });
  }
  return value;
};

const headerTenantId = (request: DealFastifyRequest): string => {
  const value = firstHeaderValue(request.headers, "x-tenant-id")?.trim();
  if (value === undefined || value.length === 0) {
    throw new ApiError({ code: "TENANT_CONTEXT_MISMATCH", message: "Workspace tenant context is required" });
  }
  return value;
};

const dealRouteContext = (request: DealFastifyRequest): DealRouteContext => ({
  tenantId: headerTenantId(request),
  actorId: request.auth?.principal.userId,
  correlation: { correlationId: request.correlationId ?? request.id ?? "unknown" },
});

const sendSuccess = (reply: FastifyReplyLike, data: unknown, correlationId: string | undefined): void => {
  reply.send({ ok: true, data, meta: { correlationId: correlationId ?? "unknown" } });
};

const parseBoardPage = (request: DealFastifyRequest): DealPageRequest => {
  const query = request.query ?? {};
  const limit = typeof query.limit === "string" ? Number(query.limit) : undefined;
  const cursors = Object.fromEntries(Object.entries(query)
    .filter(([key, value]) => key.startsWith("cursor[") && key.endsWith("]") && value !== undefined && value.length > 0)
    .map(([key, value]) => [key.slice("cursor[".length, -1), value] as const));
  return {
    ...(limit === undefined ? {} : { limit }),
    ...(Object.keys(cursors).length === 0 ? {} : { cursors }),
  };
};

const toCreateDealInput = (tenantId: string, body: CreateDealRequest) => ({
  tenantId,
  pipelineStageId: body.stageId,
  ...(body.contactId === undefined ? {} : { contactId: body.contactId }),
  title: body.title,
  value: body.dealValue,
  currency: body.currency,
  ...(body.ownerId === undefined ? {} : { ownerId: body.ownerId }),
  probability: body.probability,
});

const toMoveInput = (body: MoveDealStageRequest) => ({
  stageId: body.stageId,
  expectedUpdatedAt: body.updatedAt,
});

const normalizeDetailPayload = (detail: unknown): unknown => {
  if (typeof detail !== "object" || detail === null || !("deal" in detail)) {
    return detail;
  }
  const typed = detail as { readonly deal?: unknown };
  if (typeof typed.deal !== "object" || typed.deal === null) {
    return detail;
  }
  const deal = typed.deal as Readonly<Record<string, unknown>>;
  if (typeof deal.pipelineStageId !== "string" || deal.stageId !== undefined) {
    return detail;
  }
  return { ...detail, deal: { ...deal, stageId: deal.pipelineStageId } };
};

export const createPipelineBoardHandler = (dependencies: DealRouteDependencies) => async (request: DealFastifyRequest, reply: FastifyReplyLike): Promise<void> => {
  const context = dealRouteContext(request);
  const board = await dependencies.deals.board(context, routeParam(request, "pipelineId"), parseBoardPage(request));
  sendSuccess(reply, board, context.correlation.correlationId);
};

export const createDealCreateHandler = (dependencies: DealRouteDependencies) => async (request: DealFastifyRequest, reply: FastifyReplyLike): Promise<void> => {
  const context = dealRouteContext(request);
  const body = createDealRequestSchema.parse(request.body);
  const deal = await dependencies.deals.createCard(context, toCreateDealInput(context.tenantId, body));
  reply.code(201);
  sendSuccess(reply, deal, context.correlation.correlationId);
};

export const createDealStageMoveHandler = (dependencies: DealRouteDependencies) => async (request: DealFastifyRequest, reply: FastifyReplyLike): Promise<void> => {
  const context = dealRouteContext(request);
  const body = moveDealStageRequestSchema.parse(request.body);
  const deal = await dependencies.deals.moveStage(context, routeParam(request, "dealId"), toMoveInput(body));
  sendSuccess(reply, deal, context.correlation.correlationId);
};

export const createDealDetailHandler = (dependencies: DealRouteDependencies) => async (request: DealFastifyRequest, reply: FastifyReplyLike): Promise<void> => {
  const context = dealRouteContext(request);
  const detail = await dependencies.deals.detail(context, routeParam(request, "dealId"));
  sendSuccess(reply, normalizeDetailPayload(detail), context.correlation.correlationId);
};
