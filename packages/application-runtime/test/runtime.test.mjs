import assert from "node:assert/strict";
import test from "node:test";
import {
  ApplicationRuntimeError,
  ServiceRegistry,
  aggregateHealth,
  assertRuntimeTenantIsolation,
  createApplicationRuntime,
  createChildRuntimeRequestContext,
  createRuntimeRequestContext,
  loadRuntimeModules,
  runtimeIntegrationPortSchema,
  validateDependencyGraph
} from "../dist/index.js";

const now = new Date("2026-01-01T00:00:00.000Z");
const correlation = { correlationId: "corr-1", requestId: "req-1", traceId: "0af7651916cd43dd8448eb211c80319c", spanId: "b7ad6b7169203331" };
const request = createRuntimeRequestContext({
  tenant: { tenantId: "tenant-1", actorId: "user-1", roles: ["ADMIN"], correlation, attributes: { tier: "enterprise" } },
  requestId: "req-1",
  correlation,
  source: "HTTP",
  startedAt: now.toISOString(),
  metadata: { route: "/health" }
});

test("request context validation propagates tenant, request, and correlation ids", () => {
  assert.equal(request.tenant.tenantId, "tenant-1");
  assert.equal(request.correlation.correlationId, "corr-1");

  const child = createChildRuntimeRequestContext(request, {
    requestId: "job-1",
    source: "WORKER",
    startedAt: new Date("2026-01-01T00:01:00.000Z"),
    metadata: { queue: "default" }
  });

  assert.equal(child.tenant.tenantId, "tenant-1");
  assert.equal(child.requestId, "job-1");
  assert.equal(child.correlation.causationId, "req-1");
  assert.equal(child.correlation.correlationId, request.correlation.correlationId);

  assert.throws(() => createRuntimeRequestContext({
    tenant: { tenantId: "tenant-1", correlation },
    requestId: "req-2",
    correlation: { correlationId: "different", requestId: "req-2" },
    startedAt: now.toISOString()
  }), ApplicationRuntimeError);
});

test("tenant isolation helper fails closed on mismatched tenant context", () => {
  assert.doesNotThrow(() => assertRuntimeTenantIsolation("tenant-1", [request.tenant, request]));
  assert.throws(() => assertRuntimeTenantIsolation("tenant-1", [{ tenantId: "tenant-2" }]), ApplicationRuntimeError);
});

test("service registry validates duplicate services and dependency graph ordering", () => {
  const registry = new ServiceRegistry();
  registry
    .register({ name: "database", value: { connected: true } })
    .register({ name: "workflow", value: {}, dependencies: ["database"] })
    .register({ name: "api", value: {}, dependencies: ["workflow"] });

  assert.deepEqual(registry.validateDependencies(), {
    startupOrder: ["database", "workflow", "api"],
    shutdownOrder: ["api", "workflow", "database"]
  });
  assert.deepEqual(validateDependencyGraph(registry.services()).startupOrder, ["database", "workflow", "api"]);
  assert.equal(registry.get("database").connected, true);

  assert.throws(() => registry.register({ name: "api", value: {} }), ApplicationRuntimeError);

  const invalid = new ServiceRegistry();
  invalid.register({ name: "worker", value: {}, dependencies: ["missing"] });
  assert.throws(() => invalid.validateDependencies(), ApplicationRuntimeError);
});

test("dependency graph detects cycles deterministically", () => {
  const registry = new ServiceRegistry();
  registry
    .register({ name: "agent", value: {}, dependencies: ["workflow"] })
    .register({ name: "workflow", value: {}, dependencies: ["agent"] });

  assert.throws(() => registry.validateDependencies(), ApplicationRuntimeError);
});

test("module loader composes imported modules before dependent modules", () => {
  const graph = loadRuntimeModules([
    {
      name: "api",
      imports: [{ name: "core", services: [{ name: "logger", value: {} }] }],
      services: [{ name: "http", value: {}, dependencies: ["logger"] }]
    }
  ]);

  assert.deepEqual(graph.modules.map((module) => module.name), ["core", "api"]);
  assert.deepEqual(graph.registry.validateDependencies().startupOrder, ["logger", "http"]);

  assert.throws(() => loadRuntimeModules([{ name: "core" }, { name: "core" }]), ApplicationRuntimeError);
});

