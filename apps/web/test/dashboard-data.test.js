import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(`${root}src/${path}`, "utf8");

const helper = read("lib/dashboard-data.ts");

test("dashboard data helper defines the typed load-result contract from ST1-013H", () => {
  assert.match(helper, /export type DashboardLoadResult =/u);
  assert.match(helper, /"AUTH_REQUIRED"/u);
  assert.match(helper, /"TENANT_REQUIRED"/u);
  assert.match(helper, /"FEATURE_DISABLED"/u);
  assert.match(helper, /"CONFIGURATION_ERROR"/u);
  assert.match(helper, /"UPSTREAM_ERROR"/u);
  assert.match(helper, /"UNKNOWN_ERROR"/u);
});

test("dashboard data helper never falls back to fake zero metrics or empty arrays on failure", () => {
  assert.doesNotMatch(helper, /activeContacts: 0/u);
  assert.doesNotMatch(helper, /activities: \[\]/u);
  assert.doesNotMatch(helper, /catch \{/u);
  assert.match(helper, /return \{ ok: false, error: classifyThrown\(error\) \};/u);
});

test("dashboard data helper resolves tenant and feature state before querying any acquisition data", () => {
  assert.match(helper, /resolveTenantForCurrentUser/u);
  assert.match(helper, /getTenantFeatureState\(resolution\.tenant\.id, SELLER_ACQUISITION_FEATURE\)/u);
  assert.match(helper, /if \(!featureState\.enabled\)/u);
  assert.match(helper, /code: "FEATURE_DISABLED"/u);
});

test("dashboard data helper scopes every repository/service call to the resolved tenant", () => {
  assert.match(helper, /const context = \{ tenantId: resolution\.tenant\.id \}/u);
  assert.match(helper, /dashboardRepo\.countActiveContacts\(context\)/u);
  assert.match(helper, /metrics\.getGlobalMetrics\(context\)/u);
  assert.match(helper, /records\.list\(context, \{ limit: RECORDS_PAGE_LIMIT \}\)/u);
  assert.match(helper, /campaigns\.list\(context\)/u);
});

test("dashboard data helper classifies thrown errors without leaking raw error messages", () => {
  assert.match(helper, /const classifyThrown = \(error: unknown\): DashboardLoadError =>/u);
  assert.match(helper, /error instanceof Error \? \{ detail: error\.name \} : \{\}/u);
  assert.doesNotMatch(helper, /detail: error\.message/u);
});

test("dashboard data helper is the only place page.tsx and the API route may source dashboard data from", () => {
  const page = read("app/(app)/dashboard/page.tsx");
  const route = read("app/api/dashboard/route.ts");
  assert.match(page, /getDashboardDataForCurrentTenant/u);
  assert.match(route, /getDashboardDataForCurrentTenant/u);
});
