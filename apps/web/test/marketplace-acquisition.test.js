import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";

const appRoot = fileURLToPath(new URL("../src/", import.meta.url));

function read(relativePath) {
  return readFileSync(join(appRoot, relativePath), "utf8");
}

test("marketplace sellers page uses SellerAcquisitionRecord command center", () => {
  const source = read("components/marketplace-acquisition/acquisition-workbench.tsx");

  assert.match(source, /recordsPath/u);
  const recordsStore = read("lib/marketplace-acquisition/records-store.ts");
  assert.match(recordsStore, /\/api\/marketplace-acquisition\/records/u);
  assert.doesNotMatch(source, /fetch\("\/api\/deals\?pipelineDefaultKey=marketplace_acquisition"\)/u);
  assert.match(source, /Acquisition Workbench/u);
  assert.doesNotMatch(source, /<h1[^>]*>Seller Capture<\/h1>/u);
  for (const label of [
    "Needs Phone Reveal",
    "Needs Invitation",
    "Waiting For Claim",
    "Ready For Seller Conversion",
    "Ready For Inventory Conversion",
    "Ready To Complete",
  ]) {
    assert.match(source, new RegExp(label, "u"));
  }
  assert.match(source, /Mobile required/u);
  assert.match(source, /PHONE_REQUIRED blocks invitation/u);
  assert.match(source, /WhatsApp will be attempted first/u);
  assert.match(source, /SMS is fallback/u);
  assert.match(source, /Email is optional for non-cellphone-first markets/u);
  assert.match(source, /PHONE READY/u);
  assert.match(source, /queueBuckets\.find\(\(bucket\) => bucket\.matches\(record\)\)/u);
  assert.match(source, /Captured \$\{captured\}/u);
  assert.match(source, /Seller dossier/u);
  assert.match(source, /Seller command center summary/u);
  assert.match(source, /Total sellers/u);
  assert.match(source, /Phone-ready/u);
  assert.match(source, /Seller portfolio/u);
  assert.match(source, /Phone-ready captures/u);
  assert.doesNotMatch(source, /generic Prospect/u);
});

test("seller acquisition navigation is add-on gated and keeps core CRM links", () => {
  const sidebar = read("components/app-shell/sidebar.tsx");
  const appShell = read("components/app-shell/app-shell.tsx");
  const appLayout = read("app/(app)/layout.tsx");
  const messages = JSON.parse(read("lib/i18n/en.json"));

  assert.equal(messages["marketplaceSellers.title"], "Marketplace Sellers");
  assert.doesNotMatch(sidebar, /labelKey: "marketplaceCapture\.title"/u);
  assert.doesNotMatch(sidebar, /href: "\/marketplace-acquisition\/capture"/u);
  assert.match(sidebar, /SELLER_ACQUISITION_FEATURE/u);
  assert.match(sidebar, /enabledFeatures\.includes\(SELLER_ACQUISITION_FEATURE\)/u);
  assert.match(sidebar, /marketplaceSellers\.title/u);
  assert.match(appLayout, /getTenantFeatures\(tenant\.id\)/u);
  assert.match(appLayout, /<AppShell enabledFeatures=\{enabledFeatures\}>/u);
  assert.match(appShell, /<Sidebar enabledFeatures=\{enabledFeatures \?\? \[\]\} \/>/u);

  for (const coreLabel of ["dashboard.title", "contacts.title", "deals.title", "reports.title", "settings.title"]) {
    assert.match(sidebar, new RegExp(coreLabel, "u"));
  }
});

test("seller acquisition app pages are gated by tenant entitlement", () => {
  const layout = read("app/(app)/marketplace-acquisition/layout.tsx");

  assert.match(layout, /getTenantForCurrentUser/u);
  assert.match(layout, /SELLER_ACQUISITION_FEATURE/u);
  assert.match(layout, /isProtectedTenantFeatureEnabled\(tenant\.id, SELLER_ACQUISITION_FEATURE\)/u);
  assert.match(layout, /notFound\(\)/u);
});

