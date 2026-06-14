CREATE TABLE "MarketplaceSellerInvitation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "marketplaceCaptureId" UUID NOT NULL,
  "channel" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "inviteUrl" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MarketplaceSellerInvitation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MarketplaceSellerInvitation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MarketplaceSellerInvitation_tenantId_marketplaceCaptureId_fkey" FOREIGN KEY ("tenantId", "marketplaceCaptureId") REFERENCES "MarketplaceCapture"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MarketplaceSellerInvitation_tenantId_id_key" ON "MarketplaceSellerInvitation"("tenantId", "id");
CREATE INDEX "MarketplaceSellerInvitation_tenantId_idx" ON "MarketplaceSellerInvitation"("tenantId");
CREATE INDEX "MarketplaceSellerInvitation_tenantId_marketplaceCaptureId_idx" ON "MarketplaceSellerInvitation"("tenantId", "marketplaceCaptureId");
CREATE INDEX "MarketplaceSellerInvitation_tenantId_status_expiresAt_idx" ON "MarketplaceSellerInvitation"("tenantId", "status", "expiresAt");
CREATE INDEX "MarketplaceSellerInvitation_tenantId_channel_createdAt_idx" ON "MarketplaceSellerInvitation"("tenantId", "channel", "createdAt");
