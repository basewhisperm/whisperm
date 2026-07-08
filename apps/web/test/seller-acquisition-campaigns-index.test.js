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

// ST1-013C: the campaign card's targeting/readiness truth must come from the shared
// packages/services helpers, not ad hoc inline JSX -- otherwise the card and the workbench can
// (and did) disagree about whether a campaign's targeting is configured.
test("campaigns index derives targeting truth from the canonical shared helpers", () => {
  assert.match(page, /import \{ formatCampaignTargetingSummary, getCampaignTargetingReadiness \} from "@whisperm\/services\/campaign-targeting";/u);
  assert.match(page, /formatCampaignTargetingSummary\(campaign\.metadata\)/u);
  assert.match(page, /getCampaignTargetingReadiness\(campaign\.metadata\)/u);
  assert.doesNotMatch(page, /\?\? "Not configured"/u);
});

test("campaigns index renders targeting, runtime, and members as distinct truthful sections", () => {
  assert.match(page, />Targeting</u);
  assert.match(page, />Runtime</u);
  assert.match(page, />Members</u);
  assert.match(page, /Ready to run discovery/u);
  assert.match(page, /Configure targeting/u);
});
