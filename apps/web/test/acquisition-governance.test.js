import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const route = readFileSync("src/app/api/marketplace-acquisition/governance/route.ts", "utf8");
const component = readFileSync("src/components/marketplace-acquisition/governance-panel.tsx", "utf8");
const globalPage = readFileSync("src/app/(app)/marketplace-acquisition/page.tsx", "utf8");
const service = readFileSync("../../packages/services/src/acquisition-governance.ts", "utf8");

test("governance route authenticates and delegates to the service", () => {
  assert.match(route, /getTenantForCurrentUser/u);
  assert.match(route, /AcquisitionGovernanceService/u);
  assert.match(route, /getGovernanceSnapshot/u);
  assert.match(route, /ok: true, data: snapshot/u);
});

test("governance route only exposes GET", () => {
  assert.match(route, /export async function GET\(/u);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)\(/u);
});

test("governance route returns 401 when there is no tenant", () => {
  assert.match(route, /if \(!tenant\) return errorResponse\("Unauthorized", 401\)/u);
});

test("governance route never hard-gates the snapshot behind the feature flag -- the snapshot itself reports the disabled state", () => {
  assert.doesNotMatch(route, /requireSellerAcquisitionFeatureForApi/u);
});

test("governance route returns a safe 500 message on service failure and never leaks internals", () => {
  assert.match(route, /catch/u);
  assert.match(route, /Failed to load acquisition governance\./u);
  assert.doesNotMatch(route, /(secret|password|apiKey|tokenHash)/iu);
});

test("governance route performs no direct Prisma aggregation beyond repository construction", () => {
  assert.doesNotMatch(route, /prisma\.\w+\.(findMany|aggregate|groupBy|count)\(/u);
});

test("governance service centralizes decisions and never mutates campaign, execution, or deal state", () => {
  assert.doesNotMatch(service, /\.update\(/u);
  assert.doesNotMatch(service, /\.create\(/u);
});

test("component renders the Governance & Limits section title and overall status", () => {
  assert.match(component, /Governance & Limits/u);
  assert.match(component, /snapshot\.overallStatus/u);
});

test("component renders the plan name and feature state", () => {
  assert.match(component, /snapshot\.planName/u);
  assert.match(component, /snapshot\.featureEnabled/u);
});

test("component renders a capability table", () => {
  assert.match(component, /snapshot\.capabilities/u);
  assert.match(component, /\.status/u);
});

test("component renders a limits table", () => {
  assert.match(component, /snapshot\.limits\.map/u);
  assert.match(component, /limit\.used/u);
  assert.match(component, /limit\.limit/u);
  assert.match(component, /limit\.period/u);
});

test("component renders a warning list with severity", () => {
  assert.match(component, /snapshot\.warnings\.map/u);
  assert.match(component, /warning\.severity/u);
  assert.match(component, /warning\.message/u);
});

test("component handles the disabled/empty state usefully instead of crashing", () => {
  assert.match(component, /DISABLED/u);
  assert.match(component, /not enabled/iu);
});

test("component handles API failure with a visible error state", () => {
  assert.match(component, /\(fetchError: unknown\)/u);
  assert.match(component, /setError/u);
  assert.match(component, /role="alert"/u);
});

test("component never computes tenant data client-side -- it only renders the server snapshot", () => {
  assert.doesNotMatch(component, /tenantId/u);
  assert.match(component, /fetch\("\/api\/marketplace-acquisition\/governance"\)/u);
});

test("component does not render secrets or raw internal ids beyond what is needed", () => {
  assert.doesNotMatch(component, /(token|secret|apiKey|password)/iu);
});

test("component contains no direct Prisma logic", () => {
  assert.doesNotMatch(component, /prisma\./u);
});

test("global marketplace-acquisition page mounts the governance panel", () => {
  assert.match(globalPage, /GovernancePanel/u);
  assert.match(globalPage, /<GovernancePanel \/>/u);
});
