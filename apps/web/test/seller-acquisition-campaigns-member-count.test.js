import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const listRoute = readFileSync("src/app/api/marketplace-acquisition/campaigns/route.ts", "utf8");
const detailRoute = readFileSync("src/app/api/marketplace-acquisition/campaigns/[campaignId]/route.ts", "utf8");
const repositories = readFileSync("../../packages/repositories/src/index.ts", "utf8");
const campaignsService = readFileSync("../../packages/services/src/seller-acquisition-campaigns.ts", "utf8");

// Review finding: the campaigns API never populated memberCount (SellerAcquisitionCampaignService.list
// delegated straight to the repository with no member count projection), so any campaign with real
// members still showed "0 captured sellers" and the card kept offering "Run discovery" instead of
// "Review sellers". Every campaign response (list, get, create, patch) must carry a real memberCount.
test("campaign repository and service expose a countMembers method", () => {
  assert.match(repositories, /countMembers\(context: TenantScoped, campaignId: string\): Promise<number>/u);
  assert.match(repositories, /async countMembers\(context: TenantScoped, campaignId: string\): Promise<number>/u);
  assert.match(campaignsService, /countMembers\(context: TenantScoped, campaignId: string\): Promise<number>/u);
});

test("campaigns list/create route enriches every returned campaign with a real memberCount", () => {
  assert.match(listRoute, /memberCount: await service\.countMembers\(\{ tenantId: tenant\.id \}, campaign\.id\)/u);
  assert.match(listRoute, /memberCount: 0/u);
});

test("campaign creation returns structured API errors when persistence fails", () => {
  assert.match(listRoute, /error instanceof PersistenceError/u);
  assert.match(listRoute, /errorResponse\(error\.message, error\.status\)/u);
  assert.match(listRoute, /Campaign could not be created\. Please try again\./u);
});

test("campaign detail get/patch routes enrich the returned campaign with a real memberCount", () => {
  assert.match(detailRoute, /const memberCount = await service\.countMembers\(\{ tenantId: tenant\.id \}, campaign\.id\);/u);
  assert.match(detailRoute, /data: \{ campaign: \{ \.\.\.campaign, memberCount \} \}/u);
});
