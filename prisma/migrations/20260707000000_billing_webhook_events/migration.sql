-- Billing webhook dedup marker. Created in the same transaction as the
-- Subscription upsert it guards, so a retried Stripe/Paystack webhook can
-- never be told "duplicate" without the corresponding subscription change
-- having actually been applied.

CREATE TABLE "BillingWebhookEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillingWebhookEvent_tenantId_provider_providerEventId_key" ON "BillingWebhookEvent"("tenantId", "provider", "providerEventId");
CREATE INDEX "BillingWebhookEvent_tenantId_provider_eventType_idx" ON "BillingWebhookEvent"("tenantId", "provider", "eventType");

ALTER TABLE "BillingWebhookEvent" ADD CONSTRAINT "BillingWebhookEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
