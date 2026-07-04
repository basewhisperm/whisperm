-- CS-023 Billing Usage Metering
-- Adds an append-only, tenant-scoped billable-usage ledger for the autonomous
-- acquisition runtime. No foreign keys to campaign/capture/contact/deal/
-- execution records: this is an event log that must stay writable even if a
-- referenced record is later archived or deleted.

CREATE TYPE "AcquisitionUsageEventType" AS ENUM ('SELLER_DISCOVERED', 'SELLER_QUALIFIED', 'INVITATION_SENT', 'SELLER_CLAIMED', 'CRM_CONVERSION_CREATED', 'REVENUE_ATTRIBUTED', 'GROWTH_LOOP_EVALUATED', 'GROWTH_RECOMMENDATION_APPLIED');

CREATE TABLE "AcquisitionUsageEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "eventType" "AcquisitionUsageEventType" NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "campaignId" UUID,
    "captureId" UUID,
    "contactId" UUID,
    "dealId" UUID,
    "runtimeExecutionId" UUID,
    "idempotencyKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcquisitionUsageEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AcquisitionUsageEvent_tenantId_idempotencyKey_key" ON "AcquisitionUsageEvent"("tenantId", "idempotencyKey");
CREATE INDEX "AcquisitionUsageEvent_tenantId_occurredAt_idx" ON "AcquisitionUsageEvent"("tenantId", "occurredAt");
CREATE INDEX "AcquisitionUsageEvent_tenantId_eventType_occurredAt_idx" ON "AcquisitionUsageEvent"("tenantId", "eventType", "occurredAt");

ALTER TABLE "AcquisitionUsageEvent" ADD CONSTRAINT "AcquisitionUsageEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
