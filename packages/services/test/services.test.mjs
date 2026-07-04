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
    contacts: {
      async create(scope, input) { push("contacts", "create", [scope, input]); return { id: "contact-1", tenantId: input.tenantId, externalId: input.externalId ?? null, email: input.email ?? null, phone: input.phone ?? null, firstName: input.firstName ?? null, lastName: input.lastName ?? null, stage: input.stage ?? "PROSPECT", metadata: input.metadata ?? {}, createdAt: now, updatedAt: now }; },
      async createMany(scope, inputs) { push("contacts", "createMany", [scope, inputs]); return inputs.length; },
      async count(scope) { push("contacts", "count", [scope]); return 0; },
      async findById(scope, id) { push("contacts", "findById", [scope, id]); return { id, tenantId: scope.tenantId, externalId: "ext-1", email: "lead@example.com", phone: "+15555550100", firstName: "Lead", lastName: "One", stage: "PROSPECT", metadata: {}, createdAt: now, updatedAt: now }; },
      async findByEmails(scope, emails) { push("contacts", "findByEmails", [scope, emails]); return []; },
      async list(scope) { push("contacts", "list", [scope]); return page([{ id: "contact-1", tenantId: scope.tenantId, email: "lead@example.com", phone: null, firstName: null, lastName: null, externalId: null, metadata: {}, createdAt: now, updatedAt: now }]); },
      async update(scope, id, input) { push("contacts", "update", [scope, id, input]); return { id, tenantId: scope.tenantId, externalId: input.externalId ?? null, email: input.email ?? "lead@example.com", phone: input.phone ?? null, firstName: input.firstName ?? "Updated", lastName: input.lastName ?? null, stage: input.stage ?? "PROSPECT", metadata: input.metadata ?? {}, createdAt: now, updatedAt: now }; },
      async listLeadEvents(scope, contactId) { push("contacts", "listLeadEvents", [scope, contactId]); return page([
        { id: "lead-event-1", tenantId: scope.tenantId, contactId, eventType: "lead.created", occurredAt: "2026-05-28T00:00:00.000Z", payload: {}, createdAt: now },
        { id: "lead-event-2", tenantId: scope.tenantId, contactId, eventType: "email.clicked", occurredAt: "2026-05-27T00:00:00.000Z", payload: {}, createdAt: now },
        { id: "lead-event-3", tenantId: scope.tenantId, contactId, eventType: "meeting.booked", occurredAt: "2026-05-15T00:00:00.000Z", payload: {}, createdAt: now }
      ]); }
    },
    deals: {
      async create(workspaceId, input) { push("deals", "create", [workspaceId, input]); return { id: "deal-1", tenantId: workspaceId, contactId: input.contactId ?? null, pipelineId: "pipeline-a", pipelineStageId: input.pipelineStageId, ownerId: input.ownerId ?? null, externalId: input.externalId ?? null, title: input.title, value: input.value ?? null, currency: input.currency ?? "USD", probability: input.probability ?? null, closedAt: null, metadata: input.metadata ?? {}, createdAt: now, updatedAt: now }; },
      async list(workspaceId, filters) { push("deals", "list", [workspaceId, filters]); return []; },
      async findById(workspaceId, dealId) { push("deals", "findById", [workspaceId, dealId]); return { id: dealId, tenantId: workspaceId, contactId: "contact-1", pipelineId: "pipeline-a", pipelineStageId: "stage-a", ownerId: null, title: "Deal", value: "100", currency: "USD", probability: 50, createdAt: now, updatedAt: now }; },
      async findBoardByPipeline(workspaceId, pipelineId, pagination) { push("deals", "findBoardByPipeline", [workspaceId, pipelineId, pagination]); return { pipeline: { id: pipelineId, name: "Sales" }, columns: [{ id: "stage-a", name: "Prospect", position: 1, color: "#64748B", deals: { items: [], limit: pagination?.limit ?? 25 } }] }; },
      async updateStageWithOptimisticLock(workspaceId, dealId, stageId, expectedUpdatedAt) { push("deals", "updateStageWithOptimisticLock", [workspaceId, dealId, stageId, expectedUpdatedAt]); return { previousStageId: "stage-old", deal: { id: dealId, tenantId: workspaceId, contactId: "contact-1", pipelineId: "pipeline-a", pipelineStageId: stageId, ownerId: null, title: "Deal", value: "100", currency: "USD", probability: 50, createdAt: now, updatedAt: "2026-05-29T00:01:00.000Z" } }; },
      async findDetailById(workspaceId, dealId) { push("deals", "findDetailById", [workspaceId, dealId]); return { deal: { id: dealId, tenantId: workspaceId, contactId: "contact-1", pipelineId: "pipeline-a", pipelineStageId: "stage-a", ownerId: null, title: "Deal", value: "100", currency: "USD", probability: 50, createdAt: now, updatedAt: now }, contact: { id: "contact-1", firstName: "Lead", lastName: "One", email: "lead@example.com" }, owner: null, activity: [] }; },
      async updateStage(workspaceId, dealId, stageId) { push("deals", "updateStage", [workspaceId, dealId, stageId]); return { id: dealId, tenantId: workspaceId, pipelineId: "pipeline-a", pipelineStageId: stageId, title: "Deal", value: "100", currency: "USD", createdAt: now, updatedAt: now }; },
      async findByContact(workspaceId, contactId) { push("deals", "findByContact", [workspaceId, contactId]); return []; },
      async update(workspaceId, dealId, input) { push("deals", "update", [workspaceId, dealId, input]); return { id: dealId, tenantId: workspaceId, contactId: "contact-1", pipelineId: "pipeline-a", pipelineStageId: "stage-a", ownerId: null, title: "Deal", value: input.value ?? "100", currency: input.currency ?? "USD", probability: 50, closedAt: input.closedAt ?? null, metadata: input.metadata ?? {}, createdAt: now, updatedAt: "2026-05-29T00:02:00.000Z" }; }
    },
    activities: {
      async create(scope, input) { push("activities", "create", [scope, input]); return { id: "activity-1", tenantId: scope.tenantId, contactId: input.contactId ?? null, dealId: input.dealId ?? null, createdById: input.createdById, type: input.type, note: input.note ?? null, occurredAt: input.occurredAt ?? now, metadata: input.metadata ?? {}, createdAt: now, updatedAt: now }; },
      async listByDeal(scope, dealId) { push("activities", "listByDeal", [scope, dealId]); return page(); }
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
    contacts: {
      async create(scope, input) { push("contacts", "create", [scope, input]); return { id: "contact-1", tenantId: input.tenantId, externalId: input.externalId ?? null, email: input.email ?? null, phone: input.phone ?? null, firstName: input.firstName ?? null, lastName: input.lastName ?? null, stage: input.stage ?? "PROSPECT", metadata: input.metadata ?? {}, createdAt: now, updatedAt: now }; },
      async createMany(scope, inputs) { push("contacts", "createMany", [scope, inputs]); return inputs.length; },
      async count(scope) { push("contacts", "count", [scope]); return 0; },
      async findById(scope, id) { push("contacts", "findById", [scope, id]); return { id, tenantId: scope.tenantId, externalId: "ext-1", email: "lead@example.com", phone: "+15555550100", firstName: "Lead", lastName: "One", stage: "PROSPECT", metadata: {}, createdAt: now, updatedAt: now }; },
      async findByEmails(scope, emails) { push("contacts", "findByEmails", [scope, emails]); return []; },
      async list(scope) { push("contacts", "list", [scope]); return page([{ id: "contact-1", tenantId: scope.tenantId, email: "lead@example.com", phone: null, firstName: null, lastName: null, externalId: null, metadata: {}, createdAt: now, updatedAt: now }]); },
      async update(scope, id, input) { push("contacts", "update", [scope, id, input]); return { id, tenantId: scope.tenantId, externalId: input.externalId ?? null, email: input.email ?? "lead@example.com", phone: input.phone ?? null, firstName: input.firstName ?? "Updated", lastName: input.lastName ?? null, stage: input.stage ?? "PROSPECT", metadata: input.metadata ?? {}, createdAt: now, updatedAt: now }; },
      async listLeadEvents(scope, contactId) { push("contacts", "listLeadEvents", [scope, contactId]); return page([
        { id: "lead-event-1", tenantId: scope.tenantId, contactId, eventType: "lead.created", occurredAt: "2026-05-28T00:00:00.000Z", payload: {}, createdAt: now },
        { id: "lead-event-2", tenantId: scope.tenantId, contactId, eventType: "email.clicked", occurredAt: "2026-05-27T00:00:00.000Z", payload: {}, createdAt: now },
        { id: "lead-event-3", tenantId: scope.tenantId, contactId, eventType: "meeting.booked", occurredAt: "2026-05-15T00:00:00.000Z", payload: {}, createdAt: now }
      ]); }
    },
    deals: {
      async create(workspaceId, input) { push("deals", "create", [workspaceId, input]); return { id: "deal-1", tenantId: workspaceId, contactId: input.contactId ?? null, pipelineId: "pipeline-a", pipelineStageId: input.pipelineStageId, ownerId: input.ownerId ?? null, externalId: input.externalId ?? null, title: input.title, value: input.value ?? null, currency: input.currency ?? "USD", probability: input.probability ?? null, closedAt: null, metadata: input.metadata ?? {}, createdAt: now, updatedAt: now }; },
      async list(workspaceId, filters) { push("deals", "list", [workspaceId, filters]); return []; },
      async findById(workspaceId, dealId) { push("deals", "findById", [workspaceId, dealId]); return { id: dealId, tenantId: workspaceId, contactId: "contact-1", pipelineId: "pipeline-a", pipelineStageId: "stage-a", ownerId: null, title: "Deal", value: "100", currency: "USD", probability: 50, createdAt: now, updatedAt: now }; },
      async findBoardByPipeline(workspaceId, pipelineId, pagination) { push("deals", "findBoardByPipeline", [workspaceId, pipelineId, pagination]); return { pipeline: { id: pipelineId, name: "Sales" }, columns: [{ id: "stage-a", name: "Prospect", position: 1, color: "#64748B", deals: { items: [], limit: pagination?.limit ?? 25 } }] }; },
      async updateStageWithOptimisticLock(workspaceId, dealId, stageId, expectedUpdatedAt) { push("deals", "updateStageWithOptimisticLock", [workspaceId, dealId, stageId, expectedUpdatedAt]); return { previousStageId: "stage-old", deal: { id: dealId, tenantId: workspaceId, contactId: "contact-1", pipelineId: "pipeline-a", pipelineStageId: stageId, ownerId: null, title: "Deal", value: "100", currency: "USD", probability: 50, createdAt: now, updatedAt: "2026-05-29T00:01:00.000Z" } }; },
      async findDetailById(workspaceId, dealId) { push("deals", "findDetailById", [workspaceId, dealId]); return { deal: { id: dealId, tenantId: workspaceId, contactId: "contact-1", pipelineId: "pipeline-a", pipelineStageId: "stage-a", ownerId: null, title: "Deal", value: "100", currency: "USD", probability: 50, createdAt: now, updatedAt: now }, contact: { id: "contact-1", firstName: "Lead", lastName: "One", email: "lead@example.com" }, owner: null, activity: [] }; },
      async updateStage(workspaceId, dealId, stageId) { push("deals", "updateStage", [workspaceId, dealId, stageId]); return { id: dealId, tenantId: workspaceId, pipelineId: "pipeline-a", pipelineStageId: stageId, title: "Deal", value: "100", currency: "USD", createdAt: now, updatedAt: now }; },
      async findByContact(workspaceId, contactId) { push("deals", "findByContact", [workspaceId, contactId]); return []; },
      async update(workspaceId, dealId, input) { push("deals", "update", [workspaceId, dealId, input]); return { id: dealId, tenantId: workspaceId, contactId: "contact-1", pipelineId: "pipeline-a", pipelineStageId: "stage-a", ownerId: null, title: "Deal", value: input.value ?? "100", currency: input.currency ?? "USD", probability: 50, closedAt: input.closedAt ?? null, metadata: input.metadata ?? {}, createdAt: now, updatedAt: "2026-05-29T00:02:00.000Z" }; }
    },
    activities: {
      async create(scope, input) { push("activities", "create", [scope, input]); return { id: "activity-1", tenantId: scope.tenantId, contactId: input.contactId ?? null, dealId: input.dealId ?? null, createdById: input.createdById, type: input.type, note: input.note ?? null, occurredAt: input.occurredAt ?? now, metadata: input.metadata ?? {}, createdAt: now, updatedAt: now }; },
      async listByDeal(scope, dealId) { push("activities", "listByDeal", [scope, dealId]); return page(); }
    },
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


test("contact create success validates tenant and records side effects", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);

  const contact = await services.contacts.create(context, { tenantId: "tenant-a", email: "new@example.com", firstName: "New" });

  assert.equal(contact.tenantId, "tenant-a");
  assert.equal(contact.email, "new@example.com");
  assert.deepEqual(repositories.calls.find((call) => call.repo === "contacts" && call.method === "create").args[0], { tenantId: "tenant-a" });
  assert.equal(repositories.calls.some((call) => call.repo === "events" && call.method === "appendOutbox" && call.args[1].eventType === "contact.created"), true);
});

