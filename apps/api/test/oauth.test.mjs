import assert from "node:assert/strict";
import test from "node:test";
import {
  OAuthError, buildGoogleAuthorizationUrl, createGoogleOAuthHandler,
  createOAuthCallbackRouteHandler, createOAuthInitiateRouteHandler, generateOAuthState,
} from "../dist/auth/oauth.js";

const fixedNow = new Date("2026-01-01T00:00:00.000Z");
const correlationId = "corr-oauth-1";
const config = { clientId: "test-client-id", clientSecret: "test-client-secret", redirectUri: "https://whisperm.io/auth/google/callback" };
const mockUser = { id: "user-1", tenantId: "tenant-1", externalUserId: "google-sub-abc123", email: "owner@render.com", displayName: "Kwame Mensah", isActive: true, role: "OWNER" };
const mockTenant = { id: "tenant-1", slug: "render", name: "Render" };

const createDeps = (overrides = {}) => {
  const auditEntries = [];
  const savedStates = new Map();
  const base = {
    auditEntries, config, now: () => fixedNow,
    stateStore: {
      async save(state, expiresAt) { savedStates.set(state, expiresAt); },
      async consume(state) { if (!savedStates.has(state)) return false; savedStates.delete(state); return true; },
    },
    userRepository: {
      async findByExternalUserId() { return null; },
      async findByEmail() { return null; },
      async upsertFromOAuth(input) { return { user: { ...mockUser, externalUserId: input.externalUserId, email: input.email, displayName: input.displayName }, isNewUser: true }; },
      async listTenants() { return [mockTenant]; },
    },
    sessionService: {
      async create(input) { return { accessToken: `token-for-${input.userId}`, expiresAt: new Date(fixedNow.getTime() + 3600000) }; },
    },
    httpClient: {
      async post(url) {
        if (url.includes("token")) return { access_token: "google-access-token", id_token: "google-id-token", expires_in: 3600, token_type: "Bearer" };
        throw new Error("unexpected post");
      },
      async get(url) {
        if (url.includes("userinfo")) return { sub: "google-sub-abc123", email: "owner@render.com", email_verified: true, name: "Kwame Mensah" };
        throw new Error("unexpected get");
      },
    },
    auditLogger: { async record(entry) { auditEntries.push(entry); } },
  };
  return { ...base, ...overrides };
};

test("generateOAuthState produces unique non-empty base64url strings", () => {
  const s1 = generateOAuthState(); const s2 = generateOAuthState();
  assert.ok(s1.length > 20); assert.notEqual(s1, s2); assert.ok(/^[A-Za-z0-9_-]+$/.test(s1));
});

test("buildGoogleAuthorizationUrl includes required params", () => {
  const url = new URL(buildGoogleAuthorizationUrl(config, "test-state"));
  assert.equal(url.hostname, "accounts.google.com");
  assert.equal(url.searchParams.get("client_id"), config.clientId);
  assert.equal(url.searchParams.get("state"), "test-state");
  assert.ok(url.searchParams.get("scope")?.includes("email"));
});

test("initiateAuthorization saves state and returns authorization URL", async () => {
  const deps = createDeps();
  const { state, authorizationUrl } = await createGoogleOAuthHandler(deps).initiateAuthorization(correlationId);
  assert.ok(authorizationUrl.startsWith("https://accounts.google.com"));
  assert.ok(state.length > 20);
  assert.ok(deps.auditEntries.some((e) => e.action === "auth.oauth.initiated"));
});

test("handleCallback rejects invalid state", async () => {
  const deps = createDeps();
  await assert.rejects(
    () => createGoogleOAuthHandler(deps).handleCallback({ code: "code", state: "bad", correlationId }),
    (err) => err instanceof OAuthError && err.code === "OAUTH_STATE_INVALID"
  );
  assert.ok(deps.auditEntries.some((e) => e.action === "auth.oauth.state_invalid"));
});

test("handleCallback rejects replayed state", async () => {
  const deps = createDeps();
  const handler = createGoogleOAuthHandler(deps);
  const { state } = await handler.initiateAuthorization(correlationId);
  await handler.handleCallback({ code: "code-1", state, correlationId });
  await assert.rejects(
    () => handler.handleCallback({ code: "code-2", state, correlationId }),
    (err) => err instanceof OAuthError && err.code === "OAUTH_STATE_INVALID"
  );
});

test("handleCallback completes full OAuth flow for new user", async () => {
  const deps = createDeps();
  const handler = createGoogleOAuthHandler(deps);
  const { state } = await handler.initiateAuthorization(correlationId);
  const result = await handler.handleCallback({ code: "auth-code-123", state, correlationId });
  assert.equal(result.isNewUser, true);
  assert.equal(result.requiresWorkspaceSetup, false);
  assert.equal(result.user.externalUserId, "google-sub-abc123");
  assert.equal(result.tenants[0].slug, "render");
  assert.ok(result.session.accessToken.length > 0);
  assert.ok(deps.auditEntries.some((e) => e.action === "auth.oauth.user_registered" && e.outcome === "SUCCESS"));
});

