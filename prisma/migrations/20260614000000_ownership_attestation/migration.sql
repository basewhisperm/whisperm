CREATE TABLE IF NOT EXISTS "MarketplaceOwnershipAttestation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "marketplaceCaptureId" UUID NOT NULL,
  "draftInventoryId" UUID NOT NULL,
  "contactId" UUID,
  "claimTokenId" UUID,
  "invitationId" UUID,
  "claimantName" TEXT NOT NULL,
  "claimantPhone" TEXT,
  "claimantEmail" TEXT,
  "marketplaceIdentity" TEXT,
  "attestationStatement" TEXT NOT NULL,
  "acceptedTerms" BOOLEAN NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "attestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "evidence" JSONB,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketplaceOwnershipAttestation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MarketplaceOwnershipAttestation_tenantId_id_key" ON "MarketplaceOwnershipAttestation"("tenantId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "MarketplaceOwnershipAttestation_tenantId_marketplaceCaptureId_key" ON "MarketplaceOwnershipAttestation"("tenantId", "marketplaceCaptureId");
CREATE INDEX IF NOT EXISTS "MarketplaceOwnershipAttestation_tenantId_idx" ON "MarketplaceOwnershipAttestation"("tenantId");
CREATE INDEX IF NOT EXISTS "MarketplaceOwnershipAttestation_tenantId_draftInventoryId_idx" ON "MarketplaceOwnershipAttestation"("tenantId", "draftInventoryId");
CREATE INDEX IF NOT EXISTS "MarketplaceOwnershipAttestation_tenantId_claimTokenId_idx" ON "MarketplaceOwnershipAttestation"("tenantId", "claimTokenId");
ALTER TABLE "MarketplaceOwnershipAttestation" ADD CONSTRAINT "MarketplaceOwnershipAttestation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketplaceOwnershipAttestation" ADD CONSTRAINT "MarketplaceOwnershipAttestation_tenantId_marketplaceCaptureId_fkey" FOREIGN KEY ("tenantId", "marketplaceCaptureId") REFERENCES "MarketplaceCapture"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketplaceOwnershipAttestation" ADD CONSTRAINT "MarketplaceOwnershipAttestation_tenantId_draftInventoryId_fkey" FOREIGN KEY ("tenantId", "draftInventoryId") REFERENCES "DraftInventory"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketplaceOwnershipAttestation" ADD CONSTRAINT "MarketplaceOwnershipAttestation_tenantId_claimTokenId_fkey" FOREIGN KEY ("tenantId", "claimTokenId") REFERENCES "MarketplaceClaimToken"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
