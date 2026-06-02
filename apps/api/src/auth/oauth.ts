import { randomBytes } from "node:crypto";
import type { AuditLogger } from "./types.js";

export interface GoogleOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly scopes?: readonly string[];
}
export interface OAuthStateStore {
  save(state: string, expiresAt: Date): Promise<void>;
  consume(state: string): Promise<boolean>;
}
export interface OAuthUserRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly externalUserId: string;
  readonly email: string;
  readonly displayName?: string;
  readonly isActive: boolean;
  readonly role: string;
}
export interface OAuthTenantRecord {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}
export interface OAuthSessionToken {
  readonly accessToken: string;
  readonly expiresAt: Date;
}
export interface OAuthCallbackResult {
  readonly user: OAuthUserRecord;
  readonly isNewUser: boolean;
  readonly requiresWorkspaceSetup: boolean;
  readonly session: OAuthSessionToken;
  readonly tenants: readonly OAuthTenantRecord[];
}
export interface OAuthUserRepository {
  findByExternalUserId(externalUserId: string): Promise<OAuthUserRecord | null>;
  findByEmail(email: string): Promise<OAuthUserRecord | null>;
  upsertFromOAuth(input: { readonly externalUserId: string; readonly email: string; readonly displayName?: string }): Promise<{ readonly user: OAuthUserRecord; readonly isNewUser: boolean }>;
  listTenants(userId: string): Promise<readonly OAuthTenantRecord[]>;
}
export interface OAuthSessionService {
  create(input: { readonly userId: string; readonly externalUserId: string; readonly tenantIds: readonly string[]; readonly correlationId: string }): Promise<OAuthSessionToken>;
}
export interface OAuthHttpClient {
  post(url: string, body: Record<string, string>): Promise<unknown>;
  get(url: string, accessToken: string): Promise<unknown>;
}
export interface GoogleOAuthDependencies {
  readonly config: GoogleOAuthConfig;
  readonly stateStore: OAuthStateStore;
  readonly userRepository: OAuthUserRepository;
  readonly sessionService: OAuthSessionService;
  readonly httpClient: OAuthHttpClient;
  readonly auditLogger: AuditLogger;
  readonly now?: () => Date;
}
export interface OAuthTokenResponse { readonly accessToken: string; readonly idToken: string; readonly expiresIn: number; readonly tokenType: string; }
export interface GoogleUserInfo { readonly sub: string; readonly email: string; readonly emailVerified: boolean; readonly name?: string; }
export interface OAuthRouteResult { readonly statusCode: number; readonly body: unknown; readonly redirectTo?: string; }

export type OAuthErrorCode =
  | "OAUTH_STATE_INVALID"
  | "OAUTH_STATE_EXPIRED"
  | "OAUTH_CODE_EXCHANGE_FAILED"
  | "OAUTH_USERINFO_FAILED"
  | "OAUTH_EMAIL_NOT_VERIFIED"
  | "OAUTH_ACCOUNT_INACTIVE";

