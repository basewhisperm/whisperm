import assert from "node:assert/strict";
import test from "node:test";

import {
  assertWorkflowStateTransition,
  assertWorkflowTenantIsolation,
  calculateRetryDelayMs,
  canTransitionWorkflowState,
  createWorkflowExecutionToken,
  executeDeterministicWorkflowStep,
  shouldRetryWorkflowStep,
  workflowDeadLetterSchema,
  workflowDefinitionSchema,
  WorkflowError
} from "../dist/index.js";

const correlation = { correlationId: "corr-1", requestId: "req-1" };

const createDefinition = (overrides = {}) => workflowDefinitionSchema.parse({
  id: "wf-campaign-1",
  tenantId: "tenant-1",
  name: "Campaign workflow",
  version: 1,
  initialStepId: "draft",
  steps: [
    {
      id: "draft",
      type: "TASK",
      input: { action: "create-draft" },
      retryPolicy: {
        kind: "EXPONENTIAL",
        maxAttempts: 3,
        initialDelayMs: 100,
        maxDelayMs: 1_000,
        backoffMultiplier: 2,
        jitter: false
      }
    },
    {
      id: "approval",
      type: "HUMAN_APPROVAL",
      dependsOn: ["draft"],
      approval: { approvalId: "approval-1", requiredRole: "ADMIN" }
    },
    {
      id: "publish",
      type: "TASK",
      dependsOn: ["approval"]
    }
  ],
  ...overrides
});

const createContext = (overrides = {}) => ({
  tenantId: "tenant-1",
  workflowId: "wf-campaign-1",
  workflowVersion: 1,
  runId: "run-1",
  state: "RUNNING",
  actorId: "user-1",
  correlation,
  trigger: {
    type: "API",
    triggeredAt: "2026-01-01T00:00:00.000Z",
    sourceId: "request-1"
  },
  ...overrides
});

test("workflow definition schema validates deterministic tenant-scoped orchestration contracts", () => {
  const definition = createDefinition();

  assert.equal(definition.tenantId, "tenant-1");
  assert.equal(definition.steps[0].deterministic, true);
  assert.equal(definition.steps[1].type, "HUMAN_APPROVAL");

  assert.throws(() => {
    createDefinition({ initialStepId: "missing" });
  });

  assert.throws(() => {
    createDefinition({
      steps: [
        { id: "duplicate", type: "TASK" },
        { id: "duplicate", type: "TASK" }
      ]
    });
  });

  assert.throws(() => {
    createDefinition({
      initialStepId: "approval",
      steps: [{ id: "approval", type: "HUMAN_APPROVAL" }]
    });
  });

  assert.throws(() => {
    createDefinition({
      steps: [{ id: "nondeterministic", type: "TASK", deterministic: false }]
    });
  });
});

test("workflow state machine allows only declared non-terminal transitions", () => {
  assert.equal(canTransitionWorkflowState("PENDING", "RUNNING"), true);
  assert.equal(canTransitionWorkflowState("RUNNING", "WAITING_FOR_APPROVAL"), true);
  assert.equal(canTransitionWorkflowState("SUCCEEDED", "RUNNING"), false);

  assert.throws(
    () => assertWorkflowStateTransition("SUCCEEDED", "RUNNING"),
    (error) => error instanceof WorkflowError && error.code === "WORKFLOW_TRANSITION_INVALID"
  );
});

test("retry policy model is deterministic and bounded", () => {
  const policy = {
    kind: "EXPONENTIAL",
    maxAttempts: 4,
    initialDelayMs: 250,
    maxDelayMs: 1_000,
    backoffMultiplier: 2,
    jitter: false
  };

  assert.equal(calculateRetryDelayMs(policy, 1), 250);
  assert.equal(calculateRetryDelayMs(policy, 2), 500);
  assert.equal(calculateRetryDelayMs(policy, 3), 1_000);
  assert.equal(shouldRetryWorkflowStep(policy, 3), true);
  assert.equal(shouldRetryWorkflowStep(policy, 4), false);

  assert.throws(
    () => calculateRetryDelayMs({ ...policy, jitter: true }, 1),
    (error) => error instanceof WorkflowError && error.code === "WORKFLOW_DEFINITION_INVALID"
  );
});

