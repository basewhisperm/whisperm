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


test("stripe webhook route verifies signature and reaches billing dependencies", async () => {
  const Stripe = (await import("stripe")).default;
  const stripeWebhookSecret = "whsec_test_secret";
  const calls = { reservations: [], subscriptions: [], outbox: [] };

  const server = createApiServer({
    ...createDependencies(),
    stripeWebhook: {
      stripeSecretKey: "sk_test_123",
      stripeWebhookSecret,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      billingEventIngestion: {
        async reserve(input) {
          calls.reservations.push(input);
          return "reserved";
        },
      },
      subscriptions: {
        async upsertSubscription(snapshot) {
          calls.subscriptions.push(snapshot);
        },
      },
      outbox: {
        async publishSubscriptionChanged(event) {
          calls.outbox.push(event);
        },
      },
    },
  });

  const payload = JSON.stringify({
    id: "evt_server_route",
    object: "event",
    api_version: "2026-05-27.dahlia",
    created: 1767225600,
    data: {
      object: {
        id: "sub_server_route",
        object: "subscription",
        customer: "cus_server_route",
        status: "active",
        metadata: { tenantId: "tenant-1" },
        cancel_at_period_end: false,
        current_period_start: 1767225600,
        current_period_end: 1769904000,
        trial_end: null,
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: "customer.subscription.created",
  });

  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: stripeWebhookSecret,
  });

  const response = await server.inject({
    method: "POST",
    url: "/webhooks/stripe",
    headers: { "stripe-signature": signature },
    payload,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(calls.reservations.length, 1);
  assert.equal(calls.subscriptions.length, 1);
  assert.equal(calls.outbox.length, 1);
});


const multipartCsvPayload = (csv, boundary = "whisperm-boundary") => ({
  boundary,
  payload: [
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="contacts.csv"',
    "Content-Type: text/csv",
    "",
    csv,
    `--${boundary}--`,
    ""
  ].join("\r\n")
});

test("contacts import route parses multipart CSV and preserves tenant context", async () => {
  const imports = [];
  const contacts = {
    async create() { throw new Error("not used"); },
    async update() { throw new Error("not used"); },
    async get() { throw new Error("not used"); },
    async list() { throw new Error("not used"); },
    async importCsvRows(context, input) {
      imports.push({ context, input });
      return { imported: input.rows.length, skipped: 0, errors: [] };
    }
  };
  const server = createApiServer(createDependencies({ contacts }));
  const multipart = multipartCsvPayload("email,stage,firstName\nPerson@Example.COM,PROSPECT,Person");

  const response = await server.inject({
    method: "POST",
    url: "/contacts/import",
    headers: {
      "content-type": `multipart/form-data; boundary=${multipart.boundary}`,
      "x-tenant-id": "tenant-1",
      "x-correlation-id": "corr-import"
    },
    payload: multipart.payload
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { imported: 1, skipped: 0, errors: [] });
  assert.equal(imports[0].context.tenantId, "tenant-1");
  assert.equal(imports[0].context.correlation.correlationId, "corr-import");
  assert.deepEqual(imports[0].input.rows, [{ email: "Person@Example.COM", firstName: "Person", lastName: undefined, phone: undefined, externalId: undefined, stage: "PROSPECT" }]);
});

test("contacts import route rejects fatal file errors before service call", async () => {
  let called = false;
  const contacts = {
    async create() { throw new Error("not used"); },
    async update() { throw new Error("not used"); },
    async get() { throw new Error("not used"); },
    async list() { throw new Error("not used"); },
    async importCsvRows() { called = true; return { imported: 0, skipped: 0, errors: [] }; }
  };
  const server = createApiServer(createDependencies({ contacts }));

  const response = await server.inject({
    method: "POST",
    url: "/contacts/import",
    headers: { "content-type": "application/json", "x-tenant-id": "tenant-1", "x-correlation-id": "corr-import" },
    payload: "{}"
  });

  assert.equal(response.statusCode, 415);
  assert.equal(response.json().error.code, "REQUEST_CONTENT_TYPE_INVALID");
  assert.equal(called, false);
});


test("kanban board route returns tenant scoped columns", async () => {
  const calls = [];
  const server = createApiServer({
    ...createDependencies(),
    deals: {
      async board(context, pipelineId, pagination) { calls.push(["board", context, pipelineId, pagination]); return { pipeline: { id: pipelineId, name: "Sales" }, columns: [{ id: "stage-a", name: "Prospect", position: 1, deals: { items: [{ id: "deal-1", title: "Deal", contactName: "Ada", dealValue: "100", currency: "USD", owner: null, probability: 50, stageId: "stage-a", updatedAt: "2026-05-29T00:00:00.000Z" }], limit: 25 } }] }; },
      async createCard() { assert.fail("unexpected create"); },
      async moveStage() { assert.fail("unexpected move"); },
      async detail() { assert.fail("unexpected detail"); }
    }
  });

  const response = await server.inject({ method: "GET", url: "/pipelines/pipeline-a/board?limit=25&cursor[stage-a]=deal-25", headers: { "x-tenant-id": "tenant-a", "x-correlation-id": "corr-board" } });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.columns[0].deals.items[0].contactName, "Ada");
  assert.deepEqual(calls[0][1].tenantId, "tenant-a");
  assert.deepEqual(calls[0][3], { limit: 25, cursors: { "stage-a": "deal-25" } });
});

test("deal stage move route maps updatedAt optimistic lock", async () => {
  const calls = [];
  const server = createApiServer({
    ...createDependencies(),
    deals: {
      async board() { assert.fail("unexpected board"); },
      async createCard() { assert.fail("unexpected create"); },
      async moveStage(context, dealId, input) { calls.push([context, dealId, input]); return { id: dealId, tenantId: context.tenantId, pipelineStageId: input.stageId, title: "Deal", currency: "USD", updatedAt: "2026-05-29T00:01:00.000Z" }; },
      async detail() { assert.fail("unexpected detail"); }
    }
  });

  const response = await server.inject({ method: "PATCH", url: "/deals/deal-1/stage", headers: { "x-tenant-id": "tenant-a", "x-correlation-id": "corr-move" }, payload: { stageId: "stage-new", updatedAt: "2026-05-29T00:00:00.000Z" } });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls[0][2], { stageId: "stage-new", expectedUpdatedAt: "2026-05-29T00:00:00.000Z" });
});

test("quick add route creates deal card", async () => {
  const calls = [];
  const server = createApiServer({
    ...createDependencies(),
    deals: {
      async board() { assert.fail("unexpected board"); },
      async createCard(context, input) { calls.push([context, input]); return { id: "deal-1", title: input.title, contactName: null, dealValue: input.value, currency: input.currency, owner: null, probability: input.probability, stageId: input.pipelineStageId, updatedAt: "2026-05-29T00:00:00.000Z" }; },
      async moveStage() { assert.fail("unexpected move"); },
      async detail() { assert.fail("unexpected detail"); }
    }
  });

  const response = await server.inject({ method: "POST", url: "/deals", headers: { "x-tenant-id": "tenant-a", "x-correlation-id": "corr-create" }, payload: { stageId: "stage-a", contactId: "contact-1", title: "New Deal", dealValue: 100, currency: "USD", probability: 50 } });

  assert.equal(response.statusCode, 201);
  assert.equal(response.json().data.stageId, "stage-a");
  assert.deepEqual(calls[0][1].tenantId, "tenant-a");
});

test("deal detail route returns deal contact and activity", async () => {
  const server = createApiServer({
    ...createDependencies(),
    deals: {
      async board() { assert.fail("unexpected board"); },
      async createCard() { assert.fail("unexpected create"); },
      async moveStage() { assert.fail("unexpected move"); },
      async detail(context, dealId) { return { deal: { id: dealId, tenantId: context.tenantId, title: "Deal", stageId: "stage-a", currency: "USD", updatedAt: "2026-05-29T00:00:00.000Z" }, contact: { id: "contact-1", email: "lead@example.com" }, activity: [] }; }
    }
  });

  const response = await server.inject({ method: "GET", url: "/deals/deal-1", headers: { "x-tenant-id": "tenant-a", "x-correlation-id": "corr-detail" } });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.contact.email, "lead@example.com");
  assert.deepEqual(response.json().data.activity, []);
});

