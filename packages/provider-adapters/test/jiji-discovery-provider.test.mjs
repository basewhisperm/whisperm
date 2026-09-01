import assert from "node:assert/strict";
import test from "node:test";
import { buildJijiSearchUrl, JijiDiscoveryProvider, parseJijiSearchResults } from "../dist/index.js";

const request = {
  tenant: { tenantId: "tenant-1" },
  campaign: { campaignId: "campaign-1", executionId: "execution-1" },
  marketplaceSource: "JIJI",
  search: { query: "cleaning supplies", location: "Greater Accra" },
  limits: { limit: 2 },
};

test("builds a fixed-origin JIJI search URL from governed targeting", () => {
  assert.equal(buildJijiSearchUrl(request), "https://jiji.com.gh/greater-accra/search?query=cleaning+supplies");
});

test("extracts unique JIJI listing links and respects the execution limit", () => {
  const html = '<a href="/accra-central/office-equipment/cleaner-one-a1.html"><span>Cleaner One</span></a><a href="/search?query=x">Search</a><a href="/accra-central/office-equipment/cleaner-two-b2.html">Cleaner Two</a><a href="/accra-central/office-equipment/cleaner-three-c3.html">Cleaner Three</a>';
  assert.deepEqual(parseJijiSearchResults(html, 2), [
    { source: "JIJI", listingUrl: "https://jiji.com.gh/accra-central/office-equipment/cleaner-one-a1.html", title: "Cleaner One" },
    { source: "JIJI", listingUrl: "https://jiji.com.gh/accra-central/office-equipment/cleaner-two-b2.html", title: "Cleaner Two" },
  ]);
});

test("provider uses the campaign limit without live network access", async () => {
  const provider = new JijiDiscoveryProvider({ fetch: async () => new Response('<a href="/accra/item-one.html">Item One</a>') });
  const response = await provider.discover(request);
  assert.equal(response.providerKey, "jiji-public-search");
  assert.equal(response.results.length, 1);
});