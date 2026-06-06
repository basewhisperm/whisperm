import { z } from "zod";
import { correlationMetadataSchema } from "@whisperm/types";
import type { CorrelationMetadata } from "@whisperm/types";

const runtimeNamePattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const safeAttributeKeyPattern = /^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$/u;

export const runtimeMetadataSchema = z.record(z.string(), z.unknown());
export type RuntimeMetadata = z.output<typeof runtimeMetadataSchema>;

export const runtimeTimestampSchema = z.string().datetime();
export type RuntimeTimestamp = z.output<typeof runtimeTimestampSchema>;

export const runtimeErrorCodeValues = [
  "RUNTIME_VALIDATION_FAILED",
  "RUNTIME_TENANT_ISOLATION_VIOLATION",
  "RUNTIME_DUPLICATE_MODULE",
  "RUNTIME_DUPLICATE_SERVICE",
  "RUNTIME_UNKNOWN_DEPENDENCY",
  "RUNTIME_DEPENDENCY_CYCLE",
  "RUNTIME_SERVICE_NOT_FOUND",
  "RUNTIME_INVALID_STATE_TRANSITION",
  "RUNTIME_LIFECYCLE_FAILED",
  "RUNTIME_HEALTH_CHECK_FAILED"
] as const;
export const runtimeErrorCodeSchema = z.enum(runtimeErrorCodeValues);
export type RuntimeErrorCode = z.output<typeof runtimeErrorCodeSchema>;

export const runtimeErrorModelSchema = z.object({
  code: runtimeErrorCodeSchema,
  message: z.string().min(1),
  status: z.number().int().min(400).max(599),
  retryable: z.boolean().default(false),
  details: runtimeMetadataSchema.optional(),
  correlation: correlationMetadataSchema.optional()
}).strict();
export type RuntimeErrorModel = z.output<typeof runtimeErrorModelSchema>;

export interface RuntimeErrorInput {
  readonly code: RuntimeErrorCode;
  readonly message: string;
  readonly status: number;
  readonly retryable?: boolean | undefined;
  readonly details?: RuntimeMetadata | undefined;
  readonly correlation?: CorrelationMetadata | undefined;
}

export class ApplicationRuntimeError extends Error {
  readonly code: RuntimeErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: RuntimeMetadata | undefined;
  readonly correlation?: CorrelationMetadata | undefined;

  constructor(input: RuntimeErrorInput) {
    super(input.message);
    this.name = "ApplicationRuntimeError";
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable ?? false;
    this.details = input.details;
    this.correlation = input.correlation;
    Object.setPrototypeOf(this, ApplicationRuntimeError.prototype);
  }

  toErrorModel(): RuntimeErrorModel {
    return runtimeErrorModelSchema.parse({
      code: this.code,
      message: this.message,
      status: this.status,
      retryable: this.retryable,
      details: this.details,
      correlation: this.correlation
    });
  }
}

const validationIssues = (error: z.ZodError): readonly RuntimeMetadata[] => error.issues.map((issue) => ({
  path: issue.path.join("."),
  message: issue.message,
  code: issue.code
}));

export const parseRuntimeContract = <TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  input: unknown,
  correlation?: CorrelationMetadata,
): z.output<TSchema> => {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ApplicationRuntimeError({
      code: "RUNTIME_VALIDATION_FAILED",
      message: "Application runtime contract validation failed",
      status: 400,
      details: { issues: validationIssues(result.error) },
      correlation
    });
  }
  return result.data;
};

export const runtimeTenantContextSchema = z.object({
  tenantId: z.string().min(1),
  actorId: z.string().min(1).optional(),
  roles: z.array(z.string().min(1)).default([]),
  correlation: correlationMetadataSchema,
  attributes: z.record(z.string().regex(safeAttributeKeyPattern), z.union([z.string(), z.number(), z.boolean()])).default({})
}).strict();
export type RuntimeTenantContext = z.output<typeof runtimeTenantContextSchema>;

export const runtimeRequestContextSchema = z.object({
  tenant: runtimeTenantContextSchema,
  requestId: z.string().min(1),
  correlation: correlationMetadataSchema,
  source: z.enum(["HTTP", "WORKER", "SCHEDULER", "WORKFLOW", "AGENT", "CAMPAIGN", "BILLING", "SYSTEM"]).default("SYSTEM"),
  startedAt: runtimeTimestampSchema,
  metadata: runtimeMetadataSchema.default({})
}).strict().superRefine((value, context) => {
  if (value.tenant.correlation.correlationId !== value.correlation.correlationId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "tenant and request correlation ids must match", path: ["correlation", "correlationId"] });
  }
  if (value.correlation.requestId !== undefined && value.correlation.requestId !== value.requestId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "requestId must match correlation requestId", path: ["requestId"] });
  }
});
export type RuntimeRequestContext = z.output<typeof runtimeRequestContextSchema>;

