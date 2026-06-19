-- Close MarketplaceCapture check-then-create race conditions by enforcing
-- tenant-scoped uniqueness for listing URLs at the database layer.
-- This backfill mutates only historical duplicate rows within the same tenant;
-- the oldest row wins by createdAt ASC, then id ASC. Losing duplicates receive
-- a deterministic #duplicate-{id} suffix before the unique index is created.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "tenantId", "listingUrl"
      ORDER BY "createdAt" ASC, id ASC
    ) AS rn
  FROM "MarketplaceCapture"
)
UPDATE "MarketplaceCapture" mc
SET "listingUrl" = mc."listingUrl" || '#duplicate-' || mc.id
FROM ranked
WHERE ranked.id = mc.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "MarketplaceCapture_tenantId_listingUrl_key"
  ON "MarketplaceCapture" ("tenantId", "listingUrl");
