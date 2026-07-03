-- CS-018 Revenue Attribution Engine
-- Expand-only: adds nullable revenue attribution bridge columns to the existing
-- BusinessGrowthOpportunity table. No destructive changes, no new tables.

ALTER TABLE "BusinessGrowthOpportunity"
  ADD COLUMN "attributedRevenueAmount" DECIMAL(18,4),
  ADD COLUMN "attributedRevenueCurrency" TEXT,
  ADD COLUMN "revenueAttributedAt" TIMESTAMP(3),
  ADD COLUMN "attributionCompleteness" TEXT,
  ADD COLUMN "attributionMissingLinks" JSONB;
