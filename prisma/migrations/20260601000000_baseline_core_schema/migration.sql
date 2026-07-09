-- ST1-013L: baseline schema for the core tables that predate migration tracking.
-- Every model in prisma/schema.prisma that has never been created by any earlier migration
-- file (Tenant, TenantUser, Contact, Deal, Pipeline, Subscription, and the rest of the
-- platform/observability tables) is created here, generated from `prisma migrate diff
-- --from-empty --to-schema-datamodel=prisma/schema.prisma --script` and filtered down to just
-- the tables/enums/indexes/constraints that other migrations (ST1-013J/K/etc.) don't already own.
--
-- Without this migration, `prisma migrate deploy` against a genuinely empty database fails
-- immediately on 20260604000000_add_activity_log (FK to a nonexistent "Tenant" table) --
-- every environment created before migration tracking started (e.g. via `prisma db push`)
-- already has these tables, so every statement below is IF NOT EXISTS / duplicate_object-safe
-- and is a no-op there; only a from-scratch database is actually changed by this file.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "TenantRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ContentState" AS ENUM ('DRAFT', 'REVIEW', 'APPROVED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "PublishState" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "HealthStatus" AS ENUM ('HEALTHY', 'DEGRADED', 'UNHEALTHY', 'UNKNOWN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "IncidentSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "WorkflowExecutionState" AS ENUM ('PENDING', 'SCHEDULED', 'RUNNING', 'WAITING_FOR_APPROVAL', 'WAITING_FOR_EVENT', 'RETRY_SCHEDULED', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'DEAD_LETTERED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "WorkflowStepExecutionState" AS ENUM ('PENDING', 'RUNNING', 'WAITING', 'RETRY_SCHEDULED', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'DEAD_LETTERED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "AiExecutionState" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "EventPersistenceState" AS ENUM ('RECEIVED', 'NORMALIZED', 'PROCESSED', 'FAILED', 'DEAD_LETTERED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "IdempotencyKeyState" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "QueueJobState" AS ENUM ('WAITING', 'DELAYED', 'ACTIVE', 'COMPLETED', 'FAILED', 'RETRY_SCHEDULED', 'DEAD_LETTERED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ExecutionLeaseState" AS ENUM ('ACTIVE', 'RELEASED', 'EXPIRED', 'STOLEN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "DistributedLockState" AS ENUM ('HELD', 'RELEASED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "EventDeliveryState" AS ENUM ('PENDING', 'PUBLISHED', 'CONSUMED', 'FAILED', 'DEAD_LETTERED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "TraceSpanStatus" AS ENUM ('OK', 'ERROR', 'UNSET');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ContactStage" AS ENUM ('PROSPECT', 'QUALIFIED', 'PROPOSAL', 'ENGAGEMENT', 'RENEWAL', 'INACTIVE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "DealStage" AS ENUM ('PROSPECT', 'QUALIFIED', 'PROPOSAL', 'ENGAGEMENT', 'RENEWAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "SubscriptionPlan" AS ENUM ('STARTER', 'GROWTH', 'PRO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'UNPAID');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "Tenant" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "externalId" TEXT,
    "alertDigestEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TenantUser" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "externalUserId" TEXT,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "role" "TenantRole" NOT NULL DEFAULT 'MEMBER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Contact" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "externalId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "company" TEXT,
    "stage" "ContactStage" NOT NULL DEFAULT 'PROSPECT',
    "source" TEXT,
    "ownerId" UUID,
    "lastTouchAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ContentItem" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "contactId" UUID,
    "createdByUserId" UUID,
    "externalId" TEXT,
    "title" TEXT NOT NULL,
    "state" "ContentState" NOT NULL DEFAULT 'DRAFT',
    "source" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ContentVariant" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "contentItemId" UUID NOT NULL,
    "externalId" TEXT,
    "label" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "state" "ContentState" NOT NULL DEFAULT 'DRAFT',
    "body" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "InboundEvent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "contactId" UUID,
    "externalId" TEXT,
    "source" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "correlationId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,

    CONSTRAINT "InboundEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LeadEvent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "contactId" UUID,
    "inboundEventId" UUID,
    "externalId" TEXT,
    "eventType" TEXT NOT NULL,
    "correlationId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MarketMoment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "externalId" TEXT,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketMoment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TenantSLO" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "target" DOUBLE PRECISION NOT NULL,
    "window" TEXT NOT NULL,
    "healthStatus" "HealthStatus" NOT NULL DEFAULT 'UNKNOWN',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantSLO_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SloSnapshot" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "tenantSloId" UUID NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "healthStatus" "HealthStatus" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SloSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ReliabilityIncident" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "tenantSloId" UUID,
    "externalId" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "severity" "IncidentSeverity" NOT NULL,
    "healthStatus" "HealthStatus" NOT NULL DEFAULT 'UNHEALTHY',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReliabilityIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PromptLibraryEntry" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "prompt" TEXT NOT NULL,
    "metadata" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptLibraryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PublishJob" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "contentItemId" UUID,
    "contentVariantId" UUID,
    "externalId" TEXT,
    "idempotencyKey" TEXT,
    "target" TEXT NOT NULL,
    "state" "PublishState" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublishJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Pipeline" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "defaultKey" TEXT DEFAULT 'default',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PipelineStage" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "pipelineId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Deal" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "contactId" UUID,
    "pipelineId" UUID NOT NULL,
    "pipelineStageId" UUID NOT NULL,
    "ownerId" UUID,
    "externalId" TEXT,
    "title" TEXT NOT NULL,
    "value" DECIMAL(18,4),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "probability" INTEGER,
    "closedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Subscription" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "plan" "SubscriptionPlan" NOT NULL DEFAULT 'STARTER',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "paystackCustomerId" TEXT,
    "paystackSubscriptionId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "correlationId" TEXT NOT NULL,
    "requestId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WorkflowExecution" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "workflowId" TEXT NOT NULL,
    "workflowVersion" INTEGER NOT NULL,
    "runId" TEXT NOT NULL,
    "state" "WorkflowExecutionState" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT,
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB,
    "error" JSONB,
    "correlationId" TEXT NOT NULL,
    "causationId" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WorkflowStepExecution" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "workflowExecutionId" UUID NOT NULL,
    "stepId" TEXT NOT NULL,
    "state" "WorkflowStepExecutionState" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB,
    "error" JSONB,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowStepExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AiExecution" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "workflowExecutionId" UUID,
    "providerId" TEXT NOT NULL,
    "providerKind" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "state" "AiExecutionState" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT,
    "promptHash" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "response" JSONB,
    "usage" JSONB,
    "error" JSONB,
    "correlationId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "EventIngestion" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "state" "EventPersistenceState" NOT NULL DEFAULT 'RECEIVED',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "error" JSONB,
    "correlationId" TEXT NOT NULL,

    CONSTRAINT "EventIngestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "IdempotencyKey" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "state" "IdempotencyKeyState" NOT NULL DEFAULT 'IN_PROGRESS',
    "response" JSONB,
    "lockedUntil" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "VectorDocument" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "embeddingModel" TEXT,
    "embeddingDimension" INTEGER,
    "contentHash" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "indexedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VectorDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ExecutionTrace" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "traceId" TEXT NOT NULL,
    "rootSpanId" TEXT,
    "correlationId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "attributes" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "ExecutionTrace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ExecutionTraceSpan" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "executionTraceId" UUID NOT NULL,
    "spanId" TEXT NOT NULL,
    "parentSpanId" TEXT,
    "name" TEXT NOT NULL,
    "status" "TraceSpanStatus" NOT NULL DEFAULT 'UNSET',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "attributes" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "ExecutionTraceSpan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "QueueJob" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "queueName" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "state" "QueueJobState" NOT NULL DEFAULT 'WAITING',
    "payload" JSONB NOT NULL,
    "attemptsMade" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "scheduledAt" TIMESTAMP(3),
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "lastError" JSONB,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueueJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DeadLetterJob" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "queueName" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "attemptsMade" INTEGER NOT NULL,
    "failedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlationId" TEXT NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "DeadLetterJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ScheduledJob" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "scheduleName" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "cron" TEXT,
    "runAt" TIMESTAMP(3),
    "payload" JSONB NOT NULL DEFAULT '{}',
    "state" "QueueJobState" NOT NULL DEFAULT 'WAITING',
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ExecutionLease" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "leaseKey" TEXT NOT NULL,
    "holderId" TEXT NOT NULL,
    "workflowExecutionId" UUID,
    "workflowStepExecutionId" UUID,
    "state" "ExecutionLeaseState" NOT NULL DEFAULT 'ACTIVE',
    "fencingToken" BIGINT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "correlationId" TEXT NOT NULL,

    CONSTRAINT "ExecutionLease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DistributedLock" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "lockKey" TEXT NOT NULL,
    "holderId" TEXT NOT NULL,
    "state" "DistributedLockState" NOT NULL DEFAULT 'HELD',
    "fencingToken" BIGINT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "correlationId" TEXT NOT NULL,

    CONSTRAINT "DistributedLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "OutboxEvent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventVersion" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "headers" JSONB NOT NULL DEFAULT '{}',
    "state" "EventDeliveryState" NOT NULL DEFAULT 'PENDING',
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "attemptsMade" INTEGER NOT NULL DEFAULT 0,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "InboxEvent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "headers" JSONB NOT NULL DEFAULT '{}',
    "state" "EventDeliveryState" NOT NULL DEFAULT 'PENDING',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "attemptsMade" INTEGER NOT NULL DEFAULT 0,
    "correlationId" TEXT NOT NULL,
    "error" JSONB,

    CONSTRAINT "InboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_externalId_key" ON "Tenant"("externalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TenantUser_tenantId_idx" ON "TenantUser"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TenantUser_tenantId_externalUserId_idx" ON "TenantUser"("tenantId", "externalUserId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TenantUser_tenantId_id_key" ON "TenantUser"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TenantUser_tenantId_email_key" ON "TenantUser"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TenantUser_tenantId_externalUserId_key" ON "TenantUser"("tenantId", "externalUserId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Contact_tenantId_idx" ON "Contact"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Contact_tenantId_email_idx" ON "Contact"("tenantId", "email");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Contact_tenantId_phone_idx" ON "Contact"("tenantId", "phone");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Contact_tenantId_externalId_idx" ON "Contact"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Contact_tenantId_stage_idx" ON "Contact"("tenantId", "stage");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Contact_tenantId_ownerId_idx" ON "Contact"("tenantId", "ownerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Contact_tenantId_lastTouchAt_idx" ON "Contact"("tenantId", "lastTouchAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Contact_tenantId_id_key" ON "Contact"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Contact_tenantId_externalId_key" ON "Contact"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ContentItem_tenantId_idx" ON "ContentItem"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ContentItem_tenantId_contactId_idx" ON "ContentItem"("tenantId", "contactId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ContentItem_tenantId_createdByUserId_idx" ON "ContentItem"("tenantId", "createdByUserId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ContentItem_tenantId_state_idx" ON "ContentItem"("tenantId", "state");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ContentItem_tenantId_externalId_idx" ON "ContentItem"("tenantId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ContentItem_tenantId_id_key" ON "ContentItem"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ContentItem_tenantId_externalId_key" ON "ContentItem"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ContentVariant_tenantId_idx" ON "ContentVariant"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ContentVariant_tenantId_contentItemId_idx" ON "ContentVariant"("tenantId", "contentItemId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ContentVariant_tenantId_state_idx" ON "ContentVariant"("tenantId", "state");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ContentVariant_tenantId_externalId_idx" ON "ContentVariant"("tenantId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ContentVariant_tenantId_id_key" ON "ContentVariant"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ContentVariant_tenantId_externalId_key" ON "ContentVariant"("tenantId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ContentVariant_tenantId_contentItemId_version_key" ON "ContentVariant"("tenantId", "contentItemId", "version");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InboundEvent_tenantId_idx" ON "InboundEvent"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InboundEvent_tenantId_contactId_idx" ON "InboundEvent"("tenantId", "contactId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InboundEvent_tenantId_externalId_idx" ON "InboundEvent"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InboundEvent_tenantId_correlationId_idx" ON "InboundEvent"("tenantId", "correlationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InboundEvent_tenantId_source_eventType_occurredAt_idx" ON "InboundEvent"("tenantId", "source", "eventType", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "InboundEvent_tenantId_id_key" ON "InboundEvent"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "InboundEvent_tenantId_source_externalId_key" ON "InboundEvent"("tenantId", "source", "externalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LeadEvent_tenantId_idx" ON "LeadEvent"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LeadEvent_tenantId_contactId_occurredAt_idx" ON "LeadEvent"("tenantId", "contactId", "occurredAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LeadEvent_tenantId_inboundEventId_idx" ON "LeadEvent"("tenantId", "inboundEventId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LeadEvent_tenantId_externalId_idx" ON "LeadEvent"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LeadEvent_tenantId_correlationId_idx" ON "LeadEvent"("tenantId", "correlationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LeadEvent_tenantId_eventType_occurredAt_idx" ON "LeadEvent"("tenantId", "eventType", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LeadEvent_tenantId_id_key" ON "LeadEvent"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LeadEvent_tenantId_externalId_key" ON "LeadEvent"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MarketMoment_tenantId_idx" ON "MarketMoment"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MarketMoment_tenantId_externalId_idx" ON "MarketMoment"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MarketMoment_tenantId_source_occurredAt_idx" ON "MarketMoment"("tenantId", "source", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MarketMoment_tenantId_id_key" ON "MarketMoment"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MarketMoment_tenantId_externalId_key" ON "MarketMoment"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TenantSLO_tenantId_idx" ON "TenantSLO"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TenantSLO_tenantId_healthStatus_idx" ON "TenantSLO"("tenantId", "healthStatus");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TenantSLO_tenantId_id_key" ON "TenantSLO"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TenantSLO_tenantId_name_key" ON "TenantSLO"("tenantId", "name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SloSnapshot_tenantId_idx" ON "SloSnapshot"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SloSnapshot_tenantId_tenantSloId_capturedAt_idx" ON "SloSnapshot"("tenantId", "tenantSloId", "capturedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SloSnapshot_tenantId_healthStatus_capturedAt_idx" ON "SloSnapshot"("tenantId", "healthStatus", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SloSnapshot_tenantId_id_key" ON "SloSnapshot"("tenantId", "id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReliabilityIncident_tenantId_idx" ON "ReliabilityIncident"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReliabilityIncident_tenantId_externalId_idx" ON "ReliabilityIncident"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReliabilityIncident_tenantId_tenantSloId_startedAt_idx" ON "ReliabilityIncident"("tenantId", "tenantSloId", "startedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReliabilityIncident_tenantId_severity_startedAt_idx" ON "ReliabilityIncident"("tenantId", "severity", "startedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReliabilityIncident_tenantId_healthStatus_startedAt_idx" ON "ReliabilityIncident"("tenantId", "healthStatus", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ReliabilityIncident_tenantId_id_key" ON "ReliabilityIncident"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ReliabilityIncident_tenantId_externalId_key" ON "ReliabilityIncident"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PromptLibraryEntry_tenantId_idx" ON "PromptLibraryEntry"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PromptLibraryEntry_tenantId_key_idx" ON "PromptLibraryEntry"("tenantId", "key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PromptLibraryEntry_tenantId_isActive_idx" ON "PromptLibraryEntry"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PromptLibraryEntry_tenantId_id_key" ON "PromptLibraryEntry"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PromptLibraryEntry_tenantId_key_version_key" ON "PromptLibraryEntry"("tenantId", "key", "version");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PublishJob_tenantId_idx" ON "PublishJob"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PublishJob_tenantId_contentItemId_idx" ON "PublishJob"("tenantId", "contentItemId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PublishJob_tenantId_contentVariantId_idx" ON "PublishJob"("tenantId", "contentVariantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PublishJob_tenantId_externalId_idx" ON "PublishJob"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PublishJob_tenantId_idempotencyKey_idx" ON "PublishJob"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PublishJob_tenantId_state_scheduledAt_idx" ON "PublishJob"("tenantId", "state", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PublishJob_tenantId_id_key" ON "PublishJob"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PublishJob_tenantId_externalId_key" ON "PublishJob"("tenantId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PublishJob_tenantId_idempotencyKey_key" ON "PublishJob"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Pipeline_tenantId_idx" ON "Pipeline"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Pipeline_tenantId_isDefault_idx" ON "Pipeline"("tenantId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Pipeline_tenantId_id_key" ON "Pipeline"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Pipeline_tenantId_defaultKey_key" ON "Pipeline"("tenantId", "defaultKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PipelineStage_tenantId_idx" ON "PipelineStage"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PipelineStage_tenantId_pipelineId_idx" ON "PipelineStage"("tenantId", "pipelineId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PipelineStage_tenantId_pipelineId_position_idx" ON "PipelineStage"("tenantId", "pipelineId", "position");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PipelineStage_tenantId_id_key" ON "PipelineStage"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PipelineStage_tenantId_pipelineId_id_key" ON "PipelineStage"("tenantId", "pipelineId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PipelineStage_tenantId_pipelineId_name_key" ON "PipelineStage"("tenantId", "pipelineId", "name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PipelineStage_tenantId_pipelineId_position_key" ON "PipelineStage"("tenantId", "pipelineId", "position");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Deal_tenantId_idx" ON "Deal"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Deal_tenantId_contactId_idx" ON "Deal"("tenantId", "contactId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Deal_tenantId_pipelineId_idx" ON "Deal"("tenantId", "pipelineId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Deal_tenantId_pipelineStageId_idx" ON "Deal"("tenantId", "pipelineStageId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Deal_tenantId_ownerId_idx" ON "Deal"("tenantId", "ownerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Deal_tenantId_pipelineId_pipelineStageId_idx" ON "Deal"("tenantId", "pipelineId", "pipelineStageId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Deal_tenantId_pipelineId_pipelineStageId_id_idx" ON "Deal"("tenantId", "pipelineId", "pipelineStageId", "id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Deal_tenantId_createdAt_idx" ON "Deal"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Deal_tenantId_closedAt_idx" ON "Deal"("tenantId", "closedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Deal_tenantId_externalId_idx" ON "Deal"("tenantId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Deal_tenantId_id_key" ON "Deal"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Deal_tenantId_externalId_key" ON "Deal"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Subscription_tenantId_idx" ON "Subscription"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Subscription_tenantId_status_idx" ON "Subscription"("tenantId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Subscription_tenantId_plan_status_idx" ON "Subscription"("tenantId", "plan", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Subscription_tenantId_trialEndsAt_idx" ON "Subscription"("tenantId", "trialEndsAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Subscription_tenantId_id_key" ON "Subscription"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Subscription_tenantId_stripeCustomerId_key" ON "Subscription"("tenantId", "stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Subscription_tenantId_paystackCustomerId_key" ON "Subscription"("tenantId", "paystackCustomerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditLog_tenantId_actorId_occurredAt_idx" ON "AuditLog"("tenantId", "actorId", "occurredAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditLog_tenantId_action_occurredAt_idx" ON "AuditLog"("tenantId", "action", "occurredAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditLog_tenantId_targetType_targetId_idx" ON "AuditLog"("tenantId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditLog_tenantId_correlationId_idx" ON "AuditLog"("tenantId", "correlationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AuditLog_tenantId_id_key" ON "AuditLog"("tenantId", "id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WorkflowExecution_tenantId_workflowId_workflowVersion_idx" ON "WorkflowExecution"("tenantId", "workflowId", "workflowVersion");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WorkflowExecution_tenantId_state_scheduledAt_idx" ON "WorkflowExecution"("tenantId", "state", "scheduledAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WorkflowExecution_tenantId_correlationId_idx" ON "WorkflowExecution"("tenantId", "correlationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WorkflowExecution_tenantId_id_key" ON "WorkflowExecution"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WorkflowExecution_tenantId_runId_key" ON "WorkflowExecution"("tenantId", "runId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WorkflowExecution_tenantId_idempotencyKey_key" ON "WorkflowExecution"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WorkflowStepExecution_tenantId_workflowExecutionId_idx" ON "WorkflowStepExecution"("tenantId", "workflowExecutionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WorkflowStepExecution_tenantId_state_scheduledAt_idx" ON "WorkflowStepExecution"("tenantId", "state", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WorkflowStepExecution_tenantId_id_key" ON "WorkflowStepExecution"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WorkflowStepExecution_tenantId_workflowExecutionId_stepId_key" ON "WorkflowStepExecution"("tenantId", "workflowExecutionId", "stepId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AiExecution_tenantId_workflowExecutionId_idx" ON "AiExecution"("tenantId", "workflowExecutionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AiExecution_tenantId_providerId_model_idx" ON "AiExecution"("tenantId", "providerId", "model");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AiExecution_tenantId_state_createdAt_idx" ON "AiExecution"("tenantId", "state", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AiExecution_tenantId_correlationId_idx" ON "AiExecution"("tenantId", "correlationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AiExecution_tenantId_id_key" ON "AiExecution"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AiExecution_tenantId_idempotencyKey_key" ON "AiExecution"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EventIngestion_tenantId_state_receivedAt_idx" ON "EventIngestion"("tenantId", "state", "receivedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EventIngestion_tenantId_eventType_occurredAt_idx" ON "EventIngestion"("tenantId", "eventType", "occurredAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EventIngestion_tenantId_correlationId_idx" ON "EventIngestion"("tenantId", "correlationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "EventIngestion_tenantId_id_key" ON "EventIngestion"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "EventIngestion_tenantId_provider_providerEventId_key" ON "EventIngestion"("tenantId", "provider", "providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "EventIngestion_tenantId_idempotencyKey_key" ON "EventIngestion"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "IdempotencyKey_tenantId_state_expiresAt_idx" ON "IdempotencyKey"("tenantId", "state", "expiresAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "IdempotencyKey_tenantId_lockedUntil_idx" ON "IdempotencyKey"("tenantId", "lockedUntil");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "IdempotencyKey_tenantId_id_key" ON "IdempotencyKey"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "IdempotencyKey_tenantId_scope_key_key" ON "IdempotencyKey"("tenantId", "scope", "key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VectorDocument_tenantId_sourceType_sourceId_idx" ON "VectorDocument"("tenantId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VectorDocument_tenantId_embeddingModel_idx" ON "VectorDocument"("tenantId", "embeddingModel");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VectorDocument_tenantId_contentHash_idx" ON "VectorDocument"("tenantId", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "VectorDocument_tenantId_id_key" ON "VectorDocument"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "VectorDocument_tenantId_sourceType_sourceId_chunkId_key" ON "VectorDocument"("tenantId", "sourceType", "sourceId", "chunkId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExecutionTrace_tenantId_correlationId_idx" ON "ExecutionTrace"("tenantId", "correlationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExecutionTrace_tenantId_startedAt_idx" ON "ExecutionTrace"("tenantId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ExecutionTrace_tenantId_id_key" ON "ExecutionTrace"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ExecutionTrace_tenantId_traceId_key" ON "ExecutionTrace"("tenantId", "traceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExecutionTraceSpan_tenantId_executionTraceId_idx" ON "ExecutionTraceSpan"("tenantId", "executionTraceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExecutionTraceSpan_tenantId_status_startedAt_idx" ON "ExecutionTraceSpan"("tenantId", "status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ExecutionTraceSpan_tenantId_id_key" ON "ExecutionTraceSpan"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ExecutionTraceSpan_tenantId_executionTraceId_spanId_key" ON "ExecutionTraceSpan"("tenantId", "executionTraceId", "spanId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "QueueJob_tenantId_queueName_state_availableAt_idx" ON "QueueJob"("tenantId", "queueName", "state", "availableAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "QueueJob_tenantId_lockedUntil_idx" ON "QueueJob"("tenantId", "lockedUntil");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "QueueJob_tenantId_correlationId_idx" ON "QueueJob"("tenantId", "correlationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "QueueJob_tenantId_id_key" ON "QueueJob"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "QueueJob_tenantId_queueName_jobKey_key" ON "QueueJob"("tenantId", "queueName", "jobKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DeadLetterJob_tenantId_queueName_failedAt_idx" ON "DeadLetterJob"("tenantId", "queueName", "failedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DeadLetterJob_tenantId_correlationId_idx" ON "DeadLetterJob"("tenantId", "correlationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DeadLetterJob_tenantId_id_key" ON "DeadLetterJob"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DeadLetterJob_tenantId_queueName_jobKey_key" ON "DeadLetterJob"("tenantId", "queueName", "jobKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ScheduledJob_tenantId_state_nextRunAt_idx" ON "ScheduledJob"("tenantId", "state", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ScheduledJob_tenantId_id_key" ON "ScheduledJob"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ScheduledJob_tenantId_scheduleName_key" ON "ScheduledJob"("tenantId", "scheduleName");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExecutionLease_tenantId_leaseKey_state_expiresAt_idx" ON "ExecutionLease"("tenantId", "leaseKey", "state", "expiresAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExecutionLease_tenantId_holderId_idx" ON "ExecutionLease"("tenantId", "holderId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ExecutionLease_tenantId_id_key" ON "ExecutionLease"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ExecutionLease_tenantId_leaseKey_fencingToken_key" ON "ExecutionLease"("tenantId", "leaseKey", "fencingToken");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DistributedLock_tenantId_lockKey_state_expiresAt_idx" ON "DistributedLock"("tenantId", "lockKey", "state", "expiresAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DistributedLock_tenantId_holderId_idx" ON "DistributedLock"("tenantId", "holderId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DistributedLock_tenantId_id_key" ON "DistributedLock"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DistributedLock_tenantId_lockKey_fencingToken_key" ON "DistributedLock"("tenantId", "lockKey", "fencingToken");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OutboxEvent_tenantId_state_availableAt_idx" ON "OutboxEvent"("tenantId", "state", "availableAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OutboxEvent_tenantId_aggregateType_aggregateId_idx" ON "OutboxEvent"("tenantId", "aggregateType", "aggregateId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OutboxEvent_tenantId_correlationId_idx" ON "OutboxEvent"("tenantId", "correlationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OutboxEvent_tenantId_id_key" ON "OutboxEvent"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OutboxEvent_tenantId_idempotencyKey_key" ON "OutboxEvent"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InboxEvent_tenantId_state_receivedAt_idx" ON "InboxEvent"("tenantId", "state", "receivedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InboxEvent_tenantId_eventType_receivedAt_idx" ON "InboxEvent"("tenantId", "eventType", "receivedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InboxEvent_tenantId_correlationId_idx" ON "InboxEvent"("tenantId", "correlationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "InboxEvent_tenantId_id_key" ON "InboxEvent"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "InboxEvent_tenantId_source_messageId_key" ON "InboxEvent"("tenantId", "source", "messageId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "TenantUser" ADD CONSTRAINT "TenantUser_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Contact" ADD CONSTRAINT "Contact_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Contact" ADD CONSTRAINT "Contact_tenantId_ownerId_fkey" FOREIGN KEY ("tenantId", "ownerId") REFERENCES "TenantUser"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_tenantId_contactId_fkey" FOREIGN KEY ("tenantId", "contactId") REFERENCES "Contact"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_tenantId_createdByUserId_fkey" FOREIGN KEY ("tenantId", "createdByUserId") REFERENCES "TenantUser"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ContentVariant" ADD CONSTRAINT "ContentVariant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ContentVariant" ADD CONSTRAINT "ContentVariant_tenantId_contentItemId_fkey" FOREIGN KEY ("tenantId", "contentItemId") REFERENCES "ContentItem"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "InboundEvent" ADD CONSTRAINT "InboundEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "InboundEvent" ADD CONSTRAINT "InboundEvent_tenantId_contactId_fkey" FOREIGN KEY ("tenantId", "contactId") REFERENCES "Contact"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "LeadEvent" ADD CONSTRAINT "LeadEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "LeadEvent" ADD CONSTRAINT "LeadEvent_tenantId_contactId_fkey" FOREIGN KEY ("tenantId", "contactId") REFERENCES "Contact"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "LeadEvent" ADD CONSTRAINT "LeadEvent_tenantId_inboundEventId_fkey" FOREIGN KEY ("tenantId", "inboundEventId") REFERENCES "InboundEvent"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "MarketMoment" ADD CONSTRAINT "MarketMoment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "TenantSLO" ADD CONSTRAINT "TenantSLO_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "SloSnapshot" ADD CONSTRAINT "SloSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "SloSnapshot" ADD CONSTRAINT "SloSnapshot_tenantId_tenantSloId_fkey" FOREIGN KEY ("tenantId", "tenantSloId") REFERENCES "TenantSLO"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ReliabilityIncident" ADD CONSTRAINT "ReliabilityIncident_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ReliabilityIncident" ADD CONSTRAINT "ReliabilityIncident_tenantId_tenantSloId_fkey" FOREIGN KEY ("tenantId", "tenantSloId") REFERENCES "TenantSLO"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "PromptLibraryEntry" ADD CONSTRAINT "PromptLibraryEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "PublishJob" ADD CONSTRAINT "PublishJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "PublishJob" ADD CONSTRAINT "PublishJob_tenantId_contentItemId_fkey" FOREIGN KEY ("tenantId", "contentItemId") REFERENCES "ContentItem"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "PublishJob" ADD CONSTRAINT "PublishJob_tenantId_contentVariantId_fkey" FOREIGN KEY ("tenantId", "contentVariantId") REFERENCES "ContentVariant"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Pipeline" ADD CONSTRAINT "Pipeline_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "PipelineStage" ADD CONSTRAINT "PipelineStage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "PipelineStage" ADD CONSTRAINT "PipelineStage_tenantId_pipelineId_fkey" FOREIGN KEY ("tenantId", "pipelineId") REFERENCES "Pipeline"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Deal" ADD CONSTRAINT "Deal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Deal" ADD CONSTRAINT "Deal_tenantId_contactId_fkey" FOREIGN KEY ("tenantId", "contactId") REFERENCES "Contact"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Deal" ADD CONSTRAINT "Deal_tenantId_pipelineId_fkey" FOREIGN KEY ("tenantId", "pipelineId") REFERENCES "Pipeline"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Deal" ADD CONSTRAINT "Deal_tenantId_pipelineId_pipelineStageId_fkey" FOREIGN KEY ("tenantId", "pipelineId", "pipelineStageId") REFERENCES "PipelineStage"("tenantId", "pipelineId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Deal" ADD CONSTRAINT "Deal_tenantId_ownerId_fkey" FOREIGN KEY ("tenantId", "ownerId") REFERENCES "TenantUser"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "WorkflowExecution" ADD CONSTRAINT "WorkflowExecution_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "WorkflowStepExecution" ADD CONSTRAINT "WorkflowStepExecution_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "WorkflowStepExecution" ADD CONSTRAINT "WorkflowStepExecution_tenantId_workflowExecutionId_fkey" FOREIGN KEY ("tenantId", "workflowExecutionId") REFERENCES "WorkflowExecution"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "AiExecution" ADD CONSTRAINT "AiExecution_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "EventIngestion" ADD CONSTRAINT "EventIngestion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "VectorDocument" ADD CONSTRAINT "VectorDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ExecutionTrace" ADD CONSTRAINT "ExecutionTrace_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ExecutionTraceSpan" ADD CONSTRAINT "ExecutionTraceSpan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ExecutionTraceSpan" ADD CONSTRAINT "ExecutionTraceSpan_tenantId_executionTraceId_fkey" FOREIGN KEY ("tenantId", "executionTraceId") REFERENCES "ExecutionTrace"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "QueueJob" ADD CONSTRAINT "QueueJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "DeadLetterJob" ADD CONSTRAINT "DeadLetterJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ScheduledJob" ADD CONSTRAINT "ScheduledJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ExecutionLease" ADD CONSTRAINT "ExecutionLease_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ExecutionLease" ADD CONSTRAINT "ExecutionLease_tenantId_workflowExecutionId_fkey" FOREIGN KEY ("tenantId", "workflowExecutionId") REFERENCES "WorkflowExecution"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ExecutionLease" ADD CONSTRAINT "ExecutionLease_tenantId_workflowStepExecutionId_fkey" FOREIGN KEY ("tenantId", "workflowStepExecutionId") REFERENCES "WorkflowStepExecution"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "DistributedLock" ADD CONSTRAINT "DistributedLock_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "InboxEvent" ADD CONSTRAINT "InboxEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