test("contact update success is tenant-scoped and optimistic", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);

  const contact = await services.contacts.update(context, "contact-1", { expectedUpdatedAt: now, firstName: "Updated" });

  assert.equal(contact.firstName, "Updated");
  assert.deepEqual(repositories.calls.find((call) => call.repo === "contacts" && call.method === "update").args, [{ tenantId: "tenant-a" }, "contact-1", { expectedUpdatedAt: now, firstName: "Updated" }]);
});

test("contact service rejects tenant mismatch before repository writes", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);

  await assert.rejects(
    services.contacts.create(context, { tenantId: "tenant-b", email: "wrong@example.com" }),
    (error) => error instanceof ServiceError && error.code === "SERVICE_TENANT_MISMATCH"
  );
  assert.equal(repositories.calls.some((call) => call.repo === "contacts" && call.method === "create"), false);
});

test("invalid contact payload is rejected before repository writes", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);

  await assert.rejects(
    services.contacts.create(context, { tenantId: "tenant-a", email: "not-an-email" }),
    (error) => error instanceof ServiceError && error.code === "SERVICE_VALIDATION_FAILED"
  );
  assert.equal(repositories.calls.some((call) => call.repo === "contacts" && call.method === "create"), false);
});

test("LeadScore calculation combines identity and weighted engagement deterministically", async () => {
  const { computeLeadScore } = await import("../dist/index.js");
  const score = computeLeadScore(
    { id: "contact-1", tenantId: "tenant-a", email: "lead@example.com", phone: "+15555550100", externalId: "ext-1", createdAt: now, updatedAt: now },
    [
      { id: "event-1", tenantId: "tenant-a", contactId: "contact-1", eventType: "lead.created", occurredAt: now, payload: {}, createdAt: now },
      { id: "event-2", tenantId: "tenant-a", contactId: "contact-1", eventType: "meeting.booked", occurredAt: now, payload: {}, createdAt: now }
    ]
  );

  assert.deepEqual(score, { eventScore: 75, identityScore: 20, engagementScore: 55, eventCount: 2 });
});

