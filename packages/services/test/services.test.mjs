import assert from "node:assert/strict";
import test from "node:test";

import { createWhispeRMServices, ServiceError } from "../dist/index.js";

const now = "2026-05-29T00:00:00.000Z";
const correlation = { correlationId: "corr-1", requestId: "req-1" };
const context = { tenantId: "tenant-a", actorId: "user-admin", correlation };

const page = (items = []) => ({ items });

const createRepositories = (overrides = {}) => {
  const calls = [];
  const push = (repo, method, args) => calls.push({ repo, method, args });

  const repositories = {
    calls,
    tenants: {
      async create(input) { push("tenants", "create", [input]); return { id: "tenant-a", slug: input.slug, name: input.name, externalId: input.externalId ?? null, createdAt: now, updatedAt: now }; },
      async findById(id) { push("tenants", "findById", [id]); return { id, slug: "tenant-a", name: "Tenant A", createdAt: now, updatedAt: now }; },
      async findBySlug(slug) { push("tenants", "findBySlug", [slug]); return null; },
      async update(id, input) { push("tenants", "update", [id, input]); return { id, slug: "tenant-a", name: input.name ?? "Tenant A", externalId: input.externalId ?? null, createdAt: now, updatedAt: now }; },
      async runInTransaction(txContext, work) { push("tenants", "runInTransaction", [txContext]); return work({ tenantId: txContext.tenantId, correlation: txContext.correlation, prisma: {} }); }
    },
    users: {
      async create(scope, input) { push("users", "create", [scope, input]); return { id: "user-1", tenantId: input.tenantId, email: input.email, role: input.role, isActive: input.isActive ?? true, displayName: input.displayName ?? null, externalUserId: input.externalUserId ?? null, createdAt: now, updatedAt: now }; },
      async findById(scope, id) { push("users", "findById", [scope, id]); return null; },
      async findByEmail(scope, email) { push("users", "findByEmail", [scope, email]); return null; },
      async list(scope) { push("users", "list", [scope]); return page(); },
      async update(scope, id, input) { push("users", "update", [scope, id, input]); return { id, tenantId: scope.tenantId, email: input.email ?? "person@example.com", role: input.role ?? "MEMBER", isActive: input.isActive ?? true, createdAt: now, updatedAt: now }; }
    },
    campaigns: {
      async create(scope, input) { push("campaigns", "create", [scope, input]); return { id: "campaign-1", tenantId: input.tenantId, title: input.title, state: input.state ?? "DRAFT", contactId: null, createdByUserId: null, externalId: null, source: null, metadata: input.metadata ?? {}, createdAt: now, updatedAt: now }; },
      async findById(scope, id) { push("campaigns", "findById", [scope, id]); return { id, tenantId: scope.tenantId, title: "Campaign", state: "DRAFT", createdAt: now, updatedAt: now }; },
      async list(scope) { push("campaigns", "list", [scope]); return page(); },
      async update(scope, id, input) { push("campaigns", "update", [scope, id, input]); return { id, tenantId: scope.tenantId, title: input.title ?? "Campaign", state: input.state ?? "DRAFT", createdAt: now, updatedAt: now }; },
      async addVariant(scope, input) { push("campaigns", "addVariant", [scope, input]); return { id: "variant-1", tenantId: input.tenantId, contentItemId: input.contentItemId, label: input.label, channel: input.channel, version: input.version ?? 1, state: input.state ?? "DRAFT", body: input.body, createdAt: now, updatedAt: now }; },
      async enqueuePublish(scope, input) { push("campaigns", "enqueuePublish", [scope, input]); return { id: "publish-1", tenantId: input.tenantId, target: input.target, state: input.state ?? "QUEUED", attempts: 0, idempotencyKey: input.idempotencyKey ?? null, contentItemId: input.contentItemId ?? null, contentVariantId: input.contentVariantId ?? null, externalId: null, scheduledAt: input.scheduledAt ?? null, startedAt: null, finishedAt: null, errorMessage: null, metadata: input.metadata ?? {}, createdAt: now, updatedAt: now }; },
      async findPublishJobByIdempotencyKey(scope, key) { push("campaigns", "findPublishJobByIdempotencyKey", [scope, key]); return null; }
    },
    workflows: {
      async createExecution(scope, input) { push("workflows", "createExecution", [scope, input]); return { id: "workflow-exec-1", tenantId: input.tenantId, workflowId: input.workflowId, workflowVersion: input.workflowVersion, runId: input.runId, state: input.state ?? "PENDING", idempotencyKey: input.idempotencyKey ?? null, input: input.input ?? {}, output: null, error: null, correlationId: input.correlationId, causationId: input.causationId ?? null, scheduledAt: null, startedAt: null, finishedAt: null, createdAt: now, updatedAt: now }; },
      async findExecutionById(scope, id) { push("workflows", "findExecutionById", [scope, id]); return null; },
      async findExecutionByRunId(scope, runId) { push("workflows", "findExecutionByRunId", [scope, runId]); return null; },
      async updateExecution(scope, id, input) { push("workflows", "updateExecution", [scope, id, input]); return { id, tenantId: scope.tenantId, workflowId: "workflow-1", workflowVersion: 1, runId: "run-1", state: input.state ?? "RUNNING", input: {}, output: null, error: null, correlationId: correlation.correlationId, createdAt: now, updatedAt: now }; },
      async upsertStep(scope, input) { push("workflows", "upsertStep", [scope, input]); return { id: "step-exec-1", tenantId: input.tenantId, workflowExecutionId: input.workflowExecutionId, stepId: input.stepId, state: input.state ?? "PENDING", attempt: input.attempt ?? 0, maxAttempts: input.maxAttempts ?? 1, input: input.input ?? {}, createdAt: now, updatedAt: now }; },
      async listRunnableExecutions(scope, state) { push("workflows", "listRunnableExecutions", [scope, state]); return page(); }
    },
    approvals: {
      async createRequest(scope, input) { push("approvals", "createRequest", [scope, input]); return { id: "approval-request-1", ...input, metadata: input.metadata ?? {}, createdAt: now }; },
      async recordDecision(scope, input) { push("approvals", "recordDecision", [scope, input]); return { id: "approval-decision-1", ...input, metadata: input.metadata ?? {}, createdAt: now }; },
      async findRequestByApprovalId(scope, approvalId) { push("approvals", "findRequestByApprovalId", [scope, approvalId]); return null; }
    },
    executions: {
      async createAiExecution(scope, input) { push("executions", "createAiExecution", [scope, input]); return { id: "ai-1", tenantId: input.tenantId, providerId: input.providerId, providerKind: input.providerKind, model: input.model, promptHash: input.promptHash, request: input.request, state: input.state ?? "PENDING", idempotencyKey: input.idempotencyKey ?? null, correlationId: input.correlationId, createdAt: now, updatedAt: now }; },
      async findAiExecutionByIdempotencyKey(scope, key) { push("executions", "findAiExecutionByIdempotencyKey", [scope, key]); return null; },
      async updateAiExecution(scope, id, input) { push("executions", "updateAiExecution", [scope, id, input]); return { id, tenantId: scope.tenantId, providerId: "provider-1", providerKind: "llm", model: "model", promptHash: "hash", request: {}, state: input.state ?? "SUCCEEDED", idempotencyKey: null, correlationId: correlation.correlationId, response: input.response ?? null, usage: input.usage ?? null, error: input.error ?? null, createdAt: now, updatedAt: now }; }
    },
    events: {
      async ingest(scope, input) { push("events", "ingest", [scope, input]); return { id: "ingestion-1", tenantId: input.tenantId, provider: input.provider, providerEventId: input.providerEventId, eventType: input.eventType, idempotencyKey: input.idempotencyKey, state: input.state ?? "RECEIVED", occurredAt: input.occurredAt, receivedAt: input.receivedAt ?? now, payload: input.payload, correlationId: input.correlationId, createdAt: now, updatedAt: now }; },
      async findIngestionByProviderEvent(scope, provider, providerEventId) { push("events", "findIngestionByProviderEvent", [scope, provider, providerEventId]); return null; },
      async appendOutbox(scope, input) { push("events", "appendOutbox", [scope, input]); return { id: `outbox-${calls.length}`, tenantId: input.tenantId, aggregateType: input.aggregateType, aggregateId: input.aggregateId, eventType: input.eventType, eventVersion: input.eventVersion ?? 1, idempotencyKey: input.idempotencyKey, payload: input.payload, headers: input.headers ?? {}, state: input.state ?? "PENDING", availableAt: input.availableAt ?? now, attemptsMade: 0, correlationId: input.correlationId, createdAt: now, updatedAt: now }; },
      async markOutboxPublished(scope, id, publishedAt) { push("events", "markOutboxPublished", [scope, id, publishedAt]); },
      async recordInbox(scope, input) { push("events", "recordInbox", [scope, input]); return { id: "inbox-1", tenantId: input.tenantId, source: input.source, messageId: input.messageId, eventType: input.eventType, payload: input.payload, headers: input.headers ?? {}, state: input.state ?? "PENDING", receivedAt: input.receivedAt ?? now, attemptsMade: 0, correlationId: input.correlationId }; },
      async markInboxConsumed(scope, id, processedAt) { push("events", "markInboxConsumed", [scope, id, processedAt]); },
      async reserveIdempotency(input) { push("events", "reserveIdempotency", [input]); return { id: "idem-1", createdAt: now, updatedAt: now, ...input }; },
      async completeIdempotency(input) { push("events", "completeIdempotency", [input]); return { id: "idem-1", tenantId: input.tenantId, scope: input.scope, key: input.key, requestHash: "hash", state: "COMPLETED", response: input.response, expiresAt: now, createdAt: now, updatedAt: now }; }
    },
    billing: {
      async recordUsage(scope, input) { push("billing", "recordUsage", [scope, input]); return { id: "usage-1", createdAt: now, ...input, metadata: input.metadata ?? {} }; },
      async findUsageByIdempotencyKey(scope, key) { push("billing", "findUsageByIdempotencyKey", [scope, key]); return null; }
    },
    auditLogs: {
      async append(scope, input) { push("auditLogs", "append", [scope, input]); return { id: `audit-${calls.length}`, tenantId: input.tenantId, actorId: input.actorId ?? null, action: input.action, targetType: input.targetType, targetId: input.targetId ?? null, correlationId: input.correlationId, requestId: input.requestId ?? null, occurredAt: input.occurredAt ?? now, metadata: input.metadata ?? {} }; },
      async listByTarget(scope, targetType, targetId) { push("auditLogs", "listByTarget", [scope, targetType, targetId]); return page(); }
    },
    ...overrides
  };
  return repositories;
};