export const createRuntimeRequestContext = (input: z.input<typeof runtimeRequestContextSchema>): RuntimeRequestContext =>
  parseRuntimeContract(runtimeRequestContextSchema, input, input.correlation);

export const createChildRuntimeRequestContext = (
  parent: RuntimeRequestContext,
  input: { readonly requestId: string; readonly source?: RuntimeRequestContext["source"] | undefined; readonly startedAt: Date; readonly metadata?: RuntimeMetadata | undefined }
): RuntimeRequestContext => createRuntimeRequestContext({
  tenant: {
    tenantId: parent.tenant.tenantId,
    ...(parent.tenant.actorId === undefined ? {} : { actorId: parent.tenant.actorId }),
    roles: parent.tenant.roles,
    correlation: {
      correlationId: parent.correlation.correlationId,
      requestId: input.requestId,
      causationId: parent.requestId,
      ...(parent.correlation.traceId === undefined ? {} : { traceId: parent.correlation.traceId }),
      ...(parent.correlation.spanId === undefined ? {} : { spanId: parent.correlation.spanId })
    },
    attributes: parent.tenant.attributes
  },
  requestId: input.requestId,
  correlation: {
    correlationId: parent.correlation.correlationId,
    requestId: input.requestId,
    causationId: parent.requestId,
    ...(parent.correlation.traceId === undefined ? {} : { traceId: parent.correlation.traceId }),
    ...(parent.correlation.spanId === undefined ? {} : { spanId: parent.correlation.spanId })
  },
  source: input.source ?? parent.source,
  startedAt: input.startedAt.toISOString(),
  metadata: input.metadata ?? {}
});

export const assertRuntimeTenantIsolation = (expectedTenantId: string, contexts: readonly { readonly tenantId?: string | undefined; readonly tenant?: { readonly tenantId: string } | undefined }[]): void => {
  for (const context of contexts) {
    const tenantId = context.tenantId ?? context.tenant?.tenantId;
    if (tenantId !== expectedTenantId) {
      throw new ApplicationRuntimeError({
        code: "RUNTIME_TENANT_ISOLATION_VIOLATION",
        message: "Runtime tenant isolation check failed",
        status: 403,
        details: { expectedTenantId, actualTenantId: tenantId ?? null }
      });
    }
  }
};

export const runtimeIntegrationKindValues = ["WORKFLOW", "AGENT", "WORKER", "SCHEDULER", "CAMPAIGN", "BILLING", "OBSERVABILITY"] as const;
export const runtimeIntegrationKindSchema = z.enum(runtimeIntegrationKindValues);
export type RuntimeIntegrationKind = z.output<typeof runtimeIntegrationKindSchema>;

export const runtimeIntegrationPortSchema = z.object({
  kind: runtimeIntegrationKindSchema,
  serviceName: z.string().regex(runtimeNamePattern),
  tenantScoped: z.literal(true),
  propagatesRequestContext: z.literal(true),
  propagatesCorrelation: z.literal(true),
  metadata: runtimeMetadataSchema.default({})
}).strict();
export type RuntimeIntegrationPort = z.output<typeof runtimeIntegrationPortSchema>;

export const serviceLifecycleStateValues = ["REGISTERED", "STARTING", "STARTED", "STOPPING", "STOPPED", "FAILED"] as const;
export const serviceLifecycleStateSchema = z.enum(serviceLifecycleStateValues);
export type ServiceLifecycleState = z.output<typeof serviceLifecycleStateSchema>;

export const healthStatusValues = ["UP", "DEGRADED", "DOWN"] as const;
export const healthStatusSchema = z.enum(healthStatusValues);
export type HealthStatus = z.output<typeof healthStatusSchema>;

export const healthCheckResultSchema = z.object({
  name: z.string().regex(runtimeNamePattern),
  status: healthStatusSchema,
  checkedAt: runtimeTimestampSchema,
  details: runtimeMetadataSchema.default({})
}).strict();
export type HealthCheckResult = z.output<typeof healthCheckResultSchema>;