test("integration ports require tenant, request, and correlation propagation", () => {
  const integration = runtimeIntegrationPortSchema.parse({
    kind: "WORKFLOW",
    serviceName: "workflow-runtime",
    tenantScoped: true,
    propagatesRequestContext: true,
    propagatesCorrelation: true
  });
  assert.equal(integration.kind, "WORKFLOW");

  assert.throws(() => runtimeIntegrationPortSchema.parse({
    kind: "WORKFLOW",
    serviceName: "workflow-runtime",
    tenantScoped: false,
    propagatesRequestContext: true,
    propagatesCorrelation: true
  }), /Invalid literal/u);
});

test("application runtime starts in dependency order and shuts down in reverse order", async () => {
  const calls = [];
  const diagnostics = [];
  const runtime = createApplicationRuntime({
    context: request,
    observability: { emit: (event) => diagnostics.push(event.name) },
    modules: [{
      name: "composition",
      services: [
        {
          name: "observability",
          value: {},
          lifecycle: {
            start: () => calls.push("start:observability"),
            stop: () => calls.push("stop:observability")
          },
          integration: { kind: "OBSERVABILITY", serviceName: "observability", tenantScoped: true, propagatesRequestContext: true, propagatesCorrelation: true }
        },
        {
          name: "workflow",
          value: {},
          dependencies: ["observability"],
          lifecycle: {
            start: () => calls.push("start:workflow"),
            stop: () => calls.push("stop:workflow")
          },
          health: {
            readiness: () => ({ name: "workflow", status: "UP", checkedAt: now.toISOString(), details: { ready: true } })
          },
          integration: { kind: "WORKFLOW", serviceName: "workflow", tenantScoped: true, propagatesRequestContext: true, propagatesCorrelation: true }
        },
        {
          name: "worker",
          value: {},
          dependencies: ["workflow"],
          lifecycle: {
            start: () => calls.push("start:worker"),
            stop: () => calls.push("stop:worker")
          },
          integration: { kind: "WORKER", serviceName: "worker", tenantScoped: true, propagatesRequestContext: true, propagatesCorrelation: true }
        }
      ]
    }]
  });

  assert.equal((await runtime.readiness()).status, "DOWN");
  assert.deepEqual(await runtime.start(), ["observability", "workflow", "worker"]);
  assert.deepEqual(calls.slice(0, 3), ["start:observability", "start:workflow", "start:worker"]);
  assert.equal((await runtime.readiness()).status, "UP");
  assert.deepEqual(runtime.diagnostics().startupOrder, ["observability", "workflow", "worker"]);
  assert.deepEqual(await runtime.shutdown(), ["worker", "workflow", "observability"]);
  assert.deepEqual(calls.slice(3), ["stop:worker", "stop:workflow", "stop:observability"]);
  assert.ok(diagnostics.includes("runtime.service.started"));
});

test("health aggregation returns degraded and down states deterministically", () => {
  assert.equal(aggregateHealth([
    { name: "api", status: "UP", checkedAt: now.toISOString(), details: {} },
    { name: "worker", status: "DEGRADED", checkedAt: now.toISOString(), details: {} }
  ], now.toISOString()).status, "DEGRADED");

  assert.equal(aggregateHealth([
    { name: "api", status: "UP", checkedAt: now.toISOString(), details: {} },
    { name: "worker", status: "DOWN", checkedAt: now.toISOString(), details: {} }
  ], now.toISOString()).status, "DOWN");
});

test("runtime surfaces typed lifecycle failures", async () => {
  const runtime = createApplicationRuntime({
    context: request,
    modules: [{ name: "failing", services: [{ name: "billing", value: {}, lifecycle: { start: () => { throw new Error("boom"); } } }] }]
  });

  await assert.rejects(() => runtime.start(), ApplicationRuntimeError);
  assert.equal(runtime.registry.definition("billing").state, "FAILED");
});
