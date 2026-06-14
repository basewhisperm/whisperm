import assert from "node:assert/strict";
import test from "node:test";

import { createWhispeRMServices, ServiceError } from "../dist/index.js";

const now = "2026-06-11T00:00:00.000Z";
const context = { tenantId: "tenant-a", actorId: "user-a", correlation: { correlationId: "corr-marketplace" } };

const record = (base) => ({ createdAt: now, updatedAt: now, ...base });

const createRepositories = (overrides = {}) => {
  const calls = [];
  const contacts = new Map();
  const captures = new Map();
  const deals = new Map();
  const activities = [];
  const push = (repo, method, args) => calls.push({ repo, method, args });

  const repositories = {
    calls,
    contactsById: contacts,
    capturesByUrl: captures,
    dealsByExternalId: deals,
    activityRows: activities,
    pipelines: {
      async findByWorkspace() { return null; },
      async updateStages() { throw new Error("not used"); },
      async findByDefaultKey(workspaceId, defaultKey) {
        push("pipelines", "findByDefaultKey", [workspaceId, defaultKey]);
        if (workspaceId !== "tenant-a" || defaultKey !== "marketplace_acquisition") return null;
        return record({ id: "pipeline-market", tenantId: workspaceId, name: "Marketplace Acquisition", isDefault: false, defaultKey, stages: [record({ id: "stage-captured", tenantId: workspaceId, pipelineId: "pipeline-market", name: "Captured", position: 1, color: "#64748B" })] });
      }
    },
    contacts: {
      async findByEmails(scope, emails) {
        push("contacts", "findByEmails", [scope, emails]);
        return [...contacts.values()].filter((contact) => contact.tenantId === scope.tenantId && emails.includes(contact.email));
      },
      async create(scope, input) {
        push("contacts", "create", [scope, input]);
        const contact = record({ id: `contact-${contacts.size + 1}`, tenantId: input.tenantId, externalId: null, email: input.email ?? null, phone: null, firstName: input.firstName ?? null, lastName: null, stage: "PROSPECT", metadata: input.metadata ?? {} });
        contacts.set(contact.id, contact);
        return contact;
      }
    },
    marketplaceCaptures: {
      async findByListingUrl(scope, listingUrl) {
        push("marketplaceCaptures", "findByListingUrl", [scope, listingUrl]);
        return captures.get(`${scope.tenantId}:${listingUrl}`) ?? null;
      },
      async create(scope, input) {
        push("marketplaceCaptures", "create", [scope, input]);
        const capture = record({ id: `capture-${captures.size + 1}`, tenantId: input.tenantId, marketplaceSourceId: input.marketplaceSourceId ?? null, contactId: input.contactId ?? null, dealId: input.dealId ?? null, externalId: input.externalId ?? null, listingUrl: input.listingUrl, title: input.title, description: input.description ?? null, price: input.price ?? null, currency: input.currency ?? null, sellerName: input.sellerName ?? null, sellerProfileUrl: input.sellerProfileUrl ?? null, status: input.status ?? "CAPTURED", capturedAt: now, metadata: input.metadata ?? {} });
        captures.set(`${scope.tenantId}:${input.listingUrl}`, capture);
        return capture;
      },
      async update(scope, captureId, input) {
        push("marketplaceCaptures", "update", [scope, captureId, input]);
        const entry = [...captures.entries()].find(([, capture]) => capture.tenantId === scope.tenantId && capture.id === captureId);
        assert.ok(entry, "capture must exist");
        const updated = { ...entry[1], ...input, updatedAt: now };
        captures.set(entry[0], updated);
        return updated;
      }
    },
    deals: {
      async findByExternalId(workspaceId, externalId) {
        push("deals", "findByExternalId", [workspaceId, externalId]);
        const deal = deals.get(`${workspaceId}:${externalId}`) ?? null;
        return deal;
      },
      async findById(workspaceId, dealId) {
        push("deals", "findById", [workspaceId, dealId]);
        return [...deals.values()].find((deal) => deal.tenantId === workspaceId && deal.id === dealId) ?? null;
      },
      async create(workspaceId, input) {
        push("deals", "create", [workspaceId, input]);
        const deal = record({ id: `deal-${deals.size + 1}`, tenantId: workspaceId, contactId: input.contactId ?? null, pipelineId: "pipeline-market", pipelineStageId: input.pipelineStageId, ownerId: input.ownerId ?? null, externalId: input.externalId ?? null, title: input.title, value: input.value ?? null, currency: input.currency ?? "USD", probability: null, closedAt: null, metadata: input.metadata ?? {} });
        deals.set(`${workspaceId}:${input.externalId}`, deal);
        return deal;
      }
    },
    activities: {
      async create(scope, input) {
        push("activities", "create", [scope, input]);
        const activity = record({ id: `activity-${activities.length + 1}`, tenantId: input.tenantId, contactId: input.contactId ?? null, dealId: input.dealId ?? null, createdById: input.createdById, type: input.type, note: input.note, occurredAt: now, metadata: input.metadata ?? {} });
        activities.push(activity);
        return activity;
      }
    },
    auditLogs: {
      async append(scope, input) { push("auditLogs", "append", [scope, input]); return record({ id: `audit-${calls.length}`, tenantId: scope.tenantId, actorId: input.actorId ?? null, action: input.action, targetType: input.targetType, targetId: input.targetId ?? null, correlationId: input.correlationId, requestId: input.requestId ?? null, occurredAt: now, metadata: input.metadata ?? {} }); },
      async listByTarget() { return { items: [] }; }
    },
    ...overrides
  };
  return repositories;
};

