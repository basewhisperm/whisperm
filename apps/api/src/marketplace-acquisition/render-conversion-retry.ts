import { ApiError } from "../errors.js";
import { firstHeaderValue, type FastifyReplyLike, type FastifyRequestLike } from "../http/fastify.js";

const convertPermission = "marketplace_acquisition.convert";
const splitPermissions = (value: string | undefined): readonly string[] => value === undefined ? [] : value.split(/[\s,]+/u).map((item) => item.trim()).filter((item) => item.length > 0);
const tokenPermissions = (request: FastifyRequestLike): readonly string[] => Array.isArray(request.auth?.principal.token.raw.permissions) ? request.auth.principal.token.raw.permissions.filter((permission): permission is string => typeof permission === "string" && permission.length > 0) : [];
const hasPermission = (request: FastifyRequestLike): boolean => [...splitPermissions(firstHeaderValue(request.headers, "x-permissions")), ...tokenPermissions(request)].includes(convertPermission);

export interface RenderConversionRetryRouteDependencies { readonly renderConversionRetry: { retryRenderConversion(context: { readonly tenantId: string; readonly actorId?: string | undefined; readonly correlation: { readonly correlationId: string; readonly requestId?: string | undefined } }, input: { readonly tenantId: string; readonly conversionId: string }): Promise<{ readonly conversionId: string; readonly status: "RETRYING" | "SUCCESS" | "FAILED" | "DEAD_LETTERED"; readonly attemptCount: number; readonly nextAttemptAt: string | null }>; }; }
export const createRenderConversionRetryHandler = (dependencies: RenderConversionRetryRouteDependencies) => async (request: FastifyRequestLike, reply: FastifyReplyLike): Promise<void> => {
  const tenantId = firstHeaderValue(request.headers, "x-tenant-id")?.trim();
  const actorId = request.auth?.principal.userId ?? firstHeaderValue(request.headers, "x-user-id")?.trim();
  const conversionId = (request as { readonly params?: Readonly<Record<string, string>> }).params?.id?.trim();
  if (tenantId === undefined || tenantId.length === 0) throw new ApiError({ code: "TENANT_CONTEXT_MISMATCH", message: "Render conversion retry tenant context is required" });
  if (actorId === undefined || actorId.length === 0) throw new ApiError({ code: "AUTH_INVALID_TOKEN", message: "Authenticated user is required", statusCode: 401 });
  if (conversionId === undefined || conversionId.length === 0) throw new ApiError({ code: "REQUEST_BODY_INVALID", message: "Render conversion id is required" });
  if (!hasPermission(request)) throw new ApiError({ code: "TENANT_CONTEXT_MISMATCH", message: "Marketplace acquisition conversion permission is required", statusCode: 403 });
  const result = await dependencies.renderConversionRetry.retryRenderConversion({ tenantId, actorId, correlation: { correlationId: request.correlationId ?? request.id ?? "unknown" } }, { tenantId, conversionId });
  reply.code(200).send({ ok: true, data: result, meta: { correlationId: request.correlationId ?? "unknown" } });
};
