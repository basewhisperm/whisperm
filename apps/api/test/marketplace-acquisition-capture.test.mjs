import assert from "node:assert/strict";
import test from "node:test";

import { createApiServer } from "../dist/index.js";

const createDependencies = (overrides = {}) => {
  const role = overrides.role ?? "MEMBER";
  const userId = overrides.userId ?? "user-1";
  const tenantIds = overrides.tenantIds ?? ["tenant-1"];
  const isActive = overrides.isActive ?? true;
  const { role: _role, userId: _userId, tenantIds: _tenantIds, isActive: _isActive, ...dependencyOverrides } = overrides;
  return {
    createEventId: () => "event-1",
    apiKeyAuthenticator: { async authenticate() { return { tenantId: "tenant-1", apiKeyId: "api-key-1" }; } },
    hmacVerifier: { async verify() { return true; } },
    persistence: { async persistInboundEvent() {} },
    queue: { async enqueueInboundEvent() {} },
    async verifyAccessToken() {
      return {
        userId,
        externalSubject: `external-${userId}`,
        tenantIds,
        token: { subject: userId, expiresAt: new Date("2030-01-01T00:00:00.000Z"), tenantIds, raw: {} },
      };
    },
    tenantMembershipLoader: {
      async loadMembership({ tenantId }) {
        return { tenantId, userId, role, isActive, email: `${userId}@example.com` };
      },
    },
    ...dependencyOverrides,
  };
};

const authHeaders = (overrides = {}) => ({
  "authorization": "Bearer token",
  "x-tenant-id": "tenant-1",
  "x-correlation-id": "corr-capture",
  ...overrides,
});

test("POST /marketplace-acquisition/captures returns contact linkage", async () => {
  const calls = [];
  const marketplaceCaptures = {
    async create(context, input) {
      calls.push({ context, input });
      return {
        id: "capture-1",
        contactId: "contact-1",
        contactLinkage: "created",
        listingUrl: input.listingUrl,
        status: "CAPTURED",
      };
    },
  };
  const server = createApiServer(createDependencies({ marketplaceCaptures }));

  const response = await server.inject({
    method: "POST",
    url: "/marketplace-acquisition/captures",
    headers: authHeaders(),
    payload: {
      tenantId: "tenant-1",
      listingUrl: "https://market.example/listings/123",
      title: "Vintage desk",
      sellerDisplayName: "Alex Seller",
      sourceSellerUrl: "https://market.example/sellers/alex",
    },
  });

  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.json().data, { id: "capture-1", contactId: "contact-1", contactLinkage: "created", listingUrl: "https://market.example/listings/123", status: "CAPTURED" });
  assert.equal(calls[0].context.tenantId, "tenant-1");
  assert.equal(calls[0].context.correlation.correlationId, "corr-capture");
});

test("POST /marketplace-acquisition/captures rejects tenant mismatch before service call", async () => {
  let called = false;
  const server = createApiServer(createDependencies({ marketplaceCaptures: { async create() { called = true; } } }));

  const response = await server.inject({
    method: "POST",
    url: "/marketplace-acquisition/captures",
    headers: authHeaders(),
    payload: {
      tenantId: "tenant-2",
      listingUrl: "https://market.example/listings/123",
      title: "Vintage desk",
    },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(called, false);
});

test("POST /marketplace-acquisition/captures requires an authenticated member with capture permission", async () => {
  let called = false;
  const server = createApiServer(createDependencies({ marketplaceCaptures: { async create() { called = true; } } }));

  const response = await server.inject({
    method: "POST",
    url: "/marketplace-acquisition/captures",
    headers: { "x-tenant-id": "tenant-1", "x-correlation-id": "corr-capture" },
    payload: {
      tenantId: "tenant-1",
      listingUrl: "https://market.example/listings/123",
      title: "Vintage desk",
    },
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, "AUTH_MISSING_TOKEN");
  assert.equal(called, false);
});

test("POST /marketplace-acquisition/captures rejects callers without capture permission", async () => {
  let called = false;
  const server = createApiServer(createDependencies({ role: "VIEWER", marketplaceCaptures: { async create() { called = true; } } }));

  const response = await server.inject({
    method: "POST",
    url: "/marketplace-acquisition/captures",
    headers: authHeaders(),
    payload: {
      tenantId: "tenant-1",
      listingUrl: "https://market.example/listings/123",
      title: "Vintage desk",
    },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, "AUTH_FORBIDDEN");
  assert.equal(called, false);
});
