import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(join(root, "src", path), "utf8");

test("dashboard sources real seller acquisition campaigns from the shared dashboard data helper", () => {
  const page = read("app/(app)/dashboard/page.tsx");

  assert.match(page, /getDashboardDataForCurrentTenant/u);
  assert.match(page, /const \{ activeContacts, pipelineValue, activities, acquisitionMetrics, acquisitionRecords, campaigns \} = result\.data;/u);
});

test("dashboard removes stale campaign placeholder copy", () => {
  const page = read("app/(app)/dashboard/page.tsx");

  assert.doesNotMatch(page, /Campaign model lands in Slice 4/u);
  assert.doesNotMatch(page, /Campaign records arrive in the next infrastructure slices/u);
  assert.match(page, /Track live campaign activity/u);
});

test("dashboard uses real campaign metrics and campaign CTAs", () => {
  const page = read("app/(app)/dashboard/page.tsx");

  assert.match(page, /const activeCampaigns = campaigns\.filter/u);
  assert.match(page, /value: String\(activeCampaigns\)/u);
  assert.match(page, /Campaign Progress/u);
  assert.match(page, /href="\/marketplace-acquisition\/campaigns"/u);
  assert.match(page, /href=\{`\/marketplace-acquisition\/campaigns\/\$\{campaign\.id\}\/workbench`\}/u);
});
