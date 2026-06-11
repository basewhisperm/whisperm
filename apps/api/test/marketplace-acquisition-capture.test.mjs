import assert from "node:assert/strict";
import test from "node:test";

import { createApiServer } from "../dist/index.js";

const createServer = (marketplaceAcquisition) => createApiServer({
  marketplaceAcquisition,
  apiKeyAuthenticator: { async authenticate(input) { return { tenantId: input.tenantId }; } },
  hmacVerifier: { async verify() { return true; } },
  eventStore: { async reserve() { return { accepted: true }; }, async markProcessed() {}, async markFailed() {} },
  queue: { async enqueue() {} },
});

test("POST /marketplace-acquisition/captures returns capture, contact, deal, strategy, match state, and status", async () => {
  const calls = [];
  const server = createServer({
    async capture(context, input) {
      calls.push({ context, input });
      return { captureId: "capture-1", contactId: "contact-1", dealId: "deal-1", contactMatchStrategy: "created", dealCreated: true, dealMatched: false, status: "CAPTURED" };
    }
  });

  const response = await server.inject({
    method: "POST",
    url: "/marketplace-acquisition/captures",
    headers: { "x-tenant-id": "tenant-a", "x-user-id": "user-a", "x-correlation-id": "corr-marketplace" },
    payload: { listingUrl: "https://market.example/listings/123", title: "Listing" }
  });

  assert.equal(response.statusCode, 201);
  const body = response.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.data, { captureId: "capture-1", contactId: "contact-1", dealId: "deal-1", contactMatchStrategy: "created", dealCreated: true, dealMatched: false, status: "CAPTURED" });
  assert.equal(calls[0].context.tenantId, "tenant-a");
  assert.equal(calls[0].context.actorId, "user-a");
  assert.equal(calls[0].input.tenantId, "tenant-a");
});

test("POST /marketplace-acquisition/captures requires an authenticated actor", async () => {
  const server = createServer({ async capture() { throw new Error("should not be called"); } });

  const response = await server.inject({
    method: "POST",
    url: "/marketplace-acquisition/captures",
    headers: { "x-tenant-id": "tenant-a" },
    payload: { listingUrl: "https://market.example/listings/123", title: "Listing" }
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, "TENANT_CONTEXT_MISMATCH");
});
