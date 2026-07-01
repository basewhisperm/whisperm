CREATE TYPE "BusinessGrowthOpportunityStatus" AS ENUM ('IDENTIFIED', 'QUALIFIED', 'NEEDS_REVIEW', 'REJECTED', 'INVITED', 'CLAIMED', 'CONVERTED', 'ARCHIVED');

CREATE TABLE "BusinessGrowthOpportunity" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "marketplaceCaptureId" UUID,
    "discoveredSellerId" UUID,
    "campaignId" UUID,
    "contactId" UUID,
    "dealId" UUID,
    "draftInventoryId" UUID,
    "status" "BusinessGrowthOpportunityStatus" NOT NULL DEFAULT 'IDENTIFIED',
    "qualificationStatus" TEXT,
    "qualificationScore" DECIMAL(5,4),
    "qualificationReasons" JSONB,
    "sourceType" TEXT,
    "sourceUrl" TEXT,
    "sourceKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessGrowthOpportunity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BusinessGrowthOpportunity_tenantId_id_key" ON "BusinessGrowthOpportunity"("tenantId", "id");
CREATE UNIQUE INDEX "BusinessGrowthOpportunity_tenantId_marketplaceCaptureId_key" ON "BusinessGrowthOpportunity"("tenantId", "marketplaceCaptureId");
CREATE UNIQUE INDEX "BusinessGrowthOpportunity_tenantId_discoveredSellerId_key" ON "BusinessGrowthOpportunity"("tenantId", "discoveredSellerId");
CREATE INDEX "BusinessGrowthOpportunity_tenantId_idx" ON "BusinessGrowthOpportunity"("tenantId");
CREATE INDEX "BusinessGrowthOpportunity_tenantId_campaignId_idx" ON "BusinessGrowthOpportunity"("tenantId", "campaignId");
CREATE INDEX "BusinessGrowthOpportunity_tenantId_marketplaceCaptureId_idx" ON "BusinessGrowthOpportunity"("tenantId", "marketplaceCaptureId");
CREATE INDEX "BusinessGrowthOpportunity_tenantId_discoveredSellerId_idx" ON "BusinessGrowthOpportunity"("tenantId", "discoveredSellerId");
CREATE INDEX "BusinessGrowthOpportunity_tenantId_contactId_idx" ON "BusinessGrowthOpportunity"("tenantId", "contactId");
CREATE INDEX "BusinessGrowthOpportunity_tenantId_dealId_idx" ON "BusinessGrowthOpportunity"("tenantId", "dealId");

ALTER TABLE "BusinessGrowthOpportunity" ADD CONSTRAINT "BusinessGrowthOpportunity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
