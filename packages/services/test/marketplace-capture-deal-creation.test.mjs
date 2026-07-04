import assert from "node:assert/strict";
import test from "node:test";

import { createWhispeRMServices, MARKETPLACE_ACQUISITION_PIPELINE_KEY, ServiceError } from "../dist/index.js";

const now = "2026-06-11T00:00:00.000Z";
const context = { tenantId: "tenant-a", actorId: "user-a", correlation: { correlationId: "corr-marketplace" } };

const record = (base) => ({ createdAt: now, updatedAt: now, ...base });

const createRepositories = (overrides = {}) => {
  const calls = [];
  const contacts = new Map();
  const captures = new Map();
  const deals = new Map();
  const draftInventories = new Map();
  const activities = [];
  const push = (repo, method, args) => calls.push({ repo, method, args });

  const repositories = {
    calls,
    contactsById: contacts,
    capturesByUrl: captures,
    dealsByExternalId: deals,
    draftInventoriesByCapture: draftInventories,
    activityRows: activities,
    pipelines: {
      async findByWorkspace() { return null; },
      async updateStages() { throw new Error("not used"); },
      async findByDefaultKey(workspaceId, defaultKey) {
        push("pipelines", "findByDefaultKey", [workspaceId, defaultKey]);
        if (workspaceId !== "tenant-a" || defaultKey !== MARKETPLACE_ACQUISITION_PIPELINE_KEY) return null;
        return record({ id: "pipeline-market", tenantId: workspaceId, name: "Marketplace Acquisition", isDefault: false, defaultKey, stages: [
          record({ id: "stage-captured", tenantId: workspaceId, pipelineId: "pipeline-market", name: "Captured", position: 1, color: "#64748B" }),
          record({ id: "stage-invited", tenantId: workspaceId, pipelineId: "pipeline-market", name: "Invited", position: 2, color: "#2563EB" }),
          record({ id: "stage-claim-started", tenantId: workspaceId, pipelineId: "pipeline-market", name: "Claim Started", position: 3, color: "#7C3AED" }),
          record({ id: "stage-claimed", tenantId: workspaceId, pipelineId: "pipeline-market", name: "Claimed", position: 4, color: "#0891B2" }),
          record({ id: "stage-converted", tenantId: workspaceId, pipelineId: "pipeline-market", name: "Converted", position: 5, color: "#16A34A" }),
          record({ id: "stage-expired", tenantId: workspaceId, pipelineId: "pipeline-market", name: "Expired", position: 6, color: "#DC2626" }),
        ] });
      }
    },
    contacts: {
      async findById(scope, id) {
        push("contacts", "findById", [scope, id]);
        return contacts.get(id) ?? null;
      },
      async findByPhone(scope, phone) {
        push("contacts", "findByPhone", [scope, phone]);
        return [...contacts.values()].find((contact) => contact.tenantId === scope.tenantId && contact.phone === phone) ?? null;
      },
      async findByEmails(scope, emails) {
        push("contacts", "findByEmails", [scope, emails]);
        return [...contacts.values()].filter((contact) => contact.tenantId === scope.tenantId && emails.includes(contact.email));
      },
      async create(scope, input) {
        push("contacts", "create", [scope, input]);
        const contact = record({ id: `contact-${contacts.size + 1}`, tenantId: input.tenantId, externalId: null, email: input.email ?? null, phone: input.phone ?? null, firstName: input.firstName ?? null, lastName: null, stage: "PROSPECT", metadata: input.metadata ?? {} });
        contacts.set(contact.id, contact);
        return contact;
      },
      async list(scope) {
        push("contacts", "list", [scope]);
        return { items: [...contacts.values()].filter((contact) => contact.tenantId === scope.tenantId) };
      }
    },
    marketplaceCaptures: {
      async findByListingUrl(scope, listingUrl) {
        push("marketplaceCaptures", "findByListingUrl", [scope, listingUrl]);
        return captures.get(`${scope.tenantId}:${listingUrl}`) ?? null;
      },
      async findByExternalId(scope, externalId) {
        push("marketplaceCaptures", "findByExternalId", [scope, externalId]);
        return [...captures.values()].find((capture) => capture.tenantId === scope.tenantId && capture.externalId === externalId) ?? null;
      },
      async list(scope) {
        push("marketplaceCaptures", "list", [scope]);
        return { items: [...captures.values()].filter((capture) => capture.tenantId === scope.tenantId) };
      },
      async create(scope, input) {
        push("marketplaceCaptures", "create", [scope, input]);
        const capture = record({ id: `capture-${captures.size + 1}`, tenantId: input.tenantId, marketplaceSourceId: input.marketplaceSourceId ?? null, contactId: input.contactId ?? null, dealId: input.dealId ?? null, externalId: input.externalId ?? null, listingUrl: input.listingUrl, title: input.title, description: input.description ?? null, price: input.price ?? null, currency: input.currency ?? null, sellerName: input.sellerName ?? null, sellerProfileUrl: input.sellerProfileUrl ?? null, status: input.status ?? "CAPTURED", capturedAt: now, metadata: input.metadata ?? {} });
        captures.set(`${scope.tenantId}:${input.listingUrl}`, capture);
        return capture;
      },
      async findByDealId(scope, dealId) {
        push("marketplaceCaptures", "findByDealId", [scope, dealId]);
        return [...captures.values()].find((capture) => capture.tenantId === scope.tenantId && capture.dealId === dealId) ?? null;
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

    draftInventories: {
      async create(scope, input) {
        push("draftInventories", "create", [scope, input]);
        const draft = record({ id: `draft-${draftInventories.size + 1}`, tenantId: input.tenantId, marketplaceCaptureId: input.marketplaceCaptureId, contactId: input.contactId ?? null, dealId: input.dealId ?? null, title: input.title, description: input.description ?? null, price: input.price ?? null, currency: input.currency ?? null, category: input.category ?? null, images: input.images ?? null, listingUrl: input.listingUrl ?? null, marketplaceSource: input.marketplaceSource ?? null, marketplaceListingId: input.marketplaceListingId ?? null, status: input.status ?? "DRAFT" });
        draftInventories.set(`${scope.tenantId}:${input.marketplaceCaptureId}`, draft);
        return draft;
      },
      async findByMarketplaceCaptureId(scope, marketplaceCaptureId) {
        push("draftInventories", "findByMarketplaceCaptureId", [scope, marketplaceCaptureId]);
        return draftInventories.get(`${scope.tenantId}:${marketplaceCaptureId}`) ?? null;
      },
      async findByMarketplaceListing(scope, marketplaceSource, marketplaceListingId) {
        push("draftInventories", "findByMarketplaceListing", [scope, marketplaceSource, marketplaceListingId]);
        return [...draftInventories.values()].find((draft) => draft.tenantId === scope.tenantId && draft.marketplaceSource === marketplaceSource && draft.marketplaceListingId === marketplaceListingId) ?? null;
      },
      async upsertForCapture(scope, input) {
        push("draftInventories", "upsertForCapture", [scope, input]);
        if (input.marketplaceSource && input.marketplaceListingId) {
          const existingByListing = [...draftInventories.values()].find((draft) => draft.tenantId === scope.tenantId && draft.marketplaceSource === input.marketplaceSource && draft.marketplaceListingId === input.marketplaceListingId);
          if (existingByListing) {
            const updated = { ...existingByListing, ...input, updatedAt: now };
            draftInventories.set(`${scope.tenantId}:${updated.marketplaceCaptureId}`, updated);
            return updated;
          }
          return this.create(scope, input);
        }
        const existingByCapture = draftInventories.get(`${scope.tenantId}:${input.marketplaceCaptureId}`);
        if (existingByCapture) return existingByCapture;
        return this.create(scope, input);
      },
      async update(scope, draftInventoryId, input) {
        push("draftInventories", "update", [scope, draftInventoryId, input]);
        const entry = [...draftInventories.entries()].find(([, draft]) => draft.tenantId === scope.tenantId && draft.id === draftInventoryId);
        assert.ok(entry, "draft inventory must exist");
        const updated = { ...entry[1], ...input, updatedAt: now };
        draftInventories.set(entry[0], updated);
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
      async updateStage(workspaceId, dealId, stageId) {
        push("deals", "updateStage", [workspaceId, dealId, stageId]);
        const entry = [...deals.entries()].find(([, deal]) => deal.tenantId === workspaceId && deal.id === dealId);
        assert.ok(entry, "deal must exist");
        const updated = { ...entry[1], pipelineStageId: stageId, updatedAt: now };
        deals.set(entry[0], updated);
        return updated;
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
  sellerPhone: "+15555550123",
  phone: "+15555550123",
  sellerProfileUrl: "https://market.example/sellers/one",
  externalId: "listing-123",
  metadata: { imageUrls: ["https://market.example/images/one.jpg"], category: "Furniture" }
};

test("capture creates a marketplace acquisition deal linked to contact and Captured stage", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);

  const result = await services.marketplaceAcquisition.capture(context, captureInput);

  assert.equal(result.status, "CAPTURED");
  assert.equal(result.contactId, "contact-1");
  assert.equal(result.dealId, "deal-1");
  assert.equal(result.draftInventoryId, "draft-1");
  assert.equal(result.dealCreated, true);
  assert.equal(result.dealMatched, false);

  const dealCreate = repositories.calls.find((call) => call.repo === "deals" && call.method === "create");
  assert.equal(dealCreate.args[1].pipelineStageId, "stage-captured");
  assert.equal(dealCreate.args[1].contactId, "contact-1");
  assert.equal(dealCreate.args[1].metadata.marketplaceCaptureId, "capture-1");
  assert.equal(repositories.activityRows[0].contactId, "contact-1");
  assert.equal(repositories.activityRows[0].dealId, "deal-1");
  assert.equal(repositories.activityRows[0].metadata.eventType, "MARKETPLACE_CAPTURED");

  const draft = [...repositories.draftInventoriesByCapture.values()][0];
  assert.equal(draft.tenantId, "tenant-a");
  assert.equal(draft.marketplaceCaptureId, "capture-1");
  assert.equal(draft.contactId, "contact-1");
  assert.equal(draft.dealId, "deal-1");
  assert.equal(draft.title, "Two-chair salon suite");
  assert.equal(draft.description, null);
  assert.equal(draft.price, "2500.00");
  assert.equal(draft.currency, "USD");
  assert.equal(draft.category, "Furniture");
  assert.deepEqual(draft.images, ["https://market.example/images/one.jpg"]);
  assert.equal(draft.listingUrl, "https://market.example/listings/123");
  assert.equal(draft.marketplaceListingId, "listing-123");
  assert.equal(draft.status, "DRAFT");
  const contact = repositories.contactsById.get("contact-1");
  assert.equal(contact.email, "seller@example.com");
});


test("different listings with same seller marketplaceIdentifier do not collapse to one capture", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);

  const first = await services.marketplaceAcquisition.capture(context, {
    ...captureInput,
    listingUrl: "https://jiji.com.gh/listings/seller-shared-1",
    externalId: undefined,
    marketplaceListingId: undefined,
    marketplaceIdentifier: "+233558153403",
    sellerPhone: "0558153403",
    phone: "0558153403",
    title: "BMW 520i",
  });

  const second = await services.marketplaceAcquisition.capture(context, {
    ...captureInput,
    listingUrl: "https://jiji.com.gh/listings/seller-shared-2",
    externalId: undefined,
    marketplaceListingId: undefined,
    marketplaceIdentifier: "+233558153403",
    sellerPhone: "0558153403",
    phone: "0558153403",
    title: "Toyota Prado",
  });

  assert.equal(first.contactId, second.contactId);
  assert.equal(first.dealId, second.dealId);
  assert.notEqual(first.captureId, second.captureId);
  assert.equal(repositories.contactsById.size, 1);
  assert.equal(repositories.dealsByExternalId.size, 1);
  assert.equal(repositories.capturesByUrl.size, 2);
  assert.equal(repositories.draftInventoriesByCapture.size, 2);
});

test("multiple listings from same seller phone reuse one contact and one acquisition deal", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);

  const first = await services.marketplaceAcquisition.capture(context, {
    ...captureInput,
    sourceUrl: "https://tonaton.com/listing-1",
    listingUrl: "https://tonaton.com/listing-1",
    externalId: "tonaton-listing-1",
    marketplaceListingId: "tonaton-listing-1",
    marketplaceIdentifier: "kwame-motors",
    title: "Honda Civic",
    sellerName: "Kwame Motors",
    phone: "0241234567",
    sellerPhone: "0241234567",
    email: undefined,
    sellerEmail: undefined,
    marketplaceSource: "TONATON"
  });

  const second = await services.marketplaceAcquisition.capture(context, {
    ...captureInput,
    sourceUrl: "https://tonaton.com/listing-2",
    listingUrl: "https://tonaton.com/listing-2",
    externalId: "tonaton-listing-2",
    marketplaceListingId: "tonaton-listing-2",
    marketplaceIdentifier: "kwame-motors",
    title: "Toyota Corolla",
    sellerName: "Kwame Motors",
    phone: "0241234567",
    sellerPhone: "0241234567",
    email: undefined,
    sellerEmail: undefined,
    marketplaceSource: "TONATON"
  });

  assert.equal(first.contactId, second.contactId);
  assert.equal(first.dealId, second.dealId);
  assert.notEqual(first.captureId, second.captureId);
  assert.notEqual(first.draftInventoryId, second.draftInventoryId);
  assert.equal(first.contactMatchStrategy, "created");
  assert.equal(second.contactMatchStrategy, "phone");
  assert.equal(first.dealCreated, true);
  assert.equal(second.dealCreated, false);
  assert.equal(repositories.contactsById.size, 1);
  assert.equal(repositories.dealsByExternalId.size, 1);
  assert.equal(repositories.draftInventoriesByCapture.size, 2);
});

