import assert from "node:assert/strict";
import test from "node:test";
import {
  PublishingRuntimeError,
  buildPublishJobInput,
  buildPublishWorkerJob,
  dispatchPublish,
  evaluatePrePublishGate,
  parsePublishingContract,
  publishRequestSchema
} from "../dist/index.js";

const now = "2026-01-01T00:00:00.000Z";
const correlation = { correlationId: "corr-1", requestId: "req-1" };

const request = {
  tenantId: "tenant-1",
  campaignId: "campaign-1",
  contentId: "content-1",
  providerConnectionId: "connection-1",
  target: "social-post",
  channel: "linkedin",
  idempotencyKey: "publish-key-1",
  approvalIds: ["approval-1"],
  metadata: { source: "unit-test" }
};

const context = { tenantId: "tenant-1", actorId: "user-1", correlation };

const campaign = {
  id: "campaign-1",
  tenantId: "tenant-1",
  title: "Campaign",
  state: "APPROVED",
  metadata: {},
  createdAt: now,
  updatedAt: now
};

const content = {
  tenantId: "tenant-1",
  contentId: "content-1",
  campaignId: "campaign-1",
  contentVariantId: "variant-1",
  state: "APPROVED",
  version: 1,
  metadata: {}
};

const approval = {
  id: "approval-row-1",
  tenantId: "tenant-1",
  approvalId: "approval-1",
  requesterId: "user-1",
  resourceType: "CONTENT",
  resourceId: "content-1",
  state: "APPROVED",
  idempotencyKey: "approval-key-1",
  metadata: {},
  correlation,
  createdAt: now
};

const providerConnection = {
  tenantId: "tenant-1",
  connectionId: "connection-1",
  providerId: "provider-1",
  providerKind: "linkedin",
  authorized: true,
  metadata: {}
};

const publishJob = {
  id: "publish-job-1",
  tenantId: "tenant-1",
  contentItemId: "campaign-1",
  contentVariantId: "variant-1",
  externalId: null,
  idempotencyKey: "publish-key-1",
  target: "social-post",
  state: "QUEUED",
  attempts: 0,
  scheduledAt: null,
  startedAt: null,
  finishedAt: null,
  errorMessage: null,
  metadata: {},
  createdAt: now,
  updatedAt: now
};

const createDependencies = (overrides = {}) => {
  const calls = [];
  const outbox = [];
  const dependencies = {
    calls,
    outbox,
    queueName: "publishing.tenant-1",
    campaigns: {
      async findById(scope, id) {
        calls.push(["campaigns.findById", scope, id]);
        return campaign;
      },
      async findPublishJobByIdempotencyKey(scope, idempotencyKey) {
        calls.push(["campaigns.findPublishJobByIdempotencyKey", scope, idempotencyKey]);
        return null;
      },
      async enqueuePublish(scope, input) {
        calls.push(["campaigns.enqueuePublish", scope, input]);
        return { ...publishJob, ...input, id: "publish-job-1", attempts: 0, createdAt: now, updatedAt: now };
      }
    },
    contents: {
      async findContentById(scope, contentId) {
        calls.push(["contents.findContentById", scope, contentId]);
        return content;
      }
    },
    approvals: {
      async findRequestByApprovalId(scope, approvalId) {
        calls.push(["approvals.findRequestByApprovalId", scope, approvalId]);
        return approval;
      }
    },
    providerConnections: {
      async findProviderConnectionById(scope, connectionId) {
        calls.push(["providerConnections.findProviderConnectionById", scope, connectionId]);
        return providerConnection;
      }
    },
    rateLimits: {
      async checkPublishAllowed(input) {
        calls.push(["rateLimits.checkPublishAllowed", input]);
        return { tenantId: input.tenantId, allowed: true };
      }
    },
    reliability: {
      async checkPublishHealth(input) {
        calls.push(["reliability.checkPublishHealth", input]);
        return { tenantId: input.tenantId, permitsPublish: true, health: "HEALTHY" };
      }
    },
    events: {
      async appendOutbox(scope, input) {
        calls.push(["events.appendOutbox", scope, input]);
        outbox.push(input);
        return { id: `outbox-${outbox.length}`, createdAt: now, updatedAt: now, attemptsMade: 0, eventVersion: 1, headers: {}, state: "PENDING", availableAt: now, ...input };
      }
    }
  };

  const merged = { ...dependencies, ...overrides };
  return merged;
};

const input = (requestOverride = {}) => ({ context, request: { ...request, ...requestOverride } });

const methodNames = (dependencies) => dependencies.calls.map((call) => call[0]);

const assertDecisionEvent = (dependencies, eventType, state) => {
  assert.equal(dependencies.outbox.length, 1);
  assert.equal(dependencies.outbox[0].eventType, eventType);
  assert.equal(dependencies.outbox[0].payload.state, state);
  assert.equal(dependencies.outbox[0].tenantId, "tenant-1");
  assert.equal(dependencies.outbox[0].idempotencyKey, `publish-key-1:${eventType}`);
};

