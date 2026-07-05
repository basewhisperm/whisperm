import assert from "node:assert/strict";
import test from "node:test";

import {
  createWhispeRMServices,
  MARKETPLACE_ACQUISITION_PIPELINE_KEY,
  MarketplaceDiscoveryService,
  MarketplaceRequalificationService,
} from "../dist/index.js";

const now = "2026-07-05T00:00:00.000Z";
const record = (base) => ({ createdAt: now, updatedAt: now, ...base });

class SpyUsageMetering {
  constructor() {
    this.events = [];
  }
  async recordUsageEvent(scope, input) {
    const existing = this.events.find((event) => event.scope.tenantId === scope.tenantId && event.input.idempotencyKey === input.idempotencyKey);
    if (existing !== undefined) return existing.record;
    const record = { id: `event-${this.events.length + 1}`, ...input };
    this.events.push({ scope, input, record });
    return record;
  }
}

// Mirrors the in-memory harness in marketplace-requalification.test.mjs so SELLER_QUALIFIED
// metering is exercised against the real MarketplaceAcquisitionCaptureService.capture pipeline
// (ST1-004 qualification + ST1-005/ST1-006 capture-time CRM conversion) instead of a fake.
const createRepositories = () => {
  const contacts = new Map();
  const captures = new Map();
  const deals = new Map();
  const draftInventories = new Map();
  const activities = [];
  const auditLogs = [];
  const campaignMembers = new Map();

  return {
    capturesById: captures,
    pipelines: {
      async findByWorkspace() { return null; },
      async findByDefaultKey(workspaceId, defaultKey) {
        if (workspaceId !== "tenant-a" || defaultKey !== MARKETPLACE_ACQUISITION_PIPELINE_KEY) return null;
        return record({
          id: "pipeline-market", tenantId: workspaceId, name: "Marketplace Acquisition", isDefault: false, defaultKey,
          stages: [record({ id: "stage-captured", tenantId: workspaceId, pipelineId: "pipeline-market", name: "Captured", position: 1, color: "#64748B" })],
        });
      },
    },
    contacts: {
      async findById(scope, id) { return contacts.get(id) ?? null; },
      async findByPhone(scope, phone) { return [...contacts.values()].find((c) => c.tenantId === scope.tenantId && c.phone === phone) ?? null; },
      async findByEmails(scope, emails) { return [...contacts.values()].filter((c) => c.tenantId === scope.tenantId && emails.includes(c.email)); },
      async create(scope, input) {
        const contact = record({ id: `contact-${contacts.size + 1}`, tenantId: input.tenantId, externalId: null, email: input.email ?? null, phone: input.phone ?? null, firstName: input.firstName ?? null, lastName: null, stage: "PROSPECT", metadata: input.metadata ?? {} });
        contacts.set(contact.id, contact);
        return contact;
      },
      async list(scope) { return { items: [...contacts.values()].filter((c) => c.tenantId === scope.tenantId) }; },
    },
    marketplaceCaptures: {
      async findByListingUrl(scope, listingUrl) { return [...captures.values()].find((c) => c.tenantId === scope.tenantId && c.listingUrl === listingUrl) ?? null; },
      async findByExternalId(scope, externalId) { return [...captures.values()].find((c) => c.tenantId === scope.tenantId && c.externalId === externalId) ?? null; },
      async findById(scope, id) { const capture = captures.get(id); return capture !== undefined && capture.tenantId === scope.tenantId ? capture : null; },
      async list(scope) { return { items: [...captures.values()].filter((c) => c.tenantId === scope.tenantId) }; },
      async create(scope, input) {
        const capture = record({ id: `capture-${captures.size + 1}`, tenantId: input.tenantId, marketplaceSourceId: input.marketplaceSourceId ?? null, contactId: input.contactId ?? null, dealId: input.dealId ?? null, externalId: input.externalId ?? null, listingUrl: input.listingUrl, title: input.title, description: input.description ?? null, price: input.price ?? null, currency: input.currency ?? null, sellerName: input.sellerName ?? null, sellerProfileUrl: input.sellerProfileUrl ?? null, status: input.status ?? "CAPTURED", capturedAt: now, metadata: input.metadata ?? {} });
        captures.set(capture.id, capture);
        return capture;
      },
      async findByDealId(scope, dealId) { return [...captures.values()].find((c) => c.tenantId === scope.tenantId && c.dealId === dealId) ?? null; },
      async update(scope, captureId, input) {
        const existing = captures.get(captureId);
        assert.ok(existing, "capture must exist");
        const updated = { ...existing, ...input, updatedAt: now };
        captures.set(captureId, updated);
        return updated;
      },
    },
    draftInventories: {
      async create(scope, input) {
        const draft = record({ id: `draft-${draftInventories.size + 1}`, tenantId: input.tenantId, marketplaceCaptureId: input.marketplaceCaptureId, contactId: input.contactId ?? null, dealId: input.dealId ?? null, title: input.title, description: input.description ?? null, price: input.price ?? null, currency: input.currency ?? null, category: input.category ?? null, images: input.images ?? null, listingUrl: input.listingUrl ?? null, marketplaceSource: input.marketplaceSource ?? null, marketplaceListingId: input.marketplaceListingId ?? null, status: input.status ?? "DRAFT" });
        draftInventories.set(`${scope.tenantId}:${input.marketplaceCaptureId}`, draft);
        return draft;
      },
      async findByMarketplaceCaptureId(scope, marketplaceCaptureId) { return draftInventories.get(`${scope.tenantId}:${marketplaceCaptureId}`) ?? null; },
      async findByMarketplaceListing() { return null; },
      async upsertForCapture(scope, input) {
        const existing = draftInventories.get(`${scope.tenantId}:${input.marketplaceCaptureId}`);
        if (existing) return existing;
        return this.create(scope, input);
      },
      async update(scope, draftInventoryId, input) {
        const entry = [...draftInventories.entries()].find(([, d]) => d.tenantId === scope.tenantId && d.id === draftInventoryId);
        assert.ok(entry, "draft inventory must exist");
        const updated = { ...entry[1], ...input, updatedAt: now };
        draftInventories.set(entry[0], updated);
        return updated;
      },
    },
    deals: {
      async findByExternalId(workspaceId, externalId) { return deals.get(`${workspaceId}:${externalId}`) ?? null; },
      async findById(workspaceId, dealId) { return [...deals.values()].find((d) => d.tenantId === workspaceId && d.id === dealId) ?? null; },
      async updateStage(workspaceId, dealId, stageId) {
        const entry = [...deals.entries()].find(([, d]) => d.tenantId === workspaceId && d.id === dealId);
        const updated = { ...entry[1], pipelineStageId: stageId, updatedAt: now };
        deals.set(entry[0], updated);
        return updated;
      },
      async create(workspaceId, input) {
        const deal = record({ id: `deal-${deals.size + 1}`, tenantId: workspaceId, contactId: input.contactId ?? null, pipelineId: "pipeline-market", pipelineStageId: input.pipelineStageId, ownerId: input.ownerId ?? null, externalId: input.externalId ?? null, title: input.title, value: input.value ?? null, currency: input.currency ?? "USD", probability: null, closedAt: null, metadata: input.metadata ?? {} });
        deals.set(`${workspaceId}:${input.externalId}`, deal);
        return deal;
      },
    },
    activities: {
      async create(scope, input) {
        const activity = record({ id: `activity-${activities.length + 1}`, tenantId: input.tenantId, contactId: input.contactId ?? null, dealId: input.dealId ?? null, createdById: input.createdById, type: input.type, note: input.note, occurredAt: now, metadata: input.metadata ?? {} });
        activities.push(activity);
        return activity;
      },
    },
    auditLogs: {
      async append(scope, input) {
        const entry = record({ id: `audit-${auditLogs.length + 1}`, tenantId: scope.tenantId, actorId: input.actorId ?? null, action: input.action, targetType: input.targetType, targetId: input.targetId ?? null, correlationId: input.correlationId, requestId: input.requestId ?? null, occurredAt: now, metadata: input.metadata ?? {} });
        auditLogs.push(entry);
        return entry;
      },
      async listByTarget() { return { items: [] }; },
    },
    sellerAcquisitionCampaigns: {
      async listMembersByCapture(scope, marketplaceCaptureId) { return [...campaignMembers.values()].filter((m) => m.tenantId === scope.tenantId && m.marketplaceCaptureId === marketplaceCaptureId && m.status !== "REMOVED"); },
      async updateMember(scope, memberId, input) {
        const existing = campaignMembers.get(memberId);
        const updated = { ...existing, ...input, updatedAt: now };
        campaignMembers.set(memberId, updated);
        return updated;
      },
      async addSeller(scope, input) {
        const member = record({ id: `member-${campaignMembers.size + 1}`, tenantId: scope.tenantId, campaignId: input.campaignId, marketplaceCaptureId: input.marketplaceCaptureId, contactId: input.contactId ?? null, dealId: input.dealId ?? null, status: input.status ?? "ADDED", assignedAt: now, metadata: input.metadata ?? {} });
        campaignMembers.set(member.id, member);
        return member;
      },
      async findById(scope, id) { return { id, tenantId: scope.tenantId, status: "ACTIVE" }; },
      async findMemberByCapture(scope, campaignId, marketplaceCaptureId) {
        return [...campaignMembers.values()].find((m) => m.tenantId === scope.tenantId && m.campaignId === campaignId && m.marketplaceCaptureId === marketplaceCaptureId) ?? null;
      },
    },
  };
};

