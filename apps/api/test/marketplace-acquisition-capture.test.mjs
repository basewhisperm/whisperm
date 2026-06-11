import assert from "node:assert/strict";
import test from "node:test";

import { ApiError, createApiServer } from "../dist/index.js";

const baseDependencies = (captures) => ({
  createEventId: () => "event-1",
  apiKeyAuthenticator: { async authenticate(input) { if (input.apiKey !== "valid-api-key") throw new ApiError({ code: "API_KEY_INVALID", message: "bad key" }); return { tenantId: input.tenantId }; } },
  hmacVerifier: { async verify() { return true; } },
  idempotency: { async reserve() { return "reserved"; }, async markSucceeded() {}, async markFailed() {} },
  persistence: { async persistInboundEvent() {} },
  queue: { async enqueueInboundEvent() {} },
  marketplaceCaptures: captures,
});

const createCaptureStore = () => {
  const records = [];
  const service = {
    records,
    async createCapture(context, input) {
      const sourceListingUrl = new URL(input.sourceUrl).toString();
      const existing = records.find((record) => record.tenantId === context.tenantId && record.sourceListingUrl === sourceListingUrl);
      if (existing !== undefined) return { capture: existing, isNew: false };
      const capture = {
        id: `capture-${records.length + 1}`,
        tenantId: context.tenantId,
        sourceListingUrl,
        title: input.title,
        status: "CAPTURED",
        createdAt: "2026-06-11T00:00:00.000Z",
      };
      records.push(capture);
      return { capture, isNew: true };
    },
  };
  return service;
};

const validPayload = (overrides = {}) => ({
  sourceUrl: "https://market.example/listings/123",
  sourceHost: "market.example",
  title: "2019 Freightliner Cascadia",
  description: "Clean sleeper truck",
  priceText: "$45,000",
  imageUrls: ["https://market.example/images/1.jpg"],
  rawExtract: { seller: "Dealer A" },
  ...overrides,
});

const authHeaders = (overrides = {}) => ({
  "content-type": "application/json",
  "x-tenant-id": "tenant-a",
  "x-user-id": "user-a",
  "x-permissions": "marketplace_acquisition.capture",
  "x-correlation-id": "corr-capture",
  ...overrides,
});

const injectCapture = (server, payload = validPayload(), headers = authHeaders()) => server.inject({
  method: "POST",
  url: "/marketplace-acquisition/captures",
  headers,
  payload,
});

test("POST /marketplace-acquisition/captures creates a tenant-scoped MarketplaceCapture", async () => {
  const captures = createCaptureStore();
  const server = createApiServer(baseDependencies(captures));

  const response = await injectCapture(server);

  assert.equal(response.statusCode, 201);
  assert.equal(response.json().data.tenantId, "tenant-a");
  assert.equal(response.json().data.sourceListingUrl, "https://market.example/listings/123");
  assert.equal(captures.records.length, 1);
});

test("POST /marketplace-acquisition/captures requires tenant context", async () => {
  const server = createApiServer(baseDependencies(createCaptureStore()));

  const response = await injectCapture(server, validPayload(), authHeaders({ "x-tenant-id": "" }));

  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, "TENANT_CONTEXT_MISMATCH");
});

test("POST /marketplace-acquisition/captures requires marketplace acquisition permission", async () => {
  const server = createApiServer(baseDependencies(createCaptureStore()));

  const response = await injectCapture(server, validPayload(), authHeaders({ "x-permissions": "crm.contacts.create" }));

  assert.equal(response.statusCode, 403);
});

test("POST /marketplace-acquisition/captures handles duplicate sourceUrl idempotently per tenant", async () => {
  const captures = createCaptureStore();
  const server = createApiServer(baseDependencies(captures));

  const first = await injectCapture(server);
  const second = await injectCapture(server);

  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 200);
  assert.equal(second.json().data.id, first.json().data.id);
  assert.equal(captures.records.length, 1);
});

test("POST /marketplace-acquisition/captures rejects invalid URL", async () => {
  const captures = createCaptureStore();
  const server = createApiServer(baseDependencies(captures));

  const response = await injectCapture(server, validPayload({ sourceUrl: "not-a-url" }));

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "REQUEST_BODY_INVALID");
  assert.equal(captures.records.length, 0);
});

test("POST /marketplace-acquisition/captures rejects oversized image arrays", async () => {
  const captures = createCaptureStore();
  const server = createApiServer(baseDependencies(captures));

  const response = await injectCapture(server, validPayload({ imageUrls: Array.from({ length: 11 }, (_, index) => `https://market.example/images/${index}.jpg`) }));

  assert.equal(response.statusCode, 400);
  assert.equal(captures.records.length, 0);
});

test("POST /marketplace-acquisition/captures rejects raw page HTML", async () => {
  const captures = createCaptureStore();
  const server = createApiServer(baseDependencies(captures));

  const response = await injectCapture(server, validPayload({ rawExtract: { html: "<html><body>listing</body></html>" } }));

  assert.equal(response.statusCode, 400);
  assert.equal(captures.records.length, 0);
});

test("POST /marketplace-acquisition/captures isolates duplicate checks by tenant", async () => {
  const captures = createCaptureStore();
  const server = createApiServer(baseDependencies(captures));

  const tenantA = await injectCapture(server);
  const tenantB = await injectCapture(server, validPayload(), authHeaders({ "x-tenant-id": "tenant-b", "x-user-id": "user-b" }));

  assert.equal(tenantA.statusCode, 201);
  assert.equal(tenantB.statusCode, 201);
  assert.notEqual(tenantA.json().data.id, tenantB.json().data.id);
  assert.deepEqual(captures.records.map((record) => record.tenantId), ["tenant-a", "tenant-b"]);
});
