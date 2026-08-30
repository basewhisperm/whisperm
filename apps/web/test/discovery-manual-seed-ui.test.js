import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/app/(app)/marketplace-acquisition/campaigns/[campaignId]/discovery/page.tsx", "utf8");

test("manual discovery asks for a marketplace, not an internal source UUID", () => {
  assert.doesNotMatch(page, /Marketplace Source ID|UUID of the marketplace source|sourceId/u);
  assert.match(page, /Marketplace Key/u);
  assert.match(page, /marketplaceSourceKey: sourceKey/u);
});
