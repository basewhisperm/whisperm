-- Activity log persistence for tenant-scoped CRM interactions.
-- Expand-only table creation; existing installations with the table already present
-- keep their data and constraints.
DO $$ BEGIN
  CREATE TYPE "ActivityType" AS ENUM ('CALL', 'EMAIL', 'MEETING', 'TASK', 'NOTE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "Activity" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "contactId" UUID,
  "dealId" UUID,
  "createdById" UUID NOT NULL,
  "type" "ActivityType" NOT NULL,
  "note" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

ALTER TABLE IF EXISTS "Activity" ALTER COLUMN "note" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Activity_tenantId_id_key" ON "Activity"("tenantId", "id");
CREATE INDEX IF NOT EXISTS "Activity_tenantId_idx" ON "Activity"("tenantId");
CREATE INDEX IF NOT EXISTS "Activity_tenantId_contactId_occurredAt_idx" ON "Activity"("tenantId", "contactId", "occurredAt");
CREATE INDEX IF NOT EXISTS "Activity_tenantId_dealId_occurredAt_idx" ON "Activity"("tenantId", "dealId", "occurredAt");
CREATE INDEX IF NOT EXISTS "Activity_tenantId_createdById_idx" ON "Activity"("tenantId", "createdById");
CREATE INDEX IF NOT EXISTS "Activity_tenantId_type_occurredAt_idx" ON "Activity"("tenantId", "type", "occurredAt");

DO $$ BEGIN
  ALTER TABLE "Activity" ADD CONSTRAINT "Activity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Activity" ADD CONSTRAINT "Activity_tenantId_contactId_fkey" FOREIGN KEY ("tenantId", "contactId") REFERENCES "Contact"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Activity" ADD CONSTRAINT "Activity_tenantId_dealId_fkey" FOREIGN KEY ("tenantId", "dealId") REFERENCES "Deal"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Activity" ADD CONSTRAINT "Activity_tenantId_createdById_fkey" FOREIGN KEY ("tenantId", "createdById") REFERENCES "TenantUser"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
