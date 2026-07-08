import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(`${root}src/${path}`, "utf8");

const component = read("components/dashboard/dashboard-status-panel.tsx");

test("DashboardStatusPanel exposes the required props", () => {
  assert.match(component, /title: string/u);
  assert.match(component, /message: string/u);
  assert.match(component, /code\?: string/u);
  assert.match(component, /actionLabel\?: string/u);
  assert.match(component, /actionHref\?: string/u);
});

test("DashboardStatusPanel renders as an alert with a stable test id", () => {
  assert.match(component, /role="alert"/u);
  assert.match(component, /data-testid="dashboard-status-panel"/u);
});

test("DashboardStatusPanel never renders secrets or raw stack traces", () => {
  assert.doesNotMatch(component, /(secret|password|apiKey|stack)/iu);
});