export class OAuthError extends Error {
  public readonly code: OAuthErrorCode;
  public readonly statusCode: number;
  public constructor(code: OAuthErrorCode, message: string, statusCode = 400) {
    super(message);
    this.name = "OAuthError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

const STATE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_SCOPES = ["openid", "email", "profile"] as const;

export const generateOAuthState = (): string => randomBytes(32).toString("base64url");

const isTokenResponse = (v: unknown): v is { access_token: string; id_token: string; expires_in: number; token_type: string } =>
  typeof v === "object" && v !== null &&
  typeof (v as Record<string, unknown>).access_token === "string" &&
  typeof (v as Record<string, unknown>).id_token === "string" &&
  typeof (v as Record<string, unknown>).expires_in === "number";

const isUserInfo = (v: unknown): v is { sub: string; email: string; email_verified: boolean; name?: string } =>
  typeof v === "object" && v !== null &&
  typeof (v as Record<string, unknown>).sub === "string" &&
  typeof (v as Record<string, unknown>).email === "string";

export const buildGoogleAuthorizationUrl = (config: GoogleOAuthConfig, state: string): string => {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: (config.scopes ?? DEFAULT_SCOPES).join(" "),
    state,
    access_type: "offline",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
};

export const createGoogleOAuthHandler = (deps: GoogleOAuthDependencies) => {
  const { config, stateStore, userRepository, sessionService, httpClient, auditLogger } = deps;
  const now = deps.now ?? (() => new Date());

  const initiateAuthorization = async (correlationId: string): Promise<{ readonly authorizationUrl: string; readonly state: string }> => {
    const state = generateOAuthState();
    await stateStore.save(state, new Date(now().getTime() + STATE_TTL_MS));
    await auditLogger.record({ action: "auth.oauth.initiated", correlationId, outcome: "SUCCESS", occurredAt: now() });
    return { authorizationUrl: buildGoogleAuthorizationUrl(config, state), state };
  };

  const handleCallback = async (input: { readonly code: string; readonly state: string; readonly correlationId: string }): Promise<OAuthCallbackResult> => {
    const { code, state, correlationId } = input;

    const stateValid = await stateStore.consume(state);
    if (!stateValid) {
      await auditLogger.record({ action: "auth.oauth.state_invalid", correlationId, outcome: "DENIED", occurredAt: now() });
      throw new OAuthError("OAUTH_STATE_INVALID", "OAuth state is invalid or expired", 400);
    }

    let rawTokens: unknown;
    try {
      rawTokens = await httpClient.post("https://oauth2.googleapis.com/token", {
        client_id: config.clientId, client_secret: config.clientSecret,
        redirect_uri: config.redirectUri, grant_type: "authorization_code", code,
      });
    } catch {
      await auditLogger.record({ action: "auth.oauth.token_exchange_failed", correlationId, outcome: "FAILED", occurredAt: now() });
      throw new OAuthError("OAUTH_CODE_EXCHANGE_FAILED", "Failed to exchange authorization code for tokens", 502);
    }
    if (!isTokenResponse(rawTokens)) {
      throw new OAuthError("OAUTH_CODE_EXCHANGE_FAILED", "Token response has unexpected shape", 502);
    }

    let rawUserInfo: unknown;
    try {
      rawUserInfo = await httpClient.get("https://www.googleapis.com/oauth2/v3/userinfo", rawTokens.access_token);
    } catch {
      throw new OAuthError("OAUTH_USERINFO_FAILED", "Failed to retrieve user info from Google", 502);
    }
    if (!isUserInfo(rawUserInfo)) {
      throw new OAuthError("OAUTH_USERINFO_FAILED", "User info response has unexpected shape", 502);
    }
    if (!rawUserInfo.email_verified) {
      await auditLogger.record({ action: "auth.oauth.email_not_verified", correlationId, outcome: "DENIED", occurredAt: now() });
      throw new OAuthError("OAUTH_EMAIL_NOT_VERIFIED", "Google account email is not verified", 403);
    }

    const { user, isNewUser } = await userRepository.upsertFromOAuth({
      externalUserId: rawUserInfo.sub,
      email: rawUserInfo.email,
      displayName: rawUserInfo.name,
    });

    if (!user.isActive) {
      await auditLogger.record({ action: "auth.oauth.account_inactive", correlationId, outcome: "DENIED", occurredAt: now() });
      throw new OAuthError("OAUTH_ACCOUNT_INACTIVE", "Account is inactive", 403);
    }

    const tenants = await userRepository.listTenants(user.id);
    const session = await sessionService.create({
      userId: user.id, externalUserId: user.externalUserId,
      tenantIds: tenants.map((t) => t.id), correlationId,
    });

    await auditLogger.record({
      action: isNewUser ? "auth.oauth.user_registered" : "auth.oauth.user_signed_in",
      correlationId, outcome: "SUCCESS", occurredAt: now(),
    });

    return { user, isNewUser, requiresWorkspaceSetup: tenants.length === 0, session, tenants };
  };

  return { initiateAuthorization, handleCallback };
};

export type GoogleOAuthHandler = ReturnType<typeof createGoogleOAuthHandler>;

export const createOAuthInitiateRouteHandler = (handler: GoogleOAuthHandler) =>
  async (correlationId: string): Promise<OAuthRouteResult> => {
    const result = await handler.initiateAuthorization(correlationId);
    return { statusCode: 302, redirectTo: result.authorizationUrl, body: { ok: true, data: { state: result.state } } };
  };

export const createOAuthCallbackRouteHandler = (handler: GoogleOAuthHandler) =>
  async (input: { readonly code: string | undefined; readonly state: string | undefined; readonly error: string | undefined; readonly correlationId: string }): Promise<OAuthRouteResult> => {
    const { code, state, error, correlationId } = input;
    if (error !== undefined) {
      return { statusCode: 400, body: { ok: false, error: { code: "OAUTH_DENIED", message: `Google OAuth denied: ${error}` } } };
    }
    if (typeof code !== "string" || code.length === 0 || typeof state !== "string" || state.length === 0) {
      return { statusCode: 400, body: { ok: false, error: { code: "OAUTH_STATE_INVALID", message: "Missing code or state parameter" } } };
    }
    const result = await handler.handleCallback({ code, state, correlationId });
    return {
      statusCode: 302,
      redirectTo: result.requiresWorkspaceSetup ? "/onboarding/workspace" : "/dashboard",
      body: {
        ok: true,
        data: {
          userId: result.user.id, isNewUser: result.isNewUser,
          requiresWorkspaceSetup: result.requiresWorkspaceSetup,
          accessToken: result.session.accessToken,
          expiresAt: result.session.expiresAt.toISOString(),
          tenants: result.tenants.map((t) => ({ id: t.id, slug: t.slug, name: t.name })),
        },
      },
    };
  };
