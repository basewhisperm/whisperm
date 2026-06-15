import { ApiError } from "../errors.js";
import { firstHeaderValue, type FastifyReplyLike, type FastifyRequestLike } from "../http/fastify.js";

const convertPermission = "marketplace_acquisition.convert";

export interface RenderSellerConversionRouteDependencies {
  readonly renderSellerConversion: {
    convertClaimedSellerToRender(context: { readonly tenantId: string; readonly actorId?: string | undefined; readonly correlation: { readonly correlationId: string; readonly requestId?: string | undefined } }, input: { readonly tenantId: string; readonly marketplaceCaptureId: string }): Promise<{ readonly captureId: string; readonly contactId: string; readonly attestationId: string; readonly renderSellerId: string; readonly conversionStatus: "SUCCESS" }>;
  };
}

const splitPermissions = (value: string | undefined): readonly string[] => value === undefined ? [] : value.split(/[\s,]+/u).map((item) => item.trim()).filter((item) => item.length > 0);
const tokenPermissions = (request: FastifyRequestLike): readonly string[] => Array.isArray(request.auth?.principal.token.raw.permissions) ? request.auth.principal.token.raw.permissions.filter((permission): permission is string => typeof permission === "string" && permission.length > 0) : [];
const hasPermission = (request: FastifyRequestLike): boolean => [...splitPermissions(firstHeaderValue(request.headers, "x-permissions")), ...tokenPermissions(request)].includes(convertPermission);

export const createRenderSellerConversionHandler = (dependencies: RenderSellerConversionRouteDependencies) => async (request: FastifyRequestLike, reply: FastifyReplyLike): Promise<void> => {
  const tenantId = firstHeaderValue(request.headers, "x-tenant-id")?.trim();
  const actorId = request.auth?.principal.userId ?? firstHeaderValue(request.headers, "x-user-id")?.trim();
  const captureId = (request as { readonly params?: Readonly<Record<string, string>> }).params?.id?.trim();
  if (tenantId === undefined || tenantId.length === 0) throw new ApiError({ code: "TENANT_CONTEXT_MISMATCH", message: "Render seller conversion tenant context is required" });
  if (actorId === undefined || actorId.length === 0) throw new ApiError({ code: "AUTH_INVALID_TOKEN", message: "Authenticated user is required", statusCode: 401 });
  if (captureId === undefined || captureId.length === 0) throw new ApiError({ code: "REQUEST_BODY_INVALID", message: "Marketplace capture id is required" });
  if (!hasPermission(request)) throw new ApiError({ code: "TENANT_CONTEXT_MISMATCH", message: "Marketplace acquisition conversion permission is required", statusCode: 403 });

  const result = await dependencies.renderSellerConversion.convertClaimedSellerToRender({ tenantId, actorId, correlation: { correlationId: request.correlationId ?? request.id ?? "unknown" } }, { tenantId, marketplaceCaptureId: captureId });
  reply.code(200).send({ ok: true, data: { captureId: result.captureId, contactId: result.contactId, attestationId: result.attestationId, renderSellerId: result.renderSellerId, conversionStatus: result.conversionStatus }, meta: { correlationId: request.correlationId ?? "unknown" } });
};
