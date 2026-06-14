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
        return {
          capture: { ...existing, duplicate: true },
          isNew: false,
          duplicate: true,
          normalizationWarnings: [],
        };
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
  marketplaceAcquisition: {
    async capture(context, input) {
      const result = await captures.createCapture(context, {
        sourceUrl: input.sourceUrl ?? input.listingUrl,
        title: input.title ?? "",
        description: input.description,
        priceText: input.priceText,
        imageUrls: input.imageUrls,
        rawExtract: input.rawExtract,
      });

      return {
          ...result.capture,
          isNew: result.isNew,
          duplicate: result.duplicate,
          normalizationWarnings: result.normalizationWarnings,
        };
    },
  },
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

const injectCapture = (server, payload = validPayload(), headers = {}) =>
  server.inject({
    method: "POST",
    url: "/marketplace-acquisition/captures",
    headers: {
      "x-tenant-id": "tenant-a",
      "x-user-id": "user-a",
      "x-api-key": "test-api-key",
      "x-whisperm-signature": "test-signature",
      "x-correlation-id": "corr-marketplace",
      ...headers,
    },
    payload,
  });

test("POST /marketplace-acquisition/captures returns normalized capture response", async () => {
  const captures = createCaptureStore();
  const server = createApiServer(createDependencies(captures));

  const response = await injectCapture(server);

  assert.equal(response.statusCode, 201);
  assert.equal(response.json().data.status, "CAPTURED");
  assert.equal(response.json().data.duplicate, false);
  assert.equal(captures.records[0].tenantId, "tenant-a");
});

test("POST /marketplace-acquisition/captures exposes normalization metadata for duplicate response", async () => {
  const captures = createCaptureStore();
  const server = createApiServer(createDependencies(captures));

  await injectCapture(server);
  const response = await injectCapture(server);

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().meta.duplicate, true);
  assert.deepEqual(response.json().meta.normalizationWarnings, []);
  assert.equal(response.json().data.duplicate, true);
});

test("POST /marketplace-acquisition/captures normalizes listing URL deterministically", async () => {
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
});

test("POST /marketplace-acquisition/captures stores parser version metadata in capture service result", async () => {
  const captures = createCaptureStore();
  const server = createApiServer(createDependencies(captures));

  const response = await injectCapture(server);

  assert.equal(response.statusCode, 201);
  assert.equal(
    captures.records[0].metadata.parserVersion,
    "marketplace-capture-normalizer-v1",
  );
});