const context = { tenantId: "tenant-a", actorId: "user-a", correlation: { correlationId: "corr-usage" } };

const qualifiedInput = (overrides = {}) => ({
  tenantId: "tenant-a",
  listingUrl: "https://market.example/listings/qualified-seller",
  title: "Toyota Corolla",
  sellerName: "Ama Seller",
  sellerPhone: "+233555000111",
  ...overrides,
});

test("manual/URL capture that is qualified on first pass records SELLER_QUALIFIED once", async () => {
  const usageMetering = new SpyUsageMetering();
  const repositories = createRepositories();
  const services = createWhispeRMServices({ ...repositories, usageMetering });

  const result = await services.marketplaceAcquisition.capture(context, qualifiedInput());

  assert.equal(result.qualificationStatus, "QUALIFIED");
  const qualified = usageMetering.events.filter((event) => event.input.eventType === "SELLER_QUALIFIED");
  assert.equal(qualified.length, 1);
  assert.equal(qualified[0].input.captureId, result.captureId);
});

test("unqualified capture (no phone) does not record SELLER_QUALIFIED", async () => {
  const usageMetering = new SpyUsageMetering();
  const repositories = createRepositories();
  const services = createWhispeRMServices({ ...repositories, usageMetering });

  const result = await services.marketplaceAcquisition.capture(context, qualifiedInput({ sellerPhone: undefined, phone: undefined }));

  assert.equal(result.qualificationStatus, "UNQUALIFIED");
  assert.equal(usageMetering.events.filter((event) => event.input.eventType === "SELLER_QUALIFIED").length, 0);
});