test("second capture for same source URL links existing deal without duplication", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);

  await services.marketplaceAcquisition.capture(context, captureInput);
  const second = await services.marketplaceAcquisition.capture(context, captureInput);

  assert.equal(second.dealId, "deal-1");
  assert.equal(second.draftInventoryId, "draft-1");
  assert.equal(second.dealCreated, false);
  assert.equal(second.dealMatched, true);
  assert.equal(repositories.calls.filter((call) => call.repo === "deals" && call.method === "create").length, 1);
  assert.equal(repositories.calls.filter((call) => call.repo === "draftInventories" && call.method === "create").length, 1);
  assert.equal(repositories.draftInventoriesByCapture.size, 1);
});

test("capture without phone creates capture only and remains unqualified", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);

  const result = await services.marketplaceAcquisition.capture(context, {
    ...captureInput,
    sellerPhone: undefined,
    phone: undefined,
    sellerEmail: "seller@example.com",
  });

  assert.equal(result.status, "CAPTURED");
  assert.equal(result.contactId, undefined);
  assert.equal(result.dealId, undefined);
  assert.equal(result.contactMatchStrategy, "unqualified");
  assert.equal(result.qualificationStatus, "UNQUALIFIED");
  assert.equal(result.qualificationReason, "PHONE_REQUIRED");
  assert.equal(result.contactCreated, false);
  assert.equal(result.dealCreated, false);
  assert.equal(result.dealMatched, false);
  assert.equal(result.draftInventoryId, "draft-1");
  assert.equal(repositories.calls.some((call) => call.repo === "contacts" && call.method === "create"), false);
  assert.equal(repositories.calls.some((call) => call.repo === "deals" && call.method === "create"), false);

  const capture = [...repositories.capturesByUrl.values()][0];
  assert.equal(capture.contactId, null);
  assert.equal(capture.dealId, null);
  assert.equal(capture.metadata.acquisitionReadiness, "BLOCKED");
  assert.equal(capture.metadata.mobileRequiredForQualification, true);

  const draft = [...repositories.draftInventoriesByCapture.values()][0];
  assert.equal(draft.contactId, null);
  assert.equal(draft.dealId, null);
  assert.deepEqual(draft.images, ["https://market.example/images/one.jpg"]);
});

