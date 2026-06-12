import assert from "node:assert/strict";
import test from "node:test";

import { MarketplaceCaptureService } from "../dist/index.js";

const now = "2026-06-11T00:00:00.000Z";

const context = {
  tenantId: "tenant-a",
  actorId: "actor-1",
  correlation: { correlationId: "corr-marketplace" },
};

const baseCaptureInput = (overrides = {}) => ({
  sourceUrl: "https://market.example/listings/123",
  sourceHost: "market.example",
  title: "Vintage desk",
  description: "Solid wood desk",
  priceText: "USD 45,000",
  imageUrls: ["https://market.example/images/desk.jpg"],
  rawExtract: { seller: "Alex Seller" },
  ...overrides,
});

const createStore = () => ({
  captures: [],
  audits: [],
});

const createDependencies = (store = createStore()) => ({
  marketplaceAcquisition: {
    async findMarketplaceCaptureBySourceUrl(scope, sourceUrl) {
      return store.captures.find(
        (capture) =>
          capture.tenantId === scope.tenantId &&
          capture.sourceListingUrl === sourceUrl,
      ) ?? null;
    },

    async createMarketplaceCapture(scope, input) {
      const capture = {
        id: `capture-${store.captures.length + 1}`,
        tenantId: scope.tenantId,
        sourceListingUrl: input.sourceListingUrl,
        sourceHost: input.sourceHost,
        title: input.title,
        description: input.description ?? null,
        priceText: input.priceText ?? null,
        priceAmount: input.priceAmount ?? null,
        currency: input.currency ?? null,
        imageUrls: input.imageUrls ?? [],
        rawExtract: input.rawExtract ?? {},
        status: input.status,
        createdAt: now,
        updatedAt: now,
      };

      store.captures.push(capture);
      return capture;
    },
  },

  auditLogs: {
    async append(scope, input) {
      const audit = {
        id: `audit-${store.audits.length + 1}`,
        tenantId: scope.tenantId,
        ...input,
        occurredAt: now,
        createdAt: now,
      };

      store.audits.push(audit);
      return audit;
    },
  },
});

test("capture creates new MarketplaceCapture when no source URL match exists", async () => {
  const store = createStore();
  const service = new MarketplaceCaptureService(createDependencies(store));

  const result = await service.createCapture(context, baseCaptureInput());

  assert.equal(result.isNew, true);
  assert.equal(result.capture.id, "capture-1");
  assert.equal(result.capture.tenantId, "tenant-a");
  assert.equal(result.capture.sourceListingUrl, "https://market.example/listings/123");
  assert.equal(result.capture.title, "Vintage desk");
  assert.equal(result.capture.status, "CAPTURED");

  assert.equal(store.captures.length, 1);
  assert.equal(store.captures[0].priceAmount, "45000");
  assert.equal(store.captures[0].currency, "USD");
});

test("second capture with same source URL returns existing MarketplaceCapture idempotently", async () => {
  const store = createStore();
  const service = new MarketplaceCaptureService(createDependencies(store));

  const first = await service.createCapture(context, baseCaptureInput());
  const second = await service.createCapture(context, baseCaptureInput({ title: "Vintage chair" }));

  assert.equal(first.isNew, true);
  assert.equal(second.isNew, false);
  assert.equal(second.capture.id, first.capture.id);
  assert.equal(second.capture.title, "Vintage desk");
  assert.equal(store.captures.length, 1);
});

test("raw listing data remains on MarketplaceCapture", async () => {
  const store = createStore();
  const service = new MarketplaceCaptureService(createDependencies(store));

  await service.createCapture(
    context,
    baseCaptureInput({
      rawExtract: {
        title: "Vintage desk",
        description: "Solid wood desk",
        images: ["https://market.example/image.jpg"],
      },
    }),
  );

  assert.deepEqual(store.captures[0].rawExtract, {
    title: "Vintage desk",
    description: "Solid wood desk",
    images: ["https://market.example/image.jpg"],
  });
});

test("tenant isolation prevents cross-tenant MarketplaceCapture matching", async () => {
  const store = createStore();

  store.captures.push({
    id: "foreign-capture",
    tenantId: "tenant-b",
    sourceListingUrl: "https://market.example/listings/123",
    sourceHost: "market.example",
    title: "Foreign capture",
    status: "CAPTURED",
    createdAt: now,
    updatedAt: now,
  });

  const service = new MarketplaceCaptureService(createDependencies(store));

  const result = await service.createCapture(context, baseCaptureInput());

  assert.equal(result.isNew, true);
  assert.notEqual(result.capture.id, "foreign-capture");
  assert.equal(store.captures.length, 2);
  assert.equal(store.captures[1].tenantId, "tenant-a");
});

test("capture writes audit log for newly-created MarketplaceCapture", async () => {
  const store = createStore();
  const service = new MarketplaceCaptureService(createDependencies(store));

  await service.createCapture(context, baseCaptureInput());

  assert.equal(store.audits.length, 1);
  assert.equal(store.audits[0].action, "MARKETPLACE_CAPTURE_CREATED");
  assert.equal(store.audits[0].targetType, "MARKETPLACE_CAPTURE");
  assert.equal(store.audits[0].targetId, "capture-1");
  assert.equal(store.audits[0].correlationId, "corr-marketplace");
});