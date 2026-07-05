import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// ST1-010: the usage route's runtime behavior (auth, feature gating, period validation, the
// real per-tenant summary shape, and safe error handling) is now proven executably in
// apps/web/test/marketplace-acquisition-usage-metering.test.js, which transpiles and invokes the
// real route against a fake repository instead of regex-matching its source. What remains here
// are cheap structural/content checks that are reasonable to leave as source-text assertions
// (only-GET, no-secrets, component rendering) because they are not behavioral claims.
const route = readFileSync("src/app/api/marketplace-acquisition/usage/route.ts", "utf8");
const component = readFileSync("src/components/marketplace-acquisition/usage-metering-panel.tsx", "utf8");
const globalPage = readFileSync("src/app/(app)/marketplace-acquisition/page.tsx", "utf8");
const service = readFileSync("../../packages/services/src/acquisition-usage-metering.ts", "utf8");
const governanceService = readFileSync("../../packages/services/src/acquisition-governance.ts", "utf8");

test("usage route only exposes GET", () => {
  assert.match(route, /export async function GET\(/u);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)\(/u);
});

test("usage route response contains no secrets or provider tokens", () => {
  assert.doesNotMatch(route, /(secret|password|apiKey|tokenHash|stripe|paystack)/iu);
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
