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

// ST1-013C: the workbench must show the campaign's own saved targeting (fetched from the
// canonical campaign record) rather than only the last discovery execution's metrics snapshot --
// otherwise a campaign with valid targeting that has never run discovery yet shows stale/absent
// targeting state that contradicts the campaigns list card.
test("campaign workbench renders canonical campaign targeting truth independent of discovery execution history", () => {
  assert.match(component, /fetchCampaignSummary/u);
  assert.match(component, /getCampaignTargetingReadiness\(campaignSummary\.metadata\)/u);
  assert.match(component, /formatCampaignTargetingSummary\(campaignSummary\.metadata\)/u);
  assert.match(component, /aria-label="Campaign targeting"/u);
});

test("workbench renders seller relationship memory from API projection", () => {
  assert.match(component, /Seller relationship memory/u);
  assert.match(component, /sellerRelationshipTimelineItems/u);
  const domain = readFileSync("src/lib/marketplace-acquisition/workbench-domain.ts", "utf8");
  assert.match(domain, /relationshipMemory\?\.timeline/u);
  assert.match(domain, /Date\.parse\(a\.occurredAt\)/u);
});

test('workbench renders claim intelligence state from API projection', () => {
  const source = component;
  const domain = readFileSync('src/lib/marketplace-acquisition/workbench-domain.ts', 'utf8');
  assert.match(source, /Claim intelligence/);
  assert.match(source, /claimIntelligenceItems\(record\)/);
  assert.match(domain, /claimIntelligenceRecoveryActionStatus/);
  assert.match(domain, /Stalled reason/);
});

test('workbench renders CRM conversion state from canonical Contact/Deal linkage, not dead post-claim runtime metadata', () => {
  assert.match(component, /CRM conversion/u);
  assert.match(component, /crmConversionStatus\(record\)/u);
  assert.match(component, /record\.contact !== null && record\.deal !== null/u);
  assert.doesNotMatch(component, /crmConversionContactId/u);
  assert.doesNotMatch(component, /crmConversionDealId/u);
  assert.doesNotMatch(component, /crmConversionFailureCode/u);
  assert.doesNotMatch(component, /executeConversion\(/u);
});
