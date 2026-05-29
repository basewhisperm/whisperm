import assert from "node:assert/strict";
import test from "node:test";

import {
  ExecutionRuntimeError,
  assertExecutionStateTransition,
  assertExecutionTenantIsolation,
  calculateExecutionBackoffMs,
  canTransitionExecutionState,
  createExecutionRuntime,
  executionDeadLetterSchema,
  agentExecutionPlanSchema,
  recoverExecutionSnapshot
} from "../dist/index.js";

const correlation = { correlationId: "corr-exec-1", requestId: "req-exec-1" };

const createContext = (overrides = {}) => ({
  tenantId: "tenant-1",
  actorId: "user-1",
  agentId: "agent-1",
  executionId: "exec-1",
  idempotencyKey: "tenant-1:exec-1",
  correlation,
  ...overrides
});

const createPlan = (overrides = {}) => agentExecutionPlanSchema.parse({
  planId: "plan-1",
  tenantId: "tenant-1",
  agentId: "agent-1",
  plannerId: "planner-1",
  version: 1,
  objective: "Create deterministic customer follow-up",
  steps: [
    {
      id: "draft",
      type: "TASK",
      input: { leadId: "lead-1" },
      retryPolicy: { maxAttempts: 2, initialDelayMs: 25, maxDelayMs: 100, backoffMultiplier: 2, jitter: false }
    },
    {
      id: "enrich",
      type: "TOOL",
      dependsOn: ["draft"],
      tool: { toolName: "crm.lookupLead", toolVersion: "1.0.0", input: { leadId: "lead-1" } }
    },
    {
      id: "provider-normalize",
      type: "PROVIDER",
      dependsOn: ["enrich"],
      provider: { providerId: "provider-1", capability: "TEXT_GENERATION", operation: "normalize", input: { draftId: "draft-1" } }
    }
  ],
  ...overrides
});

const memoryCheckpointStore = () => {
  const records = new Map();
  return {
    records,
    async load(tenantId, executionId) {
      return records.get(`${tenantId}:${executionId}`);
    },
    async save(checkpoint) {
      records.set(`${checkpoint.tenantId}:${checkpoint.executionId}`, checkpoint);
    }
  };
};

test("execution contracts enforce deterministic plans and tenant-safe state transitions", () => {
  const plan = createPlan();
  assert.equal(plan.steps[0].deterministic, true);
  assert.equal(plan.steps[1].tenantScoped, true);
  assert.equal(canTransitionExecutionState("CREATED", "RUNNING"), true);
  assert.equal(canTransitionExecutionState("SUCCEEDED", "RUNNING"), false);

  assert.throws(
    () => assertExecutionStateTransition("SUCCEEDED", "RUNNING", correlation),
    (error) => error instanceof ExecutionRuntimeError && error.code === "EXECUTION_STATE_TRANSITION_INVALID"
  );

  assert.throws(() => {
    createPlan({ steps: [{ id: "not-safe", type: "TASK", deterministic: false }] });
  });

  assert.throws(
    () => assertExecutionTenantIsolation(createContext(), { tenantId: "tenant-2" }),
    (error) => error instanceof ExecutionRuntimeError && error.code === "EXECUTION_TENANT_MISMATCH"
  );
});

