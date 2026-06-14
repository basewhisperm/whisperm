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