test("repeated capture without phone is idempotent and creates no contact or deal", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);
  const input = { ...captureInput, sellerPhone: undefined, phone: undefined };

  const first = await services.marketplaceAcquisition.capture(context, input);
  const second = await services.marketplaceAcquisition.capture(context, input);

  assert.equal(first.captureId, second.captureId);
  assert.equal(second.contactId, undefined);
  assert.equal(second.dealId, undefined);
  assert.equal(second.qualificationStatus, "UNQUALIFIED");
  assert.equal(repositories.calls.filter((call) => call.repo === "contacts" && call.method === "create").length, 0);
  assert.equal(repositories.calls.filter((call) => call.repo === "deals" && call.method === "create").length, 0);
  assert.equal(repositories.calls.filter((call) => call.repo === "draftInventories" && call.method === "create").length, 1);
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


test("valid marketplace acquisition lifecycle transitions update deal and capture status", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);
  await services.marketplaceAcquisition.capture(context, captureInput);

  const invited = await services.marketplaceAcquisition.transitionStage(context, { dealId: "deal-1", stageName: "Invited" });
  assert.equal(invited.previousStage, "Captured");
  assert.equal(invited.currentStage, "Invited");
  assert.equal(invited.status, "INVITED");

  const claimStarted = await services.marketplaceAcquisition.transitionStage(context, { dealId: "deal-1", stageName: "Claim Started" });
  assert.equal(claimStarted.status, "CLAIM_STARTED");

  const claimed = await services.marketplaceAcquisition.transitionStage(context, { dealId: "deal-1", stageName: "Claimed" });
  assert.equal(claimed.status, "CLAIMED");

  const converted = await services.marketplaceAcquisition.transitionStage(context, { dealId: "deal-1", stageName: "Converted" });
  assert.equal(converted.status, "CONVERTED");
});

