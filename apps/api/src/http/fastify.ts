import type { AuthenticatedRequestContext, TenantMembership } from "../auth/types.js";

export interface RequestLogger {
  info?(data: Readonly<Record<string, unknown>>, message?: string): void;
  warn?(data: Readonly<Record<string, unknown>>, message?: string): void;
  error?(data: Readonly<Record<string, unknown>>, message?: string): void;
}

export interface FastifyRequestLike {
  headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  id?: string;
  log?: RequestLogger;
  auth?: AuthenticatedRequestContext;
  tenant?: TenantMembership;
  correlationId?: string;
  body?: unknown;
}

export interface FastifyReplyLike {
  code(statusCode: number): FastifyReplyLike;
  header(name: string, value: string): FastifyReplyLike;
  send(payload: unknown): void;
}

export type FastifyHookHandler = (
  request: FastifyRequestLike,
  reply: FastifyReplyLike,
) => Promise<void> | void;

export type FastifyRouteHandler = FastifyHookHandler;

export const firstHeaderValue = (
  headers: FastifyRequestLike["headers"],
  name: string,
): string | undefined => {
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (typeof direct === "string") {
    return direct;
  }
  if (Array.isArray(direct)) {
    return direct[0];
  }
  return undefined;
};
