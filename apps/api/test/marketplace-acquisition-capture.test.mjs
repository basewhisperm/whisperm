import assert from "node:assert/strict";
import test from "node:test";

import { createApiServer } from "../dist/index.js";

const createCaptureStore = () => {
  const records = [];

  return {
    records,
    async createCapture(context, input) {
      const parsedUrl = new URL(input.sourceUrl.trim());
      parsedUrl.hostname = parsedUrl.hostname.toLowerCase();
      if (parsedUrl.pathname.length > 1 && parsedUrl.pathname.endsWith("/")) {
        parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/u, "");
      }
      const sourceListingUrl = parsedUrl.toString();

      const existing = records.find(
        (record) =>
          record.tenantId === context.tenantId &&
          record.sourceListingUrl === sourceListingUrl,
      );

      if (existing !== undefined) {
        return { capture: { ...existing, duplicate: true }, isNew: false, duplicate: true, normalizationWarnings: [] };
      }

      const capture = {
        id: `capture-${records.length + 1}`,
        tenantId: context.tenantId,
        sourceListingUrl,
        listingUrl: sourceListingUrl,
        title: input.title.trim().slice(0, 300),
        status: "CAPTURED",
        marketplaceSourceId: null,
        duplicate: false,
        normalizationWarnings: [],
        metadata: { parserVersion: "marketplace-capture-normalizer-v1" },
        createdAt: "2026-06-11T00:00:00.000Z",
      };

      records.push(capture);

      return {
        capture,
        isNew: true,
        duplicate: false,
        normalizationWarnings: [],
      };
    },
  };
};

const createDependencies = (captures) => ({
  createEventId: () => "event-1",

  apiKeyAuthenticator: {
    async authenticate() {
      return {
        tenantId: "tenant-a",
        apiKeyId: "api-key-1",
      };
    },
  },

  hmacVerifier: {
    async verify() {
      return true;
    },
  },

  persistence: {
    async persistInboundEvent() {},
  },

  queue: {
    async enqueueInboundEvent() {},
  },

  marketplaceCaptures: captures,
});

const validPayload = (overrides = {}) => ({
  sourceUrl: "https://market.example/listings/123",
  sourceHost: "market.example",
  title: "2019 Freightliner Cascadia",
  description: "Clean sleeper truck",
  priceText: "$45,000",
  imageUrls: ["https://market.example/images/1.jpg"],
  rawExtract: {
    seller: "Dealer A",
  },
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

const injectCapture = (
  server,
  payload = validPayload(),
  headers = authHeaders(),
) =>
  server.inject({
    method: "POST",
    url: "/marketplace-acquisition/captures",
    headers,
    payload,
  });

test(
  "POST /marketplace-acquisition/captures creates a tenant-scoped MarketplaceCapture",
  async () => {
    const captures = createCaptureStore();
    const server = createApiServer(createDependencies(captures));

    const response = await injectCapture(server);

    assert.equal(response.statusCode, 201);
    assert.equal(response.json().data.tenantId, "tenant-a");
    assert.equal(
      response.json().data.sourceListingUrl,
      "https://market.example/listings/123",
    );
    assert.equal(response.json().data.title, "2019 Freightliner Cascadia");
    assert.equal(response.json().data.status, "CAPTURED");
    assert.equal(captures.records.length, 1);
  },
);

test(
  "POST /marketplace-acquisition/captures requires tenant context",
  async () => {
    const server = createApiServer(
      createDependencies(createCaptureStore()),
    );

    const response = await injectCapture(
      server,
      validPayload(),
      authHeaders({
        "x-tenant-id": "",
      }),
    );

    assert.equal(response.statusCode, 403);
    assert.equal(
      response.json().error.code,
      "TENANT_CONTEXT_MISMATCH",
    );
  },
);

test(
  "POST /marketplace-acquisition/captures requires an authenticated actor",
  async () => {
    const captures = createCaptureStore();
    const server = createApiServer(createDependencies(captures));

    const response = await injectCapture(
      server,
      validPayload(),
      authHeaders({
        "x-user-id": "",
      }),
    );

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, "AUTH_INVALID_TOKEN");
    assert.equal(captures.records.length, 0);
  },
);

test(
  "POST /marketplace-acquisition/captures requires marketplace acquisition permission",
  async () => {
    const captures = createCaptureStore();
    const server = createApiServer(createDependencies(captures));

    const response = await injectCapture(
      server,
      validPayload(),
      authHeaders({
        "x-permissions": "crm.contacts.create",
      }),
    );

    assert.equal(response.statusCode, 403);
    assert.equal(
      response.json().error.code,
      "TENANT_CONTEXT_MISMATCH",
    );
    assert.equal(captures.records.length, 0);
  },
);

test(
  "POST /marketplace-acquisition/captures handles duplicate sourceUrl idempotently per tenant",
  async () => {
    const captures = createCaptureStore();
    const server = createApiServer(createDependencies(captures));

    const first = await injectCapture(server);
    const second = await injectCapture(server);

    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 200);
    assert.equal(
      second.json().data.id,
      first.json().data.id,
    );
    assert.equal(captures.records.length, 1);
  },
);

