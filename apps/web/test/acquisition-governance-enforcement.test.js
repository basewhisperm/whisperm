import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(path, "utf8");

const inviteRoute = read("src/app/api/marketplace-acquisition/captures/[id]/invite/route.ts");
const bulkInviteRoute = read("src/app/api/marketplace-acquisition/captures/bulk-invite/route.ts");
const discoveryRunsRoute = read("src/app/api/marketplace-acquisition/campaigns/[campaignId]/discovery/runs/route.ts");
const growthRecommendationRoute = read("src/app/api/marketplace-acquisition/campaigns/[campaignId]/growth/recommendations/[recommendationId]/route.ts");
const retryRoute = read("src/app/api/marketplace-acquisition/campaigns/[campaignId]/runtime/executions/[executionId]/retry/route.ts");
const commandCenterRoute = read("src/app/api/marketplace-acquisition/command-center/route.ts");
const runtimeHealthRoute = read("src/app/api/marketplace-acquisition/runtime-health/route.ts");
const governanceRoute = read("src/app/api/marketplace-acquisition/governance/route.ts");
const lib = read("src/lib/acquisition-governance.ts");

test("the invitation send route authorizes INVITATION before dispatching to the runtime", () => {
  assert.match(inviteRoute, /authorizeAcquisitionActionForApi/u);
  assert.match(inviteRoute, /capability: "INVITATION"/u);
  assert.match(inviteRoute, /if \(denied\) return denied;/u);
  const authorizeIndex = inviteRoute.indexOf("authorizeAcquisitionActionForApi(tenant.id");
  const executeIndex = inviteRoute.indexOf("runtimeService().executeInvitation");
  assert.ok(authorizeIndex > 0 && executeIndex > 0 && authorizeIndex < executeIndex, "authorization must run before runtime execution");
});

test("the bulk invite route authorizes INVITATION per capture before dispatching", () => {
  assert.match(bulkInviteRoute, /authorizeAcquisitionActionForApi/u);
  assert.match(bulkInviteRoute, /capability: "INVITATION"/u);
  const authorizeIndex = bulkInviteRoute.indexOf("authorizeAcquisitionActionForApi(tenant.id");
  const executeIndex = bulkInviteRoute.indexOf("runtime.executeInvitation");
  assert.ok(authorizeIndex > 0 && executeIndex > 0 && authorizeIndex < executeIndex, "authorization must run before runtime execution");
});

test("the invitation retry route authorizes INVITATION before retrying", () => {
  assert.match(retryRoute, /authorizeAcquisitionActionForApi/u);
  assert.match(retryRoute, /capability: "INVITATION"/u);
  assert.match(retryRoute, /if \(denied\) return denied;/u);
  const authorizeIndex = retryRoute.indexOf("authorizeAcquisitionActionForApi(tenant.id");
  const executeIndex = retryRoute.indexOf("retryInvitationExecution");
  assert.ok(authorizeIndex > 0 && executeIndex > 0 && authorizeIndex < executeIndex, "authorization must run before the retry executes");
});

test("the discovery run trigger route authorizes DISCOVERY before running discovery", () => {
  assert.match(discoveryRunsRoute, /authorizeAcquisitionActionForApi/u);
  assert.match(discoveryRunsRoute, /capability: "DISCOVERY"/u);
  const authorizeIndex = discoveryRunsRoute.indexOf("authorizeAcquisitionActionForApi(tenant.id");
  const executeIndex = discoveryRunsRoute.indexOf("service.runDiscovery");
  assert.ok(authorizeIndex > 0 && executeIndex > 0 && authorizeIndex < executeIndex, "authorization must run before discovery executes");
});

test("the discovery route resolves a tenant marketplace source instead of accepting an internal source ID", () => {
  assert.match(discoveryRunsRoute, /prisma\.marketplaceSource\.upsert/u);
  assert.match(discoveryRunsRoute, /tenantId_key/u);
  assert.doesNotMatch(discoveryRunsRoute, /marketplaceSourceId\?: string/u);
  assert.match(discoveryRunsRoute, /marketplaceSourceId: source\.id/u);
});

test("the discovery route verifies campaign ownership and active state before provisioning a source", () => {
  const campaignIndex = discoveryRunsRoute.indexOf("prisma.sellerAcquisitionCampaign.findFirst");
  const sourceIndex = discoveryRunsRoute.indexOf("prisma.marketplaceSource.upsert");
  assert.ok(campaignIndex > 0 && sourceIndex > campaignIndex, "campaign verification must precede source mutation");
  assert.match(discoveryRunsRoute, /where: \{ tenantId: tenant\.id, id: campaignId \}/u);
  assert.match(discoveryRunsRoute, /campaign\.status !== "ACTIVE"/u);
});

test("the discovery route enforces canonical governance allowances without phantom TenantFeature credit columns", () => {
  assert.match(discoveryRunsRoute, /remainingDiscoveryAllowance\(decision\.limits\)/u);
  assert.match(discoveryRunsRoute, /discoveryCreditsRemaining: allowance/u);
  assert.doesNotMatch(discoveryRunsRoute, /discoveryCreditsUsed|DISCOVERY_CREDITS_DEFAULT|\$executeRaw/u);
});

test("the discovery run trigger route still gates GET reads behind the feature flag only, never governance", () => {
  const getBody = discoveryRunsRoute.slice(discoveryRunsRoute.indexOf("export async function GET"), discoveryRunsRoute.indexOf("export async function POST"));
  assert.doesNotMatch(getBody, /authorizeAcquisitionActionForApi/u);
});

test("ST1-009: the discovery run trigger route constructs MarketplaceDiscoveryService with usageMetering so SELLER_DISCOVERED is recorded", () => {
  assert.match(discoveryRunsRoute, /usageMetering/u);
  assert.match(discoveryRunsRoute, /createAcquisitionUsageMetering/u);
});

test("the growth recommendation apply/dismiss route authorizes GROWTH_LOOP before mutating the campaign", () => {
  assert.match(growthRecommendationRoute, /authorizeAcquisitionActionForApi/u);
  assert.match(growthRecommendationRoute, /capability: "GROWTH_LOOP"/u);
  const authorizeIndex = growthRecommendationRoute.indexOf("authorizeAcquisitionActionForApi(tenant.id");
  const executeIndex = growthRecommendationRoute.indexOf("applyGrowthRecommendation");
  assert.ok(authorizeIndex > 0 && executeIndex > 0 && authorizeIndex < executeIndex, "authorization must run before the recommendation is applied or dismissed");
});

test("read-only command center and runtime health routes never call acquisition governance authorization", () => {
  assert.doesNotMatch(commandCenterRoute, /authorizeAcquisitionActionForApi/u);
  assert.doesNotMatch(runtimeHealthRoute, /authorizeAcquisitionActionForApi/u);
});

test("the governance snapshot route itself never calls authorizeAcquisitionAction -- it only reads the snapshot", () => {
  assert.doesNotMatch(governanceRoute, /authorizeAcquisitionAction\(/u);
  assert.match(governanceRoute, /getGovernanceSnapshot/u);
});

test("the shared governance helper returns a ready-to-return NextResponse on DENY and null otherwise", () => {
  assert.match(lib, /status === "DENY"/u);
  assert.match(lib, /denied: null/u);
  assert.match(lib, /NextResponse\.json/u);
});

test("the shared governance helper never leaks internal reason codes without a human-readable message", () => {
  assert.match(lib, /decision\.message/u);
});
