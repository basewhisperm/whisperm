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

test("records API supports campaignId scoped record listing", () => {
  const route = readFileSync("src/app/api/marketplace-acquisition/records/route.ts", "utf8");
  assert.match(route, /searchParams\.get\("campaignId"\)/u);
  assert.match(route, /sellerAcquisitionRecords\.listByCampaignId/u);
  assert.match(route, /sellerAcquisitionRecords\.list/u);
});

test("SellerAcquisitionRecordService lists records by campaign membership", () => {
  const service = readFileSync("../../packages/services/src/seller-acquisition-records.ts", "utf8");
  assert.match(service, /async listByCampaignId/u);
  assert.match(service, /sellerAcquisitionCampaigns\.findById/u);
  assert.match(service, /sellerAcquisitionCampaigns\.listMembers/u);
  assert.match(service, /marketplaceCaptures\.findById/u);
  assert.match(service, /member\.marketplaceCaptureId/u);
});