test("TrajectoryScore calculation compares recent and previous seven-day windows", async () => {
  const { computeTrajectoryScore } = await import("../dist/index.js");
  const score = computeTrajectoryScore([
    { id: "event-1", tenantId: "tenant-a", contactId: "contact-1", eventType: "meeting.booked", occurredAt: "2026-05-28T00:00:00.000Z", payload: {}, createdAt: now },
    { id: "event-2", tenantId: "tenant-a", contactId: "contact-1", eventType: "email.opened", occurredAt: "2026-05-20T00:00:00.000Z", payload: {}, createdAt: now }
  ], new Date("2026-05-29T00:00:00.000Z"));

  assert.deepEqual(score, { score: 30, recentScore: 35, previousScore: 5, recentEventCount: 1, previousEventCount: 1 });
});

test("trustBand derivation maps combined lead and trajectory scores", async () => {
  const { deriveTrustBand } = await import("../dist/index.js");

  assert.equal(deriveTrustBand(80, 20), "HIGH");
  assert.equal(deriveTrustBand(45, 0), "MEDIUM");
  assert.equal(deriveTrustBand(20, -20), "LOW");
});

test("score recomputation is deterministic for the same contact, events, and clock", async () => {
  const repositories = createRepositories();
  const { ScoringService } = await import("../dist/index.js");
  const scoring = new ScoringService(repositories, { now: () => new Date(now) });
  const input = { tenantId: "tenant-a", contactId: "contact-1", reason: "test", requestedAt: now, correlation };

  const first = await scoring.recomputeContactScore(context, input);
  const second = await scoring.recomputeContactScore(context, input);

  assert.deepEqual(first, second);
  assert.equal(first.leadScore, 90);
  assert.equal(first.trajectoryScore, 0);
  assert.equal(first.trustBand, "HIGH");
});