test("publishing contracts validate tenant-scoped payloads with typed errors", () => {
  const parsed = parsePublishingContract(publishRequestSchema, request, correlation);
  assert.equal(parsed.tenantId, "tenant-1");
  assert.throws(() => parsePublishingContract(publishRequestSchema, { ...request, tenantId: "" }, correlation), PublishingRuntimeError);
});

test("worker and publish job builders emit replay-safe tenant-scoped jobs", () => {
  const workerJob = buildPublishWorkerJob({ context, request, content, providerConnection, queueName: "publishing.tenant-1" });
  assert.equal(workerJob.replaySafe, true);
  assert.equal(workerJob.payload.tenantId, "tenant-1");
  assert.equal(workerJob.payload.replaySafe, true);
  assert.equal(workerJob.dedupeKey, request.idempotencyKey);

  const publishInput = buildPublishJobInput({
    tenantId: "tenant-1",
    state: "READY",
    reason: "ready",
    eventType: "PUBLISH_READY",
    request,
    workerJob,
    correlation
  });
  assert.equal(publishInput.tenantId, "tenant-1");
  assert.equal(publishInput.idempotencyKey, request.idempotencyKey);
  assert.equal(publishInput.metadata.replaySafe, true);
});

test("pre-publish gate rejects tenant mismatches before repository reads", async () => {
  const dependencies = createDependencies();
  const decision = await evaluatePrePublishGate(dependencies, input({ tenantId: "tenant-2" }));

  assert.equal(decision.state, "REJECTED_TENANT_MISMATCH");
  assert.deepEqual(methodNames(dependencies), ["events.appendOutbox"]);
  assertDecisionEvent(dependencies, "PUBLISH_REJECTED", "REJECTED_TENANT_MISMATCH");
});

test("pre-publish gate rejects missing campaigns", async () => {
  const base = createDependencies();
  const dependencies = createDependencies({
    campaigns: { ...base.campaigns, async findById(scope, id) { dependencies.calls.push(["campaigns.findById", scope, id]); return null; } }
  });

  const decision = await evaluatePrePublishGate(dependencies, input());
  assert.equal(decision.state, "REJECTED_INVALID_STATE");
  assert.equal(methodNames(dependencies).includes("contents.findContentById"), false);
  assertDecisionEvent(dependencies, "PUBLISH_REJECTED", "REJECTED_INVALID_STATE");
});

test("pre-publish gate rejects inactive campaigns", async () => {
  const base = createDependencies();
  const dependencies = createDependencies({
    campaigns: { ...base.campaigns, async findById(scope, id) { dependencies.calls.push(["campaigns.findById", scope, id]); return { ...campaign, state: "DRAFT" }; } }
  });

  const decision = await evaluatePrePublishGate(dependencies, input());
  assert.equal(decision.state, "REJECTED_INVALID_STATE");
  assert.equal(methodNames(dependencies).includes("contents.findContentById"), false);
});

test("pre-publish gate rejects missing content", async () => {
  const dependencies = createDependencies({
    contents: { async findContentById(scope, contentId) { dependencies.calls.push(["contents.findContentById", scope, contentId]); return null; } }
  });

  const decision = await evaluatePrePublishGate(dependencies, input());
  assert.equal(decision.state, "REJECTED_INVALID_STATE");
  assert.equal(methodNames(dependencies).includes("approvals.findRequestByApprovalId"), false);
});

test("pre-publish gate rejects content that is not approved", async () => {
  const dependencies = createDependencies({
    contents: { async findContentById(scope, contentId) { dependencies.calls.push(["contents.findContentById", scope, contentId]); return { ...content, state: "REVIEW" }; } }
  });

  const decision = await evaluatePrePublishGate(dependencies, input());
  assert.equal(decision.state, "REJECTED_INVALID_STATE");
  assert.equal(methodNames(dependencies).includes("approvals.findRequestByApprovalId"), false);
});

test("pre-publish gate holds when approval requirements are not satisfied", async () => {
  const dependencies = createDependencies({
    approvals: { async findRequestByApprovalId(scope, approvalId) { dependencies.calls.push(["approvals.findRequestByApprovalId", scope, approvalId]); return { ...approval, state: "REQUESTED" }; } }
  });

  const decision = await evaluatePrePublishGate(dependencies, input());
  assert.equal(decision.state, "HELD_APPROVAL");
  assert.equal(methodNames(dependencies).includes("providerConnections.findProviderConnectionById"), false);
  assertDecisionEvent(dependencies, "PUBLISH_HELD", "HELD_APPROVAL");
});

test("pre-publish gate holds when provider connection is missing", async () => {
  const dependencies = createDependencies({
    providerConnections: { async findProviderConnectionById(scope, connectionId) { dependencies.calls.push(["providerConnections.findProviderConnectionById", scope, connectionId]); return null; } }
  });

  const decision = await evaluatePrePublishGate(dependencies, input());
  assert.equal(decision.state, "HELD_PROVIDER_AUTH");
  assert.equal(methodNames(dependencies).includes("rateLimits.checkPublishAllowed"), false);
});

