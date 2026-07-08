import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(`${root}src/${path}`, "utf8");

const tenantFeatures = read("lib/tenant-features.ts");

test("getTenantFeatureState distinguishes explicitly-disabled, lookup-failed, and tenant-required", () => {
  assert.match(tenantFeatures, /export type TenantFeatureResult =/u);
  assert.match(tenantFeatures, /"TENANT_REQUIRED" \| "LOOKUP_FAILED"/u);
  assert.match(tenantFeatures, /export async function getTenantFeatureState/u);
  assert.match(tenantFeatures, /return \{ ok: false, code: "TENANT_REQUIRED"/u);
  assert.match(tenantFeatures, /return \{ ok: false, code: "LOOKUP_FAILED"/u);
});

test("getTenantFeatureState still fails closed on a lookup error", () => {
  assert.match(tenantFeatures, /catch \(error\) \{[\s\S]*?tenant_feature_state_lookup_failed[\s\S]*?return \{ ok: false, code: "LOOKUP_FAILED", message: "Feature flag lookup failed\." \};/u);
});

test("isTenantFeatureEnabled remains a boolean legacy wrapper for existing callers", () => {
  assert.match(tenantFeatures, /export async function isTenantFeatureEnabled\(\s*tenantId: string,\s*featureKey: string,\s*\): Promise<boolean>/u);
  assert.match(tenantFeatures, /const result = await getTenantFeatureState\(tenantId, featureKey\);/u);
  assert.match(tenantFeatures, /return result\.ok && result\.enabled;/u);
});

test("existing protected-feature helpers and their callers are untouched", () => {
  assert.match(tenantFeatures, /export async function isProtectedTenantFeatureEnabled/u);
  assert.match(tenantFeatures, /export async function requireSellerAcquisitionFeatureForApi/u);
});
