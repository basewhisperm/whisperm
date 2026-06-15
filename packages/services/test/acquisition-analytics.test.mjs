import assert from "node:assert/strict";
import test from "node:test";

import { SellerAcquisitionAnalyticsService } from "../dist/acquisition-analytics.js";

const response = (overrides = {}) => ({
  dateRange: { from: "", to: "" },
  acquisition: { captures: 2, capturesPerDay: [{ date: "2026-06-01", count: 2 }], invitationsSent: 2, claimRate: 0.5, conversionRate: 1, expiredCount: 1 },
  inventory: { listingsCaptured: 2, listingsClaimed: 1, listingsConverted: 1, listingsExpired: 1 },
  operations: { averageTimeToInviteHours: 2, averageTimeToClaimHours: 4, averageTimeToConversionHours: 8 },
  conversion: { sellerConversionsSucceeded: 1, inventoryConversionsSucceeded: 1, conversionFailures: 1, deadLetteredConversions: 1 },
  ...overrides,
});

test("analytics service requires tenant and normalizes filters without mutation", async () => {
  const calls = [];
  const service = new SellerAcquisitionAnalyticsService({ now: () => new Date("2026-06-15T00:00:00.000Z"), repository: { async getSellerAcquisitionAnalytics(input) { calls.push(input); return response(); } } });
  const filters = { marketplaceSource: "source-a", channel: "SMS" };
  const result = await service.get({ tenantId: "tenant-a" }, filters);
  assert.equal(result.dateRange.from, "2026-05-16T00:00:00.000Z");
  assert.equal(calls[0].tenantId, "tenant-a");
  assert.deepEqual(filters, { marketplaceSource: "source-a", channel: "SMS" });
});

test("analytics service rejects missing tenant", async () => {
  const service = new SellerAcquisitionAnalyticsService({ repository: { async getSellerAcquisitionAnalytics() { return response(); } } });
  await assert.rejects(() => service.get({ tenantId: "" }, {}));
});
