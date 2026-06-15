import assert from "node:assert/strict";
import test from "node:test";

import { createApiServer } from "../dist/index.js";

const createDependencies = (analytics) => ({
  createEventId: () => "event-1",
  apiKeyAuthenticator: { async authenticate() { return { tenantId: "tenant-a", apiKeyId: "api-key-1" }; } },
  hmacVerifier: { async verify() { return true; } },
  persistence: { async persistInboundEvent() {} },
  queue: { async enqueueInboundEvent() {} },
  marketplaceAcquisitionAnalytics: analytics,
});

const emptyAnalytics = {
  dateRange: { from: "2026-06-01T00:00:00.000Z", to: "2026-06-15T00:00:00.000Z" },
  acquisition: { captures: 0, capturesPerDay: [], invitationsSent: 0, claimRate: 0, conversionRate: 0, expiredCount: 0 },
  inventory: { listingsCaptured: 0, listingsClaimed: 0, listingsConverted: 0, listingsExpired: 0 },
  operations: { averageTimeToInviteHours: null, averageTimeToClaimHours: null, averageTimeToConversionHours: null },
  conversion: { sellerConversionsSucceeded: 0, inventoryConversionsSucceeded: 0, conversionFailures: 0, deadLetteredConversions: 0 },
};

test("analytics endpoint requires tenant auth", async () => {
  const server = createApiServer(createDependencies({ async get() { return emptyAnalytics; } }));
  const response = await server.inject({ method: "GET", url: "/marketplace-acquisition/analytics", headers: { "x-user-id": "user-a" } });
  assert.equal(response.statusCode, 401);
});

test("analytics endpoint passes tenant and filters to service", async () => {
  const calls = [];
  const server = createApiServer(createDependencies({ async get(context, filters) { calls.push({ context, filters }); return emptyAnalytics; } }));
  const response = await server.inject({ method: "GET", url: "/marketplace-acquisition/analytics?dateFrom=2026-06-01T00%3A00%3A00.000Z&dateTo=2026-06-15T00%3A00%3A00.000Z&marketplaceSource=source-a&channel=SMS", headers: { "x-tenant-id": "tenant-a", "x-user-id": "user-a" } });
  assert.equal(response.statusCode, 200);
  assert.equal(calls[0].context.tenantId, "tenant-a");
  assert.deepEqual(calls[0].filters, { dateFrom: "2026-06-01T00:00:00.000Z", dateTo: "2026-06-15T00:00:00.000Z", marketplaceSource: "source-a", channel: "SMS" });
  assert.equal(response.json().data.acquisition.claimRate, 0);
});
