import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const globalPage = readFileSync("src/app/(app)/marketplace-acquisition/page.tsx", "utf8");
const campaignPage = readFileSync("src/app/(app)/marketplace-acquisition/campaigns/[campaignId]/workbench/page.tsx", "utf8");
const component = readFileSync("src/components/marketplace-acquisition/acquisition-workbench.tsx", "utf8");
const campaignRecordsRoute = readFileSync("src/app/api/marketplace-acquisition/campaigns/[campaignId]/records/route.ts", "utf8");

test("global workbench uses reusable acquisition workbench component", () => {
  assert.match(globalPage, /AcquisitionWorkbench/u);
  assert.match(globalPage, /\/api\/marketplace-acquisition\/records/u);
  assert.match(globalPage, /mode="global"/u);
});

test("campaign workbench mounts a campaign-scoped acquisition workbench", () => {
  assert.match(campaignPage, /Campaign Workbench/u);
  assert.match(campaignPage, /campaignId/u);
  assert.match(campaignPage, /campaignId=\{campaignId\}/u);
  assert.match(campaignPage, /encodeURIComponent\(campaignId\)/u);
  assert.match(campaignPage, /\/api\/marketplace-acquisition\/campaigns\/\$\{encodeURIComponent\(campaignId\)\}\/records/u);
  assert.match(campaignPage, /mode="campaign"/u);
});

test("reusable acquisition workbench preserves core V1 operations", () => {
  assert.match(component, /Send Invites/u);
  assert.match(component, /Edit extract/u);
  assert.match(component, /WhatsApp-first/u);
  assert.match(component, /runPrimaryAction/u);
  assert.match(component, /recordsPath/u);
});

test("campaign records API supports campaign-scoped record listing", () => {
  assert.match(campaignRecordsRoute, /paramsSchema/u);
  assert.match(campaignRecordsRoute, /requireSellerAcquisitionFeatureForApi/u);
  assert.match(campaignRecordsRoute, /sellerAcquisitionRecords\.listByCampaignId/u);
  assert.doesNotMatch(campaignRecordsRoute, /sellerAcquisitionRecords\.list\(/u);
});

test("global records API remains available for unscoped record listing", () => {
  const route = readFileSync("src/app/api/marketplace-acquisition/records/route.ts", "utf8");
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

test("campaign workbench passes campaignId into reusable acquisition workbench", () => {
  const campaignPage = readFileSync("src/app/(app)/marketplace-acquisition/campaigns/[campaignId]/workbench/page.tsx", "utf8");
  assert.match(campaignPage, /campaignId=\{campaignId\}/u);
  assert.match(campaignPage, /mode="campaign"/u);
});

test("global workbench does not pass campaignId into reusable acquisition workbench", () => {
  const globalPage = readFileSync("src/app/(app)/marketplace-acquisition/page.tsx", "utf8");
  assert.doesNotMatch(globalPage, /campaignId=/u);
  assert.match(globalPage, /mode="global"/u);
});

test("AcquisitionWorkbench preserves campaignId across record refreshes", () => {
  const component = readFileSync("src/components/marketplace-acquisition/acquisition-workbench.tsx", "utf8");
  assert.match(component, /readonly campaignId\?: string \| undefined/u);
  assert.match(component, /const scopedRecordsPath = useMemo/u);
  assert.match(component, /encodeURIComponent\(campaignId\)/u);
  assert.match(component, /fetchSellerAcquisitionRecords\(scopedRecordsPath\)/u);
  assert.match(component, /\[scopedRecordsPath\]/u);
});

test("AcquisitionWorkbench keeps global records path unchanged without campaignId", () => {
  const component = readFileSync("src/components/marketplace-acquisition/acquisition-workbench.tsx", "utf8");
  assert.match(component, /campaignId === undefined \|\| campaignId\.trim\(\)\.length === 0/u);
  assert.match(component, /return recordsPath/u);
});

test("campaign workbench visualizes autonomous discovery runtime state without executing discovery", () => {
  assert.match(component, /fetchDiscoveryRuntimeState/u);
  assert.match(component, /Autonomous discovery execution/u);
  assert.match(component, /discoveredCount/u);
  assert.match(component, /capturedCount/u);
  assert.match(component, /skippedDuplicateCount/u);
  assert.doesNotMatch(component, /runDiscovery\(/u);
});
