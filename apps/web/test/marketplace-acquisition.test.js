import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";

const appRoot = fileURLToPath(new URL("../src/", import.meta.url));

function read(relativePath) {
  return readFileSync(join(appRoot, relativePath), "utf8");
}

test("seller acquisition page renders required board copy and stages", () => {
  const source = read("app/(app)/marketplace-acquisition/page.tsx");

  assert.match(source, /Seller Acquisition/u);
  assert.match(
    source,
    /Capture, invite, and convert marketplace sellers into Render sellers/u,
  );
  for (const stage of ["Captured", "Invited", "Converted"]) {
    assert.match(source, new RegExp(stage, "u"));
  }
  assert.match(source, /href="\/marketplace-acquisition\/capture"/u);
  assert.match(source, /pipelineDefaultKey=marketplace_acquisition/u);
  assert.match(source, /Search acquisitions/u);
  assert.match(source, /Search by deal or contact/u);
  assert.match(source, /All stages/u);
  assert.match(source, /No acquisition opportunities match these filters\./u);
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
  assert.match(layout, /isTenantFeatureEnabled\(tenant\.id, SELLER_ACQUISITION_FEATURE\)/u);
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
  ];
  for (const routePath of authenticatedRoutes) {
    const route = read(routePath);
    assert.match(route, /SELLER_ACQUISITION_FEATURE/u);
    assert.match(route, /isTenantFeatureEnabled/u);
    assert.match(route, /featureNotEnabledResponse\(\)/u);
  }

  const helper = read("lib/tenant-features.ts");
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

test("seller acquisition board store exposes a minimal SWR-backed data API", () => {
  const source = read("lib/marketplace-acquisition/board-store.ts");

  assert.match(source, /import useSWR, \{ type KeyedMutator \} from "swr"/u);
  assert.match(source, /marketplaceAcquisitionDealsPath = "\/api\/deals\?pipelineDefaultKey=marketplace_acquisition"/u);
  assert.match(source, /export function useMarketplaceAcquisitionBoardStore\(\)/u);
  assert.match(source, /readonly refresh: KeyedMutator<MarketplaceAcquisitionBoardResponse>/u);
  assert.match(source, /captureId\?: string \| null/u);
  assert.match(source, /pipeline: data\?\.pipeline \?\? null/u);
  assert.match(source, /deals: data\?\.deals \?\? \[\]/u);
});

test("seller acquisition page filters client-side without backend query changes", () => {
  const source = read("app/(app)/marketplace-acquisition/page.tsx");

  assert.match(
    source,
    /const \[searchQuery, setSearchQuery\] = useState\(""\)/u,
  );
  assert.match(source, /const \[stageFilter, setStageFilter\]/u);
  assert.match(source, /const filteredDeals = useMemo/u);
  assert.match(
    source,
    /searchText\(deal\)\.includes\(normalizedSearchQuery\)/u,
  );
  assert.match(
    source,
    /stageKey\(dealStageName\) !== stageKey\(stageFilter\)/u,
  );
  assert.match(source, /marketplaceSource\(deal\)/u);
  assert.doesNotMatch(source, /raw payload|tokenHash|providerSecret/u);
});


test("seller acquisition dashboard renders compact analytics cards", () => {
  const source = read("app/(app)/marketplace-acquisition/page.tsx");
  const analyticsRoute = read("app/api/marketplace-acquisition/analytics/route.ts");
  assert.match(source, /api\/marketplace-acquisition\/analytics/u);
  assert.match(source, /payload\.data \?\? null/u);
  assert.match(analyticsRoute, /NextResponse\.json\(\{ ok: true, data: analytics \}\)/u);
  for (const label of ["Captures", "Invitations sent", "Claim rate", "Conversion rate", "Expired", "Listings converted", "Failed conversions"]) {
    assert.match(source, new RegExp(label, "u"));
  }
  assert.match(source, /analytics\?\.acquisition\.captures \?\? 0/u);
});


test("seller acquisition dashboard renders lifecycle analytics cards", () => {
  const source = read("app/(app)/marketplace-acquisition/page.tsx");
  for (const label of [
    "Seller acquisition lifecycle analytics",
    "Claim started",
    "Seller converted",
    "Inventory converted",
    "Fully converted",
    "Expiration rate",
  ]) {
    assert.match(source, new RegExp(label, "u"));
  }
  assert.match(source, /sellerConversionsSucceeded/u);
  assert.match(source, /inventoryConversionsSucceeded/u);
  assert.match(source, /listingsClaimed/u);
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
