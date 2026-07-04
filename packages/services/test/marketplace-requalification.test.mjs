import assert from "node:assert/strict";
import test from "node:test";

import { createWhispeRMServices, MARKETPLACE_ACQUISITION_PIPELINE_KEY, MarketplaceRequalificationService } from "../dist/index.js";

const now = "2026-06-11T00:00:00.000Z";
const context = { tenantId: "tenant-a", actorId: "user-a", correlation: { correlationId: "corr-requal" } };

const record = (base) => ({ createdAt: now, updatedAt: now, ...base });

// Mirrors the in-memory harness in marketplace-capture-deal-creation.test.mjs so requalification
// is exercised against the same real MarketplaceAcquisitionCaptureService.capture pipeline
// (ST1-004 qualification + ST1-005/ST1-006 capture-time CRM conversion) rather than a fake.
const createRepositories = () => {
  const calls = [];
  const contacts = new Map();
  const captures = new Map();
  const deals = new Map();
  const draftInventories = new Map();
  const activities = [];
  const auditLogs = [];
  const campaignMembers = new Map();
  const push = (repo, method, args) => calls.push({ repo, method, args });

  return {
    calls,
    contactsById: contacts,
    capturesById: captures,
    dealsByExternalId: deals,
    auditLogRows: auditLogs,
    campaignMembersById: campaignMembers,
    pipelines: {
      async findByWorkspace() { return null; },
      async findByDefaultKey(workspaceId, defaultKey) {
        if (workspaceId !== "tenant-a" || defaultKey !== MARKETPLACE_ACQUISITION_PIPELINE_KEY) return null;
        return record({
          id: "pipeline-market", tenantId: workspaceId, name: "Marketplace Acquisition", isDefault: false, defaultKey,
          stages: [
            record({ id: "stage-captured", tenantId: workspaceId, pipelineId: "pipeline-market", name: "Captured", position: 1, color: "#64748B" }),
          ],
        });
      },
    },
    contacts: {
      async findById(scope, id) { return contacts.get(id) ?? null; },
      async findByPhone(scope, phone) {
        return [...contacts.values()].find((c) => c.tenantId === scope.tenantId && c.phone === phone) ?? null;
      },
      async findByEmails(scope, emails) {
        return [...contacts.values()].filter((c) => c.tenantId === scope.tenantId && emails.includes(c.email));
      },
      async create(scope, input) {
        push("contacts", "create", [scope, input]);
        const contact = record({ id: `contact-${contacts.size + 1}`, tenantId: input.tenantId, externalId: null, email: input.email ?? null, phone: input.phone ?? null, firstName: input.firstName ?? null, lastName: null, stage: "PROSPECT", metadata: input.metadata ?? {} });
        contacts.set(contact.id, contact);
        return contact;
      },
      async list(scope) { return { items: [...contacts.values()].filter((c) => c.tenantId === scope.tenantId) }; },
    },
    marketplaceCaptures: {
      async findByListingUrl(scope, listingUrl) {
        return [...captures.values()].find((c) => c.tenantId === scope.tenantId && c.listingUrl === listingUrl) ?? null;
      },
      async findByExternalId(scope, externalId) {
        return [...captures.values()].find((c) => c.tenantId === scope.tenantId && c.externalId === externalId) ?? null;
      },
      async findById(scope, id) {
        const capture = captures.get(id);
        return capture !== undefined && capture.tenantId === scope.tenantId ? capture : null;
      },
      async list(scope) { return { items: [...captures.values()].filter((c) => c.tenantId === scope.tenantId) }; },
      async create(scope, input) {
        push("marketplaceCaptures", "create", [scope, input]);
        const capture = record({ id: `capture-${captures.size + 1}`, tenantId: input.tenantId, marketplaceSourceId: input.marketplaceSourceId ?? null, contactId: input.contactId ?? null, dealId: input.dealId ?? null, externalId: input.externalId ?? null, listingUrl: input.listingUrl, title: input.title, description: input.description ?? null, price: input.price ?? null, currency: input.currency ?? null, sellerName: input.sellerName ?? null, sellerProfileUrl: input.sellerProfileUrl ?? null, status: input.status ?? "CAPTURED", capturedAt: now, metadata: input.metadata ?? {} });
        captures.set(capture.id, capture);
        return capture;
      },
      async findByDealId(scope, dealId) {
        return [...captures.values()].find((c) => c.tenantId === scope.tenantId && c.dealId === dealId) ?? null;
      },
      async update(scope, captureId, input) {
        push("marketplaceCaptures", "update", [scope, captureId, input]);
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
      async findByMarketplaceCaptureId(scope, marketplaceCaptureId) {
        return draftInventories.get(`${scope.tenantId}:${marketplaceCaptureId}`) ?? null;
      },
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
        push("deals", "create", [workspaceId, input]);
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
      async listMembersByCapture(scope, marketplaceCaptureId) {
        return [...campaignMembers.values()].filter((m) => m.tenantId === scope.tenantId && m.marketplaceCaptureId === marketplaceCaptureId && m.status !== "REMOVED");
      },
      async updateMember(scope, memberId, input) {
        push("sellerAcquisitionCampaigns", "updateMember", [scope, memberId, input]);
        const existing = campaignMembers.get(memberId);
        assert.ok(existing, "campaign member must exist");
        const updated = { ...existing, ...input, updatedAt: now };
        campaignMembers.set(memberId, updated);
        return updated;
      },
      async addSeller(scope, input) {
        const member = record({ id: `member-${campaignMembers.size + 1}`, tenantId: scope.tenantId, campaignId: input.campaignId, marketplaceCaptureId: input.marketplaceCaptureId, contactId: input.contactId ?? null, dealId: input.dealId ?? null, status: input.status ?? "ADDED", assignedAt: now, metadata: input.metadata ?? {} });
        campaignMembers.set(member.id, member);
        return member;
      },
    },
  };
};

const seedUnqualifiedCapture = async (services, repositories) => {
  const result = await services.marketplaceAcquisition.capture(context, {
    tenantId: "tenant-a",
    listingUrl: "https://market.example/listings/needs-qualification",
    title: "Vintage bicycle",
    description: "One careful owner",
    sellerName: "Alex Seller",
  });
  assert.equal(result.qualificationStatus, "UNQUALIFIED");
  assert.equal(result.contactId, undefined);
  return result.captureId;
};

test("requalification succeeds after phone is added: contact and deal are created once", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);
  const requalification = new MarketplaceRequalificationService({
    marketplaceCaptures: repositories.marketplaceCaptures,
    canonicalCapture: services.marketplaceAcquisition,
    auditLogs: repositories.auditLogs,
    sellerAcquisitionCampaigns: repositories.sellerAcquisitionCampaigns,
  });

  const captureId = await seedUnqualifiedCapture(services, repositories);

  // Seller enrichment: phone is written into capture.metadata (as SellerAcquisitionEditService does).
  await repositories.marketplaceCaptures.update({ tenantId: "tenant-a" }, captureId, {
    metadata: { ...repositories.capturesById.get(captureId).metadata, sellerPhone: "+233555000111" },
  });

  const result = await requalification.requalifyMarketplaceCapture(context, captureId);

  assert.equal(result.qualificationStatus, "QUALIFIED");
  assert.equal(result.crmConversionStatus, "CREATED");
  assert.equal(result.requalified, true);
  assert.equal(result.invitationEligible, true);
  assert.equal(typeof result.contactId, "string");
  assert.equal(typeof result.dealId, "string");

  assert.equal(repositories.contactsById.size, 1);
  assert.equal(repositories.dealsByExternalId.size, 1);

  const capture = repositories.capturesById.get(captureId);
  assert.equal(capture.contactId, result.contactId);
  assert.equal(capture.dealId, result.dealId);
});

