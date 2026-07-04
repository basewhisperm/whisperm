import assert from "node:assert/strict";
import test from "node:test";

import { CampaignRuntimeService, CrmConversionRuntimeService, MarketplaceDiscoveryService } from "@whisperm/services";

const now = "2026-07-01T00:00:00.000Z";

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

// ---------------------------------------------------------------------------
// Discovery success records SELLER_DISCOVERED
// ---------------------------------------------------------------------------

class MemoryDiscoveryRepo {
  runs = [];
  sellers = [];
  nextRun = 1;
  nextSeller = 1;
  async createDiscoveryRun(ctx, input) {
    const run = { id: `run-${this.nextRun++}`, status: "PENDING", sellersFound: 0, sellersQualified: 0, sellersRejected: 0, sellersDuplicate: 0, metadata: {}, createdAt: now, updatedAt: now, ...input };
    this.runs.push(run);
    return run;
  }
  async updateDiscoveryRun(ctx, runId, input) {
    const index = this.runs.findIndex((run) => run.tenantId === ctx.tenantId && run.id === runId);
    this.runs[index] = { ...this.runs[index], ...input, updatedAt: now };
    return this.runs[index];
  }
  async createDiscoveredSeller(ctx, input) {
    const row = { id: `seller-${this.nextSeller++}`, qualificationScore: 0, status: "PENDING", createdAt: now, updatedAt: now, ...input };
    this.sellers.push(row);
    return row;
  }
  async updateDiscoveredSellerStatus(ctx, sellerId, status, extra = {}) {
    const index = this.sellers.findIndex((seller) => seller.tenantId === ctx.tenantId && seller.id === sellerId);
    this.sellers[index] = { ...this.sellers[index], status, ...extra, updatedAt: now };
    return this.sellers[index];
  }
  async findDiscoveredSellerByListingUrl(ctx, runId, listingUrl) { return this.sellers.find((seller) => seller.tenantId === ctx.tenantId && seller.discoveryRunId === runId && seller.listingUrl === listingUrl) ?? null; }
  async findDiscoveredSellerByIdentityKey() { return null; }
}

const discoveryEntry = (overrides = {}) => ({
  listingUrl: "https://jiji.com.gh/cars/listing-1",
  marketplaceSourceKey: "JIJI",
  sellerName: "Ama Seller",
  sellerProfileUrl: "https://jiji.com.gh/seller/ama",
  phone: "+233555000000",
  title: "Clean Toyota Corolla",
  category: "Cars",
  price: "10000",
  location: "Accra",
  images: ["https://cdn.example/image.jpg"],
  ...overrides,
});

const discoveryRunInput = (entries, overrides = {}) => ({
  campaignId: "campaign-1",
  marketplaceSourceId: "source-1",
  marketplaceSourceKey: "JIJI",
  mode: "MANUAL_SEED",
  entries,
  discoveryCreditsRemaining: 50,
  ...overrides,
});

test("discovery success records SELLER_DISCOVERED", async () => {
  const usageMetering = new SpyUsageMetering();
  const repo = new MemoryDiscoveryRepo();
  const service = new MarketplaceDiscoveryService({ discoveryRepo: repo, usageMetering });

  await service.runDiscovery({ tenantId: "tenant-1", actorId: "actor-1" }, discoveryRunInput([discoveryEntry()]));

  const discovered = usageMetering.events.filter((event) => event.input.eventType === "SELLER_DISCOVERED");
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].scope.tenantId, "tenant-1");
  assert.equal(discovered[0].input.campaignId, "campaign-1");
});

test("retried discovery of the same listing does not double-count SELLER_DISCOVERED", async () => {
  const usageMetering = new SpyUsageMetering();
  const repo = new MemoryDiscoveryRepo();
  const service = new MarketplaceDiscoveryService({ discoveryRepo: repo, usageMetering });
  const context = { tenantId: "tenant-1", actorId: "actor-1" };

  await service.runDiscovery(context, discoveryRunInput([discoveryEntry()]));
  await service.runDiscovery(context, discoveryRunInput([discoveryEntry()]));

  const discovered = usageMetering.events.filter((event) => event.input.eventType === "SELLER_DISCOVERED");
  assert.equal(discovered.length, 1, "retrying discovery for the same listing must reuse the idempotency key");
});

// ---------------------------------------------------------------------------
// Invitation success records INVITATION_SENT (and retries do not double-count)
// ---------------------------------------------------------------------------