test("contact CSV import inserts 100 valid normalized rows", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices({ ...repositories, contactPlans: { async findCurrentPlan() { return { plan: "GROWTH" }; } } });
  const rows = Array.from({ length: 100 }, (_, index) => ({ email: ` Person${index}@Example.COM `, stage: "PROSPECT", firstName: `Person${index}` }));

  const result = await services.contacts.importCsvRows(context, { tenantId: "tenant-a", rows });

  assert.deepEqual(result, { imported: 100, skipped: 0, errors: [] });
  const createMany = repositories.calls.find((call) => call.repo === "contacts" && call.method === "createMany");
  assert.equal(createMany.args[1].length, 100);
  assert.equal(createMany.args[1][0].email, "person0@example.com");
});

test("contact CSV import skips existing and uploaded duplicate emails", async () => {
  const base = createRepositories();
  const repositories = createRepositories({
    contacts: {
      ...base.contacts,
      async findByEmails(scope, emails) {
        repositories.calls.push({ repo: "contacts", method: "findByEmails", args: [scope, emails] });
        return [{ id: "contact-existing", tenantId: scope.tenantId, email: "existing@example.com", stage: "PROSPECT", createdAt: now, updatedAt: now }];
      }
    }
  });
  const services = createWhispeRMServices({ ...repositories, contactPlans: { async findCurrentPlan() { return { plan: "GROWTH" }; } } });

  const result = await services.contacts.importCsvRows(context, { tenantId: "tenant-a", rows: [
    { email: "existing@example.com", stage: "PROSPECT" },
    { email: "new@example.com", stage: "QUALIFIED" },
    { email: "NEW@example.com", stage: "QUALIFIED" }
  ] });

  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 2);
  assert.deepEqual(result.errors.map((error) => error.reason), ["Email already exists in workspace", "Duplicate email in uploaded CSV"]);
});

