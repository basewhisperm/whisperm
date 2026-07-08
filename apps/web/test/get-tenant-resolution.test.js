import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(`${root}src/${path}`, "utf8");

const getTenant = read("lib/get-tenant.ts");

test("resolveTenantForCurrentUser distinguishes auth-required from tenant-required", () => {
  assert.match(getTenant, /export async function resolveTenantForCurrentUser\(\): Promise<TenantResolution>/u);
  assert.match(getTenant, /return \{ ok: false, code: "AUTH_REQUIRED" \};/u);
  assert.match(getTenant, /return \{ ok: false, code: "TENANT_REQUIRED" \};/u);
  assert.match(getTenant, /return \{ ok: true, tenant: tenantUser\.tenant, tenantUserId: tenantUser\.id \};/u);
});

test("existing getTenantForCurrentUser and getTenantContextForCurrentUser callers are unchanged", () => {
  assert.match(getTenant, /export async function getTenantForCurrentUser\(\)/u);
  assert.match(getTenant, /export async function getTenantContextForCurrentUser\(\)/u);
});