test("user service rejects tenant mismatches before repositories mutate state", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);

  await assert.rejects(
    services.users.create(context, { tenantId: "tenant-b", email: "person@example.com", role: "MEMBER" }),
    (error) => error instanceof ServiceError && error.code === "SERVICE_TENANT_MISMATCH"
  );

  assert.equal(repositories.calls.some((call) => call.repo === "users" && call.method === "create"), false);
  assert.equal(repositories.calls.some((call) => call.repo === "events" && call.method === "appendOutbox"), false);
});

test("write services run audit and outbox hooks inside the transaction abstraction", async () => {
  const repositories = createRepositories();
  const transactionCalls = [];
  const services = createWhispeRMServices({
    ...repositories,
    transactions: {
      async run(txContext, work) {
        transactionCalls.push(txContext);
        return work(repositories);
      }
    }
  });

  const user = await services.users.create(context, { tenantId: "tenant-a", email: "person@example.com", role: "ADMIN" });

  assert.equal(user.tenantId, "tenant-a");
  assert.deepEqual(transactionCalls, [context]);
  assert.deepEqual(repositories.calls.find((call) => call.repo === "users" && call.method === "create").args[0], { tenantId: "tenant-a" });
  assert.equal(repositories.calls.some((call) => call.repo === "auditLogs" && call.method === "append"), true);
  assert.equal(repositories.calls.some((call) => call.repo === "events" && call.method === "appendOutbox" && call.args[1].eventType === "user.created"), true);
});

