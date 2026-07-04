import assert from "node:assert/strict";
import test from "node:test";

import { MARKETPLACE_ACQUISITION_PIPELINE_KEY } from "../dist/index.js";
import { MarketplaceCaptureCompletionError, MarketplaceCaptureCompletionService } from "../dist/marketplace-capture-completion.js";

const now = "2026-06-15T00:00:00.000Z";
const context = { tenantId: "tenant-1", actorId: "user-1", correlation: { correlationId: "corr-complete" } };

const capture = (overrides = {}) => ({
  id: "capture-1",
  tenantId: "tenant-1",
  contactId: "contact-1",
  dealId: "deal-1",
  listingUrl: "https://market.test/listing/1",
  title: "Bike",
  status: "CLAIMED",
  capturedAt: now,
  createdAt: now,
  updatedAt: now,
  metadata: {},
  ...overrides,
});

const draft = (overrides = {}) => ({
  id: "draft-1",
  tenantId: "tenant-1",
  marketplaceCaptureId: "capture-1",
  contactId: "contact-1",
  dealId: "deal-1",
  title: "Bike",
  status: "CONVERTED",
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const deal = (overrides = {}) => ({
  id: "deal-1",
  tenantId: "tenant-1",
  value: "500",
  currency: "USD",
  closedAt: null,
  updatedAt: now,
  metadata: {},
  ...overrides,
});

const conversion = (kind, overrides = {}) => ({
  id: kind === "SELLER" ? "seller-conv-1" : "inventory-conv-1",
  tenantId: "tenant-1",
  marketplaceCaptureId: "capture-1",
  contactId: "contact-1",
  externalId: kind === "INVENTORY" ? "draft-1" : null,
  renderSellerId: kind === "SELLER" ? "render-seller-1" : null,
  conversionKind: kind,
  status: "SUCCESS",
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

function setup(options = {}) {
  const state = {
    capture: options.capture ?? capture(),
    draft: options.draft === undefined ? draft() : options.draft,
    deal: options.deal === undefined ? deal() : options.deal,
    audits: [],
    activities: [],
    stageUpdates: [],
    dealUpdates: [],
    attributionCalls: [],
  };

  const revenueAttribution = options.revenueAttribution === null ? undefined : {
    async evaluateForDeal(evalContext, input) {
      state.attributionCalls.push({ evalContext, input });
      if (typeof options.revenueAttribution === "function") return options.revenueAttribution(state, input);
      if (state.deal === null || state.deal.id !== input.dealId) return { status: "NOT_ELIGIBLE", dealId: input.dealId, idempotent: true };
      return {
        status: "ATTRIBUTED",
        dealId: input.dealId,
        idempotent: false,
        snapshot: {
          idempotencyKey: `attr:${input.dealId}`,
          revenueAmount: state.deal.value === null || state.deal.value === undefined ? undefined : String(state.deal.value),
        },
      };
    },
  };

  const service = new MarketplaceCaptureCompletionService({
    clock: () => new Date(now),
    revenueAttribution,
    marketplaceCaptures: {
      async findById(scope, id) {
        assert.equal(scope.tenantId, "tenant-1");
        return id === state.capture.id ? state.capture : null;
      },
      async update(scope, id, input) {
        assert.equal(scope.tenantId, "tenant-1");
        assert.equal(id, state.capture.id);
        state.capture = { ...state.capture, ...input, updatedAt: now };
        return state.capture;
      },
    },
    draftInventories: {
      async findByMarketplaceCaptureId(scope, id) {
        assert.equal(scope.tenantId, "tenant-1");
        return state.draft !== null && id === state.capture.id ? state.draft : null;
      },
    },
    renderConversions: {
      async findSuccessfulSellerConversion() {
        return options.seller === undefined ? conversion("SELLER") : options.seller;
      },
      async findSuccessfulInventoryConversion() {
        return options.inventory === undefined ? conversion("INVENTORY") : options.inventory;
      },
    },
    pipelines: {
      async findByDefaultKey(tenantId, key) {
        assert.equal(tenantId, "tenant-1");
        assert.equal(key, MARKETPLACE_ACQUISITION_PIPELINE_KEY);
        return { id: "pipe-1", tenantId, stages: [{ id: "stage-converted", name: "Converted" }] };
      },
    },
    deals: {
      async updateStage(tenantId, dealId, stageId) {
        state.stageUpdates.push({ tenantId, dealId, stageId });
        return { id: dealId, tenantId, pipelineStageId: stageId, updatedAt: now };
      },
      async findById(tenantId, dealId) {
        assert.equal(tenantId, "tenant-1");
        return state.deal !== null && state.deal.id === dealId ? state.deal : null;
      },
      async update(tenantId, dealId, input) {
        assert.equal(tenantId, "tenant-1");
        state.dealUpdates.push({ tenantId, dealId, input });
        state.deal = { ...state.deal, ...input, updatedAt: "2026-06-15T00:00:01.000Z" };
        return state.deal;
      },
    },
    auditLogs: {
      async append(scope, input) {
        assert.equal(scope.tenantId, input.tenantId);
        state.audits.push(input);
        return { id: `audit-${state.audits.length}`, ...input, occurredAt: now };
      },
    },
    activities: {
      async create(scope, input) {
        assert.equal(scope.tenantId, input.tenantId);
        state.activities.push(input);
        return { id: `activity-${state.activities.length}`, ...input, occurredAt: now, createdAt: now, updatedAt: now };
      },
    },
  });

  return { service, state };
}

async function rejectsWithCode(fn, code) {
  await assert.rejects(fn, (error) => error instanceof MarketplaceCaptureCompletionError && error.code === code);
}

test("seller and inventory success complete claimed marketplace capture", async () => {
  const { service, state } = setup();

  const result = await service.completeCapture(context, { tenantId: "tenant-1", marketplaceCaptureId: "capture-1" });

  assert.equal(result.status, "CONVERTED");
  assert.equal(result.idempotent, false);
  assert.equal(state.capture.status, "CONVERTED");
  assert.equal(state.stageUpdates[0].stageId, "stage-converted");
  assert.equal(state.audits[0].action, "MARKETPLACE_CAPTURE_COMPLETED");
  assert.equal(state.activities.length, 1);
  assert.equal(state.activities[0].metadata.eventType, "MARKETPLACE_CAPTURE_COMPLETED");
  // ST1-008: capture completion is the canonical trigger for revenue attribution.
  assert.equal(result.revenueAttributed, true);
  assert.equal(result.dealId, "deal-1");
  assert.equal(result.attributionId, "attr:deal-1");
  assert.equal(result.attributedAmount, "500");
  assert.equal(state.dealUpdates.length, 1);
  assert.equal(state.dealUpdates[0].input.closedAt, now);
  assert.equal(state.audits[0].metadata.revenueAttributed, true);
  assert.equal(state.audits[0].metadata.attributedAmount, "500");
});

test("completion is idempotent after capture and draft are converted", async () => {
  const { service, state } = setup({ capture: capture({ status: "CONVERTED" }), draft: draft({ status: "CONVERTED" }) });

  const result = await service.completeCapture(context, { tenantId: "tenant-1", marketplaceCaptureId: "capture-1" });

  assert.equal(result.idempotent, true);
  assert.equal(state.audits.length, 0);
  assert.equal(state.stageUpdates.length, 0);
  // Revenue attribution is still reported on the idempotent read path -- evaluateForDeal is
  // itself idempotent, so calling it again here is safe and lets repeat completion calls
  // continue to report the canonical attribution outcome.
  assert.equal(result.revenueAttributed, true);
  assert.equal(result.attributedAmount, "500");
});

test("deal closed by capture completion triggers revenue attribution exactly once", async () => {
  const { service, state } = setup();

  await service.completeCapture(context, { tenantId: "tenant-1", marketplaceCaptureId: "capture-1" });
  assert.equal(state.attributionCalls.length, 1);
  assert.equal(state.dealUpdates.length, 1);

  // Simulate a repeat completion call after the capture/draft/deal are already converted+closed.
  const repeat = setup({
    capture: capture({ status: "CONVERTED" }),
    draft: draft({ status: "CONVERTED" }),
    deal: deal({ closedAt: now }),
  });
  const result = await repeat.service.completeCapture(context, { tenantId: "tenant-1", marketplaceCaptureId: "capture-1" });

  assert.equal(result.revenueAttributed, true);
  // closedAt was already set, so completion must not re-issue a deal update (no duplicate outcome recording).
  assert.equal(repeat.state.dealUpdates.length, 0);
  assert.equal(repeat.state.attributionCalls.length, 1);
});

test("zero-value deal is attributed without inflating revenue", async () => {
  const { service, state } = setup({ deal: deal({ value: "0" }) });

  const result = await service.completeCapture(context, { tenantId: "tenant-1", marketplaceCaptureId: "capture-1" });

  assert.equal(result.revenueAttributed, true);
  assert.equal(result.attributedAmount, "0");
});

test("capture without a linked deal reports no revenue attribution", async () => {
  const { service } = setup({ capture: capture({ dealId: null }), deal: null });

  const result = await service.completeCapture(context, { tenantId: "tenant-1", marketplaceCaptureId: "capture-1" });

  assert.equal(result.revenueAttributed, false);
  assert.equal(result.dealId, undefined);
});

test("a failing revenue attribution runtime does not block capture completion", async () => {
  const { service, state } = setup({
    revenueAttribution: async () => { throw new Error("revenue attribution runtime unavailable"); },
  });

  const result = await service.completeCapture(context, { tenantId: "tenant-1", marketplaceCaptureId: "capture-1" });

  assert.equal(result.status, "CONVERTED");
  assert.equal(result.revenueAttributed, false);
  assert.equal(state.capture.status, "CONVERTED");
});

test("missing seller or inventory success blocks completion", async () => {
  await rejectsWithCode(() => setup({ seller: null }).service.completeCapture(context, { tenantId: "tenant-1", marketplaceCaptureId: "capture-1" }), "SERVICE_INVALID_STATE_TRANSITION");
  await rejectsWithCode(() => setup({ inventory: null }).service.completeCapture(context, { tenantId: "tenant-1", marketplaceCaptureId: "capture-1" }), "SERVICE_INVALID_STATE_TRANSITION");
});

test("tenant mismatch and invalid statuses fail closed", async () => {
  await rejectsWithCode(() => setup().service.completeCapture({ ...context, tenantId: "tenant-2" }, { tenantId: "tenant-1", marketplaceCaptureId: "capture-1" }), "SERVICE_TENANT_MISMATCH");
  await rejectsWithCode(() => setup({ capture: capture({ status: "INVITED" }) }).service.completeCapture(context, { tenantId: "tenant-1", marketplaceCaptureId: "capture-1" }), "SERVICE_INVALID_STATE_TRANSITION");
  await rejectsWithCode(() => setup({ draft: draft({ status: "CLAIMED" }) }).service.completeCapture(context, { tenantId: "tenant-1", marketplaceCaptureId: "capture-1" }), "SERVICE_INVALID_STATE_TRANSITION");
});

test("completion skips activity safely when actor is missing", async () => {
  const { service, state } = setup();

  const result = await service.completeCapture({ tenantId: "tenant-1", correlation: { correlationId: "corr-complete" } }, { tenantId: "tenant-1", marketplaceCaptureId: "capture-1" });

  assert.equal(result.status, "CONVERTED");
  assert.equal(state.audits[0].action, "MARKETPLACE_CAPTURE_COMPLETED");
  assert.equal(state.activities.length, 0);
});