test("handleCallback routes new user with no tenants to workspace setup", async () => {
  const deps = createDeps({ userRepository: { ...createDeps().userRepository, async listTenants() { return []; } } });
  const handler = createGoogleOAuthHandler(deps);
  const { state } = await handler.initiateAuthorization(correlationId);
  const result = await handler.handleCallback({ code: "code", state, correlationId });
  assert.equal(result.requiresWorkspaceSetup, true);
  assert.equal(result.tenants.length, 0);
});

test("handleCallback rejects unverified email", async () => {
  const deps = createDeps({ httpClient: { ...createDeps().httpClient, async get() { return { sub: "s", email: "x@x.com", email_verified: false }; } } });
  const handler = createGoogleOAuthHandler(deps);
  const { state } = await handler.initiateAuthorization(correlationId);
  await assert.rejects(() => handler.handleCallback({ code: "c", state, correlationId }),
    (err) => err instanceof OAuthError && err.code === "OAUTH_EMAIL_NOT_VERIFIED" && err.statusCode === 403);
});

test("handleCallback rejects inactive account", async () => {
  const deps = createDeps({ userRepository: { ...createDeps().userRepository, async upsertFromOAuth(i) { return { user: { ...mockUser, isActive: false, externalUserId: i.externalUserId }, isNewUser: false }; } } });
  const handler = createGoogleOAuthHandler(deps);
  const { state } = await handler.initiateAuthorization(correlationId);
  await assert.rejects(() => handler.handleCallback({ code: "c", state, correlationId }),
    (err) => err instanceof OAuthError && err.code === "OAUTH_ACCOUNT_INACTIVE" && err.statusCode === 403);
});

test("handleCallback surfaces OAuthError when token exchange fails", async () => {
  const deps = createDeps({ httpClient: { ...createDeps().httpClient, async post() { throw new Error("network error"); } } });
  const handler = createGoogleOAuthHandler(deps);
  const { state } = await handler.initiateAuthorization(correlationId);
  await assert.rejects(() => handler.handleCallback({ code: "bad", state, correlationId }),
    (err) => err instanceof OAuthError && err.code === "OAUTH_CODE_EXCHANGE_FAILED");
  assert.ok(deps.auditEntries.some((e) => e.action === "auth.oauth.token_exchange_failed"));
});

test("tokens and emails never appear in audit log", async () => {
  const deps = createDeps();
  const handler = createGoogleOAuthHandler(deps);
  const { state } = await handler.initiateAuthorization(correlationId);
  await handler.handleCallback({ code: "auth-code-123", state, correlationId });
  const j = JSON.stringify(deps.auditEntries);
  assert.ok(!j.includes("google-access-token"), "access token leaked");
  assert.ok(!j.includes("google-id-token"), "id token leaked");
  assert.ok(!j.includes("auth-code-123"), "auth code leaked");
  assert.ok(!j.includes("owner@render.com"), "email leaked");
  assert.ok(!j.includes("google-sub-abc123"), "sub leaked");
});

test("initiate route handler returns 302 to Google", async () => {
  const deps = createDeps();
  const result = await createOAuthInitiateRouteHandler(createGoogleOAuthHandler(deps))(correlationId);
  assert.equal(result.statusCode, 302);
  assert.ok(result.redirectTo?.includes("accounts.google.com"));
});

test("callback route returns 302 to /onboarding/workspace for new user without tenant", async () => {
  const deps = createDeps({ userRepository: { ...createDeps().userRepository, async listTenants() { return []; } } });
  const handler = createGoogleOAuthHandler(deps);
  const { state } = await handler.initiateAuthorization(correlationId);
  const result = await createOAuthCallbackRouteHandler(handler)({ code: "c", state, error: undefined, correlationId });
  assert.equal(result.statusCode, 302);
  assert.equal(result.redirectTo, "/onboarding/workspace");
});

test("callback route returns 302 to /dashboard for returning user", async () => {
  const deps = createDeps({ userRepository: { ...createDeps().userRepository, async upsertFromOAuth(i) { return { user: { ...mockUser, externalUserId: i.externalUserId }, isNewUser: false }; } } });
  const handler = createGoogleOAuthHandler(deps);
  const { state } = await handler.initiateAuthorization(correlationId);
  const result = await createOAuthCallbackRouteHandler(handler)({ code: "c", state, error: undefined, correlationId });
  assert.equal(result.statusCode, 302);
  assert.equal(result.redirectTo, "/dashboard");
});

test("callback route returns 400 when Google returns error param", async () => {
  const result = await createOAuthCallbackRouteHandler(createGoogleOAuthHandler(createDeps()))({ code: undefined, state: undefined, error: "access_denied", correlationId });
  assert.equal(result.statusCode, 400);
});

test("callback route returns 400 when code is missing", async () => {
  const result = await createOAuthCallbackRouteHandler(createGoogleOAuthHandler(createDeps()))({ code: undefined, state: "s", error: undefined, correlationId });
  assert.equal(result.statusCode, 400);
});
