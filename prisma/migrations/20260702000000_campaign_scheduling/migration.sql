CREATE TYPE "CampaignScheduleCadence" AS ENUM ('HOURLY', 'DAILY', 'WEEKLY');

ALTER TABLE "SellerAcquisitionCampaign"
  ADD COLUMN "scheduleEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "scheduleCadence" "CampaignScheduleCadence",
  ADD COLUMN "scheduleTimezone" TEXT,
  ADD COLUMN "nextRunAt" TIMESTAMP(3),
  ADD COLUMN "lastRunAt" TIMESTAMP(3);

CREATE INDEX "SellerAcquisitionCampaign_tenantId_scheduleEnabled_nextRunAt_idx"
  ON "SellerAcquisitionCampaign"("tenantId", "scheduleEnabled", "nextRunAt");
