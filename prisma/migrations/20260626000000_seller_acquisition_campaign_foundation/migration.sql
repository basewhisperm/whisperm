CREATE TYPE "SellerAcquisitionCampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');

CREATE TYPE "SellerAcquisitionCampaignMemberStatus" AS ENUM ('ADDED', 'QUALIFIED', 'INVITED', 'CLAIMED', 'CONVERTED', 'COMPLETED', 'REMOVED');

CREATE TABLE "SellerAcquisitionCampaign" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "SellerAcquisitionCampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "ownerId" UUID,
  "goalSellerCount" INTEGER,
  "goalRevenue" DECIMAL(18,4),
  "currency" TEXT,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SellerAcquisitionCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SellerAcquisitionCampaignMember" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "campaignId" UUID NOT NULL,
  "marketplaceCaptureId" UUID NOT NULL,
  "contactId" UUID,
  "dealId" UUID,
  "status" "SellerAcquisitionCampaignMemberStatus" NOT NULL DEFAULT 'ADDED',
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removedAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SellerAcquisitionCampaignMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SellerAcquisitionCampaign_tenantId_id_key" ON "SellerAcquisitionCampaign"("tenantId", "id");
CREATE INDEX "SellerAcquisitionCampaign_tenantId_idx" ON "SellerAcquisitionCampaign"("tenantId");
CREATE INDEX "SellerAcquisitionCampaign_tenantId_status_createdAt_idx" ON "SellerAcquisitionCampaign"("tenantId", "status", "createdAt");
CREATE INDEX "SellerAcquisitionCampaign_tenantId_ownerId_idx" ON "SellerAcquisitionCampaign"("tenantId", "ownerId");
CREATE INDEX "SellerAcquisitionCampaign_tenantId_startsAt_idx" ON "SellerAcquisitionCampaign"("tenantId", "startsAt");

CREATE UNIQUE INDEX "SellerAcquisitionCampaignMember_tenantId_id_key" ON "SellerAcquisitionCampaignMember"("tenantId", "id");
CREATE UNIQUE INDEX "SellerAcquisitionCampaignMember_tenantId_campaignId_marketplaceCaptureId_key" ON "SellerAcquisitionCampaignMember"("tenantId", "campaignId", "marketplaceCaptureId");
CREATE INDEX "SellerAcquisitionCampaignMember_tenantId_idx" ON "SellerAcquisitionCampaignMember"("tenantId");
CREATE INDEX "SellerAcquisitionCampaignMember_tenantId_campaignId_idx" ON "SellerAcquisitionCampaignMember"("tenantId", "campaignId");
CREATE INDEX "SellerAcquisitionCampaignMember_tenantId_marketplaceCaptureId_idx" ON "SellerAcquisitionCampaignMember"("tenantId", "marketplaceCaptureId");
CREATE INDEX "SellerAcquisitionCampaignMember_tenantId_contactId_idx" ON "SellerAcquisitionCampaignMember"("tenantId", "contactId");
CREATE INDEX "SellerAcquisitionCampaignMember_tenantId_dealId_idx" ON "SellerAcquisitionCampaignMember"("tenantId", "dealId");
CREATE INDEX "SellerAcquisitionCampaignMember_tenantId_status_assignedAt_idx" ON "SellerAcquisitionCampaignMember"("tenantId", "status", "assignedAt");

ALTER TABLE "SellerAcquisitionCampaign"
  ADD CONSTRAINT "SellerAcquisitionCampaign_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SellerAcquisitionCampaignMember"
  ADD CONSTRAINT "SellerAcquisitionCampaignMember_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SellerAcquisitionCampaignMember"
  ADD CONSTRAINT "SellerAcquisitionCampaignMember_tenantId_campaignId_fkey"
  FOREIGN KEY ("tenantId", "campaignId") REFERENCES "SellerAcquisitionCampaign"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SellerAcquisitionCampaignMember"
  ADD CONSTRAINT "SellerAcquisitionCampaignMember_tenantId_marketplaceCaptureId_fkey"
  FOREIGN KEY ("tenantId", "marketplaceCaptureId") REFERENCES "MarketplaceCapture"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SellerAcquisitionCampaignMember"
  ADD CONSTRAINT "SellerAcquisitionCampaignMember_tenantId_contactId_fkey"
  FOREIGN KEY ("tenantId", "contactId") REFERENCES "Contact"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SellerAcquisitionCampaignMember"
  ADD CONSTRAINT "SellerAcquisitionCampaignMember_tenantId_dealId_fkey"
  FOREIGN KEY ("tenantId", "dealId") REFERENCES "Deal"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
