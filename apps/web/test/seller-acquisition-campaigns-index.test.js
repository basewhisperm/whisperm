import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const page = readFileSync("src/app/(app)/marketplace-acquisition/campaigns/page.tsx", "utf8");
const sidebar = readFileSync("src/components/app-shell/sidebar.tsx", "utf8");
const topbar = readFileSync("src/components/app-shell/top-bar.tsx", "utf8");

test("campaigns index is wired into seller acquisition navigation", () => {
  assert.match(sidebar, /\/marketplace-acquisition\/campaigns/u);
  assert.match(topbar, /\/marketplace-acquisition\/campaigns/u);
});

test("campaigns index supports V1 campaign operations", () => {
  assert.match(page, /Total Campaigns/u);
  assert.match(page, /Active Campaigns/u);
  assert.match(page, /Draft Campaigns/u);
  assert.match(page, /Archived Campaigns/u);
  assert.match(page, /New Campaign/u);
  assert.match(page, /Create your first campaign/u);
  assert.match(page, /Archive/u);
  assert.match(page, /PATCH/u);
  assert.match(page, /POST/u);
  assert.match(page, /\/api\/marketplace-acquisition\/campaigns/u);
});