class MemoryCampaigns {
  constructor(campaigns) { this.campaigns = campaigns; }
  async findById(context, id) { return this.campaigns.find((row) => row.tenantId === context.tenantId && row.id === id) ?? null; }
  async update(context, id, input) {
    const row = await this.findById(context, id);
    Object.assign(row, input, { updatedAt: now });
    return row;
  }
}

class MemoryExecutions {
  rows = [];
  next = 1;
  async create(context, input) {
    const row = { id: `execution-${this.next++}`, tenantId: context.tenantId, status: "QUEUED", metrics: {}, createdAt: now, updatedAt: now, ...input };
    this.rows.push(row);
    return row;
  }
  async findById(context, id) { return this.rows.find((row) => row.tenantId === context.tenantId && row.id === id) ?? null; }
  async update(context, id, input) {
    const index = this.rows.findIndex((row) => row.tenantId === context.tenantId && row.id === id);
    this.rows[index] = { ...this.rows[index], ...input, updatedAt: now };
    return this.rows[index];
  }
}

const campaign = (overrides = {}) => ({ id: "campaign-1", tenantId: "tenant-1", name: "Growth", status: "ACTIVE", metadata: {}, createdAt: now, updatedAt: now, ...overrides });

test("invitation success records INVITATION_SENT", async () => {
  const usageMetering = new SpyUsageMetering();
  const executions = new MemoryExecutions();
  const service = new CampaignRuntimeService({ campaigns: new MemoryCampaigns([campaign()]), executions, usageMetering });
  const created = await executions.create({ tenantId: "tenant-1" }, { tenantId: "tenant-1", campaignId: "campaign-1", trigger: "MANUAL", status: "RUNNING", metrics: { invitationExecutionState: "DISPATCHED", opportunityId: "capture-1" } });

  await service.recordInvitationResult({ tenantId: "tenant-1" }, { executionId: created.id, opportunityId: "capture-1", invitationId: "invite-1", status: "SENT", channel: "WHATSAPP", provider: "WHATSAPP" });

  const sent = usageMetering.events.filter((event) => event.input.eventType === "INVITATION_SENT");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].input.captureId, "capture-1");
  assert.equal(sent[0].input.runtimeExecutionId, created.id);
});

test("retried invitation completion does not double-count INVITATION_SENT", async () => {
  const usageMetering = new SpyUsageMetering();
  const executions = new MemoryExecutions();
  const service = new CampaignRuntimeService({ campaigns: new MemoryCampaigns([campaign()]), executions, usageMetering });
  const created = await executions.create({ tenantId: "tenant-1" }, { tenantId: "tenant-1", campaignId: "campaign-1", trigger: "MANUAL", status: "RUNNING", metrics: { invitationExecutionState: "DISPATCHED", opportunityId: "capture-1" } });

  const input = { executionId: created.id, opportunityId: "capture-1", invitationId: "invite-1", status: "SENT", channel: "WHATSAPP", provider: "WHATSAPP" };
  await service.recordInvitationResult({ tenantId: "tenant-1" }, input);
  await service.recordInvitationResult({ tenantId: "tenant-1" }, input);
  await service.recordInvitationResult({ tenantId: "tenant-1" }, input);

  const sent = usageMetering.events.filter((event) => event.input.eventType === "INVITATION_SENT");
  assert.equal(sent.length, 1, "a duplicate provider webhook replaying the same executionId must not double-count");
});

test("failed invitation delivery does not record INVITATION_SENT", async () => {
  const usageMetering = new SpyUsageMetering();
  const executions = new MemoryExecutions();
  const service = new CampaignRuntimeService({ campaigns: new MemoryCampaigns([campaign()]), executions, usageMetering });
  const created = await executions.create({ tenantId: "tenant-1" }, { tenantId: "tenant-1", campaignId: "campaign-1", trigger: "MANUAL", status: "RUNNING", metrics: { invitationExecutionState: "DISPATCHED", opportunityId: "capture-1" } });

  await service.recordInvitationResult({ tenantId: "tenant-1" }, { executionId: created.id, opportunityId: "capture-1", status: "FAILED", channel: "SMS", retryable: false });

  assert.equal(usageMetering.events.filter((event) => event.input.eventType === "INVITATION_SENT").length, 0);
});

// ---------------------------------------------------------------------------
// CRM conversion success records CRM_CONVERSION_CREATED
// ---------------------------------------------------------------------------