test("repeated requalification is idempotent: no duplicate contact, deal, or audit noise", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);
  const requalification = new MarketplaceRequalificationService({
    marketplaceCaptures: repositories.marketplaceCaptures,
    canonicalCapture: services.marketplaceAcquisition,
    auditLogs: repositories.auditLogs,
  });

  const captureId = await seedUnqualifiedCapture(services, repositories);
  await repositories.marketplaceCaptures.update({ tenantId: "tenant-a" }, captureId, {
    metadata: { ...repositories.capturesById.get(captureId).metadata, sellerPhone: "+233555000111" },
  });

  const first = await requalification.requalifyMarketplaceCapture(context, captureId);
  const second = await requalification.requalifyMarketplaceCapture(context, captureId);

  assert.equal(first.requalified, true);
  assert.equal(second.requalified, false);
  assert.equal(second.qualificationStatus, "QUALIFIED");
  assert.equal(second.crmConversionStatus, "EXISTING");
  assert.equal(second.contactId, first.contactId);
  assert.equal(second.dealId, first.dealId);

  assert.equal(repositories.contactsById.size, 1);
  assert.equal(repositories.dealsByExternalId.size, 1);
  const requalifiedAudits = repositories.auditLogRows.filter((entry) => entry.action === "MARKETPLACE_CAPTURE_REQUALIFIED");
  assert.equal(requalifiedAudits.length, 2, "one requalification audit event per call");
});

