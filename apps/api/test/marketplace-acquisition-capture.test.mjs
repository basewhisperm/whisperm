import assert from "node:assert/strict";
import test from "node:test";

import { createApiServer } from "../dist/index.js";

const createServer = (marketplaceAcquisition, overrides = {}) => createApiServer({
  marketplaceAcquisition,
  apiKeyAuthenticator: { async authenticate(input) { return { tenantId: input.tenantId }; } },
  hmacVerifier: { async verify() { return true; } },
  eventStore: { async reserve() { return { accepted: true }; }, async markProcessed() {}, async markFailed() {} },
  queue: { async enqueue() {} },
  ...overrides,
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

test("POST /marketplace-acquisition/captures requires an active subscription when trial gate is configured", async () => {
  let captureCalls = 0;
  const subscriptionLookups = [];
  const server = createServer({
    async capture() {
      captureCalls += 1;
      throw new Error("should not be called");
    }
  }, {
    now: () => new Date("2026-01-15T00:00:00.000Z"),
    subscriptionReader: {
      async findActiveOrTrialingSubscription(input) {
        subscriptionLookups.push(input);
        return null;
      }
    }
  });

  const response = await server.inject({
    method: "POST",
    url: "/marketplace-acquisition/captures",
    headers: { "x-tenant-id": "tenant-a", "x-user-id": "user-a", "x-correlation-id": "corr-marketplace" },
    payload: { listingUrl: "https://market.example/listings/123", title: "Listing" }
  });

  assert.equal(response.statusCode, 402);
  assert.equal(response.json().error.code, "TRIAL_EXPIRED");
  assert.equal(captureCalls, 0);
  assert.equal(subscriptionLookups.length, 1);
  assert.equal(subscriptionLookups[0].tenantId, "tenant-a");
});

test("POST /marketplace-acquisition/captures allows active subscribers through the trial gate", async () => {
  let captureCalls = 0;
  const server = createServer({
    async capture() {
      captureCalls += 1;
      return { captureId: "capture-1", contactId: "contact-1", dealId: "deal-1", contactMatchStrategy: "created", dealCreated: true, dealMatched: false, status: "CAPTURED" };
    }
  }, {
    now: () => new Date("2026-01-15T00:00:00.000Z"),
    subscriptionReader: {
      async findActiveOrTrialingSubscription() {
        return { status: "ACTIVE" };
      }
    }
  });

  const response = await server.inject({
    method: "POST",
    url: "/marketplace-acquisition/captures",
    headers: { "x-tenant-id": "tenant-a", "x-user-id": "user-a", "x-correlation-id": "corr-marketplace" },
    payload: { listingUrl: "https://market.example/listings/123", title: "Listing" }
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.json().data.status, "CAPTURED");
  assert.equal(captureCalls, 1);
});