test("contact CSV import returns row errors for missing field, invalid email, and invalid stage", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices({ ...repositories, contactPlans: { async findCurrentPlan() { return { plan: "GROWTH" }; } } });

  const result = await services.contacts.importCsvRows(context, { tenantId: "tenant-a", rows: [
    { email: "", stage: "PROSPECT" },
    { email: "not-an-email", stage: "PROSPECT" },
    { email: "valid@example.com", stage: "BAD" }
  ] });

  assert.equal(result.imported, 0);
  assert.equal(result.skipped, 3);
  assert.deepEqual(result.errors, [
    { row: 2, field: "email", reason: "Email is required" },
    { row: 3, field: "email", reason: "Email must be valid" },
    { row: 4, field: "stage", reason: "Stage must match a supported contact stage" }
  ]);
});

test("contact CSV import enforces Starter plan limit before writes", async () => {
  const base = createRepositories();
  const repositories = createRepositories({
    contacts: {
      ...base.contacts,
      async count(scope) { repositories.calls.push({ repo: "contacts", method: "count", args: [scope] }); return 49; }
    }
  });
  const services = createWhispeRMServices({ ...repositories, contactPlans: { async findCurrentPlan() { return { plan: "STARTER" }; } } });

  await assert.rejects(
    services.contacts.importCsvRows(context, { tenantId: "tenant-a", rows: [
      { email: "one@example.com", stage: "PROSPECT" },
      { email: "two@example.com", stage: "PROSPECT" }
    ] }),
    (error) => error instanceof ServiceError && error.code === "SERVICE_PLAN_LIMIT_EXCEEDED" && error.status === 402
  );
  assert.equal(repositories.calls.some((call) => call.repo === "contacts" && call.method === "createMany"), false);
});

test("contact CSV import batches inserts in 500-row chunks", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices({ ...repositories, contactPlans: { async findCurrentPlan() { return { plan: "GROWTH" }; } } });
  const rows = Array.from({ length: 1001 }, (_, index) => ({ email: `batch-${index}@example.com`, stage: "PROSPECT" }));

  const result = await services.contacts.importCsvRows(context, { tenantId: "tenant-a", rows });

  assert.equal(result.imported, 1001);
  assert.deepEqual(repositories.calls.filter((call) => call.repo === "contacts" && call.method === "createMany").map((call) => call.args[1].length), [500, 500, 1]);
});

test("contact CSV import rolls back through transaction manager on DB failure", async () => {
  const base = createRepositories();
  const repositories = createRepositories({
    contacts: {
      ...base.contacts,
      async createMany(scope, inputs) {
        repositories.calls.push({ repo: "contacts", method: "createMany", args: [scope, inputs] });
        throw new Error("insert failed");
      }
    }
  });
  let transactionStarted = false;
  const services = createWhispeRMServices({
    ...repositories,
    contactPlans: { async findCurrentPlan() { return { plan: "GROWTH" }; } },
    transactions: {
      async run(txContext, work) {
        transactionStarted = true;
        return work(repositories);
      }
    }
  });

  await assert.rejects(
    services.contacts.importCsvRows(context, { tenantId: "tenant-a", rows: [{ email: "rollback@example.com", stage: "PROSPECT" }] }),
    (error) => error instanceof ServiceError && error.code === "SERVICE_TRANSACTION_FAILED"
  );
  assert.equal(transactionStarted, true);
});

