ALTER TABLE "RenderConversion" ADD COLUMN IF NOT EXISTS "renderSellerId" TEXT;
ALTER TABLE "RenderConversion" ADD COLUMN IF NOT EXISTS "conversionKind" TEXT DEFAULT 'SELLER';
ALTER TABLE "RenderConversion" ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3);
ALTER TABLE "RenderConversion" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);
ALTER TABLE "RenderConversion" ADD COLUMN IF NOT EXISTS "failedAt" TIMESTAMP(3);
ALTER TABLE "RenderConversion" ADD COLUMN IF NOT EXISTS "failureReason" TEXT;
CREATE INDEX IF NOT EXISTS "RenderConversion_tenantId_conversionKind_status_idx" ON "RenderConversion"("tenantId", "conversionKind", "status");
CREATE INDEX IF NOT EXISTS "RenderConversion_tenantId_renderSellerId_idx" ON "RenderConversion"("tenantId", "renderSellerId");
