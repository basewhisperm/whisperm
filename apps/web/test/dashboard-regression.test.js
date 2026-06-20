import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(join(root, 'src', path), 'utf8');

test('/dashboard feature lookup fails closed instead of crashing the app layout', () => {
  const layout = read('app/(app)/layout.tsx');
  const tenantFeatures = read('lib/tenant-features.ts');

  assert.match(layout, /const enabledFeatures = tenant \? await getTenantFeatures\(tenant\.id\) : \[\]/u);
  assert.match(tenantFeatures, /export async function getTenantFeatures\(tenantId: string\): Promise<readonly string\[\]>/u);
  assert.match(tenantFeatures, /try \{/u);
  assert.match(tenantFeatures, /tenant_features_lookup_failed/u);
  assert.match(tenantFeatures, /return \[\];/u);
});

test('/dashboard nav includes Marketplace Sellers only when SELLER_ACQUISITION is enabled', () => {
  const sidebar = read('components/app-shell/sidebar.tsx');

  assert.match(sidebar, /enabledFeatures\.includes\(SELLER_ACQUISITION_FEATURE\)/u);
  assert.match(sidebar, /sellerAcquisitionNavigationItem/u);
  assert.match(sidebar, /marketplaceSellers\.title/u);
  assert.doesNotMatch(sidebar, /marketplaceCapture\.title/u);
  assert.doesNotMatch(sidebar, /Seller Capture/u);
});

test('/dashboard keeps core CRM navigation present for tenants with and without seller acquisition', () => {
  const sidebar = read('components/app-shell/sidebar.tsx');

  for (const coreLabel of ['dashboard.title', 'contacts.title', 'deals.title', 'reports.title', 'settings.title']) {
    assert.match(sidebar, new RegExp(coreLabel.replace('.', '\\.'), 'u'));
  }
});
