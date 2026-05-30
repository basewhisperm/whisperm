import assert from "node:assert/strict";
import test from "node:test";

import { ApiError, createApiServer } from "../dist/index.js";

const createSdkEventPayload = (overrides = {}) => ({
  tenantId: "tenant-1",
  event: {
    tenantId: "tenant-1",
    source: {
      provider: "META",
      providerEventId: "provider-event-1",
      eventType: "message.created"
    },
    payload: { messageId: "message-1" }
  },
  ...overrides
});

const createDependencies = (overrides = {}) => {
  const persisted = [];
  const queued = [];
  const idempotencyCalls = [];
  const dependencies = {
    persisted,
    queued,
    idempotencyCalls,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    createEventId: () => "event-1",
    apiKeyAuthenticator: {
      async authenticate(input) {
        if (input.apiKey !== "valid-api-key") {
          throw new ApiError({ code: "API_KEY_INVALID", message: "SDK API key is invalid" });
        }
        return { tenantId: input.tenantId, apiKeyId: "api-key-1" };
      }
    },
    hmacVerifier: {
      async verify(input) {
        return input.signature === "valid-signature";
      }
    },
    readiness: {
      async check() {}
    },
    idempotency: {
      async reserve(input) {
        idempotencyCalls.push(["reserve", input]);
        return "reserved";
      },
      async markSucceeded(input) {
        idempotencyCalls.push(["markSucceeded", input]);
      },
      async markFailed(input) {
        idempotencyCalls.push(["markFailed", input]);
      }
    },
    persistence: {
      async persistInboundEvent(event) {
        persisted.push(event);
      }
    },
    queue: {
      async enqueueInboundEvent(message) {
        queued.push(message);
      }
    },
    ...overrides
  };
  return dependencies;
};

const injectSdkEvent = (server, payload = createSdkEventPayload(), headers = {}) => server.inject({
  method: "POST",
  url: "/sdk-events/tenant-1",
  headers: {
    "x-api-key": "valid-api-key",
    "x-whisperm-signature": "valid-signature",
    "x-correlation-id": "corr-1",
    ...headers
  },
  payload
});

test("healthz success", async () => {
  const server = createApiServer(createDependencies());

  const response = await server.inject({ method: "GET", url: "/healthz", headers: { "x-correlation-id": "corr-health" } });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: true, data: { status: "ok" }, meta: { correlationId: "corr-health" } });
  assert.equal(response.headers["x-correlation-id"], "corr-health");
});

test("readyz success", async () => {
  let checked = false;
  const server = createApiServer(createDependencies({ readiness: { async check() { checked = true; } } }));

  const response = await server.inject({ method: "GET", url: "/readyz", headers: { "x-correlation-id": "corr-ready" } });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.status, "ready");
  assert.equal(checked, true);
});

test("successful SDK event ingestion persists, enqueues, and propagates correlation", async () => {
  const dependencies = createDependencies();
  const server = createApiServer(dependencies);

  const response = await injectSdkEvent(server);

  assert.equal(response.statusCode, 202);
  assert.deepEqual(response.json().data, { accepted: true, eventId: "event-1" });
  assert.equal(dependencies.persisted[0].tenantId, "tenant-1");
  assert.equal(dependencies.persisted[0].correlation.correlationId, "corr-1");
  assert.deepEqual(dependencies.queued[0], {
    tenantId: "tenant-1",
    eventId: "event-1",
    idempotencyKey: "tenant-1:META:provider-event-1",
    correlationId: "corr-1"
  });
});

test("tenant mismatch rejection fails before persistence and queue", async () => {
  const dependencies = createDependencies();
  const server = createApiServer(dependencies);

  const response = await injectSdkEvent(server, createSdkEventPayload({ tenantId: "tenant-2", event: { ...createSdkEventPayload().event, tenantId: "tenant-2" } }));

  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, "TENANT_CONTEXT_MISMATCH");
  assert.equal(dependencies.persisted.length, 0);
  assert.equal(dependencies.queued.length, 0);
});

test("missing API key rejection fails closed", async () => {
  const dependencies = createDependencies();
  const server = createApiServer(dependencies);

  const response = await server.inject({
    method: "POST",
    url: "/sdk-events/tenant-1",
    headers: { "x-whisperm-signature": "valid-signature", "x-correlation-id": "corr-1" },
    payload: createSdkEventPayload()
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, "API_KEY_MISSING");
  assert.equal(dependencies.idempotencyCalls.length, 0);
});

test("invalid HMAC rejection fails before idempotency reservation", async () => {
  const dependencies = createDependencies();
  const server = createApiServer(dependencies);

  const response = await injectSdkEvent(server, createSdkEventPayload(), { "x-whisperm-signature": "bad-signature" });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, "HMAC_SIGNATURE_INVALID");
  assert.equal(dependencies.idempotencyCalls.length, 0);
});

test("duplicate SDK event returns idempotent accepted=false response without queueing", async () => {
  const dependencies = createDependencies({
    idempotency: {
      async reserve(input) {
        dependencies.idempotencyCalls.push(["reserve", input]);
        return "duplicate";
      },
      async markSucceeded() {
        assert.fail("duplicate events must not be marked succeeded again");
      },
      async markFailed() {
        assert.fail("duplicate events must not be marked failed");
      }
    }
  });
  const server = createApiServer(dependencies);

  const response = await injectSdkEvent(server);

  assert.equal(response.statusCode, 202);
  assert.deepEqual(response.json().data, { accepted: false, duplicate: true, eventId: "event-1" });
  assert.equal(dependencies.persisted.length, 0);
  assert.equal(dependencies.queued.length, 0);
});

test("queue enqueue failure maps to deterministic retryable HTTP response and marks idempotency failed", async () => {
  const dependencies = createDependencies({
    queue: {
      async enqueueInboundEvent() {
        throw new Error("queue unavailable");
      }
    }
  });
  const server = createApiServer(dependencies);

  const response = await injectSdkEvent(server);

  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error.code, "EVENT_QUEUE_ENQUEUE_FAILED");
  assert.equal(dependencies.idempotencyCalls.at(-1)[0], "markFailed");
});
