import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const growthRoute = readFileSync("src/app/api/marketplace-acquisition/campaigns/[campaignId]/growth/route.ts", "utf8");
const recommendationRoute = readFileSync("src/app/api/marketplace-acquisition/campaigns/[campaignId]/growth/recommendations/[recommendationId]/route.ts", "utf8");
const component = readFileSync("src/components/marketplace-acquisition/acquisition-workbench.tsx", "utf8");
const campaignRuntime = readFileSync("../../packages/services/src/campaign-runtime.ts", "utf8");

test("growth route coordinates through CampaignRuntimeService rather than computing signals itself", () => {
  assert.match(growthRoute, /requireSellerAcquisitionFeatureForApi/u);
  assert.match(growthRoute, /CampaignRuntimeService/u);
  assert.match(growthRoute, /evaluateGrowthLoop/u);
  assert.doesNotMatch(growthRoute, /GrowthLoopWorker/u);
});

test("ST1-009: growth route constructs CampaignRuntimeService with usageMetering so GROWTH_LOOP_EVALUATED is recorded", () => {
  assert.match(growthRoute, /usageMetering/u);
  assert.match(growthRoute, /createAcquisitionServiceBundle/u);
});

test("growth recommendation route delegates apply/dismiss to campaign runtime ownership", () => {
  assert.match(recommendationRoute, /requireSellerAcquisitionFeatureForApi/u);
  assert.match(recommendationRoute, /applyGrowthRecommendation/u);
  assert.match(recommendationRoute, /dismissGrowthRecommendation/u);
  assert.doesNotMatch(recommendationRoute, /sellerAcquisitionCampaign\.update\(/u);
});

test("campaign runtime service owns growth loop evaluation, application, and dismissal", () => {
  assert.match(campaignRuntime, /async evaluateGrowthLoop/u);
  assert.match(campaignRuntime, /async executeGrowthLoopEvaluation/u);
  assert.match(campaignRuntime, /async applyGrowthRecommendation/u);
  assert.match(campaignRuntime, /async dismissGrowthRecommendation/u);
  assert.match(campaignRuntime, /mergeCampaignTargetingMetadata/u);
});

test("campaign runtime never mutates campaign targeting or schedule during evaluation, only inside apply", () => {
  const evaluateStart = campaignRuntime.indexOf("async evaluateGrowthLoop");
  const applyStart = campaignRuntime.indexOf("async applyGrowthRecommendation");
  const computeSection = campaignRuntime.slice(evaluateStart, applyStart);
  assert.doesNotMatch(computeSection, /scheduleCadence:\s*scheduleCadence/u);
});

test("workbench renders growth loop recommendations and delegates actions through the growth API", () => {
  assert.match(component, /GrowthLoopSection/u);
  assert.match(component, /fetchGrowthLoopState/u);
  assert.match(component, /recomputeGrowthLoop/u);
  assert.match(component, /actOnGrowthRecommendation/u);
  assert.match(component, /\/growth`/u);
  assert.match(component, /\/growth\/recommendations\//u);
});

test("workbench growth section does not compute recommendations client-side", () => {
  const sectionStart = component.indexOf("function GrowthLoopSection");
  const sectionEnd = component.indexOf("\nfunction ", sectionStart + 1);
  const section = component.slice(sectionStart, sectionEnd === -1 ? undefined : sectionEnd);
  assert.doesNotMatch(section, /SCALE_CAMPAIGN"\s*:/u);
  assert.doesNotMatch(section, /new GrowthLoopWorker/u);
});
