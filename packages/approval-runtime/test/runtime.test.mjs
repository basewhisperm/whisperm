import assert from "node:assert/strict";
import test from "node:test";

import {
  ApprovalRuntimeError,
  approvalCheckpointContractSchema,
  approvalDecisionSchema,
  approvalNotificationContractSchema,
  approvalRequestSchema,
  assertApprovalTenantIsolation,
  calculateApprovalExpiration,
  canTransitionApprovalState,
  createApprovalExecutionMiddleware,
  createDefaultApprovalSecurityGuard,
  shouldExpireApproval,
  shouldRetryApproval
} from "../dist/index.js";

const correlation = { correlationId: "corr-1", requestId: "req-1", traceId: "0123456789abcdef0123456789abcdef", spanId: "0123456789abcdef" };
const fixedNow = new Date("2026-01-01T00:00:00.000Z");
const clock = { now: () => fixedNow };

const createRequest = (overrides = {}) => approvalRequestSchema.parse({
  approvalId: "approval-1",
  tenantId: "tenant-1",
  kind: "CAMPAIGN",
  title: "Approve campaign launch",
  requester: {
    actorId: "requester-1",
    actorType: "USER",
    tenantId: "tenant-1",
    roles: ["MEMBER"]
  },
  resource: {
    type: "campaign",
    id: "campaign-1",
    tenantId: "tenant-1"
  },
  workflow: {
    workflowId: "workflow-1",
    workflowVersion: 1,
    checkpointId: "checkpoint-1",
    runId: "run-1",
    tenantId: "tenant-1"
  },
  requiredRoles: ["ADMIN"],
  priority: "HIGH",
  state: "REQUESTED",
  createdAt: fixedNow.toISOString(),
  updatedAt: fixedNow.toISOString(),
  idempotencyKey: "tenant-1:approval-1:request",
  correlation,
  expirationPolicy: { kind: "FIXED_DURATION", duration: "PT30M", failClosed: true },
  retryPolicy: { maxAttempts: 2, retryableStates: ["FAILED", "EXPIRED"], delayMs: 1000, jitter: false, replaySafe: true },
  ...overrides
});

const createDecision = (overrides = {}) => approvalDecisionSchema.parse({
  decisionId: "decision-1",
  approvalId: "approval-1",
  tenantId: "tenant-1",
  outcome: "APPROVED",
  decidedBy: {
    actorId: "approver-1",
    actorType: "USER",
    tenantId: "tenant-1",
    roles: ["ADMIN"]
  },
  decidedAt: fixedNow.toISOString(),
  reason: "Looks good",
  idempotencyKey: "tenant-1:approval-1:decision-1",
  correlation,
  ...overrides
});

test("approval schemas enforce tenant isolation and validation boundaries", () => {
  const request = createRequest();
  assert.equal(request.tenantId, "tenant-1");
  assert.equal(request.workflow.deterministic, true);
  assert.equal(request.workflow.replaySafe, true);

  assert.throws(() => {
    createRequest({ resource: { type: "campaign", id: "campaign-1", tenantId: "tenant-2" } });
  });

  assert.throws(() => {
    createRequest({ requiredRoles: [], requiredApproverIds: [] });
  });

  assert.throws(() => {
    createDecision({ decidedBy: { actorId: "approver-1", actorType: "USER", tenantId: "tenant-2", roles: ["ADMIN"] } });
  });
});

test("approval state machine is explicit and terminal states are closed", () => {
  assert.equal(canTransitionApprovalState("REQUESTED", "PENDING"), true);
  assert.equal(canTransitionApprovalState("PENDING", "APPROVED"), true);
  assert.equal(canTransitionApprovalState("APPROVED", "PENDING"), false);
  assert.equal(canTransitionApprovalState("REJECTED", "APPROVED"), false);
});

test("expiration and retry policies are deterministic and replay-safe", () => {
  const expiresAt = calculateApprovalExpiration({ policy: { kind: "FIXED_DURATION", duration: "PT30M", failClosed: true }, requestedAt: fixedNow });
  assert.equal(expiresAt, "2026-01-01T00:30:00.000Z");

  const expired = createRequest({ state: "PENDING", expiresAt });
  assert.equal(shouldExpireApproval({ approval: expired, now: new Date("2026-01-01T00:30:00.000Z") }), true);

  const failed = createRequest({ state: "FAILED" });
  assert.equal(shouldRetryApproval({ approval: failed, completedAttempts: 1 }), true);
  assert.equal(shouldRetryApproval({ approval: failed, completedAttempts: 2 }), false);
});