test("seller acquisition API gating excludes public claim routes", () => {
  const publicClaimRoutes = [
    "app/api/marketplace-acquisition/claims/[token]/route.ts",
    "app/api/marketplace-acquisition/claims/[token]/accept/route.ts",
  ];
  for (const routePath of publicClaimRoutes) {
    const route = read(routePath);
    assert.doesNotMatch(route, /SELLER_ACQUISITION_FEATURE|tenant-features|isTenantFeatureEnabled|featureNotEnabledResponse/u);
  }

  const authenticatedRoutes = [
    "app/api/marketplace-acquisition/analytics/route.ts",
    "app/api/marketplace-acquisition/captures/route.ts",
    "app/api/marketplace-acquisition/captures/from-url/route.ts",
    "app/api/marketplace-acquisition/captures/[id]/invite/route.ts",
    "app/api/marketplace-acquisition/captures/[id]/complete/route.ts",
    "app/api/marketplace-acquisition/captures/[id]/convert/render-seller/route.ts",
    "app/api/marketplace-acquisition/captures/[id]/convert/render-inventory/route.ts",
    "app/api/marketplace-acquisition/deals/route.ts",
    "app/api/marketplace-acquisition/deals/[dealId]/stage/route.ts",
    "app/api/marketplace-acquisition/records/route.ts",
    "app/api/marketplace-acquisition/records/[captureId]/route.ts",
  ];
  for (const routePath of authenticatedRoutes) {
    const route = read(routePath);
    assert.match(route, /requireSellerAcquisitionFeatureForApi/u);
    assert.doesNotMatch(route, /isTenantFeatureEnabled\(tenant\.id/u);
  }

  const helper = read("lib/tenant-features.ts");
  assert.match(helper, /isProtectedTenantFeatureEnabled/u);
  assert.match(helper, /protected_tenant_feature_lookup_failed/u);
  assert.match(helper, /requireSellerAcquisitionFeatureForApi/u);
  assert.match(helper, /FEATURE_NOT_ENABLED/u);
  assert.match(helper, /Seller Acquisition add-on is not enabled for this workspace\./u);
  assert.match(helper, /\{ status: 403 \}/u);
});


test("deals API preserves default behavior and supports marketplace acquisition default key filtering", () => {
  const route = read("app/api/deals/route.ts");

  assert.match(
    route,
    /pipelineDefaultKey === undefined\s*\? await pipelineRepo\.findByWorkspace/u,
  );
  assert.match(
    route,
    /pipelineRepo\.findByDefaultKey\(workspaceId, pipelineDefaultKey\)/u,
  );
  assert.match(
    route,
    /dealsRepo\.list\(workspaceId, \{ pipelineId: pipeline\.id \}\)/u,
  );
  assert.match(route, /where: \{ tenantId: workspaceId, dealId: \{ in: deals\.map\(\(deal\) => deal\.id\) \} \}/u);
  assert.match(route, /select: \{ id: true, dealId: true \}/u);
  assert.match(route, /captureId: captureIdByDealId\.get\(deal\.id\) \?\? null/u);
  assert.match(route, /contact: deal\.contactId === undefined \|\| deal\.contactId === null/u);
});

test("seller acquisition records store exposes a minimal SWR-backed data API", () => {
  const source = read("lib/marketplace-acquisition/records-store.ts");
  const boardStore = read("lib/marketplace-acquisition/board-store.ts");

  assert.match(source, /import useSWR, \{ type KeyedMutator \} from "swr"/u);
  assert.match(source, /marketplaceAcquisitionRecordsPath = "\/api\/marketplace-acquisition\/records"/u);
  assert.match(source, /export function useMarketplaceAcquisitionRecordsStore\(\)/u);
  assert.match(source, /readonly refresh: KeyedMutator<MarketplaceAcquisitionRecordsResponse>/u);
  assert.match(source, /readonly records: readonly SellerAcquisitionRecord\[\]/u);
  assert.match(source, /records: data\?\.records \?\? \[\]/u);
  assert.match(boardStore, /marketplaceAcquisitionRecordsPath/u);
  assert.doesNotMatch(boardStore, /marketplaceAcquisitionDealsPath/u);
  assert.doesNotMatch(boardStore, /pipelineDefaultKey=marketplace_acquisition/u);
});

test("marketplace sellers page filters records client-side", () => {
  const source = read("components/marketplace-acquisition/acquisition-workbench.tsx");

  assert.match(source, /const \[searchQuery, setSearchQuery\] = useState\(""\)/u);
  assert.match(source, /const \[queueFilter, setQueueFilter\]/u);
  assert.match(source, /const filteredRecords = useMemo/u);
  assert.match(source, /searchText\(record\)\.includes\(query\)/u);
  assert.match(source, /record\.healthStatus !== healthFilter/u);
  assert.match(source, /record\.nextAction !== nextActionFilter/u);
  assert.match(source, /confidence\(record\) !== confidenceFilter/u);
  assert.match(source, /record\.currentStage !== stageFilter/u);
  assert.doesNotMatch(source, /raw payload|tokenHash|providerSecret/u);
});

test("marketplace sellers page renders workbench actions and record inventory preview", () => {
  const source = read("components/marketplace-acquisition/acquisition-workbench.tsx");

  for (const label of [
    "Send WhatsApp-first Invite",
    "Retry Invitation",
    "Waiting for Seller Claim",
    "Convert Seller",
    "Convert Inventory",
    "Complete Acquisition",
    "No Action",
  ]) {
    assert.match(source, new RegExp(label, "u"));
  }
  assert.match(source, /record\.images\[0\]/u);
  assert.match(source, /draftInventory\?\.title \?\? record\.capture\.title/u);
  assert.match(source, /draftInventory\?\.price \?\? record\.capture\.price/u);
  assert.match(source, /marketplaceSource/u);
  assert.match(source, /capturedAge/u);
  assert.match(source, /\/api\/marketplace-acquisition\/captures\/\$\{record\.capture\.id\}\/invite/u);
  assert.match(source, /\/api\/marketplace-acquisition\/captures\/\$\{record\.capture\.id\}\/convert\/render-seller/u);
  assert.match(source, /\/api\/marketplace-acquisition\/captures\/\$\{record\.capture\.id\}\/convert\/render-inventory/u);
  assert.match(source, /\/api\/marketplace-acquisition\/captures\/\$\{record\.capture\.id\}\/complete/u);
  assert.match(source, /COMPLETE_ACQUISITION: `\/api\/marketplace-acquisition\/captures\/\$\{record\.capture\.id\}\/complete`/u);
  assert.match(source, /if \(!response\.ok\) throw new Error/u);
  assert.match(source, /await onRefresh\(\)/u);
  assert.match(source, /role="alert"/u);
});

test("seller acquisition detail renders invitation UX with WhatsApp first, SMS fallback, and email optional", () => {
  const detailPage = read("app/(app)/marketplace-acquisition/[dealId]/page.tsx");
  const invitePanel = read("components/seller-acquisition/invite-panel.tsx");

  assert.match(detailPage, /SellerAcquisitionInvitePanel/u);
  assert.match(invitePanel, /WhatsApp is the preferred cellphone-first channel/u);
  assert.match(invitePanel, /SMS remains the fallback/u);
  assert.match(invitePanel, /email is available for non-cellphone-first markets/u);
  assert.match(invitePanel, /preferredChannel: channel/u);
  assert.match(invitePanel, /Send Seller Acquisition invite/u);
  assert.match(invitePanel, /role="status"/u);
});

test("capture intake and bookmarklet support mobile-required WhatsApp-first bulk portfolio copy", () => {
  const capturePage = read("app/(app)/marketplace-acquisition/capture/page.tsx");
  const bookmarklet = read("lib/marketplace-capture/bookmarklet.js");
  const payload = read("lib/marketplace-capture/payload.ts");

  for (const expected of [
    "Reveal the seller phone/mobile number before capture",
    "Mobile number is required for qualification",
    "WhatsApp will be attempted first",
    "Bulk seller portfolio",
    "multiple listings",
  ]) {
    assert.match(capturePage + bookmarklet + payload, new RegExp(expected, "u"));
  }
  for (const token of ["portfolioListings", "rawSellerText", "sellerProfileUrl", "marketplaceListingId", "phone", "sellerPhone"]) {
    assert.match(bookmarklet + payload, new RegExp(token, "u"));
  }
});


test("URL capture no-phone response exposes blocked metadata", () => {
  const route = read("app/api/marketplace-acquisition/captures/from-url/route.ts");
  assert.match(route, /missingRequirements = result\.contactId === undefined \? \["PHONE_REQUIRED"\] : \[\]/u);
  assert.match(route, /qualified: missingRequirements\.length === 0/u);
  assert.match(route, /blocked: missingRequirements\.length > 0/u);
  assert.match(route, /nextAction: missingRequirements\.includes\("PHONE_REQUIRED"\) \? "REVEAL_PHONE" : undefined/u);
});
