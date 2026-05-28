import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

import {
  ToolRuntimeError,
  createToolRegistry,
  executeRegisteredTool,
  toolManifestSchema
} from "../dist/index.js";

const correlation = { correlationId: "corr-tool-1", requestId: "req-tool-1" };

const manifest = (overrides = {}) => ({
  name: "crm.lookupLead",
  version: "1.0.0",
  description: "Lookup a lead from tenant-scoped CRM state.",
  deterministic: true,
  idempotent: true,
  tenantScoped: true,
  networkAccess: false,
  approvalPolicy: "NEVER",
  requiredPermissions: [{ resource: "crm.lead", action: "READ" }],
  inputManifest: { leadId: "string" },
  outputManifest: { leadId: "string", name: "string" },
  ...overrides
});

const context = (overrides = {}) => ({
  tenantId: "tenant-1",
  actorId: "user-1",
  agentId: "agent-1",
  executionId: "exec-1",
  invocationId: "invoke-1",
  idempotencyKey: "tenant-1:invoke-1",
  grantedPermissions: [{ resource: "crm.lead", action: "READ" }],
  correlation,
  ...overrides
});

const request = (overrides = {}) => ({
  tenantId: "tenant-1",
  toolName: "crm.lookupLead",
  toolVersion: "1.0.0",
  invocationId: "invoke-1",
  idempotencyKey: "tenant-1:invoke-1",
  input: { leadId: "lead-1" },
  correlation,
  ...overrides
});

const createHandler = (overrides = {}) => ({
  definition: {
    manifest: manifest(overrides.manifest ?? {}),
    inputSchema: z.object({ leadId: z.string().min(1) }).strict(),
    outputSchema: z.object({ leadId: z.string().min(1), name: z.string().min(1) }).strict()
  },
  async execute(input) {
    return { leadId: input.leadId, name: "Ada Lovelace" };
  },
  ...overrides.handler
});

test("tool manifests fail closed on non-deterministic or networked tools", () => {
  assert.equal(toolManifestSchema.parse(manifest()).networkAccess, false);

  assert.throws(() => {
    toolManifestSchema.parse(manifest({ networkAccess: true }));
  });

  assert.throws(() => {
    toolManifestSchema.parse(manifest({ deterministic: false }));
  });
});

test("registered tool execution validates tenant, permissions, input, output, events, and tracing", async () => {
  const registry = createToolRegistry();
  const handler = createHandler();
  registry.register(handler);
  const events = [];
  const spans = [];

  const result = await executeRegisteredTool({
    registry,
    request: request(),
    context: context(),
    eventHook: { async emit(event) { events.push(event); } },
    tracer: {
      startSpan(executionContext, tool) {
        spans.push({ executionContext, tool, status: "started" });
        return {
          end(spanResult) { spans.push({ status: "ended", spanResult }); },
          fail(error) { spans.push({ status: "failed", error }); }
        };
      }
    },
    now: () => new Date("2026-01-01T00:00:00.000Z")
  });

  assert.equal(result.tenantId, "tenant-1");
  assert.equal(result.output.name, "Ada Lovelace");
  assert.deepEqual(events.map((event) => event.type), ["TOOL_EXECUTION_REQUESTED", "TOOL_EXECUTION_SUCCEEDED"]);
  assert.equal(spans[0].tool.name, "crm.lookupLead");
  assert.equal(spans[1].status, "ended");

  await assert.rejects(
    async () => executeRegisteredTool({ registry, request: request({ tenantId: "tenant-2" }), context: context() }),
    (error) => error instanceof ToolRuntimeError && error.code === "TOOL_TENANT_CONTEXT_MISMATCH"
  );

  await assert.rejects(
    async () => executeRegisteredTool({ registry, request: request(), context: context({ grantedPermissions: [] }) }),
    (error) => error instanceof ToolRuntimeError && error.code === "TOOL_PERMISSION_DENIED"
  );

  await assert.rejects(
    async () => executeRegisteredTool({ registry, request: request({ input: { leadId: "" } }), context: context() }),
    (error) => error instanceof ToolRuntimeError && error.code === "TOOL_INPUT_VALIDATION_FAILED"
  );
});

test("tool runtime is idempotent and retries only typed retryable failures", async () => {
  const registry = createToolRegistry();
  let calls = 0;
  registry.register(createHandler({
    handler: {
      async execute(input) {
        calls += 1;
        if (calls === 1) {
          throw new ToolRuntimeError({
            code: "TOOL_EXECUTION_FAILED",
            message: "transient storage conflict",
            status: 503,
            retryable: true,
            correlation
          });
        }
        return { leadId: input.leadId, name: "Grace Hopper" };
      }
    }
  }));
  const records = new Map();
  const delays = [];
  const idempotencyStore = {
    async get(key, tenantId) {
      return records.get(`${tenantId}:${key}`);
    },
    async set(key, tenantId, result) {
      records.set(`${tenantId}:${key}`, result);
    }
  };

  const first = await executeRegisteredTool({
    registry,
    request: request(),
    context: context(),
    retryPolicy: { maxAttempts: 2, initialDelayMs: 25, backoffMultiplier: 2, maxDelayMs: 100 },
    idempotencyStore,
    sleep: async (delayMs) => { delays.push(delayMs); }
  });
  const second = await executeRegisteredTool({ registry, request: request(), context: context(), idempotencyStore });

  assert.equal(first.output.name, "Grace Hopper");
  assert.equal(second.output.name, "Grace Hopper");
  assert.equal(calls, 2);
  assert.deepEqual(delays, [25]);
});

test("tool runtime rejects invocation/idempotency boundary mismatches", async () => {
  const registry = createToolRegistry();
  registry.register(createHandler());

  await assert.rejects(
    async () => executeRegisteredTool({ registry, request: request({ idempotencyKey: "tenant-1:other" }), context: context() }),
    (error) => error instanceof ToolRuntimeError && error.code === "TOOL_IDEMPOTENCY_CONFLICT"
  );
});