test("expiration is allowed from pre-claim marketplace acquisition stages", async () => {
  for (const setupStage of [null, "Invited", "Claim Started"]) {
    const repositories = createRepositories();
    const services = createWhispeRMServices(repositories);
    await services.marketplaceAcquisition.capture(context, captureInput);
    if (setupStage === "Invited") await services.marketplaceAcquisition.transitionStage(context, { dealId: "deal-1", stageName: "Invited" });
    if (setupStage === "Claim Started") {
      await services.marketplaceAcquisition.transitionStage(context, { dealId: "deal-1", stageName: "Invited" });
      await services.marketplaceAcquisition.transitionStage(context, { dealId: "deal-1", stageName: "Claim Started" });
    }

    const expired = await services.marketplaceAcquisition.transitionStage(context, { dealId: "deal-1", stageName: "Expired" });
    assert.equal(expired.currentStage, "Expired");
    assert.equal(expired.status, "EXPIRED");
  }
});

test("invalid backwards marketplace acquisition transition fails", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);
  await services.marketplaceAcquisition.capture(context, captureInput);
  await services.marketplaceAcquisition.transitionStage(context, { dealId: "deal-1", stageName: "Invited" });

  await assert.rejects(
    services.marketplaceAcquisition.transitionStage(context, { dealId: "deal-1", stageName: "Captured" }),
    (error) => error instanceof ServiceError && error.code === "SERVICE_INVALID_STATE_TRANSITION"
  );
});

