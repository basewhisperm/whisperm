import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(`${root}src/${path}`, "utf8");

const route = read("app/api/dashboard/route.ts");

test("dashboard API route delegates entirely to the shared data helper", () => {
  assert.match(route, /getDashboardDataForCurrentTenant/u);
  assert.doesNotMatch(route, /PrismaDashboardRepository/u);
  assert.doesNotMatch(route, /prisma\.\w+\.(findMany|aggregate|groupBy|count)\(/u);
});

test("dashboard API route returns 200 with data on success", () => {
  assert.match(route, /return NextResponse\.json\(\{ ok: true, data: result\.data \}\);/u);
});

test("dashboard API route returns a non-200 status and typed error payload on failure, never silent zeros", () => {
  assert.match(route, /if \(!result\.ok\)/u);
  assert.match(route, /STATUS_BY_ERROR_CODE\[result\.error\.code\]/u);
  assert.doesNotMatch(route, /activeContacts: 0/u);
  assert.doesNotMatch(route, /catch \{/u);
});

test("dashboard API route maps every load-error code to a non-200 status", () => {
  for (const code of ["AUTH_REQUIRED", "TENANT_REQUIRED", "FEATURE_DISABLED", "CONFIGURATION_ERROR", "UPSTREAM_ERROR", "UNKNOWN_ERROR"]) {
    const match = route.match(new RegExp(`${code}: (\\d{3})`, "u"));
    assert.ok(match, `expected a status mapping for ${code}`);
    assert.notStrictEqual(Number(match[1]), 200, `${code} must not map to 200`);
  }
});
