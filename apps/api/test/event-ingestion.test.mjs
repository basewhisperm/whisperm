import assert from "node:assert/strict";
import test from "node:test";

import { createInboundWebhookIngestionHandler, EventIngestionError } from "../dist/index.js";

const createReply = () => {
  const state = { statusCode: undefined, payload: undefined, headers: {} };
  return {
    state,
    code(statusCode) {
      state.statusCode = statusCode;
      return this;
    },
    header(name, value) {
      state.headers[name] = value;
      return this;
    },
    send(payload) {
      state.payload = payload;
    }
  };
};

const createWebhookBody = (overrides = {}) => ({
  tenantId: "tenant-1",
  event: {
    tenantId: "tenant-1",
    source: {
      provider: "META",
      providerEventId: "meta-event-1",
      eventType: "message.created"
    },
    payload: { object: "page" }
  },
  ...overrides
});

test("webhook ingestion normalizes, persists, enqueues, and propagates correlation", async () => {
  const persisted = [];
  const queued = [];
  const idempotencyCalls = [];
  const handler = createInboundWebhookIngestionHandler({
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    createEventId: () => "evt-1",
    idempotency: {
      async reserve(input) {
        idempotencyCalls.push(["reserve", input]);
        return "reserved";
      },
      async markSucceeded(input) {
        idempotencyCalls.push(["markSucceeded", input]);
      },
      async markFailed() {
        assert.fail("markFailed must not be called for successful ingestion");
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
    }
  });
  const reply = createReply();

  await handler({
    headers: { "x-tenant-id": "tenant-1" },
    id: "req-1",
    correlationId: "corr-1",
    body: createWebhookBody(),
    log: { info() {} }
  }, reply);

  assert.equal(reply.state.statusCode, 202);
  assert.equal(reply.state.payload.data.accepted, true);
  assert.equal(persisted[0].tenantId, "tenant-1");
  assert.equal(persisted[0].correlation.correlationId, "corr-1");
  assert.equal(queued[0].tenantId, "tenant-1");
  assert.equal(queued[0].correlationId, "corr-1");
  assert.equal(idempotencyCalls[0][1].idempotencyKey, "tenant-1:META:meta-event-1");
});



test("webhook ingestion fails closed when idempotency reservation throws", async () => {
  const calls = [];
  const handler = createInboundWebhookIngestionHandler({
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    createEventId: () => "evt-1",
    idempotency: {
      async reserve(input) {
        calls.push(["reserve", input.idempotencyKey]);
        throw new Error("idempotency store unavailable");
      },
      async markSucceeded() {
        calls.push(["markSucceeded"]);
      },
      async markFailed() {
        calls.push(["markFailed"]);
      }
    },
    persistence: {
      async persistInboundEvent() {
        calls.push(["persistInboundEvent"]);
      }
    },
    queue: {
      async enqueueInboundEvent() {
        calls.push(["enqueueInboundEvent"]);
      }
    }
  });

  await assert.rejects(
    async () => handler({
      headers: { "x-tenant-id": "tenant-1" },
      id: "req-1",
      correlationId: "corr-1",
      body: createWebhookBody(),
      log: { info() {}, error() {} }
    }, createReply()),
    /idempotency store unavailable/u
  );

  assert.deepEqual(calls, [["reserve", "tenant-1:META:meta-event-1"]]);
});

test("webhook ingestion fails closed when tenant header does not match event", async () => {
  const handler = createInboundWebhookIngestionHandler({
    idempotency: {
      async reserve() {
        assert.fail("idempotency must not be called for invalid tenant context");
      },
      async markSucceeded() {},
      async markFailed() {}
    },
    persistence: {
      async persistInboundEvent() {
        assert.fail("persistence must not be called for invalid tenant context");
      }
    },
    queue: {
      async enqueueInboundEvent() {
        assert.fail("queue must not be called for invalid tenant context");
      }
    }
  });

  await assert.rejects(
    async () => handler({ headers: { "x-tenant-id": "tenant-2" }, body: createWebhookBody() }, createReply()),
    (error) => error instanceof EventIngestionError && error.code === "EVENT_TENANT_MISMATCH"
  );
});
