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

test("seller acquisition navigation is placed between deals and reports", () => {
  const sidebar = read("components/app-shell/sidebar.tsx");
  const messages = JSON.parse(read("lib/i18n/en.json"));
  const dealsIndex = sidebar.indexOf("deals.title");
  const acquisitionIndex = sidebar.indexOf("marketplaceAcquisition.title");
  const reportsIndex = sidebar.indexOf("reports.title");

  assert.equal(
    messages["marketplaceAcquisition.title"],
    "Seller Acquisition",
  );
  assert.ok(dealsIndex !== -1);
  assert.ok(acquisitionIndex > dealsIndex);
  assert.ok(reportsIndex > acquisitionIndex);
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
  assert.match(source, /api\/marketplace-acquisition\/analytics/u);
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
