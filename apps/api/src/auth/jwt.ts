import { createHmac, timingSafeEqual } from "node:crypto";

import { AuthError } from "./errors.js";
import type { AuthenticatedPrincipal, JwtAccessTokenClaims } from "./types.js";

interface JwtVerifierOptions {
  issuer?: string;
  audience?: string;
  secretProvider: () => Promise<string> | string;
  now?: () => Date;
}

type JsonObject = Readonly<Record<string, unknown>>;

const textDecoder = new TextDecoder();

const decodeBase64Url = (value: string): Buffer => {
  try {
    return Buffer.from(value, "base64url");
  } catch {
    throw new AuthError({ code: "AUTH_INVALID_TOKEN", message: "Access token is not valid base64url" });
  }
};

const parseJsonObject = (value: Buffer): JsonObject => {
  try {
    const parsed: unknown = JSON.parse(textDecoder.decode(value));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new AuthError({ code: "AUTH_INVALID_TOKEN", message: "Access token segment must be a JSON object" });
    }
    return parsed as JsonObject;
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    throw new AuthError({ code: "AUTH_INVALID_TOKEN", message: "Access token segment is malformed JSON" });
  }
};

const readStringClaim = (claims: JsonObject, name: string): string | undefined => {
  const value = claims[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const readStringArrayClaim = (claims: JsonObject, name: string): readonly string[] => {
  const value = claims[name];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
};

const readNumericDate = (claims: JsonObject, name: string): Date | undefined => {
  const value = claims[name];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return new Date(value * 1000);
};

const assertExpectedIssuer = (claims: JsonObject, issuer: string | undefined): void => {
  if (issuer !== undefined && readStringClaim(claims, "iss") !== issuer) {
    throw new AuthError({ code: "AUTH_INVALID_TOKEN", message: "Access token issuer is not trusted" });
  }
};

const assertExpectedAudience = (claims: JsonObject, audience: string | undefined): void => {
  if (audience === undefined) {
    return;
  }

  const tokenAudience = claims.aud;
  const allowed = typeof tokenAudience === "string"
    ? tokenAudience === audience
    : Array.isArray(tokenAudience) && tokenAudience.includes(audience);

  if (!allowed) {
    throw new AuthError({ code: "AUTH_INVALID_TOKEN", message: "Access token audience is not accepted" });
  }
};

const buildClaims = (claims: JsonObject, now: Date, options: JwtVerifierOptions): JwtAccessTokenClaims => {
  const subject = readStringClaim(claims, "sub");
  const expiresAt = readNumericDate(claims, "exp");
  const notBefore = readNumericDate(claims, "nbf");
  const tenantIds = readStringArrayClaim(claims, "tenant_ids");

  if (subject === undefined || expiresAt === undefined) {
    throw new AuthError({ code: "AUTH_INVALID_TOKEN", message: "Access token is missing required claims" });
  }
  if (expiresAt.getTime() <= now.getTime()) {
    throw new AuthError({ code: "AUTH_TOKEN_EXPIRED", message: "Access token is expired" });
  }
  if (notBefore !== undefined && notBefore.getTime() > now.getTime()) {
    throw new AuthError({ code: "AUTH_INVALID_TOKEN", message: "Access token is not active yet" });
  }
  if (tenantIds.length === 0) {
    throw new AuthError({ code: "TENANT_CONTEXT_REQUIRED", message: "Access token has no tenant context" });
  }

  assertExpectedIssuer(claims, options.issuer);
  assertExpectedAudience(claims, options.audience);

  const result: JwtAccessTokenClaims = {
    subject,
    expiresAt,
    tenantIds,
    raw: claims,
  };
  const issuer = readStringClaim(claims, "iss");
  const issuedAt = readNumericDate(claims, "iat");
  if (issuer !== undefined) {
    result.issuer = issuer;
  }
  if (typeof claims.aud === "string") {
    result.audience = claims.aud;
  } else if (Array.isArray(claims.aud)) {
    result.audience = claims.aud.filter((item): item is string => typeof item === "string");
  }
  if (issuedAt !== undefined) {
    result.issuedAt = issuedAt;
  }
  if (notBefore !== undefined) {
    result.notBefore = notBefore;
  }
  return result;
};

export const createJwtAccessTokenVerifier = (options: JwtVerifierOptions) => async (
  token: string,
): Promise<AuthenticatedPrincipal> => {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new AuthError({ code: "AUTH_INVALID_TOKEN", message: "Access token must be a compact JWT" });
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (encodedHeader === undefined || encodedPayload === undefined || encodedSignature === undefined) {
    throw new AuthError({ code: "AUTH_INVALID_TOKEN", message: "Access token is incomplete" });
  }

  const header = parseJsonObject(decodeBase64Url(encodedHeader));
  if (header.alg !== "HS256" || header.typ !== "JWT") {
    throw new AuthError({ code: "AUTH_INVALID_TOKEN", message: "Access token header is not supported" });
  }

  const secret = await options.secretProvider();
  if (secret.length === 0) {
    throw new AuthError({ code: "AUTH_INVALID_TOKEN", message: "Access token verifier is not configured" });
  }

  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = createHmac("sha256", secret).update(signatureInput).digest();
  const actualSignature = decodeBase64Url(encodedSignature);
  if (actualSignature.length !== expectedSignature.length || !timingSafeEqual(actualSignature, expectedSignature)) {
    throw new AuthError({ code: "AUTH_INVALID_TOKEN", message: "Access token signature is invalid" });
  }

  const now = options.now?.() ?? new Date();
  const claims = buildClaims(parseJsonObject(decodeBase64Url(encodedPayload)), now, options);
  return {
    userId: claims.subject,
    externalSubject: claims.subject,
    tenantIds: claims.tenantIds,
    token: claims,
  };
};
