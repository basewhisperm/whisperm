import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root    = new URL('../', import.meta.url).pathname;
const svcRoot = join(root, '../../packages/services/src');
const repoRoot = join(root, '../../packages/repositories/src');

const source = (path) => readFileSync(join(root, path), 'utf8');
const svc    = (path) => readFileSync(join(svcRoot, path), 'utf8');
const repo   = (path) => readFileSync(join(repoRoot, path), 'utf8');

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

test('UpdateMarketplaceCaptureInput type is exported from marketplace-acquisition.ts', () => {
  const text = repo('marketplace-acquisition.ts');
  assert.match(text, /export type UpdateMarketplaceCaptureInput/u);
  assert.match(text, /sellerName.*sellerProfileUrl.*description.*price.*currency.*metadata/su);
});

test('findMarketplaceCaptureById method exists on the repository interface and class', () => {
  const text = repo('marketplace-acquisition.ts');
  assert.match(text, /findMarketplaceCaptureById\(context: TenantScoped, id: string\)/u);
  assert.match(text, /async findMarketplaceCaptureById/u);
});

test('updateMarketplaceCapture method exists on the repository interface and class', () => {
  const text = repo('marketplace-acquisition.ts');
  assert.match(text, /updateMarketplaceCapture\(context: TenantScoped, id: string, input: UpdateMarketplaceCaptureInput\)/u);
  assert.match(text, /async updateMarketplaceCapture/u);
});

test('updateMarketplaceCaptureMetadata still exists as a backward-compatible wrapper', () => {
  const text = repo('marketplace-acquisition.ts');
  assert.match(text, /updateMarketplaceCaptureMetadata/u);
  // Must delegate to updateMarketplaceCapture rather than duplicating the Prisma call
  assert.match(text, /return this\.updateMarketplaceCapture/u);
});

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

test('seller-acquisition-edit.ts service file exists', () => {
  assert.equal(existsSync(join(svcRoot, 'seller-acquisition-edit.ts')), true);
});

test('editExtractInputSchema is exported and enforces at least one field', () => {
  const text = svc('seller-acquisition-edit.ts');
  assert.match(text, /export const editExtractInputSchema/u);
  assert.match(text, /At least one field must be provided/u);
});

test('editExtractInputSchema covers all expected fields', () => {
  const text = svc('seller-acquisition-edit.ts');
  for (const field of ['title', 'sellerName', 'sellerPhone', 'priceText', 'currency', 'description', 'category', 'location']) {
    assert.ok(text.includes(field), `editExtractInputSchema should include field "${field}"`);
  }
});

test('SellerAcquisitionEditService writes DraftInventory for inventory fields', () => {
  const text = svc('seller-acquisition-edit.ts');
  assert.match(text, /draftInventories\.update/u);
  assert.match(text, /draftInventories\.upsertForCapture/u);
});

test('SellerAcquisitionEditService writes capture.sellerName for contact fields', () => {
  const text = svc('seller-acquisition-edit.ts');
  assert.match(text, /sellerName/u);
  assert.match(text, /captureUpdates/u);
  assert.match(text, /updateMarketplaceCapture/u);
});

test('SellerAcquisitionEditService writes sellerPhone and location into capture metadata', () => {
  const text = svc('seller-acquisition-edit.ts');
  assert.match(text, /sellerPhone/u);
  assert.match(text, /metaUpdates/u);
  assert.match(text, /location/u);
});

test('price parsing strips GHS symbols and uses parseFloat', () => {
  const text = svc('seller-acquisition-edit.ts');
  assert.match(text, /GH₵|GHS/u);
  assert.match(text, /parseFloat/u);
  assert.match(text, /Number\.isFinite/u);
});

test('upsertForCapture is called when no DraftInventory row exists yet', () => {
  const text = svc('seller-acquisition-edit.ts');
  assert.match(text, /draft.*null.*upsertForCapture/su);
});

// ---------------------------------------------------------------------------
// API route
// ---------------------------------------------------------------------------

test('PATCH handler exists on the records/[captureId] route', () => {
  const text = source('src/app/api/marketplace-acquisition/records/[captureId]/route.ts');
  assert.match(text, /export async function PATCH/u);
});

test('PATCH route is feature-gated identically to GET', () => {
  const text = source('src/app/api/marketplace-acquisition/records/[captureId]/route.ts');
  // Count occurrences -- both GET and PATCH must call the feature gate
  const matches = text.match(/requireSellerAcquisitionFeatureForApi/gu) ?? [];
  assert.ok(matches.length >= 2, 'requireSellerAcquisitionFeatureForApi should appear in both GET and PATCH');
});

