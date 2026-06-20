CREATE TABLE "TenantFeature" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "featureKey" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TenantFeature_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TenantFeature_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TenantFeature_tenantId_featureKey_key" ON "TenantFeature"("tenantId", "featureKey");
CREATE INDEX "TenantFeature_tenantId_enabled_idx" ON "TenantFeature"("tenantId", "enabled");
CREATE INDEX "TenantFeature_featureKey_enabled_idx" ON "TenantFeature"("featureKey", "enabled");
