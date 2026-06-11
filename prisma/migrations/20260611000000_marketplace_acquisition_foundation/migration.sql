-- Marketplace acquisition foundation persistence.
-- Expand-only tenant-scoped tables for marketplace capture, claim activation,
-- verification, Render conversion, provider connection metadata, and notification delivery logs.

CREATE TABLE IF NOT EXISTS "MarketplaceSource" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sourceUrl" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MarketplaceSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MarketplaceCapture" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "marketplaceSourceId" UUID,
  "contactId" UUID,
  "dealId" UUID,
  "externalId" TEXT,
  "listingUrl" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "price" DECIMAL(18,4),
  "currency" TEXT,
  "sellerName" TEXT,
  "sellerProfileUrl" TEXT,
  "status" TEXT NOT NULL DEFAULT 'CAPTURED',
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MarketplaceCapture_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MarketplaceClaimToken" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "marketplaceCaptureId" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "claimedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MarketplaceClaimToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MarketplaceSellerVerification" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "marketplaceCaptureId" UUID NOT NULL,
  "contactId" UUID,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "method" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "evidence" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MarketplaceSellerVerification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RenderConversion" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "marketplaceCaptureId" UUID,
  "sellerVerificationId" UUID,
  "contactId" UUID,
  "dealId" UUID,
  "externalId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "convertedAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RenderConversion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProviderConnection" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "marketplaceSourceId" UUID,
  "providerKey" TEXT NOT NULL,
  "providerType" TEXT NOT NULL,
  "externalAccountId" TEXT,
  "displayName" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "scopes" JSONB,
  "metadata" JSONB,
  "connectedAt" TIMESTAMP(3),
  "disconnectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProviderConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "NotificationDeliveryLog" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "marketplaceCaptureId" UUID,
  "claimTokenId" UUID,
  "providerConnectionId" UUID,
  "channel" TEXT NOT NULL,
  "recipientHash" TEXT,
  "templateKey" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "externalMessageId" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "NotificationDeliveryLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MarketplaceSource_tenantId_id_key" ON "MarketplaceSource"("tenantId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "MarketplaceSource_tenantId_key_key" ON "MarketplaceSource"("tenantId", "key");
CREATE INDEX IF NOT EXISTS "MarketplaceSource_tenantId_idx" ON "MarketplaceSource"("tenantId");
CREATE INDEX IF NOT EXISTS "MarketplaceSource_tenantId_isActive_idx" ON "MarketplaceSource"("tenantId", "isActive");

CREATE UNIQUE INDEX IF NOT EXISTS "MarketplaceCapture_tenantId_id_key" ON "MarketplaceCapture"("tenantId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "MarketplaceCapture_tenantId_marketplaceSourceId_externalId_key" ON "MarketplaceCapture"("tenantId", "marketplaceSourceId", "externalId");
CREATE INDEX IF NOT EXISTS "MarketplaceCapture_tenantId_idx" ON "MarketplaceCapture"("tenantId");
CREATE INDEX IF NOT EXISTS "MarketplaceCapture_tenantId_marketplaceSourceId_idx" ON "MarketplaceCapture"("tenantId", "marketplaceSourceId");
CREATE INDEX IF NOT EXISTS "MarketplaceCapture_tenantId_contactId_idx" ON "MarketplaceCapture"("tenantId", "contactId");
CREATE INDEX IF NOT EXISTS "MarketplaceCapture_tenantId_dealId_idx" ON "MarketplaceCapture"("tenantId", "dealId");
CREATE INDEX IF NOT EXISTS "MarketplaceCapture_tenantId_externalId_idx" ON "MarketplaceCapture"("tenantId", "externalId");
CREATE INDEX IF NOT EXISTS "MarketplaceCapture_tenantId_status_capturedAt_idx" ON "MarketplaceCapture"("tenantId", "status", "capturedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "MarketplaceClaimToken_tenantId_id_key" ON "MarketplaceClaimToken"("tenantId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "MarketplaceClaimToken_tenantId_tokenHash_key" ON "MarketplaceClaimToken"("tenantId", "tokenHash");
CREATE INDEX IF NOT EXISTS "MarketplaceClaimToken_tenantId_idx" ON "MarketplaceClaimToken"("tenantId");
CREATE INDEX IF NOT EXISTS "MarketplaceClaimToken_tenantId_marketplaceCaptureId_idx" ON "MarketplaceClaimToken"("tenantId", "marketplaceCaptureId");
CREATE INDEX IF NOT EXISTS "MarketplaceClaimToken_tenantId_status_expiresAt_idx" ON "MarketplaceClaimToken"("tenantId", "status", "expiresAt");

CREATE UNIQUE INDEX IF NOT EXISTS "MarketplaceSellerVerification_tenantId_id_key" ON "MarketplaceSellerVerification"("tenantId", "id");
CREATE INDEX IF NOT EXISTS "MarketplaceSellerVerification_tenantId_idx" ON "MarketplaceSellerVerification"("tenantId");
CREATE INDEX IF NOT EXISTS "MarketplaceSellerVerification_tenantId_marketplaceCaptureId_idx" ON "MarketplaceSellerVerification"("tenantId", "marketplaceCaptureId");
CREATE INDEX IF NOT EXISTS "MarketplaceSellerVerification_tenantId_contactId_idx" ON "MarketplaceSellerVerification"("tenantId", "contactId");
CREATE INDEX IF NOT EXISTS "MarketplaceSellerVerification_tenantId_status_createdAt_idx" ON "MarketplaceSellerVerification"("tenantId", "status", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "RenderConversion_tenantId_id_key" ON "RenderConversion"("tenantId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "RenderConversion_tenantId_externalId_key" ON "RenderConversion"("tenantId", "externalId");
CREATE INDEX IF NOT EXISTS "RenderConversion_tenantId_idx" ON "RenderConversion"("tenantId");
CREATE INDEX IF NOT EXISTS "RenderConversion_tenantId_marketplaceCaptureId_idx" ON "RenderConversion"("tenantId", "marketplaceCaptureId");
CREATE INDEX IF NOT EXISTS "RenderConversion_tenantId_sellerVerificationId_idx" ON "RenderConversion"("tenantId", "sellerVerificationId");
CREATE INDEX IF NOT EXISTS "RenderConversion_tenantId_contactId_idx" ON "RenderConversion"("tenantId", "contactId");
CREATE INDEX IF NOT EXISTS "RenderConversion_tenantId_dealId_idx" ON "RenderConversion"("tenantId", "dealId");
CREATE INDEX IF NOT EXISTS "RenderConversion_tenantId_status_createdAt_idx" ON "RenderConversion"("tenantId", "status", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "ProviderConnection_tenantId_id_key" ON "ProviderConnection"("tenantId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "ProviderConnection_tenantId_providerKey_externalAccountId_key" ON "ProviderConnection"("tenantId", "providerKey", "externalAccountId");
CREATE INDEX IF NOT EXISTS "ProviderConnection_tenantId_idx" ON "ProviderConnection"("tenantId");
CREATE INDEX IF NOT EXISTS "ProviderConnection_tenantId_marketplaceSourceId_idx" ON "ProviderConnection"("tenantId", "marketplaceSourceId");
CREATE INDEX IF NOT EXISTS "ProviderConnection_tenantId_providerKey_idx" ON "ProviderConnection"("tenantId", "providerKey");
CREATE INDEX IF NOT EXISTS "ProviderConnection_tenantId_providerType_status_idx" ON "ProviderConnection"("tenantId", "providerType", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "NotificationDeliveryLog_tenantId_id_key" ON "NotificationDeliveryLog"("tenantId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "NotificationDeliveryLog_tenantId_providerConnectionId_externalMessageId_key" ON "NotificationDeliveryLog"("tenantId", "providerConnectionId", "externalMessageId");
CREATE INDEX IF NOT EXISTS "NotificationDeliveryLog_tenantId_idx" ON "NotificationDeliveryLog"("tenantId");
CREATE INDEX IF NOT EXISTS "NotificationDeliveryLog_tenantId_marketplaceCaptureId_idx" ON "NotificationDeliveryLog"("tenantId", "marketplaceCaptureId");
CREATE INDEX IF NOT EXISTS "NotificationDeliveryLog_tenantId_claimTokenId_idx" ON "NotificationDeliveryLog"("tenantId", "claimTokenId");
CREATE INDEX IF NOT EXISTS "NotificationDeliveryLog_tenantId_providerConnectionId_idx" ON "NotificationDeliveryLog"("tenantId", "providerConnectionId");
CREATE INDEX IF NOT EXISTS "NotificationDeliveryLog_tenantId_channel_status_createdAt_idx" ON "NotificationDeliveryLog"("tenantId", "channel", "status", "createdAt");

DO $$ BEGIN
  ALTER TABLE "MarketplaceSource" ADD CONSTRAINT "MarketplaceSource_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "MarketplaceCapture" ADD CONSTRAINT "MarketplaceCapture_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "MarketplaceCapture" ADD CONSTRAINT "MarketplaceCapture_tenantId_marketplaceSourceId_fkey" FOREIGN KEY ("tenantId", "marketplaceSourceId") REFERENCES "MarketplaceSource"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "MarketplaceCapture" ADD CONSTRAINT "MarketplaceCapture_tenantId_contactId_fkey" FOREIGN KEY ("tenantId", "contactId") REFERENCES "Contact"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "MarketplaceCapture" ADD CONSTRAINT "MarketplaceCapture_tenantId_dealId_fkey" FOREIGN KEY ("tenantId", "dealId") REFERENCES "Deal"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "MarketplaceClaimToken" ADD CONSTRAINT "MarketplaceClaimToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "MarketplaceClaimToken" ADD CONSTRAINT "MarketplaceClaimToken_tenantId_marketplaceCaptureId_fkey" FOREIGN KEY ("tenantId", "marketplaceCaptureId") REFERENCES "MarketplaceCapture"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "MarketplaceSellerVerification" ADD CONSTRAINT "MarketplaceSellerVerification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "MarketplaceSellerVerification" ADD CONSTRAINT "MarketplaceSellerVerification_tenantId_marketplaceCaptureId_fkey" FOREIGN KEY ("tenantId", "marketplaceCaptureId") REFERENCES "MarketplaceCapture"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "MarketplaceSellerVerification" ADD CONSTRAINT "MarketplaceSellerVerification_tenantId_contactId_fkey" FOREIGN KEY ("tenantId", "contactId") REFERENCES "Contact"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "RenderConversion" ADD CONSTRAINT "RenderConversion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "RenderConversion" ADD CONSTRAINT "RenderConversion_tenantId_marketplaceCaptureId_fkey" FOREIGN KEY ("tenantId", "marketplaceCaptureId") REFERENCES "MarketplaceCapture"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "RenderConversion" ADD CONSTRAINT "RenderConversion_tenantId_sellerVerificationId_fkey" FOREIGN KEY ("tenantId", "sellerVerificationId") REFERENCES "MarketplaceSellerVerification"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "RenderConversion" ADD CONSTRAINT "RenderConversion_tenantId_contactId_fkey" FOREIGN KEY ("tenantId", "contactId") REFERENCES "Contact"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "RenderConversion" ADD CONSTRAINT "RenderConversion_tenantId_dealId_fkey" FOREIGN KEY ("tenantId", "dealId") REFERENCES "Deal"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ProviderConnection" ADD CONSTRAINT "ProviderConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ProviderConnection" ADD CONSTRAINT "ProviderConnection_tenantId_marketplaceSourceId_fkey" FOREIGN KEY ("tenantId", "marketplaceSourceId") REFERENCES "MarketplaceSource"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "NotificationDeliveryLog" ADD CONSTRAINT "NotificationDeliveryLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "NotificationDeliveryLog" ADD CONSTRAINT "NotificationDeliveryLog_tenantId_marketplaceCaptureId_fkey" FOREIGN KEY ("tenantId", "marketplaceCaptureId") REFERENCES "MarketplaceCapture"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "NotificationDeliveryLog" ADD CONSTRAINT "NotificationDeliveryLog_tenantId_claimTokenId_fkey" FOREIGN KEY ("tenantId", "claimTokenId") REFERENCES "MarketplaceClaimToken"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "NotificationDeliveryLog" ADD CONSTRAINT "NotificationDeliveryLog_tenantId_providerConnectionId_fkey" FOREIGN KEY ("tenantId", "providerConnectionId") REFERENCES "ProviderConnection"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
