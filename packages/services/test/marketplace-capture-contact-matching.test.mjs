import assert from "node:assert/strict";
import test from "node:test";

import { MarketplaceCaptureService } from "../dist/index.js";

const now = "2026-06-11T00:00:00.000Z";
const context = { tenantId: "tenant-a", actorId: "actor-1", correlation: { correlationId: "corr-marketplace" } };

const baseCaptureInput = (overrides = {}) => ({
  tenantId: "tenant-a",
  listingUrl: "https://market.example/listings/123",
  title: "Vintage desk",
  description: "Solid wood desk",
  sellerDisplayName: "Alex Seller",
  sourceSellerUrl: "https://market.example/sellers/alex",
  ...overrides,
});

const createStore = () => ({ contacts: [], captures: [], activities: [], audits: [] });

const createDependencies = (store = createStore()) => ({
  contacts: {
    async findMarketplaceSellerContact(scope, input) {
      if (input.sellerProfileUrl !== undefined) {
        const profileMatch = store.contacts.find((contact) => contact.tenantId === scope.tenantId && contact.metadata?.marketplaceAcquisition?.sellerProfileUrl === input.sellerProfileUrl);
        if (profileMatch !== undefined) return profileMatch;
      }
      if (input.sellerDisplayName !== undefined && input.sourceHost !== undefined) {
        const hostNameMatch = store.contacts.find((contact) => contact.tenantId === scope.tenantId && contact.metadata?.marketplaceAcquisition?.sellerDisplayName === input.sellerDisplayName && contact.metadata?.marketplaceAcquisition?.sourceHost === input.sourceHost);
        if (hostNameMatch !== undefined) return hostNameMatch;
      }
      if (input.email !== undefined || input.phone !== undefined) {
        return store.contacts.find((contact) => contact.tenantId === scope.tenantId && ((input.email !== undefined && contact.email === input.email) || (input.phone !== undefined && contact.phone === input.phone))) ?? null;
      }
      return null;
    },
    async createMarketplaceSellerContact(scope, input) {
      const contact = { id: `contact-${store.contacts.length + 1}`, tenantId: scope.tenantId, externalId: null, email: input.email ?? null, phone: input.phone ?? null, firstName: input.firstName ?? null, lastName: input.lastName ?? null, stage: input.stage ?? "PROSPECT", metadata: input.metadata ?? {}, createdAt: now, updatedAt: now };
      store.contacts.push(contact);
      return contact;
    },
  },
  marketplaceCaptures: {
    async create(scope, input) {
      const capture = { id: `capture-${store.captures.length + 1}`, tenantId: scope.tenantId, marketplaceSourceId: input.marketplaceSourceId ?? null, contactId: null, dealId: null, externalId: input.externalId ?? null, listingUrl: input.listingUrl, title: input.title, description: input.description ?? null, price: input.price ?? null, currency: input.currency ?? null, sellerName: input.sellerName ?? null, sellerProfileUrl: input.sellerProfileUrl ?? null, status: input.status, capturedAt: now, metadata: input.metadata ?? {}, createdAt: now, updatedAt: now };
      store.captures.push(capture);
      return capture;
    },
    async linkCaptureToContact(scope, captureId, contactId) {
      const capture = store.captures.find((candidate) => candidate.tenantId === scope.tenantId && candidate.id === captureId);
      assert.notEqual(capture, undefined);
      capture.contactId = contactId;
      capture.status = "CAPTURED";
      return capture;
    },
  },
  activities: {
    async create(scope, input) {
      const activity = { id: `activity-${store.activities.length + 1}`, tenantId: scope.tenantId, ...input, occurredAt: now, createdAt: now, updatedAt: now };
      store.activities.push(activity);
      return activity;
    },
  },
  auditLogs: {
    async append(scope, input) {
      const audit = { id: `audit-${store.audits.length + 1}`, tenantId: scope.tenantId, ...input, occurredAt: now, createdAt: now };
      store.audits.push(audit);
      return audit;
    },
  },
});

test("capture creates new Contact when no deterministic match exists", async () => {
  const store = createStore();
  const service = new MarketplaceCaptureService(createDependencies(store));

  const result = await service.create(context, baseCaptureInput());

  assert.equal(result.contactLinkage, "created");
  assert.equal(result.contactId, "contact-1");
  assert.equal(result.status, "CAPTURED");
  assert.equal(store.captures[0].contactId, "contact-1");
  assert.equal(store.contacts[0].firstName, "Alex Seller");
  assert.deepEqual(store.contacts[0].metadata, { marketplaceAcquisition: { source: "marketplace-acquisition", sourceHost: "market.example", sellerDisplayName: "Alex Seller", sellerProfileUrl: "https://market.example/sellers/alex" } });
  assert.equal(store.activities[0].type, "NOTE");
  assert.equal(store.activities[0].metadata.activityType, "MARKETPLACE_CAPTURED");
});

test("second capture with same seller profile/source links existing Contact", async () => {
  const store = createStore();
  const service = new MarketplaceCaptureService(createDependencies(store));

  const first = await service.create(context, baseCaptureInput({ listingUrl: "https://market.example/listings/123" }));
  const second = await service.create(context, baseCaptureInput({ listingUrl: "https://market.example/listings/456", title: "Vintage chair" }));

  assert.equal(first.contactLinkage, "created");
  assert.equal(second.contactLinkage, "matched");
  assert.equal(second.contactId, first.contactId);
  assert.equal(store.contacts.length, 1);
  assert.equal(store.captures.length, 2);
  assert.equal(store.captures[1].contactId, first.contactId);
});

test("raw listing data remains on MarketplaceCapture and is not duplicated into Contact metadata", async () => {
  const store = createStore();
  const service = new MarketplaceCaptureService(createDependencies(store));

  await service.create(context, baseCaptureInput({ metadata: { rawListingPayload: { title: "Vintage desk", description: "Solid wood desk", images: ["https://market.example/image.jpg"] } } }));

  assert.deepEqual(store.captures[0].metadata.rawListingPayload, { title: "Vintage desk", description: "Solid wood desk", images: ["https://market.example/image.jpg"] });
  assert.equal(store.contacts[0].metadata.rawListingPayload, undefined);
  assert.equal(store.contacts[0].metadata.listingUrl, undefined);
  assert.equal(store.contacts[0].metadata.title, undefined);
  assert.equal(store.contacts[0].metadata.description, undefined);
});

test("tenant isolation prevents cross-tenant Contact matching", async () => {
  const store = createStore();
  store.contacts.push({ id: "foreign-contact", tenantId: "tenant-b", externalId: null, email: null, phone: null, firstName: "Alex Seller", lastName: null, stage: "PROSPECT", metadata: { marketplaceAcquisition: { source: "marketplace-acquisition", sourceHost: "market.example", sellerDisplayName: "Alex Seller", sellerProfileUrl: "https://market.example/sellers/alex" } }, createdAt: now, updatedAt: now });
  const service = new MarketplaceCaptureService(createDependencies(store));

  const result = await service.create(context, baseCaptureInput());

  assert.equal(result.contactLinkage, "created");
  assert.notEqual(result.contactId, "foreign-contact");
  assert.equal(store.contacts.length, 2);
  assert.equal(store.contacts[1].tenantId, "tenant-a");
});