function makeCaptureState() {
  return {
    capture: { id: "capture-1", tenantId: "tenant-1", contactId: null, dealId: null, listingUrl: "https://market.test/1", title: "Bike", description: "Nice bike", price: "100", currency: "USD", sellerName: "Sam Seller", status: "CLAIMED", capturedAt: now, metadata: { sellerPhone: "+15555550123", sellerEmail: "sam@example.com" }, createdAt: now, updatedAt: now },
    draft: { id: "draft-1", tenantId: "tenant-1", marketplaceCaptureId: "capture-1", contactId: null, dealId: null, title: "Bike", description: "Nice bike", price: "100", currency: "USD", category: "Bikes", images: [], listingUrl: "https://market.test/1", marketplaceSource: "market", status: "CLAIMED", createdAt: now, updatedAt: now },
    contacts: [],
    deals: [],
    opportunities: [],
  };
}

function makeCrmService(usageMetering) {
  const state = makeCaptureState();
  const service = new CrmConversionRuntimeService({
    clock: () => new Date(now),
    marketplaceCaptures: { async findById(ctx, id) { return id === state.capture.id ? state.capture : null; }, async update(ctx, id, input) { state.capture = { ...state.capture, ...input, metadata: { ...(state.capture.metadata ?? {}), ...(input.metadata ?? {}) } }; return state.capture; } },
    draftInventories: { async findByMarketplaceCaptureId(ctx, id) { return id === state.capture.id ? state.draft : null; } },
    claimTokens: { async listClaimTokensByMarketplaceCaptureId() { return []; } },
    contacts: {
      async findByPhone(ctx, phone) { return state.contacts.find((contact) => contact.phone === phone) ?? null; },
      async findByEmails(ctx, emails) { return state.contacts.filter((contact) => emails.includes(contact.email)); },
      async create(ctx, input) { const contact = { id: `contact-${state.contacts.length + 1}`, ...input, createdAt: now, updatedAt: now }; state.contacts.push(contact); return contact; },
    },
    pipelines: { async findByDefaultKey(tenantId, key) { return { id: "pipeline-1", tenantId, name: "Marketplace Acquisition", isDefault: true, defaultKey: key, stages: [{ id: "stage-claimed", tenantId, pipelineId: "pipeline-1", name: "Claimed", position: 1, createdAt: now, updatedAt: now }] }; }, async findByWorkspace() { return null; } },
    deals: { async findByExternalId(tenantId, externalId) { return state.deals.find((deal) => deal.externalId === externalId) ?? null; }, async create(tenantId, input) { const deal = { id: `deal-${state.deals.length + 1}`, pipelineId: "pipeline-1", ...input, createdAt: now, updatedAt: now }; state.deals.push(deal); return deal; } },
    businessGrowthOpportunities: {
      async createOrUpdateFromMarketplaceCapture(ctx, input) { const existing = state.opportunities.find((opportunity) => opportunity.marketplaceCaptureId === input.marketplaceCaptureId); if (existing) return Object.assign(existing, input, { updatedAt: now }); const opportunity = { id: `opp-${state.opportunities.length + 1}`, campaignId: "campaign-1", ...input, status: input.status ?? "CLAIMED", createdAt: now, updatedAt: now }; state.opportunities.push(opportunity); return opportunity; },
      async linkContact(ctx, id, contactId) { const opportunity = state.opportunities.find((item) => item.id === id); opportunity.contactId = contactId; return opportunity; },
      async linkDeal(ctx, id, dealId) { const opportunity = state.opportunities.find((item) => item.id === id); opportunity.dealId = dealId; return opportunity; },
      async updateConversionStatus(ctx, id, status) { const opportunity = state.opportunities.find((item) => item.id === id); opportunity.status = status; return opportunity; },
    },
    auditLogs: { async append() { return { id: "audit-1", createdAt: now }; } },
    activities: { async create(ctx, input) { return { id: "activity-1", ...input, createdAt: now, updatedAt: now }; } },
    usageMetering,
  });
  return { service, state };
}

const crmContext = { tenantId: "tenant-1", correlation: { correlationId: "corr-crm" } };

test("CRM conversion success records CRM_CONVERSION_CREATED", async () => {
  const usageMetering = new SpyUsageMetering();
  const { service } = makeCrmService(usageMetering);

  const result = await service.executeConversion(crmContext, { tenantId: "tenant-1", claimTokenId: "token-1", marketplaceCaptureId: "capture-1" });

  assert.equal(result.status, "CONVERTED");
  const created = usageMetering.events.filter((event) => event.input.eventType === "CRM_CONVERSION_CREATED");
  assert.equal(created.length, 1);
  assert.equal(created[0].input.dealId, result.dealId);
});