test("execution runtime runs task, tool, and provider orchestration with deterministic context propagation", async () => {
  const events = [];
  const telemetry = [];
  const checkpoints = memoryCheckpointStore();
  const calls = [];
  const runtime = createExecutionRuntime({
    checkpointStore: checkpoints,
    eventSink: { async emit(event) { events.push(event); } },
    telemetrySink: { async record(record) { telemetry.push(record); } },
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    taskHandler: {
      stepType: "TASK",
      async execute(input, context, step, attempt) {
        calls.push({ kind: "task", input, tenantId: context.tenantId, stepId: step.id, attempt });
        return { draftId: "draft-1" };
      }
    },
    toolOrchestrator: {
      async executeTool(input, context, step, attempt) {
        calls.push({ kind: "tool", input, tenantId: context.tenantId, stepId: step.id, attempt });
        return { leadName: "Ada" };
      }
    },
    providerOrchestrator: {
      async executeProvider(input, context, step, attempt) {
        calls.push({ kind: "provider", input, tenantId: context.tenantId, stepId: step.id, attempt });
        return { normalized: true };
      }
    }
  });

  const result = await runtime.executePlan({ context: createContext(), plan: createPlan() });

  assert.equal(result.state, "SUCCEEDED");
  assert.deepEqual(calls.map((call) => call.kind), ["task", "tool", "provider"]);
  assert.equal(calls.every((call) => call.tenantId === "tenant-1"), true);
  assert.deepEqual(events.map((event) => event.type), [
    "EXECUTION_STARTED",
    "STEP_STARTED",
    "STEP_SUCCEEDED",
    "STEP_STARTED",
    "STEP_SUCCEEDED",
    "STEP_STARTED",
    "STEP_SUCCEEDED",
    "EXECUTION_SUCCEEDED"
  ]);
  assert.equal(telemetry.length, 3);
  assert.equal((await checkpoints.load("tenant-1", "exec-1")).snapshot.state, "SUCCEEDED");

  await assert.rejects(
    async () => runtime.executePlan({ context: createContext({ tenantId: "tenant-2" }), plan: createPlan() }),
    (error) => error instanceof ExecutionRuntimeError && error.code === "EXECUTION_TENANT_MISMATCH"
  );
});

test("execution runtime pauses for approval and resumes from a checkpoint snapshot", async () => {
  const checkpoints = memoryCheckpointStore();
  const plan = createPlan({
    steps: [
      { id: "draft", type: "TASK" },
      {
        id: "approve",
        type: "APPROVAL",
        dependsOn: ["draft"],
        approval: { approvalId: "approval-1", reason: "Human approval before publish", requiredRole: "ADMIN" }
      },
      { id: "publish", type: "TASK", dependsOn: ["approve"], input: { channel: "email" } }
    ]
  });
  const taskCalls = [];
  const runtime = createExecutionRuntime({
    checkpointStore: checkpoints,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    taskHandler: {
      stepType: "TASK",
      async execute(input) {
        taskCalls.push(input);
        return { ok: true };
      }
    }
  });

  const paused = await runtime.executePlan({ context: createContext(), plan });
  assert.equal(paused.state, "PAUSED");
  assert.equal(paused.snapshot.pendingApproval.approvalId, "approval-1");
  assert.equal(taskCalls.length, 1);

  const recovered = await recoverExecutionSnapshot({ tenantId: "tenant-1", executionId: "exec-1", correlation }, checkpoints);
  const resumed = await runtime.executePlan({
    context: createContext({ replay: true }),
    plan,
    snapshot: recovered,
    approvalDecision: {
      tenantId: "tenant-1",
      executionId: "exec-1",
      approvalId: "approval-1",
      approved: true,
      decidedByActorId: "admin-1",
      decidedAt: "2026-01-01T00:01:00.000Z",
      correlation
    }
  });

  assert.equal(resumed.state, "SUCCEEDED");
  assert.equal(taskCalls.length, 2);
  assert.equal(resumed.snapshot.stepSnapshots.find((step) => step.stepId === "approve").state, "SUCCEEDED");
});



