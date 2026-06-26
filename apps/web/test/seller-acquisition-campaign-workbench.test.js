import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const globalPage = readFileSync("src/app/(app)/marketplace-acquisition/page.tsx", "utf8");
const campaignPage = readFileSync("src/app/(app)/marketplace-acquisition/campaigns/[campaignId]/workbench/page.tsx", "utf8");
const component = readFileSync("src/components/marketplace-acquisition/acquisition-workbench.tsx", "utf8");

test("global workbench uses reusable acquisition workbench component", () => {
  assert.match(globalPage, /AcquisitionWorkbench/u);
  assert.match(globalPage, /\/api\/marketplace-acquisition\/records/u);
  assert.match(globalPage, /mode="global"/u);
});

test("campaign workbench mounts a campaign-scoped acquisition workbench", () => {
  assert.match(campaignPage, /Campaign Workbench/u);
  assert.match(campaignPage, /campaignId/u);
  assert.match(campaignPage, /records\?campaignId=/u);
  assert.match(campaignPage, /mode="campaign"/u);
});

test("reusable acquisition workbench preserves core V1 operations", () => {
  assert.match(component, /Send Invites/u);
  assert.match(component, /Edit extract/u);
  assert.match(component, /WhatsApp-first/u);
  assert.match(component, /runPrimaryAction/u);
  assert.match(component, /recordsPath/u);
});
