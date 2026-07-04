import assert from "node:assert/strict";
import test from "node:test";

import { SellerAcquisitionEditService } from "../dist/index.js";

const now = "2026-06-11T00:00:00.000Z";
const context = { tenantId: "tenant-a", actorId: "user-a", correlation: { correlationId: "corr-edit" } };

const baseCapture = (overrides = {}) => ({
  id: "capture-1",
  tenantId: "tenant-a",
  listingUrl: "https://market.example/listings/1",
  title: "Vintage bicycle",
  contactId: null,
  dealId: null,
  metadata: {},
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const createMarketplaceAcquisition = (capture) => ({
  updates: [],
  async findMarketplaceCaptureById(ctx, id) {
    return capture.id === id && capture.tenantId === ctx.tenantId ? capture : null;
  },
  async updateMarketplaceCapture(ctx, id, input) {
    this.updates.push(input);
    Object.assign(capture, input, { updatedAt: now });
    return capture;
  },
});

const createDraftInventories = () => ({
  async findByMarketplaceCaptureId() { return null; },
  async upsertForCapture(ctx, input) { return { id: "draft-1", ...input }; },
  async update(ctx, id, input) { return { id, ...input }; },
});

const createRequalificationSpy = (result) => ({
  calls: [],
  async requalifyMarketplaceCapture(ctx, captureId) {
    this.calls.push({ ctx, captureId });
    return result;
  },
});

test("editing sellerPhone triggers requalification and returns its result", async () => {
  const capture = baseCapture();
  const marketplaceAcquisition = createMarketplaceAcquisition(capture);
  const requalification = createRequalificationSpy({
    qualificationStatus: "QUALIFIED",
    crmConversionStatus: "CREATED",
    requalified: true,
    invitationEligible: true,
    contactId: "contact-1",
    dealId: "deal-1",
  });

  const service = new SellerAcquisitionEditService({
    marketplaceAcquisition,
    draftInventories: createDraftInventories(),
    requalification,
  });

  const result = await service.editExtract(context, "capture-1", { sellerPhone: "+233555000111" });

  assert.equal(requalification.calls.length, 1);
  assert.equal(requalification.calls[0].captureId, "capture-1");
  assert.equal(requalification.calls[0].ctx.tenantId, "tenant-a");
  assert.equal(requalification.calls[0].ctx.actorId, "user-a");
  assert.equal(requalification.calls[0].ctx.correlation.correlationId, "corr-edit");

  assert.deepEqual(result, {
    qualificationStatus: "QUALIFIED",
    crmConversionStatus: "CREATED",
    requalified: true,
    invitationEligible: true,
    contactId: "contact-1",
    dealId: "deal-1",
  });
});

test("editing unrelated fields (title only) does not trigger requalification", async () => {
  const capture = baseCapture();
  const marketplaceAcquisition = createMarketplaceAcquisition(capture);
  const requalification = createRequalificationSpy({ qualificationStatus: "QUALIFIED", crmConversionStatus: "CREATED", requalified: true, invitationEligible: true });

  const service = new SellerAcquisitionEditService({
    marketplaceAcquisition,
    draftInventories: createDraftInventories(),
    requalification,
  });

  const result = await service.editExtract(context, "capture-1", { title: "Updated title" });

  assert.equal(requalification.calls.length, 0, "requalification must not run for unrelated edits");
  assert.equal(result.requalified, false);
  assert.equal(result.qualificationStatus, "UNQUALIFIED");
  assert.equal(result.crmConversionStatus, "NOT_ELIGIBLE");
  assert.equal(result.invitationEligible, false);
});

test("unrelated edit on an already-qualified capture reports its current status without requalifying", async () => {
  const capture = baseCapture({ contactId: "contact-9", dealId: "deal-9" });
  const marketplaceAcquisition = createMarketplaceAcquisition(capture);
  const requalification = createRequalificationSpy({ qualificationStatus: "QUALIFIED", crmConversionStatus: "CREATED", requalified: true, invitationEligible: true });

  const service = new SellerAcquisitionEditService({
    marketplaceAcquisition,
    draftInventories: createDraftInventories(),
    requalification,
  });

  const result = await service.editExtract(context, "capture-1", { title: "Updated title" });

  assert.equal(requalification.calls.length, 0);
  assert.deepEqual(result, {
    qualificationStatus: "QUALIFIED",
    crmConversionStatus: "EXISTING",
    requalified: false,
    invitationEligible: true,
  });
});

test("editExtract works without a requalification dependency configured", async () => {
  const capture = baseCapture();
  const marketplaceAcquisition = createMarketplaceAcquisition(capture);

  const service = new SellerAcquisitionEditService({
    marketplaceAcquisition,
    draftInventories: createDraftInventories(),
  });

  const result = await service.editExtract(context, "capture-1", { sellerPhone: "+233555000111" });

  assert.equal(result.qualificationStatus, "UNQUALIFIED");
  assert.equal(result.requalified, false);
  assert.equal(marketplaceAcquisition.updates.length, 1);
  assert.equal(marketplaceAcquisition.updates[0].metadata.sellerPhone, "+233555000111");
});
