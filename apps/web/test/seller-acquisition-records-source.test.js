import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('../', import.meta.url).pathname;
const source = (path) => readFileSync(join(root, path), 'utf8');

test('seller acquisition records and detail routes exist', () => {
  assert.equal(existsSync(join(root, 'src/app/api/marketplace-acquisition/records/route.ts')), true);
  assert.equal(existsSync(join(root, 'src/app/api/marketplace-acquisition/records/[captureId]/route.ts')), true);
});

test('records routes use existing SELLER_ACQUISITION feature gate', () => {
  for (const path of ['src/app/api/marketplace-acquisition/records/route.ts', 'src/app/api/marketplace-acquisition/records/[captureId]/route.ts']) {
    const text = source(path);
    assert.match(text, /getTenantContextForCurrentUser/);
    assert.match(text, /requireSellerAcquisitionFeatureForApi/);
  }
});

test('public claim routes remain ungated', () => {
  for (const path of ['src/app/api/marketplace-acquisition/claims/[token]/route.ts', 'src/app/api/marketplace-acquisition/claims/[token]/accept/route.ts']) {
    const text = source(path);
    assert.doesNotMatch(text, /SELLER_ACQUISITION_FEATURE/);
    assert.doesNotMatch(text, /isTenantFeatureEnabled/);
  }
});

test('aggregate contract includes canonical acquisition state fields', () => {
  const text = readFileSync(join(root, '../../packages/services/src/seller-acquisition-records.ts'), 'utf8');
  for (const field of ['healthStatus', 'nextAction', 'missingRequirements', 'isQualifiedSellerLead']) {
    assert.match(text, new RegExp(`readonly ${field}`));
  }
});

test('records API is capture-centered', () => {
  const listRoute = source('src/app/api/marketplace-acquisition/records/route.ts');
  const detailRoute = source('src/app/api/marketplace-acquisition/records/[captureId]/route.ts');
  const service = readFileSync(join(root, '../../packages/services/src/seller-acquisition-records.ts'), 'utf8');
  assert.match(listRoute, /sellerAcquisitionRecords\.list/);
  assert.match(detailRoute, /findByCaptureId/);
  assert.match(detailRoute, /params: \{ readonly captureId: string \}/);
  assert.match(service, /marketplaceCaptures\.list\(context, \{ limit: 100 \}\)/);
  assert.doesNotMatch(listRoute, /findBoardByPipeline/);
});
