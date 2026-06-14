-- CreateEnum
CREATE TYPE "DraftInventoryStatus" AS ENUM ('DRAFT', 'CLAIM_PENDING', 'CLAIMED', 'CONVERTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "DraftInventory" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "marketplaceCaptureId" UUID NOT NULL,
    "contactId" UUID,
    "dealId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(18,4),
    "currency" TEXT,
    "category" TEXT,
    "images" JSONB,
    "listingUrl" TEXT,
    "marketplaceSource" TEXT,
    "marketplaceListingId" TEXT,
    "status" "DraftInventoryStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftInventory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DraftInventory_tenantId_id_key" ON "DraftInventory"("tenantId", "id");
CREATE UNIQUE INDEX "DraftInventory_tenantId_marketplaceCaptureId_key" ON "DraftInventory"("tenantId", "marketplaceCaptureId");
CREATE INDEX "DraftInventory_tenantId_idx" ON "DraftInventory"("tenantId");
CREATE INDEX "DraftInventory_tenantId_marketplaceCaptureId_idx" ON "DraftInventory"("tenantId", "marketplaceCaptureId");
CREATE INDEX "DraftInventory_tenantId_contactId_idx" ON "DraftInventory"("tenantId", "contactId");
CREATE INDEX "DraftInventory_tenantId_dealId_idx" ON "DraftInventory"("tenantId", "dealId");
CREATE INDEX "DraftInventory_tenantId_status_idx" ON "DraftInventory"("tenantId", "status");
CREATE INDEX "DraftInventory_tenantId_marketplaceSource_marketplaceListingId_idx" ON "DraftInventory"("tenantId", "marketplaceSource", "marketplaceListingId");

-- AddForeignKey
ALTER TABLE "DraftInventory" ADD CONSTRAINT "DraftInventory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DraftInventory" ADD CONSTRAINT "DraftInventory_tenantId_marketplaceCaptureId_fkey" FOREIGN KEY ("tenantId", "marketplaceCaptureId") REFERENCES "MarketplaceCapture"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DraftInventory" ADD CONSTRAINT "DraftInventory_tenantId_contactId_fkey" FOREIGN KEY ("tenantId", "contactId") REFERENCES "Contact"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DraftInventory" ADD CONSTRAINT "DraftInventory_tenantId_dealId_fkey" FOREIGN KEY ("tenantId", "dealId") REFERENCES "Deal"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