test("marketplace acquisition stage transition preserves tenant isolation", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);
  await services.marketplaceAcquisition.capture(context, captureInput);

  await assert.rejects(
    services.marketplaceAcquisition.transitionStage({ ...context, tenantId: "tenant-b" }, { dealId: "deal-1", stageName: "Invited" }),
    (error) => error instanceof ServiceError && error.code === "SERVICE_NOT_FOUND"
  );
});


test("canonical phone qualifies when optional sellerPhone and sellerEmail channels are missing", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);
  const withPhone = await services.marketplaceAcquisition.capture(context, { ...captureInput, listingUrl: "https://market.example/listings/phone", externalId: "listing-phone", sellerPhone: undefined, sellerEmail: undefined, phone: "+15555550123", email: undefined });
  assert.equal(withPhone.draftInventoryId, "draft-1");
  assert.equal(repositories.contactsById.get("contact-1").phone, "+15555550123");
  const capture = [...repositories.capturesByUrl.values()].find((item) => item.id === withPhone.captureId);
  assert.equal(capture.metadata.sellerPhone, "+15555550123");
  assert.equal(capture.metadata.sellerEmail, undefined);
});

test("truly no sellerPhone and no canonical phone creates unqualified capture without contact or deal", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);
  const result = await services.marketplaceAcquisition.capture(context, { ...captureInput, listingUrl: "https://market.example/listings/no-phone", externalId: "listing-no-phone", sellerEmail: undefined, sellerPhone: undefined, email: undefined, phone: undefined });
  assert.equal(result.status, "CAPTURED");
  assert.equal(result.contactId, undefined);
  assert.equal(result.dealId, undefined);
  assert.equal(result.contactMatchStrategy, "unqualified");
  assert.equal(result.qualificationStatus, "UNQUALIFIED");
  assert.equal(result.qualificationReason, "PHONE_REQUIRED");
  assert.equal(result.contactCreated, false);
  assert.equal(result.dealCreated, false);
  assert.equal(repositories.contactsById.size, 0);
  assert.equal(repositories.dealsByExternalId.size, 0);
  const capture = [...repositories.capturesByUrl.values()].find((item) => item.id === result.captureId);
  assert.equal(capture.metadata.acquisitionReadiness, "BLOCKED");
  assert.equal(capture.metadata.mobileRequiredForQualification, true);
});

