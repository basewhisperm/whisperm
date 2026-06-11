import assert from "node:assert/strict";
import test from "node:test";

import { createApiServer } from "../dist/index.js";

const createDependencies = (overrides = {}) => ({
  createEventId: () => "event-1",
  apiKeyAuthenticator: { async authenticate() { return { tenantId: "tenant-1", apiKeyId: "api-key-1" }; } },
  hmacVerifier: { async verify() { return true; } },
  persistence: { async persistInboundEvent() {} },
  queue: { async enqueueInboundEvent() {} },
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
    headers: { "x-tenant-id": "tenant-1", "x-correlation-id": "corr-capture" },
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
    headers: { "x-tenant-id": "tenant-1", "x-correlation-id": "corr-capture" },
    payload: {
      tenantId: "tenant-2",
      listingUrl: "https://market.example/listings/123",
      title: "Vintage desk",
    },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(called, false);
});
