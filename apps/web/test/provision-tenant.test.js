import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(`${root}src/${path}`, "utf8");

const provisionTenant = read("lib/provision-tenant.ts");

test("provisionWorkspaceForUser creates tenant, owner, default pipeline, and a 14-day trial subscription", () => {
  assert.match(provisionTenant, /const TRIAL_DURATION_DAYS = 14;/u);
  assert.match(provisionTenant, /role: "OWNER"/u);
  assert.match(provisionTenant, /plan: "STARTER"/u);
  assert.match(provisionTenant, /status: "TRIALING"/u);
  assert.match(provisionTenant, /isDefault: true/u);
  assert.match(provisionTenant, /defaultKey: "default"/u);
});

test("provisionWorkspaceForUser retries with a randomized slug suffix on a slug collision", () => {
  assert.match(provisionTenant, /const MAX_SLUG_ATTEMPTS = 4;/u);
  assert.match(provisionTenant, /collidedOnSlug && attempt < MAX_SLUG_ATTEMPTS - 1/u);
  assert.match(provisionTenant, /randomSlugSuffix/u);
});

test("provisionWorkspaceForUser resolves an email collision to the existing winner instead of failing", () => {
  assert.match(provisionTenant, /client\.tenantUser\.findFirst\(\{ where: \{ email, isActive: true \} \}\)/u);
  assert.match(provisionTenant, /if \(existing\) return \{ tenantId: existing\.tenantId, tenantUserId: existing\.id \};/u);
});

test("provisionWorkspaceForUser takes an injectable client so it's testable without a live Postgres", () => {
  assert.match(provisionTenant, /export interface WorkspaceProvisioningClient/u);
  assert.match(provisionTenant, /client: WorkspaceProvisioningClient = prisma as unknown as WorkspaceProvisioningClient/u);
});
