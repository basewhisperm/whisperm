import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const route = readFileSync("src/app/api/marketplace-acquisition/runtime-health/route.ts", "utf8");
const component = readFileSync("src/components/marketplace-acquisition/runtime-health-panel.tsx", "utf8");
const globalPage = readFileSync("src/app/(app)/marketplace-acquisition/page.tsx", "utf8");
const service = readFileSync("../../packages/services/src/acquisition-runtime-health.ts", "utf8");

test("runtime health route authenticates, gates the feature flag, and delegates to the service", () => {
  assert.match(route, /getTenantForCurrentUser/u);
  assert.match(route, /requireSellerAcquisitionFeatureForApi/u);
  assert.match(route, /AcquisitionRuntimeHealthService/u);
  assert.match(route, /getRuntimeHealth/u);
  assert.match(route, /apiSuccess\(snapshot\)/u);
});

test("runtime health route returns 401 when there is no tenant", () => {
  assert.match(route, /if \(!tenant\) return apiFailure\(401, "UNAUTHORIZED", "Unauthorized"\)/u);
});

test("runtime health route returns the existing feature-denied response when the flag is off", () => {
  assert.match(route, /const featureDenied = await requireSellerAcquisitionFeatureForApi\(tenant\.id\)/u);
  assert.match(route, /if \(featureDenied\) return featureDenied/u);
});

test("runtime health route returns a safe 500 message on service failure and never leaks internals", () => {
  assert.match(route, /catch \(error\)/u);
  assert.match(route, /Failed to load acquisition runtime health\./u);
  assert.doesNotMatch(route, /(secret|password|apiKey|tokenHash)/iu);
});

test("runtime health route performs no direct Prisma aggregation beyond repository construction", () => {
  assert.doesNotMatch(route, /prisma\.\w+\.(findMany|aggregate|groupBy|count)\(/u);
});

test("runtime health service is read-only and never mutates campaign, execution, deal, or capture state", () => {
  assert.doesNotMatch(service, /\.update\(/u);
  assert.doesNotMatch(service, /\.create\(/u);
  assert.match(service, /never mutate/u);
});

test("component renders the section title and overall status badge", () => {
  assert.match(component, /Autonomous Runtime Health/u);
  assert.match(component, /snapshot\.overallStatus/u);
});

test("component renders last successful run, retry backlog, and dead-letter count", () => {
  assert.match(component, /last successful run/u);
  assert.match(component, /retry backlog/u);
  assert.match(component, /dead letters/u);
  assert.match(component, /snapshot\.lastSuccessfulRunAt/u);
  assert.match(component, /snapshot\.retryBacklog/u);
  assert.match(component, /snapshot\.deadLetterCount/u);
});

test("component renders a runtime unit health table", () => {
  assert.match(component, /Runtime unit health/u);
  assert.match(component, /snapshot\.units\.map/u);
  assert.match(component, /unit\.status/u);
  assert.match(component, /unit\.retryBacklog/u);
  assert.match(component, /unit\.deadLetterCount/u);
});

test("component renders a provider health table", () => {
  assert.match(component, /Provider health/u);
  assert.match(component, /snapshot\.providers\.map/u);
  assert.match(component, /provider\.configured/u);
  assert.match(component, /provider\.status/u);
});

test("component renders recommended operations actions", () => {
  assert.match(component, /Recommended operations actions/u);
  assert.match(component, /recommendedOperationsActions\.map/u);
  assert.match(component, /action\.priority/u);
  assert.match(component, /action\.description/u);
});

test("component handles the UNKNOWN empty state usefully instead of crashing", () => {
  assert.match(component, /isUnknown/u);
  assert.match(component, /No acquisition runtime data yet/u);
});

test("component handles API failure with a visible error state", () => {
  assert.match(component, /\(fetchError: unknown\)/u);
  assert.match(component, /setError/u);
  assert.match(component, /role="alert"/u);
});

test("component never computes tenant data client-side -- it only renders the server snapshot", () => {
  assert.doesNotMatch(component, /tenantId/u);
  assert.match(component, /fetch\("\/api\/marketplace-acquisition\/runtime-health"\)/u);
});

test("component does not render secrets or raw internal ids beyond what is needed", () => {
  assert.doesNotMatch(component, /(token|secret|apiKey|password)/iu);
});

test("global marketplace-acquisition page mounts the runtime health panel between the command center and the workbench", () => {
  assert.match(globalPage, /RuntimeHealthPanel/u);
  assert.match(globalPage, /<RuntimeHealthPanel \/>/u);
  const commandCenterIndex = globalPage.indexOf("<AcquisitionCommandCenter");
  const runtimeHealthIndex = globalPage.indexOf("<RuntimeHealthPanel");
  const workbenchIndex = globalPage.indexOf("<AcquisitionWorkbench");
  assert.ok(
    commandCenterIndex >= 0 && runtimeHealthIndex >= 0 && workbenchIndex >= 0 &&
    commandCenterIndex < runtimeHealthIndex && runtimeHealthIndex < workbenchIndex,
    "runtime health panel should render between the command center and the workbench",
  );
});
