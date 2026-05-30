import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { inboundWebhookRequestSchema } from "@whisperm/types";

import { ApiError, mapErrorToHttp } from "./errors.js";
import { createInboundWebhookIngestionHandler, type InboundWebhookIngestionDependencies } from "./events/ingestion.js";
import { correlationIdMiddleware } from "./http/correlation.js";
import { firstHeaderValue, type FastifyReplyLike, type FastifyRequestLike, type RequestLogger } from "./http/fastify.js";

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

export interface ApiServerDependencies extends InboundWebhookIngestionDependencies {
  readonly apiKeyAuthenticator: ApiKeyAuthenticator;
  readonly hmacVerifier: HmacVerifier;
  readonly readiness?: ReadinessCheck;
  readonly logger?: RequestLogger;
}

export interface InjectOptions {
  readonly method: "GET" | "POST";
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
  rawBody?: string;
  sdkApiKey?: ApiKeyPrincipal;
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
  request.log?.info?.({ correlationId: request.correlationId, method: request.method, url: request.url }, "request received");
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
      details: { issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code })) },
    });
  }

  if (parsed.data.tenantId !== tenantId || parsed.data.event.tenantId !== tenantId || request.sdkApiKey?.tenantId !== tenantId) {
    throw new ApiError({ code: "TENANT_CONTEXT_MISMATCH", message: "SDK event tenant context does not match" });
  }
};

const parseSdkEventsRoute = (method: string, url: string): Readonly<Record<string, string>> | null => {
  if (method !== "POST") {
    return null;
  }
  const match = /^\/sdk-events\/([^/?#]+)\/?$/u.exec(url);
  if (match === null) {
    return null;
  }
  return { tenantId: decodeURIComponent(match[1] ?? "") };
};

const normalizeHeaders = (headers: InjectOptions["headers"]): Readonly<Record<string, string>> => {
  const entries = Object.entries(headers ?? {}).map(([name, value]) => [name.toLowerCase(), value] as const);
  return Object.fromEntries(entries);
};

const serializePayload = (payload: unknown): string => {
  if (payload === undefined) {
    return "";
  }
  return typeof payload === "string" ? payload : JSON.stringify(payload);
};

const parseJsonPayload = (rawBody: string): unknown => {
  if (rawBody.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(rawBody) as unknown;
  } catch (cause) {
    throw new ApiError({ code: "REQUEST_BODY_INVALID", message: "Request body must be valid JSON", cause });
  }
};

const sendMappedError = (reply: MemoryReply, correlationId: string | undefined, error: unknown, logger: RequestLogger | undefined): InjectResponse => {
  const mapped = mapErrorToHttp(error);
  logger?.warn?.({ correlationId, code: mapped.payload.error.code, statusCode: mapped.statusCode }, "request failed");
  reply.code(mapped.statusCode).send({ ...mapped.payload, meta: { correlationId: correlationId ?? "unknown" } });
  return reply.toInjectResponse();
};

export const createApiServer = (dependencies: ApiServerDependencies): ApiServer => {
  const ingestionHandler = createInboundWebhookIngestionHandler(dependencies);
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

    try {
      request.body = parseJsonPayload(rawBody);
      correlationIdMiddleware()(request, reply);
      requestLoggingMiddleware(request);

      if (options.method === "GET" && options.url === "/healthz") {
        reply.send({ ok: true, data: { status: "ok" }, meta: { correlationId: request.correlationId } });
        return reply.toInjectResponse();
      }

      if (options.method === "GET" && options.url === "/readyz") {
        try {
          await dependencies.readiness?.check();
        } catch (cause) {
          throw new ApiError({ code: "READY_CHECK_FAILED", message: "API service is not ready", cause });
        }
        reply.send({ ok: true, data: { status: "ready" }, meta: { correlationId: request.correlationId } });
        return reply.toInjectResponse();
      }

      const params = parseSdkEventsRoute(options.method, options.url);
      if (params !== null) {
        request.params = params;
        request.headers = { ...request.headers, [tenantHeaderName]: params.tenantId };
        await authenticateApiKey(dependencies)(request);
        await verifyHmac(dependencies)(request);
        tenantIsolationValidation(request);
        await ingestionHandler(request, reply);
        return reply.toInjectResponse();
      }

      reply.code(404).send({ ok: false, error: { code: "NOT_FOUND", message: "Route not found" }, meta: { correlationId: request.correlationId } });
      return reply.toInjectResponse();
    } catch (error) {
      return sendMappedError(reply, request.correlationId, error, request.log);
    }
  };

  const readHttpRequestBody = async (request: IncomingMessage): Promise<string> => new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });

  return {
    inject,
    async listen(options) {
      server = createServer(async (incomingRequest: IncomingMessage, outgoingResponse: ServerResponse) => {
        const result = await inject({
          method: incomingRequest.method === "POST" ? "POST" : "GET",
          url: incomingRequest.url ?? "/",
          headers: Object.fromEntries(Object.entries(incomingRequest.headers).flatMap(([name, value]) => {
            if (typeof value === "string") {
              return [[name, value] as const];
            }
            if (Array.isArray(value) && value[0] !== undefined) {
              return [[name, value[0]] as const];
            }
            return [];
          })),
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
      return typeof address === "string" ? address : `http://${options.host ?? "0.0.0.0"}:${address?.port ?? options.port}`;
    },
    async close() {
      if (server === undefined) {
        return;
      }
      await new Promise<void>((resolve, reject) => server?.close((error) => error === undefined ? resolve() : reject(error)));
      server = undefined;
    },
  };
};
