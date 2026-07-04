import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const route = readFileSync("src/app/api/marketplace-acquisition/usage/route.ts", "utf8");
const component = readFileSync("src/components/marketplace-acquisition/usage-metering-panel.tsx", "utf8");
const globalPage = readFileSync("src/app/(app)/marketplace-acquisition/page.tsx", "utf8");
const service = readFileSync("../../packages/services/src/acquisition-usage-metering.ts", "utf8");
const governanceService = readFileSync("../../packages/services/src/acquisition-governance.ts", "utf8");

test("usage route authenticates, gates the feature flag, and delegates to the service", () => {
  assert.match(route, /getTenantForCurrentUser/u);
  assert.match(route, /requireSellerAcquisitionFeatureForApi/u);
  assert.match(route, /AcquisitionUsageMeteringService/u);
  assert.match(route, /getUsageSummary/u);
  assert.match(route, /ok: true/u);
});

test("usage route only exposes GET", () => {
  assert.match(route, /export async function GET\(/u);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)\(/u);
});

test("usage route returns 401 when there is no tenant", () => {
  assert.match(route, /if \(!tenant\) return errorResponse\("Unauthorized", 401\)/u);
});

test("usage route returns 400 for invalid period dates", () => {
  assert.match(route, /querySchema\.safeParse/u);
  assert.match(route, /if \(!parsed\.success\) return errorResponse\(.*400\)/u);
});

test("usage route accepts periodStart and periodEnd query params", () => {
  assert.match(route, /searchParams\.get\("periodStart"\)/u);
  assert.match(route, /searchParams\.get\("periodEnd"\)/u);
});

test("usage route response contains no secrets or provider tokens", () => {
  assert.doesNotMatch(route, /(secret|password|apiKey|tokenHash|stripe|paystack)/iu);
});

test("usage route returns a safe 500 message on service failure and never leaks internals", () => {
  assert.match(route, /catch \(error\)/u);
  assert.doesNotMatch(route, /error\.stack/u);
});

test("usage service never mutates billing plans or campaign/execution state", () => {
  assert.doesNotMatch(service, /\.update\(/u);
  assert.doesNotMatch(service, /billingPlan/iu);
  assert.doesNotMatch(service, /stripe|paystack/iu);
});

test("usage service is tenant-scoped and idempotent by construction", () => {
  assert.match(service, /createIfNotExists/u);
  assert.match(service, /tenantId/u);
});

test("governance service can read usage summaries from the metering repository", () => {
  assert.match(governanceService, /usageEvents/u);
  assert.match(governanceService, /summarizeByTenantAndPeriod/u);
});

test("component renders the Usage & Metering section title", () => {
  assert.match(component, /Usage & Metering/u);
});

test("component renders current month usage and billable totals", () => {
  assert.match(component, /summary\.billableTotalQuantity/u);
  assert.match(component, /billableRows/u);
  assert.match(component, /total\.billableQuantity/u);
});

test("component renders non-billable usage separately", () => {
  assert.match(component, /nonBillableRows/u);
  assert.match(component, /Non-billable activity/u);
});

test("component clarifies this is metering, not invoice finalization", () => {
  assert.match(component, /not an invoice/iu);
});

test("component has a useful empty state", () => {
  assert.match(component, /isEmpty/u);
  assert.match(component, /No acquisition activity has been metered yet/u);
});

test("component handles API failure with a visible error state", () => {
  assert.match(component, /\(fetchError: unknown\)/u);
  assert.match(component, /setError/u);
  assert.match(component, /role="alert"/u);
});

test("component never computes tenant data client-side -- it only renders the server summary", () => {
  assert.doesNotMatch(component, /tenantId/u);
  assert.match(component, /fetch\("\/api\/marketplace-acquisition\/usage"\)/u);
});

test("component does not render secrets, tokens, or raw invoice/payment data", () => {
  assert.doesNotMatch(component, /(secret|apiKey|password|stripe|paystack)/iu);
});

test("global marketplace-acquisition page mounts the usage metering panel", () => {
  assert.match(globalPage, /UsageMeteringPanel/u);
  assert.match(globalPage, /<UsageMeteringPanel \/>/u);
});
