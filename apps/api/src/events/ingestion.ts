import { randomUUID } from "node:crypto";

import {
  inboundWebhookRequestSchema,
  normalizeInboundEvent,
  type CorrelationMetadata,
  type InboundWebhookRequest,
  type NormalizedInboundEvent,
} from "@whisperm/types";

import { firstHeaderValue, type FastifyRequestLike, type FastifyRouteHandler } from "../http/fastify.js";
import type { EventIdempotencyProtection, EventPersistenceService, EventQueue } from "./contracts.js";
import { EventIngestionError } from "./errors.js";

export interface InboundWebhookIngestionDependencies {
  idempotency: EventIdempotencyProtection;
  persistence: EventPersistenceService;
  queue: EventQueue;
  now?: () => Date;
  createEventId?: () => string;
}

const tenantHeaderName = "x-tenant-id";

const parseInboundWebhookRequest = (body: unknown): InboundWebhookRequest => {
  const result = inboundWebhookRequestSchema.safeParse(body);
  if (!result.success) {
    throw new EventIngestionError({
      code: "EVENT_VALIDATION_FAILED",
      message: "Inbound event payload is invalid",
      details: { issues: result.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code })) },
    });
  }
  return result.data;
};

const resolveTenantId = (request: FastifyRequestLike, bodyTenantId: string, eventTenantId: string): string => {
  const headerTenantId = firstHeaderValue(request.headers, tenantHeaderName)?.trim();
  if (headerTenantId === undefined || headerTenantId.length === 0) {
    throw new EventIngestionError({ code: "EVENT_TENANT_REQUIRED", message: "Tenant header is required" });
  }
  if (bodyTenantId !== eventTenantId || headerTenantId !== eventTenantId) {
    throw new EventIngestionError({ code: "EVENT_TENANT_MISMATCH", message: "Inbound event tenant context does not match" });
  }
  return eventTenantId;
};

const buildCorrelation = (request: FastifyRequestLike): CorrelationMetadata => ({
  correlationId: request.correlationId ?? request.id ?? randomUUID(),
  ...(request.id !== undefined ? { requestId: request.id } : {}),
});

const logInboundEventAccepted = (request: FastifyRequestLike, event: NormalizedInboundEvent): void => {
  request.log?.info?.({
    tenantId: event.tenantId,
    correlationId: event.correlation.correlationId,
    eventId: event.id,
    eventType: event.type,
    provider: event.source.provider,
  }, "inbound event accepted");
};

export const createInboundWebhookIngestionHandler = (
  dependencies: InboundWebhookIngestionDependencies,
): FastifyRouteHandler => async (request, reply) => {
  const parsed = parseInboundWebhookRequest(request.body);
  const tenantId = resolveTenantId(request, parsed.tenantId, parsed.event.tenantId);
  const normalized = normalizeInboundEvent({
    event: parsed.event,
    correlation: buildCorrelation(request),
    receivedAt: dependencies.now?.() ?? new Date(),
    eventId: dependencies.createEventId?.() ?? randomUUID(),
  });

  const reservation = {
    tenantId,
    idempotencyKey: normalized.idempotencyKey,
    eventId: normalized.id,
    correlationId: normalized.correlation.correlationId,
  };

  const reservationResult = await dependencies.idempotency.reserve(reservation);
  if (reservationResult === "duplicate") {
    request.log?.info?.({ tenantId, correlationId: reservation.correlationId, eventId: normalized.id }, "duplicate inbound event ignored");
    reply.code(202).send({ ok: true, data: { accepted: false, duplicate: true, eventId: normalized.id }, meta: normalized.correlation });
    return;
  }

  try {
    await dependencies.persistence.persistInboundEvent(normalized);
    await dependencies.queue.enqueueInboundEvent({
      tenantId,
      eventId: normalized.id,
      idempotencyKey: normalized.idempotencyKey,
      correlationId: normalized.correlation.correlationId,
    });
    await dependencies.idempotency.markSucceeded(reservation);
  } catch (cause) {
    await dependencies.idempotency.markFailed({ ...reservation, reasonCode: "EVENT_INGESTION_FAILED" });
    request.log?.error?.({ tenantId, correlationId: reservation.correlationId, eventId: normalized.id }, "inbound event ingestion failed");
    throw new EventIngestionError({
      code: "EVENT_QUEUE_ENQUEUE_FAILED",
      message: "Inbound event could not be accepted for processing",
      details: { causeName: cause instanceof Error ? cause.name : "Unknown" },
    });
  }

  logInboundEventAccepted(request, normalized);
  reply.code(202).send({ ok: true, data: { accepted: true, eventId: normalized.id }, meta: normalized.correlation });
};
