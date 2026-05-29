import assert from "node:assert/strict";
import test from "node:test";

import {
  AiRuntimeError,
  aiPromptRequestSchema,
  aiPromptResponseSchema,
  assertAiModelRouteAllowed,
  assertAiTenantIsolation,
  buildAiRuntimeEvent,
  executeDeterministicAiTool,
  routeAiModel
} from "../dist/index.js";

const correlation = { correlationId: "corr-ai-1", requestId: "req-ai-1" };

const context = (overrides = {}) => ({
  tenantId: "tenant-1",
  actorId: "user-1",
  agentId: "agent-support",
  executionId: "exec-1",
  mode: "RESPOND",
  correlation,
  ...overrides
});

const routeRequest = (overrides = {}) => ({
  tenantId: "tenant-1",
  requiredCapabilities: ["TEXT_GENERATION"],
  estimatedInputTokens: 100,
  maxOutputTokens: 50,
  correlation,
  ...overrides
});

const descriptors = [
  {
    providerId: "openai-primary",
    providerKind: "OPENAI",
    model: "future-openai-model",
    capabilities: ["TEXT_GENERATION", "TOOL_CALLING", "STRUCTURED_OUTPUT"],
    maxInputTokens: 128_000,
    maxOutputTokens: 16_384,
    enabled: true,
    priority: 20,
    costWeight: 2
  },
  {
    providerId: "local-default",
    providerKind: "LOCAL_OSS",
    model: "local-oss-chat",
    capabilities: ["TEXT_GENERATION"],
    maxInputTokens: 8_192,
    maxOutputTokens: 2_048,
    enabled: true,
    priority: 10,
    costWeight: 1
  },
  {
    providerId: "anthropic-disabled",
    providerKind: "ANTHROPIC",
    model: "future-anthropic-model",
    capabilities: ["TEXT_GENERATION", "TOOL_CALLING"],
    maxInputTokens: 200_000,
    maxOutputTokens: 8_192,
    enabled: false,
    priority: 1,
    costWeight: 1
  }
];

test("AI prompt request and response schemas validate tenant-scoped provider-neutral contracts", () => {
  const request = aiPromptRequestSchema.parse({
    tenantId: "tenant-1",
    agentId: "agent-support",
    messages: [
      { role: "SYSTEM", content: "Answer using approved tenant data only." },
      { role: "USER", content: "Summarize the lead." }
    ],
    requiredCapabilities: ["TEXT_GENERATION", "STRUCTURED_OUTPUT"],
    options: { responseFormat: "JSON_OBJECT", maxOutputTokens: 256 },
    correlation
  });

  assert.equal(request.tenantId, "tenant-1");
  assert.equal(request.options.responseFormat, "JSON_OBJECT");

  assert.throws(() => {
    aiPromptRequestSchema.parse({
      tenantId: "tenant-1",
      agentId: "agent-support",
      messages: [],
      correlation
    });
  });

  const response = aiPromptResponseSchema.parse({
    tenantId: "tenant-1",
    agentId: "agent-support",
    providerId: "local-default",
    providerKind: "LOCAL_OSS",
    model: "local-oss-chat",
    message: { role: "ASSISTANT", content: "{}" },
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    finishReason: "STOP",
    correlation
  });

  assert.equal(response.providerKind, "LOCAL_OSS");

  assert.throws(() => {
    aiPromptResponseSchema.parse({
      ...response,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 20 }
    });
  });
});

test("AI tenant guard fails closed for missing or mismatched tenant scope", () => {
  assert.doesNotThrow(() => {
    assertAiTenantIsolation(context(), { tenantId: "tenant-1" });
  });

  assert.throws(
    () => assertAiTenantIsolation(context(), {}),
    (error) => error instanceof AiRuntimeError && error.code === "AI_TENANT_CONTEXT_MISSING"
  );

  assert.throws(
    () => assertAiTenantIsolation(context(), { tenantId: "tenant-2" }),
    (error) => error instanceof AiRuntimeError && error.code === "AI_TENANT_MISMATCH"
  );
});

