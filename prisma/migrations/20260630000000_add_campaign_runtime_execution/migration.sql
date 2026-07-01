CREATE TYPE "CampaignRuntimeExecutionStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "CampaignRuntimeExecutionTrigger" AS ENUM ('MANUAL', 'SCHEDULED', 'SYSTEM');

CREATE TABLE "CampaignRuntimeExecution" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "campaignId" UUID NOT NULL,
  "status" "CampaignRuntimeExecutionStatus" NOT NULL DEFAULT 'QUEUED',
  "trigger" "CampaignRuntimeExecutionTrigger" NOT NULL,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "metrics" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CampaignRuntimeExecution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CampaignRuntimeExecution_tenantId_id_key" ON "CampaignRuntimeExecution"("tenantId", "id");
CREATE INDEX "CampaignRuntimeExecution_tenantId_campaignId_idx" ON "CampaignRuntimeExecution"("tenantId", "campaignId");
CREATE INDEX "CampaignRuntimeExecution_tenantId_campaignId_status_idx" ON "CampaignRuntimeExecution"("tenantId", "campaignId", "status");
CREATE INDEX "CampaignRuntimeExecution_tenantId_status_createdAt_idx" ON "CampaignRuntimeExecution"("tenantId", "status", "createdAt");

ALTER TABLE "CampaignRuntimeExecution"
  ADD CONSTRAINT "CampaignRuntimeExecution_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CampaignRuntimeExecution"
  ADD CONSTRAINT "CampaignRuntimeExecution_tenantId_campaignId_fkey"
  FOREIGN KEY ("tenantId", "campaignId") REFERENCES "SellerAcquisitionCampaign"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