test("workflow tenant guard fails closed before execution on missing or mismatched tenant context", () => {
  assert.doesNotThrow(() => {
    assertWorkflowTenantIsolation(createContext(), { tenantId: "tenant-1" });
  });

  assert.throws(
    () => assertWorkflowTenantIsolation(createContext(), {}),
    (error) => error instanceof WorkflowError && error.code === "WORKFLOW_TENANT_CONTEXT_MISSING"
  );

  assert.throws(
    () => assertWorkflowTenantIsolation(createContext(), { tenantId: "tenant-2" }),
    (error) => error instanceof WorkflowError && error.code === "WORKFLOW_TENANT_MISMATCH"
  );
});

test("deterministic step execution validates tenant, token, handler type, and typed result semantics", async () => {
  const definition = createDefinition();
  const context = createContext();
  const token = createWorkflowExecutionToken({
    tenantId: "tenant-1",
    workflowId: "wf-campaign-1",
    runId: "run-1",
    stepId: "draft",
    attempt: 1
  });
  const calls = [];
  const handler = {
    stepType: "TASK",
    async execute(input) {
      calls.push(input);
      return {
        status: "COMPLETED",
        output: { draftId: "draft-1" },
        nextStepIds: ["approval"]
      };
    }
  };

  const result = await executeDeterministicWorkflowStep({
    context,
    definition,
    stepId: "draft",
    input: { campaignId: "campaign-1" },
    token,
    handler
  });

  assert.equal(result.status, "COMPLETED");
  assert.equal(result.output.draftId, "draft-1");
  assert.equal(calls[0].context.tenantId, "tenant-1");
  assert.equal(calls[0].token.token, "tenant-1:wf-campaign-1:run-1:draft:1");

  await assert.rejects(
    async () => executeDeterministicWorkflowStep({
      context: createContext({ tenantId: "tenant-2" }),
      definition,
      stepId: "draft",
      input: {},
      token,
      handler
    }),
    (error) => error instanceof WorkflowError && error.code === "WORKFLOW_TENANT_MISMATCH"
  );

  await assert.rejects(
    async () => executeDeterministicWorkflowStep({
      context: createContext({ state: "WAITING_FOR_APPROVAL" }),
      definition,
      stepId: "draft",
      input: {},
      token,
      handler
    }),
    (error) => error instanceof WorkflowError && error.code === "WORKFLOW_STATE_INVALID"
  );

  await assert.rejects(
    async () => executeDeterministicWorkflowStep({
      context,
      definition,
      stepId: "draft",
      input: {},
      token,
      handler: { ...handler, stepType: "AI_AGENT" }
    }),
    (error) => error instanceof WorkflowError && error.code === "WORKFLOW_STEP_TYPE_MISMATCH"
  );

  await assert.rejects(
    async () => executeDeterministicWorkflowStep({
      context,
      definition,
      stepId: "approval",
      input: {},
      token,
      handler
    }),
    (error) => error instanceof WorkflowError && error.code === "WORKFLOW_EXECUTION_TOKEN_INVALID"
  );
});

test("dead-letter contract preserves tenant-safe failure metadata without secrets", () => {
  const error = new WorkflowError({
    code: "WORKFLOW_STEP_FAILED",
    message: "Step failed with typed error",
    status: 500,
    details: { reason: "processor-unavailable" },
    correlation
  });

  const deadLetter = workflowDeadLetterSchema.parse({
    id: "dlq-1",
    tenantId: "tenant-1",
    workflowId: "wf-campaign-1",
    workflowVersion: 1,
    runId: "run-1",
    stepId: "draft",
    attempts: 3,
    failedAt: "2026-01-01T00:05:00.000Z",
    reason: error.toErrorModel(),
    nextAction: "MANUAL_REVIEW",
    payload: { safeReferenceId: "campaign-1" },
    correlation
  });

  assert.equal(deadLetter.tenantId, "tenant-1");
  assert.equal(deadLetter.reason.code, "WORKFLOW_STEP_FAILED");
  assert.equal(deadLetter.nextAction, "MANUAL_REVIEW");
});