test(
  "POST /marketplace-acquisition/captures rejects invalid URL",
  async () => {
    const captures = createCaptureStore();
    const server = createApiServer(createDependencies(captures));

    const response = await injectCapture(
      server,
      validPayload({
        sourceUrl: "not-a-url",
      }),
    );

    assert.equal(response.statusCode, 400);
    assert.equal(
      response.json().error.code,
      "REQUEST_BODY_INVALID",
    );
    assert.equal(captures.records.length, 0);
  },
);

test(
  "POST /marketplace-acquisition/captures rejects oversized image arrays",
  async () => {
    const captures = createCaptureStore();
    const server = createApiServer(createDependencies(captures));

    const response = await injectCapture(
      server,
      validPayload({
        imageUrls: Array.from(
          { length: 11 },
          (_, index) =>
            `https://market.example/images/${index}.jpg`,
        ),
      }),
    );

    assert.equal(response.statusCode, 400);
    assert.equal(
      response.json().error.code,
      "REQUEST_BODY_INVALID",
    );
    assert.equal(captures.records.length, 0);
  },
);

test(
  "POST /marketplace-acquisition/captures rejects raw page HTML",
  async () => {
    const captures = createCaptureStore();
    const server = createApiServer(createDependencies(captures));

    const response = await injectCapture(
      server,
      validPayload({
        rawExtract: {
          html: "<html><body>listing</body></html>",
        },
      }),
    );

    assert.equal(response.statusCode, 400);
    assert.equal(
      response.json().error.code,
      "REQUEST_BODY_INVALID",
    );
    assert.equal(captures.records.length, 0);
  },
);

test(
  "POST /marketplace-acquisition/captures isolates duplicate checks by tenant",
  async () => {
    const captures = createCaptureStore();
    const server = createApiServer(createDependencies(captures));

    const tenantA = await injectCapture(server);

    const tenantB = await injectCapture(
      server,
      validPayload(),
      authHeaders({
        "x-tenant-id": "tenant-b",
        "x-user-id": "user-b",
      }),
    );

    assert.equal(tenantA.statusCode, 201);
    assert.equal(tenantB.statusCode, 201);

    assert.notEqual(
      tenantA.json().data.id,
      tenantB.json().data.id,
    );

    assert.deepEqual(
      captures.records.map((record) => record.tenantId),
      ["tenant-a", "tenant-b"],
    );
  },
);
test(
  "POST /marketplace-acquisition/captures exposes normalization metadata for duplicate response",
  async () => {
    const captures = createCaptureStore();
    const server = createApiServer(createDependencies(captures));

    await injectCapture(server);
    const response = await injectCapture(server);

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().meta.duplicate, true);
    assert.deepEqual(response.json().meta.normalizationWarnings, []);
    assert.equal(response.json().data.duplicate, true);
  },
);

test(
  "POST /marketplace-acquisition/captures normalizes listing URL deterministically",
  async () => {
    const captures = createCaptureStore();
    const server = createApiServer(createDependencies(captures));

    const response = await injectCapture(
      server,
      validPayload({
        sourceUrl: " https://Market.Example/listings/123/?ref=abc ",
      }),
    );

    assert.equal(response.statusCode, 201);
    assert.equal(
      response.json().data.sourceListingUrl,
      "https://market.example/listings/123?ref=abc",
    );
  },
);

test(
  "POST /marketplace-acquisition/captures stores parser version metadata in capture service result",
  async () => {
    const captures = createCaptureStore();
    const server = createApiServer(createDependencies(captures));

    const response = await injectCapture(server);

    assert.equal(response.statusCode, 201);
    assert.equal(
      captures.records[0].metadata.parserVersion,
      "marketplace-capture-normalizer-v1",
    );
  },
);