test("model routing selects deterministic provider-neutral compatible routes", () => {
  const localRoute = routeAiModel(routeRequest(), descriptors);

  assert.equal(localRoute.providerId, "local-default");
  assert.equal(localRoute.model, "local-oss-chat");
  assert.equal(localRoute.reason, "selected-lowest-priority-cost-compatible-model");

  const tieBreakRoute = routeAiModel(routeRequest(), [
    { ...descriptors[1], providerId: "z-provider", model: "z-model" },
    { ...descriptors[1], providerId: "a-provider", model: "a-model" }
  ]);
  assert.equal(tieBreakRoute.providerId, "a-provider");

  const toolRoute = routeAiModel(routeRequest({ requiredCapabilities: ["TEXT_GENERATION", "TOOL_CALLING"] }), descriptors);

  assert.equal(toolRoute.providerKind, "OPENAI");

  assert.throws(
    () => routeAiModel(routeRequest({ allowedProviderIds: ["anthropic-disabled"] }), descriptors),
    (error) => error instanceof AiRuntimeError && error.code === "AI_MODEL_ROUTE_UNSUPPORTED"
  );

  assert.throws(
    () => assertAiModelRouteAllowed(routeRequest({ allowedProviderIds: ["local-default"] }), toolRoute),
    (error) => error instanceof AiRuntimeError && error.code === "AI_MODEL_ROUTE_NOT_ALLOWED"
  );
});

test("deterministic AI tool execution enforces tenant, approval, and result boundaries", async () => {
  const definition = {
    name: "crm.lookupLead",
    version: "1.0.0",
    description: "Lookup a lead using tenant-scoped CRM data.",
    inputSchema: { leadId: "string" },
    outputSchema: { leadId: "string" },
    safety: {
      deterministic: true,
      idempotent: true,
      networkAccess: false,
      approvalPolicy: "NEVER",
      tenantScoped: true
    }
  };
  const calls = [];
  const handler = {
    definition,
    async execute(request, executionContext) {
      calls.push({ request, executionContext });
      return {
        tenantId: request.tenantId,
        toolName: request.toolName,
        invocationId: request.invocationId,
        status: "SUCCEEDED",
        output: { leadId: request.arguments.leadId },
        correlation: request.correlation
      };
    }
  };
  const request = {
    tenantId: "tenant-1",
    toolName: "crm.lookupLead",
    toolVersion: "1.0.0",
    invocationId: "invoke-1",
    idempotencyKey: "tenant-1:invoke-1",
    arguments: { leadId: "lead-1" },
    correlation
  };

  const result = await executeDeterministicAiTool(handler, request, context());

  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.output.leadId, "lead-1");
  assert.equal(calls[0].executionContext.tenantId, "tenant-1");

  await assert.rejects(
    async () => executeDeterministicAiTool(handler, { ...request, tenantId: "tenant-2" }, context()),
    (error) => error instanceof AiRuntimeError && error.code === "AI_TENANT_MISMATCH"
  );

  await assert.rejects(
    async () => executeDeterministicAiTool({ ...handler, definition: { ...definition, safety: { ...definition.safety, approvalPolicy: "REQUIRED" } } }, request, context()),
    (error) => error instanceof AiRuntimeError && error.code === "AI_TOOL_APPROVAL_REQUIRED"
  );

  await assert.rejects(
    async () => executeDeterministicAiTool({ ...handler, definition: { ...definition, safety: { ...definition.safety, networkAccess: true } } }, request, context()),
    (error) => error instanceof AiRuntimeError && error.code === "AI_RUNTIME_VALIDATION_FAILED"
  );
});

test("AI runtime events preserve structured tenant-safe observability metadata", () => {
  const event = buildAiRuntimeEvent(
    context(),
    "AI_MODEL_ROUTED",
    new Date("2026-01-01T00:00:00.000Z"),
    { providerId: "local-default", model: "local-oss-chat" }
  );

  assert.equal(event.tenantId, "tenant-1");
  assert.equal(event.type, "AI_MODEL_ROUTED");
  assert.equal(event.correlation.correlationId, "corr-ai-1");
});