test("retried CRM conversion does not double-count CRM_CONVERSION_CREATED", async () => {
  const usageMetering = new SpyUsageMetering();
  const { service } = makeCrmService(usageMetering);

  await service.executeConversion(crmContext, { tenantId: "tenant-1", claimTokenId: "token-1", marketplaceCaptureId: "capture-1" });
  await service.executeConversion(crmContext, { tenantId: "tenant-1", claimTokenId: "token-1", marketplaceCaptureId: "capture-1" });

  const created = usageMetering.events.filter((event) => event.input.eventType === "CRM_CONVERSION_CREATED");
  assert.equal(created.length, 1);
});

// ---------------------------------------------------------------------------
// Growth recommendation apply records GROWTH_RECOMMENDATION_APPLIED
// ---------------------------------------------------------------------------

class GrowthMemoryCampaigns {
  constructor(campaigns, members = []) { this.campaigns = campaigns; this.members = members; }
  async findById(context, id) { return this.campaigns.find((row) => row.tenantId === context.tenantId && row.id === id) ?? null; }
  async update(context, id, input) {
    const row = await this.findById(context, id);
    Object.assign(row, input, { updatedAt: now });
    return row;
  }
  async listMembers(context, campaignId) { return { items: this.members.filter((member) => member.tenantId === context.tenantId && member.campaignId === campaignId) }; }
}

const growthCampaign = (overrides = {}) => ({
  id: "campaign-1",
  tenantId: "tenant-1",
  name: "Growth",
  status: "ACTIVE",
  currency: "GHS",
  metadata: { targeting: { marketplaceSourceKey: "JIJI", keyword: "bikes", executionLimit: 20, exclusionTerms: [] } },
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const growthMember = (overrides = {}) => ({ id: `member-${Math.random()}`, tenantId: "tenant-1", campaignId: "campaign-1", marketplaceCaptureId: `capture-${Math.random()}`, status: "ADDED", dealId: null, ...overrides });
const growthDeal = (overrides = {}) => ({ id: `deal-${Math.random()}`, tenantId: "tenant-1", value: 0, currency: "GHS", closedAt: null, ...overrides });

test("growth recommendation apply records GROWTH_RECOMMENDATION_APPLIED", async () => {
  const usageMetering = new SpyUsageMetering();
  const wonDeals = [growthDeal({ id: "deal-1", value: 2500, closedAt: now }), growthDeal({ id: "deal-2", value: 2500, closedAt: now })];
  const members = Array.from({ length: 8 }, (_, index) => growthMember({ id: `m${index}`, status: index < 4 ? "CONVERTED" : "CLAIMED", dealId: index === 0 ? "deal-1" : index === 1 ? "deal-2" : null }));
  const campaignsRepo = new GrowthMemoryCampaigns([growthCampaign()], members);
  const service = new CampaignRuntimeService({
    campaigns: campaignsRepo,
    executions: { async listByCampaignId() { return { items: [] }; } },
    deals: { async findById(tenantId, dealId) { return wonDeals.find((deal) => deal.tenantId === tenantId && deal.id === dealId) ?? null; } },
    opportunities: { async findByCampaignId() { return { items: [] }; } },
    auditLogs: { async append() { return { id: "audit-1", createdAt: now }; } },
    usageMetering,
  });

  const evaluated = await service.evaluateGrowthLoop({ tenantId: "tenant-1" }, { campaignId: "campaign-1" });
  const scale = evaluated.metadata.growthRecommendations.find((item) => item.type === "SCALE_CAMPAIGN");
  assert.ok(scale, "expected a SCALE_CAMPAIGN recommendation from the seeded signals");

  await service.applyGrowthRecommendation({ tenantId: "tenant-1" }, { campaignId: "campaign-1", recommendationId: scale.id, actorId: "user-1" });

  const applied = usageMetering.events.filter((event) => event.input.eventType === "GROWTH_RECOMMENDATION_APPLIED");
  assert.equal(applied.length, 1);
  assert.equal(applied[0].input.campaignId, "campaign-1");

  const evaluatedUsage = usageMetering.events.filter((event) => event.input.eventType === "GROWTH_LOOP_EVALUATED");
  assert.equal(evaluatedUsage.length, 1, "growth loop evaluation itself should also be metered");
});