const activityHeaders = { "x-tenant-id": "tenant-a", "x-user-id": "jwt-user", "x-correlation-id": "corr-activity" };

const createActivityApiDependencies = () => {
  const calls = [];
  const activities = [
    { id: "activity-a", tenantId: "tenant-a", contactId: "contact-1", dealId: "deal-1", type: "NOTE", note: "Tenant A", createdById: "jwt-user", occurredAt: "2026-01-02T00:00:00.000Z", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" },
    { id: "activity-b", tenantId: "tenant-b", contactId: "contact-1", dealId: "deal-1", type: "NOTE", note: "Tenant B", createdById: "other-user", occurredAt: "2026-01-02T00:00:00.000Z", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" },
    { id: "activity-c", tenantId: "tenant-a", contactId: "contact-2", dealId: "deal-2", type: "CALL", note: "Other", createdById: "jwt-user", occurredAt: "2026-01-03T00:00:00.000Z", createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z" }
  ];
  return createDependencies({
    calls,
    activities: {
      async create(context, input) {
        calls.push({ method: "create", context, input });
        const created = { id: "activity-created", tenantId: context.tenantId, contactId: input.contactId ?? null, dealId: input.dealId ?? null, type: input.type, note: input.note, createdById: context.actorId, occurredAt: "2026-01-04T00:00:00.000Z", createdAt: "2026-01-04T00:00:00.000Z", updatedAt: "2026-01-04T00:00:00.000Z" };
        activities.push(created);
        return created;
      },
      async list(context, filters = {}, page = {}) {
        calls.push({ method: "list", context, filters, page });
        return { items: activities.filter((activity) => activity.tenantId === context.tenantId)
          .filter((activity) => filters.contactId === undefined || activity.contactId === filters.contactId)
          .filter((activity) => filters.dealId === undefined || activity.dealId === filters.dealId)
          .filter((activity) => filters.type === undefined || activity.type === filters.type)
          .filter((activity) => filters.createdById === undefined || activity.createdById === filters.createdById) };
      }
    }
  });
};

test("POST /activities sources tenant and createdBy from request context", async () => {
  const dependencies = createActivityApiDependencies();
  const server = createApiServer(dependencies);

  const response = await server.inject({ method: "POST", url: "/activities", headers: activityHeaders, payload: { contactId: "contact-1", dealId: "deal-1", type: "NOTE", note: "Follow up", createdBy: "spoofed-user" } });

  assert.equal(response.statusCode, 400);
  assert.equal(dependencies.calls.length, 0);

  const success = await server.inject({ method: "POST", url: "/activities", headers: activityHeaders, payload: { contactId: "contact-1", dealId: "deal-1", type: "NOTE", note: "Follow up" } });
  assert.equal(success.statusCode, 201);
  assert.equal(success.json().data.createdById, "jwt-user");
  assert.equal(dependencies.calls[0].input.tenantId, "tenant-a");
  assert.equal(dependencies.calls[0].context.actorId, "jwt-user");
});

test("POST /activities fails when contactId and dealId are missing", async () => {
  const dependencies = createActivityApiDependencies();
  const server = createApiServer(dependencies);

  const response = await server.inject({ method: "POST", url: "/activities", headers: activityHeaders, payload: { type: "NOTE", note: "Missing links" } });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "REQUEST_BODY_INVALID");
  assert.equal(dependencies.calls.length, 0);
});

test("GET /activities returns only activities for auth tenant", async () => {
  const dependencies = createActivityApiDependencies();
  const server = createApiServer(dependencies);

  const response = await server.inject({ method: "GET", url: "/activities", headers: activityHeaders });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().data.items.map((activity) => activity.tenantId), ["tenant-a", "tenant-a"]);
});

test("GET /contacts/:id/activities filters to that contact", async () => {
  const dependencies = createActivityApiDependencies();
  const server = createApiServer(dependencies);

  const response = await server.inject({ method: "GET", url: "/contacts/contact-1/activities", headers: activityHeaders });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().data.items.map((activity) => activity.id), ["activity-a"]);
  assert.equal(dependencies.calls[0].filters.contactId, "contact-1");
});

