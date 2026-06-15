import assert from "node:assert/strict";
import test from "node:test";

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
    audits: [],
    stageUpdates: [],
  };

  const service = new MarketplaceCaptureCompletionService({
    clock: () => new Date(now),
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
        assert.equal(key, "marketplace_acquisition");
        return { id: "pipe-1", tenantId, stages: [{ id: "stage-converted", name: "Converted" }] };
      },
    },
    deals: {
      async updateStage(tenantId, dealId, stageId) {
        state.stageUpdates.push({ tenantId, dealId, stageId });
        return { id: dealId, tenantId, pipelineStageId: stageId, updatedAt: now };
      },
    },
    auditLogs: {
      async append(scope, input) {
        assert.equal(scope.tenantId, input.tenantId);
        state.audits.push(input);
        return { id: `audit-${state.audits.length}`, ...input, occurredAt: now };
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
});

test("completion is idempotent after capture and draft are converted", async () => {
  const { service, state } = setup({ capture: capture({ status: "CONVERTED" }), draft: draft({ status: "CONVERTED" }) });

  const result = await service.completeCapture(context, { tenantId: "tenant-1", marketplaceCaptureId: "capture-1" });

  assert.equal(result.idempotent, true);
  assert.equal(state.audits.length, 0);
  assert.equal(state.stageUpdates.length, 0);
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