test("requalification without a phone leaves the capture unqualified", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);
  const requalification = new MarketplaceRequalificationService({
    marketplaceCaptures: repositories.marketplaceCaptures,
    canonicalCapture: services.marketplaceAcquisition,
    auditLogs: repositories.auditLogs,
  });

  const captureId = await seedUnqualifiedCapture(services, repositories);
  const result = await requalification.requalifyMarketplaceCapture(context, captureId);

  assert.equal(result.qualificationStatus, "UNQUALIFIED");
  assert.equal(result.crmConversionStatus, "NOT_ELIGIBLE");
  assert.equal(result.requalified, false);
  assert.equal(result.invitationEligible, false);
  assert.equal(repositories.contactsById.size, 0);
  assert.equal(repositories.dealsByExternalId.size, 0);
});

test("existing campaign membership is refreshed, not recreated, on requalification", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);
  const requalification = new MarketplaceRequalificationService({
    marketplaceCaptures: repositories.marketplaceCaptures,
    canonicalCapture: services.marketplaceAcquisition,
    auditLogs: repositories.auditLogs,
    sellerAcquisitionCampaigns: repositories.sellerAcquisitionCampaigns,
  });

  const captureId = await seedUnqualifiedCapture(services, repositories);
  const member = await repositories.sellerAcquisitionCampaigns.addSeller({ tenantId: "tenant-a" }, { campaignId: "campaign-1", marketplaceCaptureId: captureId });
  assert.equal(member.status, "ADDED");
  assert.equal(member.contactId, null);

  await repositories.marketplaceCaptures.update({ tenantId: "tenant-a" }, captureId, {
    metadata: { ...repositories.capturesById.get(captureId).metadata, sellerPhone: "+233555000111" },
  });

  const result = await requalification.requalifyMarketplaceCapture(context, captureId);

  assert.equal(repositories.campaignMembersById.size, 1, "no new campaign member should be created");
  const refreshed = repositories.campaignMembersById.get(member.id);
  assert.equal(refreshed.status, "QUALIFIED");
  assert.equal(refreshed.contactId, result.contactId);
  assert.equal(refreshed.dealId, result.dealId);
});

test("tenant isolation: requalifying a capture id from another tenant is rejected", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);
  const requalification = new MarketplaceRequalificationService({
    marketplaceCaptures: repositories.marketplaceCaptures,
    canonicalCapture: services.marketplaceAcquisition,
    auditLogs: repositories.auditLogs,
  });

  const captureId = await seedUnqualifiedCapture(services, repositories);

  await assert.rejects(
    () => requalification.requalifyMarketplaceCapture({ tenantId: "tenant-b", correlation: { correlationId: "corr-b" } }, captureId),
    (error) => {
      assert.equal(error.code, "CAPTURE_NOT_FOUND");
      assert.equal(error.status, 404);
      return true;
    },
  );
});

test("audit log records previous qualification, new qualification, actor, and reason", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);
  const requalification = new MarketplaceRequalificationService({
    marketplaceCaptures: repositories.marketplaceCaptures,
    canonicalCapture: services.marketplaceAcquisition,
    auditLogs: repositories.auditLogs,
  });

  const captureId = await seedUnqualifiedCapture(services, repositories);
  await repositories.marketplaceCaptures.update({ tenantId: "tenant-a" }, captureId, {
    metadata: { ...repositories.capturesById.get(captureId).metadata, sellerPhone: "+233555000111" },
  });

  await requalification.requalifyMarketplaceCapture(context, captureId);

  const entry = repositories.auditLogRows.find((row) => row.action === "MARKETPLACE_CAPTURE_REQUALIFIED");
  assert.ok(entry, "requalification audit entry must exist");
  assert.equal(entry.action, "MARKETPLACE_CAPTURE_REQUALIFIED");
  assert.equal(entry.actorId, "user-a");
  assert.equal(entry.targetId, captureId);
  assert.equal(entry.metadata.previousQualificationStatus, "UNQUALIFIED");
  assert.equal(entry.metadata.newQualificationStatus, "QUALIFIED");
  assert.equal(entry.metadata.requalified, true);
  assert.equal(entry.metadata.reason, "SELLER_ENRICHMENT");
});