const captureInput = {
  tenantId: "tenant-a",
  listingUrl: "https://market.example/listings/123",
  title: "Two-chair salon suite",
  price: "2500.00",
  currency: "USD",
  sellerName: "Seller One",
  sellerEmail: "seller@example.com",
  sellerProfileUrl: "https://market.example/sellers/one"
};

test("capture creates a marketplace acquisition deal linked to contact and Captured stage", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);

  const result = await services.marketplaceAcquisition.capture(context, captureInput);

  assert.equal(result.status, "CAPTURED");
  assert.equal(result.contactId, "contact-1");
  assert.equal(result.dealId, "deal-1");
  assert.equal(result.dealCreated, true);
  assert.equal(result.dealMatched, false);

  const dealCreate = repositories.calls.find((call) => call.repo === "deals" && call.method === "create");
  assert.equal(dealCreate.args[1].pipelineStageId, "stage-captured");
  assert.equal(dealCreate.args[1].contactId, "contact-1");
  assert.equal(dealCreate.args[1].metadata.marketplaceCaptureId, "capture-1");
  assert.equal(repositories.activityRows[0].contactId, "contact-1");
  assert.equal(repositories.activityRows[0].dealId, "deal-1");
  assert.equal(repositories.activityRows[0].metadata.eventType, "MARKETPLACE_CAPTURED");
});

test("second capture for same source URL links existing deal without duplication", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);

  await services.marketplaceAcquisition.capture(context, captureInput);
  const second = await services.marketplaceAcquisition.capture(context, captureInput);

  assert.equal(second.dealId, "deal-1");
  assert.equal(second.dealCreated, false);
  assert.equal(second.dealMatched, true);
  assert.equal(repositories.calls.filter((call) => call.repo === "deals" && call.method === "create").length, 1);
});

test("missing marketplace acquisition pipeline fails clearly", async () => {
  const repositories = createRepositories({ pipelines: { async findByWorkspace() { return null; }, async updateStages() { throw new Error("not used"); }, async findByDefaultKey() { return null; } } });
  const services = createWhispeRMServices(repositories);

  await assert.rejects(
    services.marketplaceAcquisition.capture(context, captureInput),
    (error) => error instanceof ServiceError && error.code === "SERVICE_NOT_FOUND" && error.message.includes("pipeline seed")
  );
});

test("tenant context is enforced before cross-tenant marketplace deal creation", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);

  await assert.rejects(
    services.marketplaceAcquisition.capture({ ...context, tenantId: "tenant-b" }, captureInput),
    (error) => error instanceof ServiceError && error.code === "SERVICE_TENANT_MISMATCH"
  );

  assert.equal(repositories.calls.some((call) => call.repo === "deals" && call.method === "create"), false);
});