test("re-capturing the same qualified listing does not double-count SELLER_QUALIFIED", async () => {
  const usageMetering = new SpyUsageMetering();
  const repositories = createRepositories();
  const services = createWhispeRMServices({ ...repositories, usageMetering });

  await services.marketplaceAcquisition.capture(context, qualifiedInput());
  await services.marketplaceAcquisition.capture(context, qualifiedInput());
  await services.marketplaceAcquisition.capture(context, qualifiedInput());

  const qualified = usageMetering.events.filter((event) => event.input.eventType === "SELLER_QUALIFIED");
  assert.equal(qualified.length, 1, "retrying capture for the same listing must reuse the idempotency key");
});

test("requalification after phone enrichment records SELLER_QUALIFIED exactly once", async () => {
  const usageMetering = new SpyUsageMetering();
  const repositories = createRepositories();
  const services = createWhispeRMServices({ ...repositories, usageMetering });
  const requalification = new MarketplaceRequalificationService({
    marketplaceCaptures: repositories.marketplaceCaptures,
    canonicalCapture: services.marketplaceAcquisition,
    auditLogs: repositories.auditLogs,
  });

  const unqualified = await services.marketplaceAcquisition.capture(context, qualifiedInput({ sellerPhone: undefined, phone: undefined }));
  assert.equal(unqualified.qualificationStatus, "UNQUALIFIED");
  assert.equal(usageMetering.events.filter((event) => event.input.eventType === "SELLER_QUALIFIED").length, 0);

  await repositories.marketplaceCaptures.update({ tenantId: "tenant-a" }, unqualified.captureId, {
    metadata: { ...repositories.capturesById.get(unqualified.captureId).metadata, sellerPhone: "+233555000111" },
  });

  const first = await requalification.requalifyMarketplaceCapture(context, unqualified.captureId);
  assert.equal(first.qualificationStatus, "QUALIFIED");
  assert.equal(usageMetering.events.filter((event) => event.input.eventType === "SELLER_QUALIFIED").length, 1);

  // Repeated requalification (e.g. a retried edit request) must not duplicate SELLER_QUALIFIED.
  const second = await requalification.requalifyMarketplaceCapture(context, unqualified.captureId);
  assert.equal(second.qualificationStatus, "QUALIFIED");
  assert.equal(usageMetering.events.filter((event) => event.input.eventType === "SELLER_QUALIFIED").length, 1);
});

