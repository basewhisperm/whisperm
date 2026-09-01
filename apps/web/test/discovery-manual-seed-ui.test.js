import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/app/(app)/marketplace-acquisition/campaigns/[campaignId]/discovery/page.tsx", "utf8");

test("manual discovery asks for a marketplace, not an internal source UUID", () => {
  assert.doesNotMatch(page, /Marketplace Source ID|UUID of the marketplace source|sourceId/u);
  assert.match(page, /Marketplace Key/u);
  assert.match(page, /marketplaceSourceKey: sourceKey/u);
});

test("campaign discovery routes authenticated marketplace collection through the bookmarklet", () => {
  assert.match(page, /Capture Marketplace Page/u);
  assert.match(page, /marketplace-acquisition\/capture\?campaignId=/u);
  assert.match(page, /Paste URLs/u);
  assert.doesNotMatch(page, /Run Automatic Discovery/u);
});