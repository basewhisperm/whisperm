import assert from "node:assert/strict";
import test from "node:test";

import {
  AiRuntimeError,
  buildInitialExecutionGraph,
  calculateRecoveryDelayMs,
  compilePromptTemplate,
  executionPlanSchema,
  extractPromptVariables,
  getReadyExecutionStepIds,
  interpolatePromptText,
  promptTemplateSchema,
  shouldRecoverPlanStep,
  validateExecutionPlanGraph,
  validatePromptTemplateVersion
} from "../dist/index.js";

const correlation = { correlationId: "corr-prompt-plan-1", requestId: "req-prompt-plan-1" };
const createdAt = "2026-01-01T00:00:00.000Z";

const context = (overrides = {}) => ({
  tenantId: "tenant-1",
  actorId: "user-1",
  agentId: "agent-planner",
  executionId: "exec-1",
  mode: "PLAN",
  correlation,
  ...overrides
});

const safety = {
  policyId: "tenant-grounded-only",
  allowExternalKnowledge: false,
  requireTenantGrounding: true,
  allowToolCalls: true,
  allowMemoryReferences: true,
  piiHandling: "REFERENCE_ONLY",
  humanApprovalRequired: true
};

const audit = {
  createdByActorId: "user-1",
  createdAt,
  changeReason: "initial prompt contract",
  correlation
};

const promptTemplate = (overrides = {}) => promptTemplateSchema.parse({
  tenantId: "tenant-1",
  templateId: "lead-summary",
  name: "Lead summary",
  currentVersion: "1.0.0",
  tags: ["crm"],
  versions: [
    {
      templateId: "lead-summary",
      version: "1.0.0",
      status: "ACTIVE",
      messages: [
        { role: "SYSTEM", content: "Use tenant CRM data only for {{tenantName}}." },
        { role: "USER", content: "Summarize lead {{leadId}} with score {{score}}." }
      ],
      variables: [
        { name: "tenantName", kind: "STRING", required: true, sensitive: false },
        { name: "leadId", kind: "STRING", required: true, sensitive: false },
        { name: "score", kind: "NUMBER", required: true, sensitive: false }
      ],
      safety,
      audit
    }
  ],
  ...overrides
});

const promptRequest = (overrides = {}) => ({
  tenantId: "tenant-1",
  templateId: "lead-summary",
  variables: { tenantName: "Acme", leadId: "lead-1", score: 42 },
  executionContext: context(),
  correlation,
  ...overrides
});

const executionPlan = (overrides = {}) => executionPlanSchema.parse({
  tenantId: "tenant-1",
  planId: "plan-1",
  plannerId: "agent-planner",
  objective: "Create and approve a tenant-scoped lead follow-up.",
  createdAt,
  correlation,
  roles: [
    {
      roleId: "planner",
      kind: "PLANNER",
      name: "Deterministic planner",
      tenantId: "tenant-1",
      deterministic: true,
      allowedToolNames: ["crm.lookupLead"],
      allowedMemoryScopes: ["crm"],
      requiresHumanApprovalForAutonomousActions: true
    },
    {
      roleId: "executor",
      kind: "EXECUTOR",
      name: "Step executor",
      deterministic: true,
      allowedToolNames: ["crm.lookupLead"],
      allowedMemoryScopes: ["crm"],
      requiresHumanApprovalForAutonomousActions: true
    }
  ],
  steps: [
    {
      stepId: "draft",
      type: "PROMPT",
      description: "Compile the lead follow-up prompt.",
      roleId: "planner",
      dependsOn: [],
      deterministic: true,
      promptTemplateId: "lead-summary",
      memoryAttachments: [
        {
          tenantId: "tenant-1",
          attachmentId: "mem-1",
          kind: "RAG_CHUNK",
          sourceId: "lead-1",
          tokenEstimate: 100,
          compressed: false
        }
      ],
      retry: {
        maxAttempts: 3,
        backoff: "EXPONENTIAL",
        initialDelayMs: 250,
        maxDelayMs: 1_000,
        jitter: false,
        recoveryAction: "RETRY_STEP"
      }
    },
    {
      stepId: "lookup",
      type: "TOOL",
      description: "Lookup tenant CRM lead details.",
      roleId: "executor",
      dependsOn: ["draft"],
      deterministic: true,
      toolInvocation: {
        tenantId: "tenant-1",
        invocationId: "invoke-1",
        toolName: "crm.lookupLead",
        toolVersion: "1.0.0",
        arguments: { leadId: "lead-1" },
        idempotencyKey: "tenant-1:plan-1:lookup",
        approvalPolicy: "NEVER"
      }
    },
    {
      stepId: "approval",
      type: "APPROVAL",
      description: "Human approval before outreach.",
      roleId: "planner",
      dependsOn: ["lookup"],
      deterministic: true,
      approval: {
        tenantId: "tenant-1",
        checkpointId: "approval-1",
        requiredRole: "ADMIN",
        reason: "Outbound campaign action requires human approval."
      }
    }
  ],
  ...overrides
});