test("discovery promotion through the canonical pipeline records SELLER_QUALIFIED once", async () => {
  const usageMetering = new SpyUsageMetering();
  const repositories = createRepositories();
  const services = createWhispeRMServices({ ...repositories, usageMetering });

  class MemoryDiscoveryRepo {
    sellers = [{
      id: "seller-1",
      tenantId: "tenant-a",
      discoveryRunId: "run-1",
      campaignId: "campaign-1",
      marketplaceSourceId: "source-1",
      status: "QUALIFIED",
      sellerName: "Ama Seller",
      phone: "+233555000111",
      listingUrl: "https://jiji.com.gh/cars/listing-1",
      title: "Clean Toyota Corolla",
    }];
    async findDiscoveredSellerById(ctx, sellerId) { return this.sellers.find((s) => s.tenantId === ctx.tenantId && s.id === sellerId) ?? null; }
    async updateDiscoveredSellerStatus(ctx, sellerId, status, extra = {}) {
      const index = this.sellers.findIndex((s) => s.tenantId === ctx.tenantId && s.id === sellerId);
      this.sellers[index] = { ...this.sellers[index], status, ...extra };
      return this.sellers[index];
    }
  }

  repositories.sellerAcquisitionCampaigns.campaigns = [{ id: "campaign-1", tenantId: "tenant-a", status: "ACTIVE" }];
  repositories.sellerAcquisitionCampaigns.findById = async (scope, id) => repositories.sellerAcquisitionCampaigns.campaigns.find((c) => c.tenantId === scope.tenantId && c.id === id) ?? null;

  const discovery = new MarketplaceDiscoveryService({
    discoveryRepo: new MemoryDiscoveryRepo(),
    canonicalCapture: services.marketplaceAcquisition,
    campaigns: repositories.sellerAcquisitionCampaigns,
  });

  const result = await discovery.promoteSellerToCapture({ tenantId: "tenant-a", actorId: "user-a" }, "campaign-1", "seller-1");

  assert.equal(result.qualificationStatus, "QUALIFIED");
  const qualified = usageMetering.events.filter((event) => event.input.eventType === "SELLER_QUALIFIED");
  assert.equal(qualified.length, 1);
  assert.equal(qualified[0].input.captureId, result.marketplaceCaptureId);

  // Re-promoting the already-promoted seller must not duplicate SELLER_QUALIFIED.
  await discovery.promoteSellerToCapture({ tenantId: "tenant-a", actorId: "user-a" }, "campaign-1", "seller-1");
  assert.equal(usageMetering.events.filter((event) => event.input.eventType === "SELLER_QUALIFIED").length, 1);
});