test("GET /deals/:id/activities filters to that deal", async () => {
  const dependencies = createActivityApiDependencies();
  const server = createApiServer(dependencies);

  const response = await server.inject({ method: "GET", url: "/deals/deal-2/activities", headers: activityHeaders });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().data.items.map((activity) => activity.id), ["activity-c"]);
  assert.equal(dependencies.calls[0].filters.dealId, "deal-2");
});

const contactBody = (tenantId = "tenant-1", index = 1) => ({
  tenantId,
  email: `person-${tenantId}-${index}@example.com`,
});

const createContactService = (contactsByTenant = new Map()) => ({
  async create(context, input) {
    const existing = contactsByTenant.get(context.tenantId) ?? [];
    const created = {
      id: `contact-${context.tenantId}-${existing.length + 1}`,
      tenantId: context.tenantId,
      email: input.email,
      stage: input.stage ?? "PROSPECT",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    contactsByTenant.set(context.tenantId, [...existing, created]);
    return created;
  },
  async update() { throw new Error("not used"); },
  async get() { throw new Error("not used"); },
  async list() { throw new Error("not used"); },
});

const createContactQuota = (contactsByTenant, planByTenant = new Map()) => ({
  async countContacts(context) {
    return (contactsByTenant.get(context.tenantId) ?? []).length;
  },
  async findCurrentPlan(context) {
    return planByTenant.get(context.tenantId) ?? "STARTER";
  },
});

const injectContactCreate = (server, tenantId, index) => server.inject({
  method: "POST",
  url: "/contacts",
  headers: { "x-tenant-id": tenantId, "x-correlation-id": `corr-${tenantId}-${index}` },
  payload: contactBody(tenantId, index),
});

test("starter workspace can create contacts up to the plan limit", async () => {
  const contactsByTenant = new Map();
  const server = createApiServer(createDependencies({
    contacts: createContactService(contactsByTenant),
    contactQuota: createContactQuota(contactsByTenant),
  }));

  for (let index = 1; index <= 50; index += 1) {
    const response = await injectContactCreate(server, "tenant-1", index);
    assert.equal(response.statusCode, 201);
  }

  assert.equal(contactsByTenant.get("tenant-1").length, 50);
});

test("starter workspace creating the 51st contact returns 402", async () => {
  const contactsByTenant = new Map([["tenant-1", Array.from({ length: 50 }, (_, index) => ({ id: `existing-${index}` }))]]);
  const server = createApiServer(createDependencies({
    contacts: createContactService(contactsByTenant),
    contactQuota: createContactQuota(contactsByTenant),
  }));

  const response = await injectContactCreate(server, "tenant-1", 51);

  assert.equal(response.statusCode, 402);
  assert.equal(response.json().error.code, "QUOTA_EXCEEDED");
  assert.equal(contactsByTenant.get("tenant-1").length, 50);
});

test("contact quota count is workspace scoped", async () => {
  const contactsByTenant = new Map([
    ["tenant-1", Array.from({ length: 50 }, (_, index) => ({ id: `tenant-1-${index}` }))],
    ["tenant-2", Array.from({ length: 49 }, (_, index) => ({ id: `tenant-2-${index}` }))],
  ]);
  const server = createApiServer(createDependencies({
    contacts: createContactService(contactsByTenant),
    contactQuota: createContactQuota(contactsByTenant),
  }));

  const response = await injectContactCreate(server, "tenant-2", 50);

  assert.equal(response.statusCode, 201);
  assert.equal(contactsByTenant.get("tenant-2").length, 50);
});

test("growth and pro workspaces are not blocked by starter contact limit", async () => {
  for (const plan of ["GROWTH", "PRO"]) {
    const contactsByTenant = new Map([[`tenant-${plan}`, Array.from({ length: 50 }, (_, index) => ({ id: `${plan}-${index}` }))]]);
    const server = createApiServer(createDependencies({
      contacts: createContactService(contactsByTenant),
      contactQuota: createContactQuota(contactsByTenant, new Map([[`tenant-${plan}`, plan]])),
    }));

    const response = await injectContactCreate(server, `tenant-${plan}`, 51);

    assert.equal(response.statusCode, 201);
    assert.equal(contactsByTenant.get(`tenant-${plan}`).length, 51);
  }
});

test("contact list route defaults pagination to limit 25 and rejects over max", async () => {
  const calls = [];
  const server = createApiServer(createDependencies({
    contacts: {
      async create() { assert.fail("unexpected create"); },
      async update() { assert.fail("unexpected update"); },
      async get() { assert.fail("unexpected get"); },
      async list(context, page) {
        calls.push({ context, page });
        const limit = page?.limit ?? 25;
        if (limit > 100) {
          throw new ApiError({ code: "REQUEST_BODY_INVALID", message: "limit must be less than or equal to 100", statusCode: 400 });
        }
        return { items: Array.from({ length: limit }, (_, index) => ({ id: `contact-${index}`, tenantId: context.tenantId, email: `contact-${index}@example.test`, createdAt: "2026-01-01T00:00:00.000Z" })) };
      },
      async importCsvRows() { assert.fail("unexpected import"); }
    }
  }));

  const defaultResponse = await server.inject({ method: "GET", url: "/contacts", headers: { "x-tenant-id": "tenant-a", "x-correlation-id": "corr-contacts" } });
  assert.equal(defaultResponse.statusCode, 200);
  assert.equal(defaultResponse.json().data.items.length, 25);
  assert.deepEqual(calls[0].context.tenantId, "tenant-a");
  assert.equal(calls[0].page, undefined);

  const maxResponse = await server.inject({ method: "GET", url: "/contacts?limit=100", headers: { "x-tenant-id": "tenant-a", "x-correlation-id": "corr-contacts" } });
  assert.equal(maxResponse.statusCode, 200);
  assert.equal(maxResponse.json().data.items.length, 100);
  assert.deepEqual(calls[1].page, { limit: 100 });

  const overResponse = await server.inject({ method: "GET", url: "/contacts?limit=101", headers: { "x-tenant-id": "tenant-a", "x-correlation-id": "corr-contacts" } });
  assert.equal(overResponse.statusCode, 400);
  assert.equal(overResponse.json().error.code, "REQUEST_BODY_INVALID");
});

test("activity list route accepts limit 100 and rejects limit above 100", async () => {
  const calls = [];
  const server = createApiServer(createDependencies({
    activities: {
      async create() { assert.fail("unexpected create"); },
      async list(context, filters, page) { calls.push({ context, filters, page }); return { items: [] }; }
    }
  }));

  const maxResponse = await server.inject({ method: "GET", url: "/activities?limit=100", headers: { "x-tenant-id": "tenant-a", "x-user-id": "user-a", "x-correlation-id": "corr-activities" } });
  assert.equal(maxResponse.statusCode, 200);
  assert.deepEqual(calls[0].page, { limit: 100 });
  assert.equal(calls[0].context.tenantId, "tenant-a");

  const overResponse = await server.inject({ method: "GET", url: "/activities?limit=101", headers: { "x-tenant-id": "tenant-a", "x-user-id": "user-a", "x-correlation-id": "corr-activities" } });
  assert.equal(overResponse.statusCode, 400);
  assert.equal(overResponse.json().error.code, "REQUEST_BODY_INVALID");
});

test("API telemetry creates safe route spans without sensitive body data", async () => {
  const spans = [];
  const telemetry = {
    startSpan(name, attributes) {
      const span = { name, attributes: { ...attributes }, ended: undefined, setAttribute(key, value) { this.attributes[key] = value; }, end(status) { this.ended = status; } };
      spans.push(span);
      return span;
    }
  };
  const server = createApiServer(createDependencies({
    telemetry,
    dashboard: { async get(context) { return { metrics: { activeClients: 0, pipelineValue: 0, wonsThisMonth: 0, avgResponseTimeDays: null }, healthPanel: [], activityFeed: [], followUpAlerts: [], tenantId: context.tenantId }; } }
  }));

  const response = await server.inject({
    method: "GET",
    url: "/dashboard",
    headers: { "x-tenant-id": "tenant-a", "x-user-id": "user-a", authorization: "Bearer secret", "x-correlation-id": "corr-dashboard" },
    payload: { email: "private@example.test", note: "secret note" }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].name, "api.request");
  assert.equal(spans[0].attributes["http.method"], "GET");
  assert.equal(spans[0].attributes["http.route"], "/dashboard");
  assert.equal(spans[0].attributes["http.status_code"], 200);
  assert.equal(spans[0].attributes["workspace.present"], true);
  assert.equal(spans[0].ended, "OK");
  const serializedAttributes = JSON.stringify(spans[0].attributes);
  assert.equal(serializedAttributes.includes("private@example.test"), false);
  assert.equal(serializedAttributes.includes("secret note"), false);
  assert.equal(serializedAttributes.includes("Bearer secret"), false);
});

test("dashboard route handles 200 contacts under local p95 target and remains workspace scoped", async () => {
  const durations = [];
  const calls = [];
  const dashboard = {
    async get(context) {
      calls.push(context);
      const contacts = Array.from({ length: 200 }, (_, index) => ({ contactId: `contact-${index}`, name: `Contact ${index}`, lastTouchAt: "2026-01-01T00:00:00.000Z", daysSinceLastTouch: 1, status: "HEALTHY", fillPct: 100 }));
      return { metrics: { activeClients: 200, pipelineValue: 5000, wonsThisMonth: 1000, avgResponseTimeDays: null }, healthPanel: contacts, activityFeed: [], followUpAlerts: [] };
    }
  };
  const server = createApiServer(createDependencies({ dashboard }));

  for (let index = 0; index < 20; index += 1) {
    const started = performance.now();
    const response = await server.inject({ method: "GET", url: "/dashboard", headers: { "x-tenant-id": "tenant-perf", "x-user-id": "user-a", "x-correlation-id": `corr-dashboard-${index}` } });
    durations.push(performance.now() - started);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.healthPanel.length, 200);
  }
  const p95 = durations.toSorted((left, right) => left - right)[Math.ceil(durations.length * 0.95) - 1];
  assert.ok(p95 < 300, `expected dashboard p95 < 300ms, got ${p95}ms`);
  assert.ok(calls.every((context) => context.tenantId === "tenant-perf"));
});

