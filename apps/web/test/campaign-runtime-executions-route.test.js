import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const route = readFileSync("src/app/api/marketplace-acquisition/campaigns/[campaignId]/runtime/executions/route.ts", "utf8");
const campaignRuntime = readFileSync("../../packages/services/src/campaign-runtime.ts", "utf8");

// ST1-012: the base runtime/executions POST never configures a discoveryQueue or a real
// CampaignRuntimeWorker, so it must not report 201/COMPLETED for autonomous discovery work
// that never actually ran.
test("runtime/executions POST surfaces FAILED executions as an explicit non-201 error instead of a false COMPLETED", () => {
  assert.match(route, /execution\.status === "FAILED"/u);
  assert.match(route, /CAMPAIGN_RUNTIME_DISCOVERY_NOT_CONFIGURED/u);
  const failedCheckIndex = route.indexOf('execution.status === "FAILED"');
  const successReturnIndex = route.indexOf('return NextResponse.json({ data: { execution } }, { status: 201 });');
  assert.ok(failedCheckIndex > -1 && successReturnIndex > -1 && failedCheckIndex < successReturnIndex, "the FAILED check must run before the 201 success response");
});

test("CampaignRuntimeService.startCampaignExecution has no default worker fallback that silently completes", () => {
  assert.doesNotMatch(campaignRuntime, /this\.worker = deps\.worker \?\? new NoopCampaignRuntimeWorker/u);
  assert.match(campaignRuntime, /CAMPAIGN_RUNTIME_DISCOVERY_NOT_CONFIGURED/u);
});
