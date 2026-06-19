import assert from "node:assert/strict";
import test from "node:test";

import { PersistenceError } from "@whisperm/types";

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
    async findMarketplaceCaptureByListingUrl(scope, listingUrl) {
      return store.captures.find(
        (capture) =>
          capture.tenantId === scope.tenantId &&
          capture.listingUrl === listingUrl,
      ) ?? null;
    },

    async findMarketplaceCaptureByExternalId(scope, externalId) {
      return store.captures.find(
        (capture) =>
          capture.tenantId === scope.tenantId &&
          capture.externalId === externalId,
      ) ?? null;
    },

    async createMarketplaceCapture(scope, input) {
      const capture = {
        id: `capture-${store.captures.length + 1}`,
        tenantId: scope.tenantId,
        marketplaceSourceId: input.marketplaceSourceId ?? null,
        externalId: input.externalId ?? null,
        listingUrl: input.listingUrl,
        title: input.title,
        description: input.description ?? null,
        price: input.price ?? null,
        currency: input.currency ?? null,
        sellerProfileUrl: input.sellerProfileUrl ?? null,
        metadata: input.metadata ?? {},
        status: input.status,
        capturedAt: now,
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

test("capture creates new MarketplaceCapture when no listing URL match exists", async () => {
  const store = createStore();
  const service = new MarketplaceCaptureService(createDependencies(store));

  const result = await service.createCapture(context, baseCaptureInput());

  assert.equal(result.isNew, true);
  assert.equal(result.duplicate, false);
  assert.equal(result.capture.id, "capture-1");
  assert.equal(result.capture.tenantId, "tenant-a");
  assert.equal(result.capture.sourceListingUrl, "https://market.example/listings/123");
  assert.equal(result.capture.listingUrl, "https://market.example/listings/123");
  assert.equal(result.capture.title, "Vintage desk");
  assert.equal(result.capture.status, "CAPTURED");

  assert.equal(store.captures.length, 1);
  assert.equal(store.captures[0].price, "45000");
  assert.equal(store.captures[0].currency, "USD");
});

test("capture normalizes listing URL host case and trailing slash", async () => {
  const store = createStore();
  const service = new MarketplaceCaptureService(createDependencies(store));

  const result = await service.createCapture(context, baseCaptureInput({ sourceUrl: " https://Market.Example/listings/123/?ref=abc " }));

  assert.equal(result.capture.listingUrl, "https://market.example/listings/123?ref=abc");
  assert.equal(store.captures[0].listingUrl, "https://market.example/listings/123?ref=abc");
});

test("second capture with same listing URL returns existing MarketplaceCapture idempotently", async () => {
  const store = createStore();
  const service = new MarketplaceCaptureService(createDependencies(store));

  const first = await service.createCapture(context, baseCaptureInput());
  const second = await service.createCapture(context, baseCaptureInput({ title: "Vintage chair" }));

  assert.equal(first.isNew, true);
  assert.equal(second.isNew, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.capture.id, first.capture.id);
  assert.equal(second.capture.title, "Vintage desk");
  assert.equal(store.captures.length, 1);
});

test("createCapture resolves a PERSISTENCE_CONFLICT from a concurrent insert as a duplicate", async () => {
  const store = createStore();
  const dependencies = createDependencies(store);
  const originalCreate = dependencies.marketplaceAcquisition.createMarketplaceCapture;
  let createAttempts = 0;

  dependencies.marketplaceAcquisition.createMarketplaceCapture = async (scope, input) => {
    createAttempts += 1;

    if (createAttempts === 1) {
      store.captures.push({
        id: "capture-racer",
        tenantId: scope.tenantId,
        marketplaceSourceId: input.marketplaceSourceId ?? null,
        externalId: input.externalId ?? null,
        listingUrl: input.listingUrl,
        title: input.title,
        description: input.description ?? null,
        price: input.price ?? null,
        currency: input.currency ?? null,
        sellerProfileUrl: input.sellerProfileUrl ?? null,
        metadata: input.metadata ?? {},
        status: input.status,
        capturedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      throw new PersistenceError({
        code: "PERSISTENCE_CONFLICT",
        message: "duplicate",
        status: 409,
      });
    }

    return originalCreate(scope, input);
  };

  const service = new MarketplaceCaptureService(dependencies);
  const result = await service.createCapture(context, baseCaptureInput());

  assert.equal(result.duplicate, true);
  assert.equal(result.isNew, false);
  assert.equal(result.capture.id, "capture-racer");
  assert.equal(createAttempts, 1);
  assert.equal(store.captures.length, 1);
  assert.equal(store.audits.length, 0);
});

test("second capture with same external ID returns existing MarketplaceCapture idempotently", async () => {
  const store = createStore();
  const service = new MarketplaceCaptureService(createDependencies(store));

  const first = await service.createCapture(context, baseCaptureInput({ externalId: "listing-123" }));
  const second = await service.createCapture(context, baseCaptureInput({ sourceUrl: "https://market.example/listings/456", externalId: "listing-123" }));

  assert.equal(first.isNew, true);
  assert.equal(second.isNew, false);
  assert.equal(second.capture.id, first.capture.id);
  assert.equal(store.captures.length, 1);
});

test("raw listing data remains in MarketplaceCapture metadata", async () => {
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

  assert.deepEqual(store.captures[0].metadata.rawExtract, {
    title: "Vintage desk",
    description: "Solid wood desk",
    images: ["https://market.example/image.jpg"],
  });
  assert.equal(store.captures[0].metadata.parserVersion, "marketplace-capture-normalizer-v1");
});

test("capture parses GHS price text conservatively", async () => {
  const store = createStore();
  const service = new MarketplaceCaptureService(createDependencies(store));

  await service.createCapture(context, baseCaptureInput({ priceText: "GHS 1,200" }));

  assert.equal(store.captures[0].price, "1200");
  assert.equal(store.captures[0].currency, "GHS");
});

test("capture parses Ghana cedi symbol price text conservatively", async () => {
  const store = createStore();
  const service = new MarketplaceCaptureService(createDependencies(store));

  await service.createCapture(context, baseCaptureInput({ priceText: "₵1,200" }));

  assert.equal(store.captures[0].price, "1200");
  assert.equal(store.captures[0].currency, "GHS");
});


test("uncertain price is preserved in metadata without failing capture", async () => {
  const store = createStore();
  const service = new MarketplaceCaptureService(createDependencies(store));

  const result = await service.createCapture(context, baseCaptureInput({ priceText: "call for price" }));

  assert.equal(result.isNew, true);
  assert.equal(store.captures[0].price, null);
  assert.equal(store.captures[0].metadata.originalPriceText, "call for price");
  assert.deepEqual(result.normalizationWarnings, ["PRICE_UNPARSED"]);
});

test("tenant isolation prevents cross-tenant MarketplaceCapture matching", async () => {
  const store = createStore();

  store.captures.push({
    id: "foreign-capture",
    tenantId: "tenant-b",
    listingUrl: "https://market.example/listings/123",
    title: "Foreign capture",
    status: "CAPTURED",
    capturedAt: now,
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