test("prompt template contracts validate versions, variables, safety, and audit metadata", () => {
  const template = promptTemplate();
  const version = validatePromptTemplateVersion(template.versions[0], correlation);

  assert.equal(template.currentVersion, "1.0.0");
  assert.equal(version.safety.requireTenantGrounding, true);
  assert.deepEqual(extractPromptVariables(version.messages[1].content), ["leadId", "score"]);

  assert.throws(() => {
    validatePromptTemplateVersion({
      ...version,
      messages: [{ role: "USER", content: "Missing {{undeclared}}." }]
    }, correlation);
  }, (error) => error instanceof AiRuntimeError && error.code === "AI_PROMPT_INVALID");

  assert.throws(() => {
    promptTemplate({ currentVersion: "2.0.0" });
  });
});

test("prompt interpolation is strict, deterministic, and type-aware", () => {
  assert.equal(
    interpolatePromptText("Hello {{ name }} with {{count}}.", { name: "Ada", count: 2 }, correlation),
    "Hello Ada with 2."
  );
  assert.equal(
    interpolatePromptText("Payload {{payload}}", { payload: { ok: true } }, correlation),
    "Payload {\"ok\":true}"
  );

  assert.throws(
    () => interpolatePromptText("Hello {{missing}}", {}, correlation),
    (error) => error instanceof AiRuntimeError && error.code === "AI_PROMPT_INVALID"
  );
});

test("tenant-safe prompt compilation injects execution context and rejects cross-tenant variables", () => {
  const compiled = compilePromptTemplate({
    context: context(),
    template: promptTemplate(),
    request: promptRequest()
  });

  assert.equal(compiled.tenantId, "tenant-1");
  assert.equal(compiled.messages[0].role, "DEVELOPER");
  assert.match(compiled.messages[1].content, /Acme/u);
  assert.match(compiled.messages[2].content, /lead-1/u);

  assert.throws(
    () => compilePromptTemplate({
      context: context({ tenantId: "tenant-2" }),
      template: promptTemplate(),
      request: promptRequest()
    }),
    (error) => error instanceof AiRuntimeError && error.code === "AI_TENANT_MISMATCH"
  );

  assert.throws(
    () => compilePromptTemplate({
      context: context(),
      template: promptTemplate(),
      request: promptRequest({ variables: { tenantName: "Acme", leadId: "lead-1", score: "high" } })
    }),
    (error) => error instanceof AiRuntimeError && error.code === "AI_PROMPT_INVALID"
  );

  assert.throws(
    () => compilePromptTemplate({
      context: context(),
      template: promptTemplate(),
      request: promptRequest({ variables: { tenantName: "Acme", leadId: "lead-1", score: 42, extra: true } })
    }),
    (error) => error instanceof AiRuntimeError && error.code === "AI_PROMPT_INVALID"
  );
});

test("deterministic planner contracts validate roles, tool plans, memory attachments, and approvals", () => {
  const plan = validateExecutionPlanGraph(executionPlan());

  assert.equal(plan.roles[0].deterministic, true);
  assert.equal(plan.steps[1].toolInvocation.idempotencyKey, "tenant-1:plan-1:lookup");
  assert.equal(plan.steps[2].approval.requiredRole, "ADMIN");

  assert.throws(() => {
    executionPlan({
      steps: [
        {
          stepId: "bad-tool",
          type: "TOOL",
          description: "Invalid tool step.",
          roleId: "executor",
          deterministic: true,
          toolInvocation: {
            tenantId: "tenant-1",
            invocationId: "invoke-2",
            toolName: "crm.lookupLead",
            toolVersion: "1.0.0",
            arguments: {},
            idempotencyKey: "global:invoke-2",
            approvalPolicy: "NEVER"
          }
        }
      ]
    });
  });

  assert.throws(() => {
    validateExecutionPlanGraph(executionPlan({
      steps: [
        {
          stepId: "a",
          type: "PROMPT",
          description: "A",
          roleId: "planner",
          dependsOn: ["b"],
          deterministic: true,
          promptTemplateId: "lead-summary"
        },
        {
          stepId: "b",
          type: "PROMPT",
          description: "B",
          roleId: "planner",
          dependsOn: ["a"],
          deterministic: true,
          promptTemplateId: "lead-summary"
        }
      ]
    }));
  }, (error) => error instanceof AiRuntimeError && error.code === "AI_RUNTIME_VALIDATION_FAILED");
});

test("execution graph semantics expose ready steps and deterministic retry recovery", () => {
  const plan = executionPlan();
  const graph = buildInitialExecutionGraph(plan);

  assert.deepEqual(getReadyExecutionStepIds(plan, graph), ["draft"]);

  const afterDraft = {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.stepId === "draft") {
        return { ...node, state: "SUCCEEDED", attempts: 1 };
      }
      if (node.stepId === "lookup") {
        return { ...node, state: "READY" };
      }
      return node;
    })
  };

  assert.deepEqual(getReadyExecutionStepIds(plan, afterDraft), ["lookup"]);

  const policy = plan.steps[0].retry;
  assert.equal(calculateRecoveryDelayMs(policy, 1), 250);
  assert.equal(calculateRecoveryDelayMs(policy, 3), 1_000);
  assert.equal(shouldRecoverPlanStep(policy, 3), true);
  assert.equal(shouldRecoverPlanStep(policy, 4), false);
});
