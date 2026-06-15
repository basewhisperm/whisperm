ALTER TABLE "RenderConversion" ADD COLUMN IF NOT EXISTS "failureCode" TEXT;
ALTER TABLE "RenderConversion" ADD COLUMN IF NOT EXISTS "attemptCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RenderConversion" ADD COLUMN IF NOT EXISTS "maxAttempts" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "RenderConversion" ADD COLUMN IF NOT EXISTS "nextAttemptAt" TIMESTAMP(3);
ALTER TABLE "RenderConversion" ADD COLUMN IF NOT EXISTS "lastAttemptAt" TIMESTAMP(3);
ALTER TABLE "RenderConversion" ADD COLUMN IF NOT EXISTS "deadLetteredAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "RenderConversion_tenantId_status_nextAttemptAt_idx" ON "RenderConversion"("tenantId", "status", "nextAttemptAt");