test("pre-publish gate holds on provider auth failure", async () => {
  const dependencies = createDependencies({
    providerConnections: { async findProviderConnectionById(scope, connectionId) { dependencies.calls.push(["providerConnections.findProviderConnectionById", scope, connectionId]); return { ...providerConnection, authorized: false }; } }
  });

  const decision = await evaluatePrePublishGate(dependencies, input());
  assert.equal(decision.state, "HELD_PROVIDER_AUTH");
  assert.equal(methodNames(dependencies).includes("rateLimits.checkPublishAllowed"), false);
  assertDecisionEvent(dependencies, "PUBLISH_HELD", "HELD_PROVIDER_AUTH");
});

test("pre-publish gate holds when rate limit or quota blocks publish", async () => {
  const dependencies = createDependencies({
    rateLimits: { async checkPublishAllowed(rateInput) { dependencies.calls.push(["rateLimits.checkPublishAllowed", rateInput]); return { tenantId: rateInput.tenantId, allowed: false, reason: "quota exhausted" }; } }
  });

  const decision = await evaluatePrePublishGate(dependencies, input());
  assert.equal(decision.state, "HELD_RATE_LIMIT");
  assert.equal(decision.reason, "quota exhausted");
  assert.equal(methodNames(dependencies).includes("reliability.checkPublishHealth"), false);
  assertDecisionEvent(dependencies, "PUBLISH_HELD", "HELD_RATE_LIMIT");
});

test("pre-publish gate holds when reliability health blocks publish", async () => {
  const dependencies = createDependencies({
    reliability: { async checkPublishHealth(reliabilityInput) { dependencies.calls.push(["reliability.checkPublishHealth", reliabilityInput]); return { tenantId: reliabilityInput.tenantId, permitsPublish: false, health: "UNHEALTHY", reason: "circuit open" }; } }
  });

  const decision = await evaluatePrePublishGate(dependencies, input());
  assert.equal(decision.state, "HELD_RELIABILITY");
  assert.equal(decision.reason, "circuit open");
  assert.equal(methodNames(dependencies).includes("campaigns.findPublishJobByIdempotencyKey"), false);
  assertDecisionEvent(dependencies, "PUBLISH_HELD", "HELD_RELIABILITY");
});

test("pre-publish gate rejects duplicate idempotency keys", async () => {
  const base = createDependencies();
  const dependencies = createDependencies({
    campaigns: {
      ...base.campaigns,
      async findPublishJobByIdempotencyKey(scope, idempotencyKey) {
        dependencies.calls.push(["campaigns.findPublishJobByIdempotencyKey", scope, idempotencyKey]);
        return publishJob;
      }
    }
  });

  const decision = await evaluatePrePublishGate(dependencies, input());
  assert.equal(decision.state, "REJECTED_INVALID_STATE");
  assert.equal(decision.existingPublishJobId, "publish-job-1");
  assertDecisionEvent(dependencies, "PUBLISH_REJECTED", "REJECTED_INVALID_STATE");
});

test("pre-publish gate returns READY with deterministic worker job after all gates pass", async () => {
  const dependencies = createDependencies();
  const decision = await evaluatePrePublishGate(dependencies, input());

  assert.equal(decision.state, "READY");
  assert.equal(decision.workerJob.payload.tenantId, "tenant-1");
  assert.deepEqual(methodNames(dependencies).filter((name) => name !== "events.appendOutbox"), [
    "campaigns.findById",
    "contents.findContentById",
    "approvals.findRequestByApprovalId",
    "providerConnections.findProviderConnectionById",
    "rateLimits.checkPublishAllowed",
    "reliability.checkPublishHealth",
    "campaigns.findPublishJobByIdempotencyKey"
  ]);
  assertDecisionEvent(dependencies, "PUBLISH_READY", "READY");
});

test("dispatchPublish enqueues a tenant-scoped publish job and emits DISPATCHED", async () => {
  const dependencies = createDependencies();
  const result = await dispatchPublish(dependencies, input());

  assert.equal(result.state, "READY");
  assert.equal(result.publishJob.tenantId, "tenant-1");
  assert.equal(result.workerJob.payload.replaySafe, true);
  assert.equal(dependencies.outbox.map((event) => event.eventType).join(","), "PUBLISH_READY,PUBLISH_DISPATCHED");
  const enqueueCall = dependencies.calls.find((call) => call[0] === "campaigns.enqueuePublish");
  assert.equal(enqueueCall[1].tenantId, "tenant-1");
  assert.equal(enqueueCall[2].metadata.workerJobId, "publish-key-1");
});

test("runtime emits FAILED when a dependency throws", async () => {
  const dependencies = createDependencies({
    rateLimits: { async checkPublishAllowed(rateInput) { dependencies.calls.push(["rateLimits.checkPublishAllowed", rateInput]); throw new Error("rate store unavailable"); } }
  });

  const decision = await evaluatePrePublishGate(dependencies, input());
  assert.equal(decision.state, "FAILED");
  assertDecisionEvent(dependencies, "PUBLISH_FAILED", "FAILED");
});
