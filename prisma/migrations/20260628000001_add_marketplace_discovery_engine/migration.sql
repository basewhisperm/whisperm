-- CreateTable (idempotent)
CREATE TABLE IF NOT EXISTS "MarketplaceDiscoveryRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "marketplaceSourceId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "mode" TEXT NOT NULL DEFAULT 'MANUAL_SEED',
    "sellersFound" INTEGER NOT NULL DEFAULT 0,
    "sellersQualified" INTEGER NOT NULL DEFAULT 0,
    "sellersRejected" INTEGER NOT NULL DEFAULT 0,
    "sellersDuplicate" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "config" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MarketplaceDiscoveryRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DiscoveredMarketplaceSeller" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "discoveryRunId" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "marketplaceSourceId" UUID NOT NULL,
    "sellerIdentityKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "qualificationScore" INTEGER NOT NULL DEFAULT 0,
    "qualificationPolicy" JSONB,
    "sellerName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "sellerProfileUrl" TEXT,
    "listingUrl" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "price" DECIMAL(18,4),
    "currency" TEXT,
    "category" TEXT,
    "location" TEXT,
    "images" JSONB,
    "rawData" JSONB,
    "duplicateOfId" UUID,
    "promotedCaptureId" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DiscoveredMarketplaceSeller_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "TenantFeature" ADD COLUMN IF NOT EXISTS "discoveryCredits" INTEGER DEFAULT 0;
ALTER TABLE "TenantFeature" ADD COLUMN IF NOT EXISTS "discoveryCreditsUsed" INTEGER DEFAULT 0;

-- CreateIndex (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS "MarketplaceDiscoveryRun_tenantId_id_key" ON "MarketplaceDiscoveryRun"("tenantId", "id");
CREATE INDEX IF NOT EXISTS "MarketplaceDiscoveryRun_tenantId_idx" ON "MarketplaceDiscoveryRun"("tenantId");
CREATE INDEX IF NOT EXISTS "MarketplaceDiscoveryRun_tenantId_campaignId_idx" ON "MarketplaceDiscoveryRun"("tenantId", "campaignId");
CREATE INDEX IF NOT EXISTS "MarketplaceDiscoveryRun_tenantId_status_idx" ON "MarketplaceDiscoveryRun"("tenantId", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "DiscoveredMarketplaceSeller_tenantId_id_key" ON "DiscoveredMarketplaceSeller"("tenantId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "DiscoveredMarketplaceSeller_tenantId_discoveryRunId_listingUrl_key" ON "DiscoveredMarketplaceSeller"("tenantId", "discoveryRunId", "listingUrl");
CREATE INDEX IF NOT EXISTS "DiscoveredMarketplaceSeller_tenantId_idx" ON "DiscoveredMarketplaceSeller"("tenantId");
CREATE INDEX IF NOT EXISTS "DiscoveredMarketplaceSeller_tenantId_campaignId_idx" ON "DiscoveredMarketplaceSeller"("tenantId", "campaignId");
CREATE INDEX IF NOT EXISTS "DiscoveredMarketplaceSeller_tenantId_campaignId_status_idx" ON "DiscoveredMarketplaceSeller"("tenantId", "campaignId", "status");
CREATE INDEX IF NOT EXISTS "DiscoveredMarketplaceSeller_tenantId_sellerIdentityKey_idx" ON "DiscoveredMarketplaceSeller"("tenantId", "sellerIdentityKey");

-- AddForeignKey (idempotent via DO blocks)
DO $$ BEGIN
  ALTER TABLE "MarketplaceDiscoveryRun" ADD CONSTRAINT "MarketplaceDiscoveryRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "MarketplaceDiscoveryRun" ADD CONSTRAINT "MarketplaceDiscoveryRun_tenantId_campaignId_fkey" FOREIGN KEY ("tenantId", "campaignId") REFERENCES "SellerAcquisitionCampaign"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "MarketplaceDiscoveryRun" ADD CONSTRAINT "MarketplaceDiscoveryRun_tenantId_marketplaceSourceId_fkey" FOREIGN KEY ("tenantId", "marketplaceSourceId") REFERENCES "MarketplaceSource"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DiscoveredMarketplaceSeller" ADD CONSTRAINT "DiscoveredMarketplaceSeller_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DiscoveredMarketplaceSeller" ADD CONSTRAINT "DiscoveredMarketplaceSeller_tenantId_discoveryRunId_fkey" FOREIGN KEY ("tenantId", "discoveryRunId") REFERENCES "MarketplaceDiscoveryRun"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DiscoveredMarketplaceSeller" ADD CONSTRAINT "DiscoveredMarketplaceSeller_tenantId_campaignId_fkey" FOREIGN KEY ("tenantId", "campaignId") REFERENCES "SellerAcquisitionCampaign"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DiscoveredMarketplaceSeller" ADD CONSTRAINT "DiscoveredMarketplaceSeller_tenantId_marketplaceSourceId_fkey" FOREIGN KEY ("tenantId", "marketplaceSourceId") REFERENCES "MarketplaceSource"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
