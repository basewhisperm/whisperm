import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const page = readFileSync("src/app/(app)/marketplace-acquisition/campaigns/page.tsx", "utf8");
const sidebar = readFileSync("src/components/app-shell/sidebar.tsx", "utf8");
const topbar = readFileSync("src/components/app-shell/top-bar.tsx", "utf8");
const acquisitionLanguage = readFileSync("src/lib/marketplace-acquisition/acquisition-language.ts", "utf8");

test("campaigns index is wired into seller acquisition navigation", () => {
  assert.match(sidebar, /\/marketplace-acquisition\/campaigns/u);
  assert.match(topbar, /\/marketplace-acquisition\/campaigns/u);
});

test("campaigns index supports V1 campaign operations", () => {
  assert.match(page, /Total Campaigns/u);
  assert.match(page, /Active Campaigns/u);
  assert.match(page, /Draft Campaigns/u);
  assert.match(page, /Archived Campaigns/u);
  // ST1-013G: the primary CTA label is rendered from the canonical acquisition-language
  // constants, not a hardcoded string -- verify the wiring and the canonical value separately.
  assert.match(page, /ACQUISITION_COPY\.actions\.createCampaign/u);
  assert.match(acquisitionLanguage, /createCampaign: "Create Campaign"/u);
  assert.match(page, /No campaigns yet/u);
  assert.match(page, /Archive/u);
  assert.match(page, /PATCH/u);
  assert.match(page, /POST/u);
  assert.match(page, /\/api\/marketplace-acquisition\/campaigns/u);
});

test("campaigns index keeps loading, error, and empty states mutually exclusive", () => {
  assert.match(page, /!loading && !error/u);
  assert.match(page, /\) : error \? \(/u);
  assert.match(page, /Campaigns couldn&apos;t be loaded\./u);
  assert.match(page, /role="alert"/u);
  assert.match(page, /setCampaigns\(\[\]\);/u);
  assert.match(page, /\) : filteredCampaigns\.length === 0 \? \(/u);
});

test("campaign refresh and failure retry have distinct labels", () => {
  assert.match(page, /<IconRefresh[^>]+\/>\s*Refresh/u);
  assert.match(page, /Campaigns couldn&apos;t be loaded[\s\S]*<IconRefresh[^>]+\/>\s*Retry/u);
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
  // ST1-013D: the CTA label is rendered from the canonical workflow resolver
  // (nextAction.label), not a hardcoded string -- see the workflow-resolver test below.
  assert.match(page, /\{nextAction\.label\}/u);
});

// ST1-013D: campaign cards derive current stage/next action from the canonical acquisition
// workflow resolver instead of ad hoc inline CTA strings, so "Open"/"Run discovery again" style
// wording can no longer drift from the rest of the acquisition experience.
test("campaigns index derives current stage and next action from the canonical workflow resolver", () => {
  assert.match(page, /import \{\s*getCampaignWorkflowBlockers,\s*getCampaignWorkflowStageLabel,\s*getNextCampaignWorkflowAction,\s*resolveCampaignWorkflowStage,\s*\} from "@whisperm\/services\/acquisition-workflow";/u);
  assert.match(page, /resolveCampaignWorkflowStage\(\{ targetingReady: readiness\.status === "READY", memberCount \}\)/u);
  assert.match(page, /getNextCampaignWorkflowAction\(workflowStage\)/u);
  assert.match(page, /data-testid="campaign-workflow-stage"/u);
  assert.match(page, /data-testid="campaign-workflow-next-action"/u);
});

// Review finding: the "Run discovery"/"Run discovery again" CTAs pointed at the workbench, which
// only reads runtime state -- the actual discovery trigger (POST .../discovery/runs) lives under
// the campaign's /discovery route. Both discovery CTAs must link there, not to the workbench.
test("run discovery CTAs link to the campaign discovery route, not the workbench", () => {
  assert.match(page, /const discoveryHref = `\/marketplace-acquisition\/campaigns\/\$\{campaign\.id\}\/discovery`;/u);
  assert.match(page, /href=\{discoveryHref\}>\s*Run Discovery\s*<\/Link>/u);
  assert.match(page, /const nextActionHref = workflowStage === "READY_FOR_DISCOVERY" \? discoveryHref : workbenchHref;/u);
});
