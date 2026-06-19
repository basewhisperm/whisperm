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
  assert.match(read("lib/marketplace-acquisition/board-store.ts"), /pipelineDefaultKey=marketplace_acquisition/u);
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

test("seller acquisition board component preserves safe card rendering protections", () => {
  const board = read("components/seller-acquisition/acquisition-board.tsx");

  assert.match(board, /export function AcquisitionBoard/u);
  assert.match(board, /acquisitionStages\.map/u);
  assert.match(board, /aria-labelledby/u);
  assert.match(board, /`\/marketplace-acquisition\/\$\{deal\.id\}`/u);
  assert.match(board, /isSafeListingUrl\(deal\.listingUrl\)/u);
  assert.match(board, /target="_blank"/u);
  assert.match(board, /rel="noreferrer"/u);
  assert.doesNotMatch(board, /\.metadata\b/u);
  assert.doesNotMatch(board, /claimToken|tokenHash|providerSecret|rawPayload/u);
});

test("seller acquisition page uses board store and accessible filter chips", () => {
  const source = read("app/(app)/marketplace-acquisition/page.tsx");
  const store = read("lib/marketplace-acquisition/board-store.ts");

  assert.match(source, /useAcquisitionBoardData\(\)/u);
  assert.match(source, /<AcquisitionBoard/u);
  assert.match(store, /api\/deals\?pipelineDefaultKey=marketplace_acquisition/u);
  assert.match(source, /role="group" aria-label="Filter by acquisition stage"/u);
  assert.match(source, /aria-pressed=\{stageFilter === "all"\}/u);
  assert.match(source, /aria-pressed=\{stageFilter === stageName\}/u);
  assert.doesNotMatch(source, /<select[\s\S]*Filter by acquisition stage/u);
});

test("seller acquisition board drag drop calls stage endpoint with route request shape and reverts rejected moves", () => {
  const board = read("components/seller-acquisition/acquisition-board.tsx");
  const route = read("app/api/marketplace-acquisition/deals/[dealId]/stage/route.ts");
  const store = read("lib/marketplace-acquisition/board-store.ts");

  assert.match(board, /draggable/u);
  assert.match(board, /onDrop/u);
  assert.match(board, /\/api\/marketplace-acquisition\/deals\/\$\{encodeURIComponent\(deal\.id\)\}\/stage/u);
  assert.match(route, /"stageName" in body/u);
  assert.match(board, /body: JSON\.stringify\(\{ stageName: targetStage\.name \}\)/u);
  assert.match(store, /allowedAcquisitionStageTransitions/u);
  assert.match(board, /canTransitionAcquisitionStage\(currentStage\.name, targetStage\.name\)/u);
  assert.match(board, /!response\.ok/u);
  assert.match(board, /onStageUpdated\?\.\(deal\.id, currentStage\.id, deal\.updatedAt\)/u);
  assert.match(board, /await onRefresh\?\.\(\)/u);
  assert.match(board, /role="alert"/u);
});

test("seller acquisition board only renders inline invite for captured cards with capture id", () => {
  const board = read("components/seller-acquisition/acquisition-board.tsx");

  assert.match(board, /SellerAcquisitionInvitePanel/u);
  assert.match(board, /stageName === "Captured" && deal\.captureId/u);
  assert.match(board, /captureId=\{deal\.captureId\}/u);
});