test("duplicate marketplace listing id is scoped to tenant and reuses capture inventory", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);
  await services.marketplaceAcquisition.capture(context, captureInput);
  const duplicate = await services.marketplaceAcquisition.capture(context, { ...captureInput, listingUrl: "https://market.example/listings/123?ref=second" });
  assert.equal(duplicate.draftInventoryId, "draft-1");
  assert.equal(repositories.draftInventoriesByCapture.size, 1);
  await assert.rejects(services.marketplaceAcquisition.capture({ ...context, tenantId: "tenant-b" }, captureInput), /tenant/i);
});

test("dirty marketplace seller name is cleaned and raw badges remain metadata", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);
  await services.marketplaceAcquisition.capture(context, {
    ...captureInput,
    listingUrl: "https://jiji.com.gh/listings/dirty-name",
    externalId: "dirty-name",
    sellerName: "Serbeh Don Ernest New on Jiji Verified ID Last seen 5 hours ago",
    sellerPhone: "0241234567",
  });
  const contact = repositories.contactsById.get("contact-1");
  assert.equal(contact.firstName, "Serbeh Don Ernest");
  assert.equal(contact.metadata.marketplaceAcquisition.rawSellerText, "Serbeh Don Ernest New on Jiji Verified ID Last seen 5 hours ago");
  assert.equal(contact.metadata.marketplaceAcquisition.verifiedSeller, true);
  assert.equal(contact.metadata.marketplaceAcquisition.lastSeen, "5 hours ago");
  assert.equal(contact.metadata.marketplaceAcquisition.marketplaceTenure, "New on Jiji");
});

test("same seller profile URL without phone creates no contact for either capture", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);
  const first = await services.marketplaceAcquisition.capture(context, { ...captureInput, listingUrl: "https://market.example/listings/profile-1", externalId: "profile-1", sellerPhone: undefined, phone: undefined, sellerEmail: undefined, email: undefined, sellerProfileUrl: "https://market.example/sellers/shared" });
  const second = await services.marketplaceAcquisition.capture(context, { ...captureInput, listingUrl: "https://market.example/listings/profile-2", externalId: "profile-2", sellerPhone: undefined, phone: undefined, sellerEmail: undefined, email: undefined, sellerProfileUrl: "https://market.example/sellers/shared" });
  assert.equal(first.contactId, undefined);
  assert.equal(second.contactId, undefined);
  assert.equal(second.sellerIdentityStrategy, "unqualified");
  assert.equal(repositories.contactsById.size, 0);
});

test("bulk portfolio payload creates many captures and drafts but one seller contact and deal", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);
  const result = await services.marketplaceAcquisition.capture(context, {
    ...captureInput,
    listingUrl: "https://market.example/listings/bulk-1",
    externalId: "bulk-1",
    sellerPhone: "0241234567",
    portfolioListings: [
      { listingUrl: "https://market.example/listings/bulk-2", marketplaceListingId: "bulk-2", title: "Bulk two", price: "200", currency: "USD", images: ["https://market.example/images/two.jpg"] },
      { listingUrl: "https://market.example/listings/bulk-3", marketplaceListingId: "bulk-3", title: "Bulk three", price: "300", currency: "USD" },
    ],
  });
  assert.equal(result.portfolioCaptureCount, 3);
  assert.equal(result.draftInventoryIds.length, 3);
  assert.equal(repositories.contactsById.size, 1);
  assert.equal(repositories.dealsByExternalId.size, 1);
  assert.equal(repositories.capturesByUrl.size, 3);
  assert.equal(repositories.draftInventoriesByCapture.size, 3);
});

test("phone missing is blocked for qualification and email-only does not qualify", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);
  const result = await services.marketplaceAcquisition.capture(context, { ...captureInput, listingUrl: "https://market.example/listings/email-only", externalId: "email-only", sellerPhone: undefined, phone: undefined, sellerEmail: "email-only@example.com" });
  const capture = [...repositories.capturesByUrl.values()].find((item) => item.id === result.captureId);
  assert.equal(capture.metadata.acquisitionReadiness, "BLOCKED");
  assert.equal(capture.metadata.whatsappCandidate, false);
});

