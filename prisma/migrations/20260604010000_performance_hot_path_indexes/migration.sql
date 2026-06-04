-- Targeted tenant-prefixed indexes for dashboard, activity feed, and pipeline board hot paths.
CREATE INDEX IF NOT EXISTS "Deal_tenantId_pipelineId_pipelineStageId_id_idx" ON "Deal" ("tenantId", "pipelineId", "pipelineStageId", "id");
CREATE INDEX IF NOT EXISTS "Deal_tenantId_createdAt_idx" ON "Deal" ("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "Deal_tenantId_closedAt_idx" ON "Deal" ("tenantId", "closedAt");
CREATE INDEX IF NOT EXISTS "Activity_tenantId_occurredAt_idx" ON "Activity" ("tenantId", "occurredAt");
CREATE INDEX IF NOT EXISTS "Activity_tenantId_createdAt_idx" ON "Activity" ("tenantId", "createdAt");
