import assert from "node:assert/strict";
import test from "node:test";

import {
  PersistenceError,
  aiExecutionRecordSchema,
  assertTenantScope,
  auditLogSchema,
  bullMqCompatibleJobOptionsSchema,
  createTransactionalOutboxOperation,
  eventIngestionRecordSchema,
  executionLeaseSchema,
  idempotencyRecordSchema,
  inboxEventSchema,
  outboxEventSchema,
  queueJobSchema,
  scheduledJobSchema,
  toBullMqCompatibleJobOptions,
  vectorDocumentMetadataSchema,
  workflowExecutionRecordSchema
} from "../dist/index.js";

const correlation = { correlationId: "corr-persistence-1", requestId: "req-persistence-1" };
const now = "2026-01-01T00:00:00.000Z";

test("persistence schemas validate tenant-scoped audit, execution, AI, ingestion, idempotency, and vector records", () => {
  const audit = auditLogSchema.parse({
    tenantId: "tenant-1",
    actorId: "user-1",
    action: "tenant.settings.updated",
    targetType: "tenant",
    targetId: "tenant-1",
    occurredAt: now,
    correlation
  });
  assert.equal(audit.tenantId, "tenant-1");
  assert.deepEqual(audit.metadata, {});

  const workflow = workflowExecutionRecordSchema.parse({
    tenantId: "tenant-1",
    workflowId: "workflow-1",
    workflowVersion: 1,
    runId: "run-1",
    state: "RUNNING",
    correlation
  });
  assert.deepEqual(workflow.input, {});

  const ai = aiExecutionRecordSchema.parse({
    tenantId: "tenant-1",
    providerId: "provider-1",
    providerKind: "LOCAL_OSS",
    model: "local-model",
    state: "SUCCEEDED",
    promptHash: "sha256:prompt",
    request: { messages: 1 },
    response: { text: "ok" },
    correlation
  });
  assert.equal(ai.model, "local-model");

  const ingestion = eventIngestionRecordSchema.parse({
    tenantId: "tenant-1",
    provider: "WEB_FORM",
    providerEventId: "evt-1",
    eventType: "lead.created",
    idempotencyKey: "tenant-1:WEB_FORM:evt-1",
    occurredAt: now,
    receivedAt: now,
    payload: { leadId: "lead-1" },
    correlation
  });
  assert.equal(ingestion.idempotencyKey, "tenant-1:WEB_FORM:evt-1");

  const idempotency = idempotencyRecordSchema.parse({
    tenantId: "tenant-1",
    scope: "workflow.start",
    key: "run-1",
    requestHash: "sha256:request",
    state: "IN_PROGRESS",
    expiresAt: "2026-01-02T00:00:00.000Z"
  });
  assert.equal(idempotency.state, "IN_PROGRESS");

  const vectorDocument = vectorDocumentMetadataSchema.parse({
    tenantId: "tenant-1",
    sourceType: "content_item",
    sourceId: "content-1",
    chunkId: "chunk-1",
    contentHash: "sha256:content",
    embeddingModel: "future-embedding-model",
    embeddingDimension: 1536
  });
  assert.equal(vectorDocument.embeddingDimension, 1536);
});

test("idempotencyRecordSchema accepts already-expired records — expiry is application-layer concern", () => {
  const expiredRecord = idempotencyRecordSchema.parse({
    tenantId: "tenant-1",
    scope: "JOB",
    key: "tenant-1:job-expired",
    requestHash: "hash-1",
    state: "EXPIRED",
    expiresAt: "2020-01-01T00:00:00.000Z",
    correlation: { correlationId: "corr-1" },
  });

  assert.equal(expiredRecord.state, "EXPIRED");
  assert.equal(expiredRecord.expiresAt, "2020-01-01T00:00:00.000Z");
});

test("tenant scope guard fails closed for missing or mismatched persistence resources", () => {
  assert.doesNotThrow(() => assertTenantScope({ tenantId: "tenant-1" }, { tenantId: "tenant-1" }));

  assert.throws(
    () => assertTenantScope({ tenantId: "tenant-1" }, {}),
    (error) => error instanceof PersistenceError && error.code === "PERSISTENCE_TENANT_CONTEXT_MISSING"
  );

  assert.throws(
    () => assertTenantScope({ tenantId: "tenant-1" }, { tenantId: "tenant-2" }),
    (error) => error instanceof PersistenceError && error.code === "PERSISTENCE_TENANT_MISMATCH"
  );
});

test("queue contracts remain BullMQ-compatible without requiring Redis at runtime", () => {
  const job = queueJobSchema.parse({
    queueName: "workflow-execution",
    job: {
      tenantId: "tenant-1",
      jobId: "job-1",
      jobName: "workflow.step.execute",
      payload: { workflowExecutionId: "execution-1" },
      idempotencyKey: "tenant-1:workflow:job-1",
      correlation
    },
    attempts: 3,
    delayMs: 250,
    retryPolicy: {
      kind: "EXPONENTIAL",
      maxAttempts: 3,
      initialDelayMs: 250,
      maxDelayMs: 1000,
      backoffMultiplier: 2,
      jitter: false
    }
  });

  const options = toBullMqCompatibleJobOptions(job);
  assert.deepEqual(bullMqCompatibleJobOptionsSchema.parse(options), {
    jobId: "tenant-1:workflow:job-1",
    attempts: 3,
    delay: 250,
    removeOnComplete: false,
    removeOnFail: false,
    backoff: { type: "exponential", delay: 250 }
  });
});

test("leasing, scheduled jobs, outbox, inbox, and transactional helper enforce deterministic boundaries", async () => {
  assert.throws(() => executionLeaseSchema.parse({
    tenantId: "tenant-1",
    leaseKey: "workflow:run-1",
    holderId: "worker-1",
    state: "ACTIVE",
    fencingToken: 1,
    acquiredAt: "2026-01-02T00:00:00.000Z",
    expiresAt: now,
    correlation
  }));

  assert.throws(() => scheduledJobSchema.parse({
    tenantId: "tenant-1",
    scheduleName: "daily-sync",
    jobName: "sync",
    cron: "0 0 * * *",
    runAt: now
  }));

  const outbox = outboxEventSchema.parse({
    tenantId: "tenant-1",
    aggregateType: "workflow",
    aggregateId: "run-1",
    eventType: "workflow.started",
    eventVersion: 1,
    idempotencyKey: "tenant-1:workflow.started:run-1",
    payload: { runId: "run-1" },
    availableAt: now,
    correlation
  });
  const inbox = inboxEventSchema.parse({
    tenantId: "tenant-1",
    source: "eventbridge",
    messageId: "message-1",
    eventType: "lead.created",
    payload: { leadId: "lead-1" },
    receivedAt: now,
    correlation
  });
  assert.equal(outbox.state, "PENDING");
  assert.equal(inbox.state, "PENDING");

  const appended = [];
  const runnerCalls = [];
  const result = await createTransactionalOutboxOperation({
    context: { tenantId: "tenant-1", correlation },
    runner: {
      async runInTransaction(context, work) {
        runnerCalls.push(context);
        return work(context);
      }
    },
    async work(transaction) {
      assert.equal(transaction.tenantId, "tenant-1");
      return "committed";
    },
    outbox: {
      async append(event) {
        appended.push(event);
        return event;
      },
      async markPublished() {}
    },
    event: outbox
  });

  assert.equal(result, "committed");
  assert.equal(runnerCalls.length, 1);
  assert.equal(appended.length, 1);
});