test('PATCH route returns the updated record in the response body', () => {
  const text = source('src/app/api/marketplace-acquisition/records/[captureId]/route.ts');
  assert.match(text, /findByCaptureId/u);
  assert.match(text, /data: \{ record, \.\.\.editResult \}/u);
});

// ---------------------------------------------------------------------------
// ST1-007: requalification wiring
// ---------------------------------------------------------------------------

test('editExtract accepts an EditExtractContext with actorId and correlation, and returns EditExtractResult', () => {
  const text = svc('seller-acquisition-edit.ts');
  assert.match(text, /interface EditExtractContext/u);
  assert.match(text, /interface EditExtractResult/u);
  assert.match(text, /async editExtract\(context: EditExtractContext, captureId: string, raw: unknown\): Promise<EditExtractResult>/u);
});

test('editExtract only triggers requalification when sellerPhone is edited', () => {
  const text = svc('seller-acquisition-edit.ts');
  assert.match(text, /input\.sellerPhone !== undefined && this\.deps\.requalification !== undefined/u);
  assert.match(text, /requalifyMarketplaceCapture/u);
});

test('SellerAcquisitionRequalificationService centralizes the canonical qualification + CRM conversion pipeline', () => {
  const text = svc('marketplace-requalification.ts');
  assert.match(text, /class MarketplaceRequalificationService/u);
  assert.match(text, /requalifyMarketplaceCapture/u);
  assert.match(text, /canonicalCapture\.capture/u);
});

test('MarketplaceRequalificationService refreshes existing campaign membership instead of recreating it', () => {
  const text = svc('marketplace-requalification.ts');
  assert.match(text, /listMembersByCapture/u);
  assert.match(text, /updateMember/u);
  assert.doesNotMatch(text, /addSeller/u);
});

test('MarketplaceRequalificationService records an audit event with previous/new qualification, actor, and reason', () => {
  const text = svc('marketplace-requalification.ts');
  assert.match(text, /MARKETPLACE_CAPTURE_REQUALIFIED/u);
  assert.match(text, /previousQualificationStatus/u);
  assert.match(text, /newQualificationStatus/u);
  assert.match(text, /actorId: context\.actorId/u);
});

test('PATCH route wires MarketplaceRequalificationService into SellerAcquisitionEditService', () => {
  const text = source('src/app/api/marketplace-acquisition/records/[captureId]/route.ts');
  assert.match(text, /MarketplaceRequalificationService/u);
  assert.match(text, /requalification/u);
  assert.match(text, /actorId: tenantContext\.tenantUserId/u);
});

test('PATCH route handles ZodError with a 400 response', () => {
  const text = source('src/app/api/marketplace-acquisition/records/[captureId]/route.ts');
  assert.match(text, /ZodError/u);
  assert.match(text, /400/u);
});

test('ST1-009: PATCH route constructs the canonical capture service with usageMetering so requalification records SELLER_QUALIFIED/CRM_CONVERSION_CREATED', () => {
  const text = source('src/app/api/marketplace-acquisition/records/[captureId]/route.ts');
  assert.match(text, /createAcquisitionServiceBundle/u);
});

// ---------------------------------------------------------------------------
// UI (page.tsx)
// ---------------------------------------------------------------------------

test('page.tsx renders an Edit extract button', () => {
  const text = source('src/components/marketplace-acquisition/acquisition-workbench.tsx');
  assert.match(text, /Edit extract/u);
});

test('page.tsx has editMode, openEdit, saveEdit, and editFields state/functions', () => {
  const text = source('src/components/marketplace-acquisition/acquisition-workbench.tsx');
  assert.match(text, /editMode/u);
  assert.match(text, /openEdit/u);
  assert.match(text, /saveEdit/u);
  assert.match(text, /editFields/u);
});

test('page.tsx sends PATCH to /api/marketplace-acquisition/records/:captureId', () => {
  const text = source('src/components/marketplace-acquisition/acquisition-workbench.tsx');
  assert.match(text, /method.*PATCH/su);
  assert.match(text, /marketplace-acquisition\/records/u);
});

test('page.tsx updates the record locally on save without a full reload', () => {
  const text = source('src/components/marketplace-acquisition/acquisition-workbench.tsx');
  assert.match(text, /onRecordPatched/u);
  assert.match(text, /patchRecord/u);
});

test('page.tsx pre-fills edit form from the current record values', () => {
  const text = source('src/components/marketplace-acquisition/acquisition-workbench.tsx');
  assert.match(text, /editFieldsFromRecord/u);
});

test('page.tsx resets edit mode when the selected capture changes', () => {
  const text = source('src/components/marketplace-acquisition/acquisition-workbench.tsx');
  assert.match(text, /setEditMode\(false\)/u);
  assert.match(text, /record\?\.capture\.id/u);
});