test("checkpoint and notification contracts support future channels without providers", () => {
  const checkpoint = approvalCheckpointContractSchema.parse({
    checkpointId: "checkpoint-1",
    tenantId: "tenant-1",
    approvalId: "approval-1",
    workflow: {
      workflowId: "workflow-1",
      workflowVersion: 1,
      checkpointId: "checkpoint-1",
      runId: "run-1",
      tenantId: "tenant-1"
    },
    requiredRoles: ["ADMIN"],
    state: "PENDING",
    attempt: 1,
    idempotencyKey: "checkpoint-key"
  });
  assert.equal(checkpoint.replaySafe, true);

  const notification = approvalNotificationContractSchema.parse({
    notificationId: "notification-1",
    tenantId: "tenant-1",
    approvalId: "approval-1",
    channel: "SLACK",
    recipientActorId: "approver-1",
    template: "approval.requested",
    correlation,
    idempotencyKey: "notification-key"
  });
  assert.equal(notification.channel, "SLACK");
  assert.equal(notification.replaySafe, true);
});

test("execution middleware emits replay-safe events, audit trail, telemetry, and notifications", async () => {
  const events = [];
  const audit = [];
  const notifications = [];
  const spans = [];
  const middleware = createApprovalExecutionMiddleware({
    clock,
    securityGuard: createDefaultApprovalSecurityGuard(),
    telemetry: {
      startSpan(name, attributes) {
        const span = { name, attributes, status: undefined, end(status) { this.status = status; } };
        spans.push(span);
        return span;
      },
      recordEvent(event) { events.push(event); },
      recordAudit(entry) { audit.push(entry); }
    },
    notificationPublisher: {
      publish(notification) { notifications.push(notification); }
    }
  });

  const requested = await middleware.requestApproval(createRequest());
  assert.equal(requested.approval.state, "PENDING");
  assert.equal(requested.events[0].replaySafe, true);
  assert.equal(requested.events[0].idempotencyKey, "tenant-1:approval-1:request");
  assert.equal(requested.audit[0].action, "REQUESTED");
  assert.equal(requested.notifications[0].recipientActorId, "role:ADMIN");

  const decided = await middleware.decideApproval({ request: requested.approval, decision: createDecision() });
  assert.equal(decided.approval.state, "APPROVED");
  assert.equal(decided.events[0].type, "approval.approved");
  assert.equal(decided.audit[0].actorId, "approver-1");
  assert.equal(events.length, 2);
  assert.equal(audit.length, 2);
  assert.equal(notifications.length, 1);
  assert.equal(spans.every((span) => span.status === "OK"), true);
});

test("execution middleware fails closed on tenant mismatch and forbidden approver", async () => {
  const middleware = createApprovalExecutionMiddleware({ clock, securityGuard: createDefaultApprovalSecurityGuard() });
  const requested = await middleware.requestApproval(createRequest());

  await assert.rejects(
    async () => middleware.decideApproval({
      request: requested.approval,
      decision: createDecision({ decidedBy: { actorId: "approver-2", actorType: "USER", tenantId: "tenant-1", roles: ["MEMBER"] } })
    }),
    (error) => error instanceof ApprovalRuntimeError && error.code === "APPROVAL_DECIDER_FORBIDDEN"
  );

  const mismatchedRequest = createRequest();
  assert.throws(
    () => assertApprovalTenantIsolation({ tenantId: "tenant-1", request: { ...mismatchedRequest, resource: { ...mismatchedRequest.resource, tenantId: "tenant-2" } } }),
    (error) => error instanceof ApprovalRuntimeError && error.code === "APPROVAL_TENANT_MISMATCH"
  );
});

test("timeout, cancellation, rejection, delegation, and retry paths use typed transitions", async () => {
  const middleware = createApprovalExecutionMiddleware({ clock, securityGuard: createDefaultApprovalSecurityGuard() });
  const pending = createRequest({ state: "PENDING", expiresAt: "2025-12-31T23:59:00.000Z" });

  const expired = await middleware.expireApproval(pending);
  assert.equal(expired.approval.state, "EXPIRED");
  assert.equal(expired.events[0].type, "approval.expired");

  const retried = await middleware.retryApproval({ request: expired.approval, completedAttempts: 1 });
  assert.equal(retried.approval.state, "REQUESTED");
  assert.equal(retried.events[0].type, "approval.retry_scheduled");

  const cancelled = await middleware.cancelApproval({
    request: createRequest({ state: "PENDING" }),
    actor: { actorId: "requester-1", actorType: "USER", tenantId: "tenant-1", roles: ["MEMBER"] },
    reason: "No longer needed",
    correlation
  });
  assert.equal(cancelled.approval.state, "CANCELLED");

  const rejected = await middleware.decideApproval({ request: createRequest({ state: "PENDING" }), decision: createDecision({ outcome: "REJECTED" }) });
  assert.equal(rejected.approval.state, "REJECTED");
  assert.equal(rejected.events[0].type, "approval.rejected");

  const delegated = await middleware.delegateApproval({
    request: createRequest({ state: "PENDING", requiredApproverIds: ["approver-1"], requiredRoles: [] }),
    delegation: {
      tenantId: "tenant-1",
      approvalId: "approval-1",
      fromActorId: "approver-1",
      toActorId: "approver-2",
      reason: "Out of office",
      delegatedAt: fixedNow.toISOString(),
      correlation
    }
  });
  assert.equal(delegated.approval.state, "DELEGATED");
});