test("idempotent campaign publishing returns the existing job without duplicate side effects", async () => {
  const existingJob = { id: "publish-existing", tenantId: "tenant-a", target: "email", state: "QUEUED", attempts: 0, idempotencyKey: "publish-key", contentItemId: null, contentVariantId: null, externalId: null, scheduledAt: null, startedAt: null, finishedAt: null, errorMessage: null, metadata: {}, createdAt: now, updatedAt: now };
  const repositories = createRepositories({
    campaigns: {
      ...createRepositories().campaigns,
      async findPublishJobByIdempotencyKey(scope, key) { repositories.calls.push({ repo: "campaigns", method: "findPublishJobByIdempotencyKey", args: [scope, key] }); return existingJob; }
    }
  });
  const services = createWhispeRMServices(repositories);

  const job = await services.campaigns.enqueuePublish(context, { tenantId: "tenant-a", target: "email", idempotencyKey: "publish-key" });

  assert.equal(job.id, "publish-existing");
  assert.equal(repositories.calls.some((call) => call.repo === "campaigns" && call.method === "enqueuePublish"), false);
  assert.equal(repositories.calls.some((call) => call.repo === "events" && call.method === "appendOutbox"), false);
});

test("event ingestion is idempotent by provider event identity", async () => {
  const existingIngestion = { id: "ingestion-existing", tenantId: "tenant-a", provider: "stripe", providerEventId: "evt-1", eventType: "payment.succeeded", idempotencyKey: "evt-key", state: "RECEIVED", occurredAt: now, receivedAt: now, payload: {}, correlationId: correlation.correlationId, createdAt: now, updatedAt: now };
  const base = createRepositories();
  const repositories = createRepositories({
    events: {
      ...base.events,
      async findIngestionByProviderEvent(scope, provider, providerEventId) { repositories.calls.push({ repo: "events", method: "findIngestionByProviderEvent", args: [scope, provider, providerEventId] }); return existingIngestion; }
    }
  });
  const services = createWhispeRMServices(repositories);

  const ingestion = await services.events.ingest(context, { tenantId: "tenant-a", provider: "stripe", providerEventId: "evt-1", eventType: "payment.succeeded", idempotencyKey: "evt-key", occurredAt: now, payload: {}, correlationId: correlation.correlationId });

  assert.equal(ingestion.id, "ingestion-existing");
  assert.equal(repositories.calls.some((call) => call.repo === "events" && call.method === "ingest"), false);
});

test("transaction manager failures are surfaced as typed transaction errors", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices({
    ...repositories,
    transactions: {
      async run() {
        throw new Error("database unavailable");
      }
    }
  });

  await assert.rejects(
    services.billing.recordUsage(context, { tenantId: "tenant-a", usageId: "usage-1", metric: "tokens", quantity: 10, occurredAt: now, idempotencyKey: "usage-key", correlation }),
    (error) => error instanceof ServiceError && error.code === "SERVICE_TRANSACTION_FAILED" && error.status === 500
  );
});