test("deal board delegates tenant-scoped bounded pagination", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);

  const board = await services.deals.board(context, "pipeline-a", { limit: 25, cursors: { "stage-a": "deal-25" } });

  assert.equal(board.pipeline.id, "pipeline-a");
  assert.deepEqual(repositories.calls.find((call) => call.repo === "deals" && call.method === "findBoardByPipeline").args, ["tenant-a", "pipeline-a", { limit: 25, cursors: { "stage-a": "deal-25" } }]);
});

test("deal stage move is optimistic and records outbox plus activity transactionally", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);

  const deal = await services.deals.moveStage(context, "deal-1", { stageId: "stage-new", expectedUpdatedAt: now });

  assert.equal(deal.pipelineStageId, "stage-new");
  assert.equal(repositories.calls.some((call) => call.repo === "events" && call.method === "appendOutbox" && call.args[1].eventType === "deal.stage_changed"), true);
  assert.equal(repositories.calls.some((call) => call.repo === "activities" && call.method === "create"), true);
  assert.deepEqual(repositories.calls.find((call) => call.repo === "deals" && call.method === "updateStageWithOptimisticLock").args, ["tenant-a", "deal-1", "stage-new", now]);
});

test("quick add deal creates card in requested stage", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);

  const card = await services.deals.createCard(context, { tenantId: "tenant-a", pipelineStageId: "stage-a", contactId: "contact-1", title: "New Deal", value: 100, currency: "USD", probability: 60 });

  assert.equal(card.stageId, "stage-a");
  assert.equal(repositories.calls.some((call) => call.repo === "deals" && call.method === "create"), true);
});

test("deal detail returns deal contact and activity", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);

  const detail = await services.deals.detail(context, "deal-1");

  assert.equal(detail.deal.id, "deal-1");
  assert.equal(detail.contact.email, "lead@example.com");
  assert.deepEqual(detail.activity, []);
});

test("recording a deal outcome persists revenue and triggers configured revenue attribution runtime", async () => {
  const repositories = createRepositories();
  const evaluations = [];
  const services = createWhispeRMServices({
    ...repositories,
    revenueAttribution: {
      async evaluateForDeal(evalContext, input) {
        evaluations.push({ evalContext, input });
        return { status: "ATTRIBUTED", dealId: input.dealId, idempotent: false };
      },
    },
  });

  const { deal, attribution } = await services.deals.recordOutcome(context, "deal-1", { value: 500, currency: "USD", closedAt: now, expectedUpdatedAt: now });

  assert.equal(deal.value, 500);
  assert.equal(deal.closedAt, now);
  assert.deepEqual(repositories.calls.find((call) => call.repo === "deals" && call.method === "update").args, ["tenant-a", "deal-1", { value: 500, currency: "USD", closedAt: now, expectedUpdatedAt: now }]);
  assert.equal(repositories.calls.some((call) => call.repo === "events" && call.method === "appendOutbox" && call.args[1].eventType === "deal.outcome_recorded"), true);
  assert.equal(evaluations.length, 1);
  assert.equal(evaluations[0].input.dealId, "deal-1");
  assert.equal(evaluations[0].input.tenantId, "tenant-a");
  assert.equal(attribution.status, "ATTRIBUTED");
  assert.equal(attribution.dealId, "deal-1");
});

test("recording a deal outcome without a configured revenue attribution runtime returns no attribution result", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);

  const { deal, attribution } = await services.deals.recordOutcome(context, "deal-1", { value: 500, currency: "USD", closedAt: now, expectedUpdatedAt: now });

  assert.equal(deal.value, 500);
  assert.equal(attribution, undefined);
});

test("recording a deal outcome without value or closedAt is rejected", async () => {
  const repositories = createRepositories();
  const services = createWhispeRMServices(repositories);

  await assert.rejects(
    services.deals.recordOutcome(context, "deal-1", { currency: "USD", expectedUpdatedAt: now }),
    (error) => error instanceof ServiceError && error.code === "SERVICE_VALIDATION_FAILED",
  );
});