export const aggregateHealthResultSchema = z.object({
  status: healthStatusSchema,
  checkedAt: runtimeTimestampSchema,
  checks: z.array(healthCheckResultSchema),
  details: runtimeMetadataSchema.default({})
}).strict();
export type AggregateHealthResult = z.output<typeof aggregateHealthResultSchema>;

export interface HealthCheckContext {
  readonly request: RuntimeRequestContext;
  readonly registry: ServiceRegistry;
}

export interface ServiceLifecycleContext {
  readonly request: RuntimeRequestContext;
  readonly registry: ServiceRegistry;
}

export interface ServiceLifecycleHooks {
  readonly start?: (context: ServiceLifecycleContext) => Promise<void> | void;
  readonly stop?: (context: ServiceLifecycleContext) => Promise<void> | void;
}

export interface ServiceHealthChecks {
  readonly health?: (context: HealthCheckContext) => Promise<HealthCheckResult> | HealthCheckResult;
  readonly readiness?: (context: HealthCheckContext) => Promise<HealthCheckResult> | HealthCheckResult;
  readonly liveness?: (context: HealthCheckContext) => Promise<HealthCheckResult> | HealthCheckResult;
}

export interface ServiceDefinition<TService = unknown> {
  readonly name: string;
  readonly value: TService;
  readonly dependencies?: readonly string[] | undefined;
  readonly lifecycle?: ServiceLifecycleHooks | undefined;
  readonly health?: ServiceHealthChecks | undefined;
  readonly integration?: RuntimeIntegrationPort | undefined;
  readonly metadata?: RuntimeMetadata | undefined;
}

export interface RegisteredService<TService = unknown> extends ServiceDefinition<TService> {
  readonly dependencies: readonly string[];
  readonly state: ServiceLifecycleState;
  readonly metadata: RuntimeMetadata;
}

const normalizeService = <TService>(definition: ServiceDefinition<TService>): RegisteredService<TService> => {
  if (!runtimeNamePattern.test(definition.name)) {
    throw new ApplicationRuntimeError({ code: "RUNTIME_VALIDATION_FAILED", message: "Service name is invalid", status: 400, details: { serviceName: definition.name } });
  }
  const dependencies = [...new Set(definition.dependencies ?? [])].sort();
  for (const dependency of dependencies) {
    if (!runtimeNamePattern.test(dependency)) {
      throw new ApplicationRuntimeError({ code: "RUNTIME_VALIDATION_FAILED", message: "Service dependency name is invalid", status: 400, details: { serviceName: definition.name, dependency } });
    }
  }
  if (definition.integration !== undefined) {
    parseRuntimeContract(runtimeIntegrationPortSchema, definition.integration);
  }
  return {
    ...definition,
    dependencies,
    state: "REGISTERED",
    metadata: definition.metadata ?? {}
  };
};

export class ServiceRegistry {
  readonly #services = new Map<string, RegisteredService>();

  register<TService>(definition: ServiceDefinition<TService>): this {
    const service = normalizeService(definition);
    if (this.#services.has(service.name)) {
      throw new ApplicationRuntimeError({ code: "RUNTIME_DUPLICATE_SERVICE", message: "Service is already registered", status: 409, details: { serviceName: service.name } });
    }
    this.#services.set(service.name, service);
    return this;
  }

  get<TService>(name: string): TService {
    const service = this.#services.get(name);
    if (service === undefined) {
      throw new ApplicationRuntimeError({ code: "RUNTIME_SERVICE_NOT_FOUND", message: "Service is not registered", status: 404, details: { serviceName: name } });
    }
    return service.value as TService;
  }

  definition(name: string): RegisteredService {
    const service = this.#services.get(name);
    if (service === undefined) {
      throw new ApplicationRuntimeError({ code: "RUNTIME_SERVICE_NOT_FOUND", message: "Service is not registered", status: 404, details: { serviceName: name } });
    }
    return service;
  }

