import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(`${root}src/${path}`, "utf8");

const page = read("app/(app)/dashboard/page.tsx");

test("dashboard page loads data through the shared helper instead of self-fetching", () => {
  assert.match(page, /getDashboardDataForCurrentTenant/u);
  assert.doesNotMatch(page, /NEXT_PUBLIC_APP_URL/u);
  assert.doesNotMatch(page, /fetch\(/u);
});

test("dashboard page renders an explicit status panel instead of fake zero metrics on failure", () => {
  assert.match(page, /if \(!result\.ok\)/u);
  assert.match(page, /import \{ DashboardStatusPanel \} from "@\/components\/dashboard\/dashboard-status-panel"/u);
  assert.match(page, /<DashboardStatusPanel/u);
});

test("dashboard page status panel maps every error code to a distinct, safe title", () => {
  assert.match(page, /STATUS_PANEL_TITLE: Readonly<Record<DashboardLoadErrorCode, string>>/u);
  assert.match(page, /AUTH_REQUIRED: "Workspace access could not be resolved\."/u);
  assert.match(page, /TENANT_REQUIRED: "Workspace access could not be resolved\."/u);
  assert.match(page, /FEATURE_DISABLED: "Marketplace acquisition is disabled for this workspace\."/u);
  assert.match(page, /UPSTREAM_ERROR: "Dashboard data could not be loaded\."/u);
  assert.doesNotMatch(page, /(secret|password|apiKey|tokenHash|stack)/iu);
});

test("dashboard page reports ready-for-conversion and converted as distinct, non-conflated metrics", () => {
  assert.doesNotMatch(page, /converted \|\| .*readyConversion/u);
  assert.match(page, /acquisitionMetrics\.readyConversion/u);
  assert.match(page, /acquisitionMetrics\.converted/u);
  assert.match(page, /label: "Ready for Conversion"/u);
  assert.match(page, /label: "Converted"/u);
});

test("dashboard page keeps distinct truthful empty states for campaigns, priority queue, and activity", () => {
  assert.match(page, /No seller acquisition campaigns yet\./u);
  assert.match(page, /No seller acquisition records yet\./u);
  assert.match(page, /No acquisition activity yet\./u);
});