test("pipeline board route handles 50 deals under local target and remains workspace scoped", async () => {
  const calls = [];
  const deals = {
    async board(context, pipelineId, pagination) {
      calls.push({ context, pipelineId, pagination });
      return { pipeline: { id: pipelineId, name: "Sales" }, columns: [{ id: "stage-a", name: "Prospect", position: 1, deals: { items: Array.from({ length: 50 }, (_, index) => ({ id: `deal-${index}`, title: `Deal ${index}`, dealValue: "100", currency: "USD", owner: null, probability: 50, stageId: "stage-a", updatedAt: "2026-05-29T00:00:00.000Z" })), limit: 50 } }] };
    },
    async createCard() { assert.fail("unexpected create"); },
    async moveStage() { assert.fail("unexpected move"); },
    async detail() { assert.fail("unexpected detail"); }
  };
  const server = createApiServer(createDependencies({ deals }));

  const started = performance.now();
  const response = await server.inject({ method: "GET", url: "/pipelines/pipeline-a/board?limit=50", headers: { "x-tenant-id": "tenant-board", "x-correlation-id": "corr-board-perf" } });
  const duration = performance.now() - started;
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.columns[0].deals.items.length, 50);
  assert.ok(duration < 500, `expected board response < 500ms, got ${duration}ms`);
  assert.equal(calls[0].context.tenantId, "tenant-board");
});

test("pipeline board route rejects limit above 100 before service call", async () => {
  let called = false;
  const server = createApiServer(createDependencies({
    deals: {
      async board() { called = true; return { pipeline: { id: "pipeline-a", name: "Sales" }, columns: [] }; },
      async createCard() { assert.fail("unexpected create"); },
      async moveStage() { assert.fail("unexpected move"); },
      async detail() { assert.fail("unexpected detail"); }
    }
  }));

  const response = await server.inject({ method: "GET", url: "/pipelines/pipeline-a/board?limit=101", headers: { "x-tenant-id": "tenant-a", "x-correlation-id": "corr-board-limit" } });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "REQUEST_BODY_INVALID");
  assert.equal(called, false);
});
