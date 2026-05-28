import { randomUUID } from "node:crypto";

import type { FastifyHookHandler } from "./fastify.js";
import { firstHeaderValue } from "./fastify.js";

const correlationHeaderName = "x-correlation-id";

const normalizeCorrelationId = (value: string | undefined): string => {
  if (value === undefined || value.trim().length === 0) {
    return randomUUID();
  }
  return value.trim();
};

export const correlationIdMiddleware = (): FastifyHookHandler => (request, reply) => {
  const correlationId = normalizeCorrelationId(firstHeaderValue(request.headers, correlationHeaderName));
  request.correlationId = correlationId;
  reply.header(correlationHeaderName, correlationId);
};