test("execution runtime dead-letters terminal TOOL step failures with tenant-safe metadata", async () => {
  const events = [];
  const runtime = createExecutionRuntime({
    eventSink: { async emit(event) { events.push(event); } },
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    toolOrchestrator: {
      async executeTool() {
        throw new ExecutionRuntimeError({
          code: "EXECUTION_STEP_FAILED",
          message: "Tool orchestration failed",
          status: 502,
          retryable: false,
          correlation
        });
      }
    }
  });

  const result = await runtime.executePlan({
    context: createContext(),
    plan: createPlan({
      steps: [{
        id: "enrich",
        type: "TOOL",
        tool: { toolName: "crm.lookupLead", toolVersion: "1.0.0", input: { leadId: "lead-1" } },
        retryPolicy: { maxAttempts: 1, initialDelayMs: 25, maxDelayMs: 100, backoffMultiplier: 2, jitter: false }
      }]
    })
  });

  assert.equal(result.state, "DEAD_LETTERED");
  assert.equal(result.deadLetter.tenantId, "tenant-1");
  assert.equal(result.deadLetter.stepId, "enrich");
  assert.equal(result.deadLetter.reason.code, "EXECUTION_STEP_FAILED");
  assert.equal(result.stepResults[0].status, "FAILED");
  assert.equal(result.stepResults[0].error.code, "EXECUTION_STEP_FAILED");
  assert.deepEqual(events.map((event) => event.type), ["EXECUTION_STARTED", "STEP_STARTED", "STEP_FAILED", "EXECUTION_DEAD_LETTERED"]);
});

test("execution runtime dead-letters terminal PROVIDER step failures with tenant-safe metadata", async () => {
  const events = [];
  const runtime = createExecutionRuntime({
    eventSink: { async emit(event) { events.push(event); } },
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    providerOrchestrator: {
      async executeProvider() {
        throw new ExecutionRuntimeError({
          code: "EXECUTION_STEP_FAILED",
          message: "Provider orchestration failed",
          status: 502,
          retryable: false,
          correlation
        });
      }
    }
  });

  const result = await runtime.executePlan({
    context: createContext(),
    plan: createPlan({
      steps: [{
        id: "provider-normalize",
        type: "PROVIDER",
        provider: { providerId: "provider-1", capability: "TEXT_GENERATION", operation: "normalize", input: { draftId: "draft-1" } },
        retryPolicy: { maxAttempts: 1, initialDelayMs: 25, maxDelayMs: 100, backoffMultiplier: 2, jitter: false }
      }]
    })
  });

  assert.equal(result.state, "DEAD_LETTERED");
  assert.equal(result.deadLetter.tenantId, "tenant-1");
  assert.equal(result.deadLetter.stepId, "provider-normalize");
  assert.equal(result.deadLetter.reason.code, "EXECUTION_STEP_FAILED");
  assert.equal(result.stepResults[0].status, "FAILED");
  assert.equal(result.stepResults[0].error.code, "EXECUTION_STEP_FAILED");
  assert.deepEqual(events.map((event) => event.type), ["EXECUTION_STARTED", "STEP_STARTED", "STEP_FAILED", "EXECUTION_DEAD_LETTERED"]);
});

test("execution retries typed retryable failures and dead-letters exhausted steps", async () => {
  const delays = [];
  let calls = 0;
  const runtime = createExecutionRuntime({
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    sleep: async (delayMs) => { delays.push(delayMs); },
    taskHandler: {
      stepType: "TASK",
      async execute() {
        calls += 1;
        throw new ExecutionRuntimeError({
          code: "EXECUTION_STEP_FAILED",
          message: "Transient deterministic failure",
          status: 503,
          retryable: true,
          correlation
        });
      }
    }
  });

  const result = await runtime.executePlan({
    context: createContext(),
    plan: createPlan({
      steps: [{ id: "draft", type: "TASK", retryPolicy: { maxAttempts: 2, initialDelayMs: 25, maxDelayMs: 100, backoffMultiplier: 2, jitter: false } }]
    })
  });

  assert.equal(result.state, "DEAD_LETTERED");
  assert.equal(result.deadLetter.reason.code, "EXECUTION_RETRY_EXHAUSTED");
  assert.equal(calls, 2);
  assert.deepEqual(delays, [25]);
  assert.equal(calculateExecutionBackoffMs({ maxAttempts: 3, initialDelayMs: 50, maxDelayMs: 100, backoffMultiplier: 3, jitter: false }, 3), 100);

  const parsedDeadLetter = executionDeadLetterSchema.parse(result.deadLetter);
  assert.equal(parsedDeadLetter.tenantId, "tenant-1");
});
