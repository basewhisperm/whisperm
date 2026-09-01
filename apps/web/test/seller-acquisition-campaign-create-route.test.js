import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const route = readFileSync("src/app/api/marketplace-acquisition/campaigns/route.ts", "utf8");

test("campaign creation validates explicit owner IDs as UUIDs", () => {
  assert.match(route, /ownerId: z\.string\(\)\.uuid\(\)\.nullable\(\)\.optional\(\)/u);
});

test("campaign creation assigns the signed-in tenant user when owner is omitted", () => {
  assert.match(route, /const \{ tenant, tenantUserId \} = tenantContext;/u);
  assert.match(route, /ownerId: parsed\.data\.ownerId \?\? tenantUserId/u);
});