  services(): readonly RegisteredService[] {
    return [...this.#services.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  setState(name: string, state: ServiceLifecycleState): void {
    const service = this.definition(name);
    this.#services.set(name, { ...service, state });
  }

  validateDependencies(): DependencyGraphValidationResult {
    return validateDependencyGraph(this.services());
  }
}

export interface DependencyGraphValidationResult {
  readonly startupOrder: readonly string[];
  readonly shutdownOrder: readonly string[];
}

export const validateDependencyGraph = (services: readonly RegisteredService[]): DependencyGraphValidationResult => {
  const serviceNames = new Set(services.map((service) => service.name));
  const servicesByName = new Map(services.map((service) => [service.name, service]));

  for (const service of services) {
    for (const dependency of service.dependencies) {
      if (dependency === service.name) {
        throw new ApplicationRuntimeError({ code: "RUNTIME_DEPENDENCY_CYCLE", message: "Service cannot depend on itself", status: 409, details: { serviceName: service.name } });
      }
      if (!serviceNames.has(dependency)) {
        throw new ApplicationRuntimeError({ code: "RUNTIME_UNKNOWN_DEPENDENCY", message: "Service dependency is not registered", status: 409, details: { serviceName: service.name, dependency } });
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const startupOrder: string[] = [];

  const visit = (serviceName: string, path: readonly string[]): void => {
    if (visited.has(serviceName)) {
      return;
    }
    if (visiting.has(serviceName)) {
      throw new ApplicationRuntimeError({ code: "RUNTIME_DEPENDENCY_CYCLE", message: "Service dependency cycle detected", status: 409, details: { cycle: [...path, serviceName].join(" -> ") } });
    }
    visiting.add(serviceName);
    const service = servicesByName.get(serviceName);
    if (service === undefined) {
      throw new ApplicationRuntimeError({ code: "RUNTIME_UNKNOWN_DEPENDENCY", message: "Service dependency is not registered", status: 409, details: { serviceName } });
    }
    for (const dependency of service.dependencies) {
      visit(dependency, [...path, serviceName]);
    }
    visiting.delete(serviceName);
    visited.add(serviceName);
    startupOrder.push(serviceName);
  };

  for (const serviceName of [...serviceNames].sort()) {
    visit(serviceName, []);
  }

  return { startupOrder, shutdownOrder: [...startupOrder].reverse() };
};

export interface RuntimeModule {
  readonly name: string;
  readonly imports?: readonly RuntimeModule[] | undefined;
  readonly services?: readonly ServiceDefinition[] | undefined;
  readonly metadata?: RuntimeMetadata | undefined;
}

export interface LoadedModuleGraph {
  readonly modules: readonly RuntimeModule[];
  readonly registry: ServiceRegistry;
}

/**
 * Loads runtime modules and validates declared service dependencies.
 *
 * This detects duplicate modules, missing module imports, and service-level
 * dependency cycles through ServiceRegistry validation.
 *
 * Module-level circular imports such as A -> B -> A are detected via the
 * loadingModules set; service-level cycles are caught separately by ServiceRegistry.
 */
export const loadRuntimeModules = (modules: readonly RuntimeModule[]): LoadedModuleGraph => {
  const seenModules = new Set<string>();
  const loadingModules = new Set<string>();
  const orderedModules: RuntimeModule[] = [];
  const registry = new ServiceRegistry();

  const load = (module: RuntimeModule, path: readonly string[] = []): void => {
    if (!runtimeNamePattern.test(module.name)) {
      throw new ApplicationRuntimeError({ code: "RUNTIME_VALIDATION_FAILED", message: "Runtime module name is invalid", status: 400, details: { moduleName: module.name } });
    }
    if (loadingModules.has(module.name)) {
      throw new ApplicationRuntimeError({ code: "RUNTIME_DEPENDENCY_CYCLE", message: "Runtime module import cycle detected", status: 409, details: { cycle: [...path, module.name].join(" -> ") } });
    }
    if (seenModules.has(module.name)) {
      throw new ApplicationRuntimeError({ code: "RUNTIME_DUPLICATE_MODULE", message: "Runtime module is already loaded", status: 409, details: { moduleName: module.name } });
    }

    loadingModules.add(module.name);
    for (const importedModule of module.imports ?? []) {
      load(importedModule, [...path, module.name]);
    }
    loadingModules.delete(module.name);
    seenModules.add(module.name);
    orderedModules.push(module);
    for (const service of module.services ?? []) {
      registry.register(service);
    }
  };

  for (const module of modules) {
    load(module);
  }
  registry.validateDependencies();
  return { modules: orderedModules, registry };
};

export interface RuntimeObservabilitySink {
  readonly emit?: (event: RuntimeDiagnosticEvent) => Promise<void> | void;
}

export const runtimeDiagnosticEventSchema = z.object({
  name: z.string().min(1),
  tenantId: z.string().min(1),
  serviceName: z.string().regex(runtimeNamePattern).optional(),
  moduleName: z.string().regex(runtimeNamePattern).optional(),
  state: serviceLifecycleStateSchema.optional(),
  occurredAt: runtimeTimestampSchema,
  correlation: correlationMetadataSchema,
  attributes: runtimeMetadataSchema.default({})
}).strict();
export type RuntimeDiagnosticEvent = z.output<typeof runtimeDiagnosticEventSchema>;

const emitDiagnostic = async (sink: RuntimeObservabilitySink | undefined, event: z.input<typeof runtimeDiagnosticEventSchema>): Promise<void> => {
  await sink?.emit?.(parseRuntimeContract(runtimeDiagnosticEventSchema, event, event.correlation));
};

export class LifecycleManager {
  readonly #registry: ServiceRegistry;
  readonly #observability?: RuntimeObservabilitySink | undefined;

  constructor(registry: ServiceRegistry, observability?: RuntimeObservabilitySink) {
    this.#registry = registry;
    this.#observability = observability;
  }

  async start(request: RuntimeRequestContext): Promise<readonly string[]> {
    const { startupOrder } = this.#registry.validateDependencies();
    const started: string[] = [];
    for (const serviceName of startupOrder) {
      const service = this.#registry.definition(serviceName);
      if (service.state === "STARTED") {
        continue;
      }
      if (service.state !== "REGISTERED" && service.state !== "STOPPED") {
        throw new ApplicationRuntimeError({ code: "RUNTIME_INVALID_STATE_TRANSITION", message: "Service cannot be started from current state", status: 409, details: { serviceName, state: service.state }, correlation: request.correlation });
      }
      this.#registry.setState(serviceName, "STARTING");
      await emitDiagnostic(this.#observability, { name: "runtime.service.starting", tenantId: request.tenant.tenantId, serviceName, state: "STARTING", occurredAt: request.startedAt, correlation: request.correlation });
      try {
        await service.lifecycle?.start?.({ request, registry: this.#registry });
        this.#registry.setState(serviceName, "STARTED");
        started.push(serviceName);
        await emitDiagnostic(this.#observability, { name: "runtime.service.started", tenantId: request.tenant.tenantId, serviceName, state: "STARTED", occurredAt: request.startedAt, correlation: request.correlation });
      } catch (error) {
        this.#registry.setState(serviceName, "FAILED");
        throw new ApplicationRuntimeError({ code: "RUNTIME_LIFECYCLE_FAILED", message: "Service failed to start", status: 500, retryable: true, details: { serviceName, reason: error instanceof Error ? error.message : "unknown" }, correlation: request.correlation });
      }
    }
    return started;
  }

  async stop(request: RuntimeRequestContext): Promise<readonly string[]> {
    const { shutdownOrder } = this.#registry.validateDependencies();
    const stopped: string[] = [];
    for (const serviceName of shutdownOrder) {
      const service = this.#registry.definition(serviceName);
      if (service.state === "STOPPED" || service.state === "REGISTERED") {
        continue;
      }
      if (service.state !== "STARTED" && service.state !== "FAILED") {
        throw new ApplicationRuntimeError({ code: "RUNTIME_INVALID_STATE_TRANSITION", message: "Service cannot be stopped from current state", status: 409, details: { serviceName, state: service.state }, correlation: request.correlation });
      }
      this.#registry.setState(serviceName, "STOPPING");
      await emitDiagnostic(this.#observability, { name: "runtime.service.stopping", tenantId: request.tenant.tenantId, serviceName, state: "STOPPING", occurredAt: request.startedAt, correlation: request.correlation });
      try {
        await service.lifecycle?.stop?.({ request, registry: this.#registry });
        this.#registry.setState(serviceName, "STOPPED");
        stopped.push(serviceName);
        await emitDiagnostic(this.#observability, { name: "runtime.service.stopped", tenantId: request.tenant.tenantId, serviceName, state: "STOPPED", occurredAt: request.startedAt, correlation: request.correlation });
      } catch (error) {
        this.#registry.setState(serviceName, "FAILED");
        throw new ApplicationRuntimeError({ code: "RUNTIME_LIFECYCLE_FAILED", message: "Service failed to stop", status: 500, retryable: true, details: { serviceName, reason: error instanceof Error ? error.message : "unknown" }, correlation: request.correlation });
      }
    }
    return stopped;
  }
}

export class HealthSubsystem {
  readonly #registry: ServiceRegistry;

  constructor(registry: ServiceRegistry) {
    this.#registry = registry;
  }

  async health(request: RuntimeRequestContext): Promise<AggregateHealthResult> {
    return this.#runChecks("health", request);
  }

  async readiness(request: RuntimeRequestContext): Promise<AggregateHealthResult> {
    const notStarted = this.#registry.services()
      .filter((service) => service.state !== "STARTED")
      .map((service) => service.name);
    const result = await this.#runChecks("readiness", request);
    if (notStarted.length === 0) {
      return result;
    }
    const checks = [
      ...result.checks,
      ...notStarted.map((name) => healthCheckResultSchema.parse({ name, status: "DOWN", checkedAt: request.startedAt, details: { state: this.#registry.definition(name).state } }))
    ];
    return aggregateHealth(checks, request.startedAt, { reason: "services_not_started" });
  }

  async liveness(request: RuntimeRequestContext): Promise<AggregateHealthResult> {
    return this.#runChecks("liveness", request);
  }

  async #runChecks(kind: keyof ServiceHealthChecks, request: RuntimeRequestContext): Promise<AggregateHealthResult> {
    const checks: HealthCheckResult[] = [];
    for (const service of this.#registry.services()) {
      const check = service.health?.[kind];
      if (check === undefined) {
        checks.push(healthCheckResultSchema.parse({ name: service.name, status: service.state === "FAILED" ? "DOWN" : "UP", checkedAt: request.startedAt, details: { state: service.state } }));
        continue;
      }
      try {
        checks.push(parseRuntimeContract(healthCheckResultSchema, await check({ request, registry: this.#registry }), request.correlation));
      } catch (error) {
        checks.push(healthCheckResultSchema.parse({ name: service.name, status: "DOWN", checkedAt: request.startedAt, details: { reason: error instanceof Error ? error.message : "unknown" } }));
      }
    }
    return aggregateHealth(checks, request.startedAt, { kind });
  }
}

export const aggregateHealth = (checks: readonly HealthCheckResult[], checkedAt: string, details: RuntimeMetadata = {}): AggregateHealthResult => {
  const status: HealthStatus = checks.some((check) => check.status === "DOWN") ? "DOWN" : checks.some((check) => check.status === "DEGRADED") ? "DEGRADED" : "UP";
  return aggregateHealthResultSchema.parse({ status, checkedAt, checks, details });
};

export interface ApplicationRuntimeOptions {
  readonly modules: readonly RuntimeModule[];
  readonly context: RuntimeRequestContext;
  readonly observability?: RuntimeObservabilitySink | undefined;
}

export interface RuntimeDiagnostics {
  readonly modules: readonly string[];
  readonly services: readonly { readonly name: string; readonly dependencies: readonly string[]; readonly state: ServiceLifecycleState; readonly integration?: RuntimeIntegrationKind | undefined }[];
  readonly startupOrder: readonly string[];
  readonly shutdownOrder: readonly string[];
  readonly generatedAt: RuntimeTimestamp;
}

export class ApplicationRuntime {
  readonly modules: readonly RuntimeModule[];
  readonly registry: ServiceRegistry;
  readonly lifecycle: LifecycleManager;
  readonly health: HealthSubsystem;
  readonly #context: RuntimeRequestContext;

  constructor(options: ApplicationRuntimeOptions) {
    const graph = loadRuntimeModules(options.modules);
    this.modules = graph.modules;
    this.registry = graph.registry;
    this.lifecycle = new LifecycleManager(this.registry, options.observability);
    this.health = new HealthSubsystem(this.registry);
    this.#context = options.context;
  }

  async start(): Promise<readonly string[]> {
    return this.lifecycle.start(this.#context);
  }

  async shutdown(): Promise<readonly string[]> {
    return this.lifecycle.stop(this.#context);
  }

  async readiness(): Promise<AggregateHealthResult> {
    return this.health.readiness(this.#context);
  }

  async liveness(): Promise<AggregateHealthResult> {
    return this.health.liveness(this.#context);
  }

  diagnostics(generatedAt = this.#context.startedAt): RuntimeDiagnostics {
    const graph = this.registry.validateDependencies();
    return {
      modules: this.modules.map((module) => module.name),
      services: this.registry.services().map((service) => ({
        name: service.name,
        dependencies: service.dependencies,
        state: service.state,
        ...(service.integration === undefined ? {} : { integration: service.integration.kind })
      })),
      startupOrder: graph.startupOrder,
      shutdownOrder: graph.shutdownOrder,
      generatedAt
    };
  }
}

export const createApplicationRuntime = (options: ApplicationRuntimeOptions): ApplicationRuntime => new ApplicationRuntime(options);