const createUsageMetering = () => {
  const events = [];
  return {
    events,
    async recordUsageEvent(scope, input) {
      const existing = events.find((event) => event.idempotencyKey === input.idempotencyKey);
      if (existing) return existing;
      const event = { id: `usage-${events.length + 1}`, tenantId: scope.tenantId, ...input };
      events.push(event);
      return event;
    },
  };
};

test("qualified capture reports crmConversionStatus CREATED and records CRM_CONVERSION_CREATED exactly once", async () => {
  const usageMetering = createUsageMetering();
  const repositories = createRepositories();
  const services = createWhispeRMServices({ ...repositories, usageMetering });

  const result = await services.marketplaceAcquisition.capture(context, captureInput);

  assert.equal(result.crmConversionStatus, "CREATED");
  assert.equal(usageMetering.events.length, 1);
  assert.equal(usageMetering.events[0].eventType, "CRM_CONVERSION_CREATED");
  assert.equal(usageMetering.events[0].tenantId, "tenant-a");
  assert.equal(usageMetering.events[0].captureId, result.captureId);
  assert.equal(usageMetering.events[0].contactId, result.contactId);
  assert.equal(usageMetering.events[0].dealId, result.dealId);
});

test("repeated qualified capture reports EXISTING and does not record a duplicate CRM_CONVERSION_CREATED event", async () => {
  const usageMetering = createUsageMetering();
  const repositories = createRepositories();
  const services = createWhispeRMServices({ ...repositories, usageMetering });

  const first = await services.marketplaceAcquisition.capture(context, captureInput);
  const second = await services.marketplaceAcquisition.capture(context, captureInput);

  assert.equal(first.crmConversionStatus, "CREATED");
  assert.equal(second.crmConversionStatus, "EXISTING");
  assert.equal(usageMetering.events.length, 1, "usage metering must fire exactly once for the canonical CRM conversion");
});

test("unqualified capture reports crmConversionStatus NOT_ELIGIBLE and records no CRM conversion usage event", async () => {
  const usageMetering = createUsageMetering();
  const repositories = createRepositories();
  const services = createWhispeRMServices({ ...repositories, usageMetering });

  const result = await services.marketplaceAcquisition.capture(context, { ...captureInput, sellerPhone: undefined, phone: undefined });

  assert.equal(result.qualificationStatus, "UNQUALIFIED");
  assert.equal(result.crmConversionStatus, "NOT_ELIGIBLE");
  assert.equal(usageMetering.events.length, 0);
});

test("CRM conversion usage event idempotency key is scoped by tenant, capture, contact, and deal", async () => {
  const usageMetering = createUsageMetering();
  const repositories = createRepositories();
  const services = createWhispeRMServices({ ...repositories, usageMetering });

  const result = await services.marketplaceAcquisition.capture(context, captureInput);

  const [event] = usageMetering.events;
  assert.ok(event.idempotencyKey.includes("tenant-a"));
  assert.ok(event.idempotencyKey.includes(result.captureId));
  assert.ok(event.idempotencyKey.includes(result.contactId));
  assert.ok(event.idempotencyKey.includes(result.dealId));
});

test("same marketplace name without phone creates capture drafts without any contact or deal", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);
  const first = await services.marketplaceAcquisition.capture(context, { ...captureInput, listingUrl: "https://market.example/listings/name-1", externalId: "name-1", sellerPhone: undefined, phone: undefined, sellerEmail: "one@example.com", sellerProfileUrl: undefined, marketplaceIdentifier: undefined, sellerName: "Same Seller" });
  const second = await services.marketplaceAcquisition.capture(context, { ...captureInput, listingUrl: "https://market.example/listings/name-2", externalId: "name-2", sellerPhone: undefined, phone: undefined, sellerEmail: "two@example.com", sellerProfileUrl: undefined, marketplaceIdentifier: undefined, sellerName: "Same Seller" });
  assert.equal(first.contactId, undefined);
  assert.equal(second.contactId, undefined);
  assert.equal(repositories.contactsById.size, 0);
  assert.equal(repositories.dealsByExternalId.size, 0);
  assert.equal(repositories.draftInventoriesByCapture.size, 2);
});
