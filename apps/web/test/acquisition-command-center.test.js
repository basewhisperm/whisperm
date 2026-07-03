import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const route = readFileSync("src/app/api/marketplace-acquisition/command-center/route.ts", "utf8");
const component = readFileSync("src/components/marketplace-acquisition/acquisition-command-center.tsx", "utf8");
const globalPage = readFileSync("src/app/(app)/marketplace-acquisition/page.tsx", "utf8");
const workbenchComponent = readFileSync("src/components/marketplace-acquisition/acquisition-workbench.tsx", "utf8");
const service = readFileSync("../../packages/services/src/acquisition-command-center.ts", "utf8");

test("command center route authenticates, gates the feature flag, and delegates to the service", () => {
  assert.match(route, /getTenantForCurrentUser/u);
  assert.match(route, /requireSellerAcquisitionFeatureForApi/u);
  assert.match(route, /AcquisitionCommandCenterService/u);
  assert.match(route, /getSnapshot/u);
  assert.match(route, /ok: true, data: snapshot/u);
});

test("command center route performs no direct Prisma aggregation beyond repository construction", () => {
  assert.doesNotMatch(route, /prisma\.\w+\.(findMany|aggregate|groupBy|count)\(/u);
});

test("command center service never mutates campaign, member, or deal state", () => {
  assert.doesNotMatch(service, /\.update\(/u);
  assert.doesNotMatch(service, /\.create\(/u);
  assert.match(service, /never mutate/u);
});

test("component renders revenue funnel metrics", () => {
  assert.match(component, /funnelStages/u);
  assert.match(component, /Discovered/u);
  assert.match(component, /Qualified/u);
  assert.match(component, /Invited/u);
  assert.match(component, /Claimed/u);
  assert.match(component, /Converted to CRM/u);
  assert.match(component, /Deal created/u);
  assert.match(component, /Revenue attributed/u);
  assert.match(component, /snapshot\.funnel\[stage\.key\]/u);
});

test("component renders readiness warnings", () => {
  assert.match(component, /readinessWarnings/u);
  assert.match(component, /Production readiness/u);
  assert.match(component, /warning\.message/u);
});

test("component renders next best actions", () => {
  assert.match(component, /Next best actions/u);
  assert.match(component, /topActions/u);
  assert.match(component, /action\.workbenchHref/u);
  assert.match(component, /action\.description/u);
});

test("component handles the empty (no campaign) state without crashing", () => {
  assert.match(component, /hasCampaign/u);
  assert.match(component, /No campaign yet/u);
  assert.match(component, /Create a campaign/u);
});

test("component handles API failure with a visible error state", () => {
  assert.match(component, /\(fetchError: unknown\)/u);
  assert.match(component, /setError/u);
  assert.match(component, /role="alert"/u);
});

test("component never computes or filters tenant data client-side -- it only renders the server snapshot", () => {
  assert.doesNotMatch(component, /tenantId/u);
  assert.match(component, /fetch\(`\/api\/marketplace-acquisition\/command-center/u);
});

test("global marketplace-acquisition page mounts the command center above the workbench", () => {
  assert.match(globalPage, /AcquisitionCommandCenter/u);
  assert.match(globalPage, /<AcquisitionCommandCenter \/>/u);
  const commandCenterIndex = globalPage.indexOf("<AcquisitionCommandCenter");
  const workbenchIndex = globalPage.indexOf("<AcquisitionWorkbench");
  assert.ok(commandCenterIndex >= 0 && workbenchIndex >= 0 && commandCenterIndex < workbenchIndex, "command center should render above the workbench");
});

test("campaign workbench links back to the command center", () => {
  assert.match(workbenchComponent, /Back to command center/u);
  assert.match(workbenchComponent, /href="\/marketplace-acquisition"/u);
});
