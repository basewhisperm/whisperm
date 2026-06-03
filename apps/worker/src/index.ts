import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  buildDeadLetterContract,
  computeRetryDecision,
  createExecutionTokenContract,
  createWorkerHeartbeatContract,
  executeReplaySafeJob,
  jobContractSchema,
  parseWorkerRuntimeContract,
  queueContractSchema,
  WorkerRuntimeError,
  workerHealthContractSchema,
  workerLeaseContractSchema,
  workerRegistrationContractSchema,
  workerRuntimeMetadataSchema,
  workerShutdownContractSchema,
  workerTelemetryEventSchema,
  type DeadLetterQueueContract,
  type JobContract,
  type QueueContract,
  type WorkerClock,
  type WorkerHeartbeatContract,
  type WorkerHealthContract,
  type WorkerJobHandler,
  type WorkerRegistrationContract,
  type WorkerRuntimeMetadata,
  type WorkerRuntimePorts,
  type WorkerShutdownContract,
  type WorkerTelemetryEvent,
  type IdempotencyContract,
  type IdempotencyDecision,
  type IdempotencyStore,
  type WorkerTelemetryHooks,
} from "@whisperm/worker-runtime";
import {
  executeTrialReminderJob,
  trialReminderJobPayloadSchema,
<<<<<<< HEAD
=======
  type NotificationServicePort,
>>>>>>> origin/main
} from "@whisperm/notification-runtime";
import {
  inboundEventSchema,
  normalizeInboundEvent,
  scoreRecomputationJobPayloadSchema,
  scoreRecomputationQueueContract,
  type ScoreRecomputationResult,
  type CorrelationMetadata,
  type InboundEvent,
  type NormalizedInboundEvent,
} from "@whisperm/types";

export const packageName = "@whisperm/worker" as const;
export const workerRuntimeVersion = "0.1.0" as const;

const workerNamePattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const workerIdPattern = /^[A-Za-z0-9_.:-]+$/u;
const defaultNow = (): Date => new Date();

const correlationFromEnvironment = (workerId: string): CorrelationMetadata => ({
  correlationId: `${workerId}:bootstrap`,
  causationId: "worker.bootstrap",
});

export const workerBootstrapConfigSchema = z.object({
  tenantId: z.string().min(1),
  workerId: z.string().min(1).regex(workerIdPattern),
  gracefulShutdownMs: z.number().int().min(0).default(30_000),
  heartbeatIntervalMs: z.number().int().min(1_000).default(15_000),
  runtimeVersion: z.string().min(1).default(workerRuntimeVersion),
  correlation: z.object({
    correlationId: z.string().min(1),
    requestId: z.string().min(1).optional(),
    causationId: z.string().min(1).optional(),
    traceId: z.string().min(1).optional(),
    spanId: z.string().min(1).optional(),
  }).strict().optional(),
}).strict();
export type WorkerBootstrapConfig = z.output<typeof workerBootstrapConfigSchema>;

export const createWorkerBootstrapConfigFromEnv = (env: NodeJS.ProcessEnv = process.env): WorkerBootstrapConfig => {
  const workerId = env.WHISPERM_WORKER_ID ?? `worker:${process.pid}`;
  return workerBootstrapConfigSchema.parse({
    tenantId: env.WHISPERM_WORKER_TENANT_ID,
    workerId,
    gracefulShutdownMs: env.WHISPERM_WORKER_GRACEFUL_SHUTDOWN_MS === undefined ? undefined : Number(env.WHISPERM_WORKER_GRACEFUL_SHUTDOWN_MS),
    heartbeatIntervalMs: env.WHISPERM_WORKER_HEARTBEAT_INTERVAL_MS === undefined ? undefined : Number(env.WHISPERM_WORKER_HEARTBEAT_INTERVAL_MS),
    runtimeVersion: env.WHISPERM_WORKER_RUNTIME_VERSION,
    correlation: env.WHISPERM_WORKER_CORRELATION_ID === undefined ? undefined : {
      correlationId: env.WHISPERM_WORKER_CORRELATION_ID,
      causationId: "worker.bootstrap",
    },
  });
};

export interface Logger {
  info(message: string, attributes: WorkerRuntimeMetadata): void;
  warn(message: string, attributes: WorkerRuntimeMetadata): void;
  error(message: string, attributes: WorkerRuntimeMetadata): void;
}

export const createConsoleLogger = (): Logger => ({
  info: (message, attributes) => console.info(JSON.stringify({ level: "info", message, ...attributes })),
  warn: (message, attributes) => console.warn(JSON.stringify({ level: "warn", message, ...attributes })),
  error: (message, attributes) => console.error(JSON.stringify({ level: "error", message, ...attributes })),
});

export interface EventIngestionServicePort {
  ingest(
    context: { readonly tenantId: string; readonly correlation: CorrelationMetadata },
    input: {
      readonly tenantId: string;
      readonly provider: string;
      readonly providerEventId: string;
      readonly eventType: string;
      readonly idempotencyKey: string;
      readonly occurredAt: string;
      readonly receivedAt: string;
      readonly payload: Readonly<Record<string, unknown>>;
      readonly correlationId: string;
      readonly state?: "RECEIVED" | "NORMALIZED" | "PROCESSED" | "FAILED" | "DEAD_LETTERED" | undefined;
    },
  ): Promise<{ readonly id: string; readonly tenantId: string }> | { readonly id: string; readonly tenantId: string };
}

export interface ScoreRecomputationServicePort {
  recomputeContactScore(
    context: { readonly tenantId: string; readonly correlation: CorrelationMetadata },
    input: z.output<typeof scoreRecomputationJobPayloadSchema>,
  ): Promise<ScoreRecomputationResult> | ScoreRecomputationResult;
}

export interface NotificationServicePort {
  sendTrialExpiryEmail(input: {
    readonly workspace: {
      readonly tenantId: string;
      readonly workspaceId: string;
      readonly workspaceName: string;
    };
    readonly recipient: {
      readonly email: string;
      readonly name?: string | undefined;
    };
    readonly trialEndsAt: string;
    readonly marker: "D-3" | "D-1" | "D+0";
  }): Promise<void> | void;
}

export interface WorkerServices {
  readonly events: EventIngestionServicePort;
  readonly scoring?: ScoreRecomputationServicePort | undefined;
  readonly notifications?: NotificationServicePort | undefined;
}

export interface QueueRegistration {
  readonly queue: QueueContract;
  readonly worker: WorkerRegistrationContract;
}

export interface RegisteredWorkerDefinition<TResult extends WorkerRuntimeMetadata = WorkerRuntimeMetadata> {
  readonly name: string;
  readonly queue: QueueContract;
  readonly jobTypes: readonly string[];
  readonly handler: WorkerJobHandler<TResult>;
}

export interface QueueRuntimePort {
  register(input: QueueRegistration): Promise<void> | void;
  startWorker(worker: RegisteredWorkerDefinition): Promise<void> | void;
  stopWorker(workerName: string): Promise<void> | void;
  deadLetter(contract: DeadLetterQueueContract): Promise<void> | void;
}

export class InMemoryQueueRuntime implements QueueRuntimePort {
  private readonly registrations = new Map<string, QueueRegistration>();
  private readonly activeWorkers = new Set<string>();
  private readonly deadLetters: DeadLetterQueueContract[] = [];

  async register(input: QueueRegistration): Promise<void> {
    this.registrations.set(input.worker.workerId, input);
  }

  async startWorker(worker: RegisteredWorkerDefinition): Promise<void> {
    this.activeWorkers.add(worker.name);
  }

  async stopWorker(workerName: string): Promise<void> {
    this.activeWorkers.delete(workerName);
  }

  async deadLetter(contract: DeadLetterQueueContract): Promise<void> {
    this.deadLetters.push(contract);
  }

  getRegistration(workerId: string): QueueRegistration | undefined {
    return this.registrations.get(workerId);
  }

  isWorkerActive(workerName: string): boolean {
    return this.activeWorkers.has(workerName);
  }

  getDeadLetters(): readonly DeadLetterQueueContract[] {
    return this.deadLetters;
  }
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly completed = new Map<string, WorkerRuntimeMetadata>();
  private readonly claimed = new Set<string>();

  claim(contract: IdempotencyContract): IdempotencyDecision {
    const scopedKey = this.scopedKey(contract.tenantId, contract.key);
    const previousResult = this.completed.get(scopedKey);
    if (previousResult !== undefined) {
      return { status: "DUPLICATE", previousResult };
    }
    if (this.claimed.has(scopedKey)) {
      return { status: contract.conflictPolicy === "FAIL_CONFLICT" ? "CONFLICT" : "DUPLICATE" };
    }
    this.claimed.add(scopedKey);
    return { status: "CLAIMED" };
  }

  complete(input: { readonly tenantId: string; readonly key: string; readonly result: WorkerRuntimeMetadata; readonly correlation: CorrelationMetadata }): void {
    const scopedKey = this.scopedKey(input.tenantId, input.key);
    this.completed.set(scopedKey, input.result);
    this.claimed.delete(scopedKey);
  }

  private scopedKey(tenantId: string, key: string): string {
    return `${tenantId}:${key}`;
  }
}

export const createBootstrapOnlyWorkerServices = (): WorkerServices => ({
  events: {
    ingest: async (_context, _input) => {
      throw new WorkerRuntimeError({
        code: "WORKER_RUNTIME_VALIDATION_FAILED",
        message: "Event ingestion service port is not configured for this worker process",
        status: 503,
        retryable: true,
      });
    },
  },
  scoring: {
    recomputeContactScore: async () => {
      throw new WorkerRuntimeError({
        code: "WORKER_RUNTIME_VALIDATION_FAILED",
        message: "Score recomputation service port is not configured for this worker process",
        status: 503,
        retryable: true,
      });
    },
  },
  notifications: {
    sendTrialExpiryEmail: async () => {
      throw new WorkerRuntimeError({
        code: "WORKER_RUNTIME_VALIDATION_FAILED",
        message: "Notification service port is not configured for this worker process",
        status: 503,
        retryable: true,
      });
    },
  },
});

export const createBootstrapOnlyWorkerDependencies = (config: WorkerBootstrapConfig): WorkerApplicationDependencies => ({
  config,
  services: createBootstrapOnlyWorkerServices(),
  queues: new InMemoryQueueRuntime(),
  runtimePorts: { idempotency: new InMemoryIdempotencyStore() },
  logger: createConsoleLogger(),
});

export interface WorkerApplicationDependencies {
  readonly config: WorkerBootstrapConfig;
  readonly services: WorkerServices;
  readonly queues: QueueRuntimePort;
  readonly runtimePorts: WorkerRuntimePorts;
  readonly clock?: WorkerClock | undefined;
  readonly telemetry?: WorkerTelemetryHooks | undefined;
  readonly logger?: Logger | undefined;
}

export type WorkerApplicationStatus = "CREATED" | "STARTING" | "READY" | "DRAINING" | "STOPPED" | "UNHEALTHY";

export interface WorkerProcessJobInput {
  readonly job: JobContract;
  readonly lease?: JobProcessingLeaseInput | undefined;
}

export interface JobProcessingLeaseInput {
  readonly leaseId: string;
  readonly acquiredAt: Date;
  readonly ttlMs: number;
  readonly heartbeatIntervalMs: number;
  readonly fencingToken: string;
}

export interface WorkerProcessJobResult {
  readonly status: "SUCCEEDED" | "DUPLICATE_SKIPPED" | "RETRY_SCHEDULED" | "DEAD_LETTERED";
  readonly result: WorkerRuntimeMetadata;
  readonly deadLetter?: DeadLetterQueueContract | undefined;
}

const workerDefinitionSchema = z.object({
  name: z.string().regex(workerNamePattern),
  jobTypes: z.array(z.string().regex(workerNamePattern)).min(1),
}).strict();

const standardQueueCapabilities = {
  supportsScheduling: true,
  supportsDelayedJobs: true,
  supportsRecurringJobs: false,
  supportsPriority: true,
  supportsFifoGroups: false,
  supportsVisibilityTimeout: true,
  supportsDeadLetterQueue: true,
  supportsLeaseExtension: true,
  supportsReplay: true,
} as const;

const placeholderQueueCapabilities = {
  ...standardQueueCapabilities,
  supportsRecurringJobs: true,
} as const;

const createQueueContract = (input: {
  readonly tenantId: string;
  readonly queueName: string;
  readonly deadLetterQueueName: string;
  readonly capabilities?: typeof standardQueueCapabilities | typeof placeholderQueueCapabilities | undefined;
}): QueueContract => queueContractSchema.parse({
  tenantId: input.tenantId,
  queueName: input.queueName,
  kind: "STANDARD",
  version: 1,
  capabilities: input.capabilities ?? standardQueueCapabilities,
  retention: {
    successfulJobRetentionMs: 86_400_000,
    failedJobRetentionMs: 604_800_000,
    deadLetterRetentionMs: 2_592_000_000,
  },
  maxPayloadBytes: 262_144,
  visibilityTimeoutMs: 300_000,
  deadLetterQueueName: input.deadLetterQueueName,
  metadata: { component: packageName },
});

const createRegistrationContract = (input: {
  readonly tenantId: string;
  readonly workerId: string;
  readonly runtimeVersion: string;
  readonly queueNames: readonly string[];
  readonly jobTypes: readonly string[];
  readonly registeredAt: Date;
  readonly correlation: CorrelationMetadata;
}): WorkerRegistrationContract => workerRegistrationContractSchema.parse({
  tenantId: input.tenantId,
  workerId: input.workerId,
  runtimeVersion: input.runtimeVersion,
  queueNames: input.queueNames,
  jobTypes: input.jobTypes,
  capabilities: ["EXECUTE_JOB", "EXTEND_VISIBILITY", "SCHEDULE_JOB", "HANDLE_DELAYED", "EMIT_TELEMETRY", "WORKFLOW_AWARE"],
  registeredAt: input.registeredAt.toISOString(),
  correlation: input.correlation,
  metadata: { component: packageName },
});

const eventIngestionPayloadSchema = z.object({
  event: inboundEventSchema,
  receivedAt: z.string().datetime().optional(),
}).strict();

const toRuntimeError = (error: unknown, correlation: CorrelationMetadata): WorkerRuntimeError => {
  if (error instanceof WorkerRuntimeError) {
    return error;
  }
  return new WorkerRuntimeError({
    code: "WORKER_RUNTIME_VALIDATION_FAILED",
    message: error instanceof Error ? error.message : "Worker job failed",
    status: 500,
    retryable: true,
    correlation,
  });
};

const createPlaceholderHandler = (workerName: string): WorkerJobHandler => ({
  execute: (context) => ({
    placeholder: true,
    workerName,
    tenantId: context.tenantId,
    jobId: context.job.jobId,
    correlationId: context.correlation.correlationId,
  }),
});

export const createEventIngestionHandler = (services: WorkerServices, clock: WorkerClock = { now: defaultNow }): WorkerJobHandler => ({
  async execute(context) {
    const payload = eventIngestionPayloadSchema.parse(context.job.payload);
    const receivedAt = payload.receivedAt === undefined ? clock.now() : new Date(payload.receivedAt);
    const normalized: NormalizedInboundEvent = normalizeInboundEvent({
      event: payload.event as InboundEvent,
      correlation: context.correlation,
      receivedAt,
      eventId: context.job.jobId,
    });

    const ingestion = await services.events.ingest(
      { tenantId: context.tenantId, correlation: normalized.correlation },
      {
        tenantId: normalized.tenantId,
        provider: normalized.source.provider,
        providerEventId: normalized.source.providerEventId,
        eventType: normalized.source.eventType,
        idempotencyKey: normalized.idempotencyKey,
        occurredAt: normalized.occurredAt,
        receivedAt: normalized.receivedAt,
        payload: normalized.payload,
        correlationId: normalized.correlation.correlationId,
        state: "NORMALIZED",
      },
    );

    return workerRuntimeMetadataSchema.parse({
      ingestionId: ingestion.id,
      tenantId: ingestion.tenantId,
      provider: normalized.source.provider,
      providerEventId: normalized.source.providerEventId,
      eventType: normalized.source.eventType,
      correlationId: normalized.correlation.correlationId,
    });
  },
});


export const createNotificationTrialReminderHandler = (services: WorkerServices): WorkerJobHandler => ({
  async execute(context) {
    if (services.notifications === undefined) {
      throw new WorkerRuntimeError({
        code: "WORKER_RUNTIME_VALIDATION_FAILED",
        message: "Notification service port is not configured",
        status: 503,
        retryable: true,
        correlation: context.correlation,
      });
    }

    const payload = trialReminderJobPayloadSchema.parse(context.job.payload);

    if (payload.tenantId !== context.tenantId) {
      throw new WorkerRuntimeError({
        code: "WORKER_RUNTIME_TENANT_ISOLATION_VIOLATION",
        message: "Notification job tenantId must match execution context",
        status: 403,
        correlation: context.correlation,
      });
    }

    await executeTrialReminderJob(services.notifications, payload);

    return workerRuntimeMetadataSchema.parse({
      tenantId: payload.tenantId,
      workspaceId: payload.workspaceId,
      marker: payload.marker,
      recipientEmail: payload.recipientEmail,
      correlationId: context.correlation.correlationId,
    });
  },
});

<<<<<<< HEAD
=======

>>>>>>> origin/main
export const createScoreRecomputationHandler = (services: WorkerServices): WorkerJobHandler => ({
  async execute(context) {
    if (services.scoring === undefined) {
      throw new WorkerRuntimeError({
        code: "WORKER_RUNTIME_VALIDATION_FAILED",
        message: "Score recomputation service port is not configured",
        status: 503,
        retryable: true,
        correlation: context.correlation,
      });
    }
    const payload = scoreRecomputationJobPayloadSchema.parse(context.job.payload);
    if (payload.tenantId !== context.tenantId) {
      throw new WorkerRuntimeError({
        code: "WORKER_RUNTIME_TENANT_ISOLATION_VIOLATION",
        message: "Score recomputation job tenantId must match execution context",
        status: 403,
        correlation: context.correlation,
      });
    }
    const result = await services.scoring.recomputeContactScore({ tenantId: context.tenantId, correlation: context.correlation }, payload);
    return workerRuntimeMetadataSchema.parse({
      tenantId: result.tenantId,
      contactId: result.contactId,
      leadScore: result.leadScore,
      trajectoryScore: result.trajectoryScore,
      trustBand: result.trustBand,
      correlationId: result.correlation.correlationId,
    });
  },
});

export const createWorkerDefinitions = (input: {
  readonly tenantId: string;
  readonly services: WorkerServices;
  readonly clock?: WorkerClock | undefined;
}): readonly RegisteredWorkerDefinition[] => {
  const definitions: readonly RegisteredWorkerDefinition[] = [
    {
      name: "event-ingestion-worker",
      queue: createQueueContract({ tenantId: input.tenantId, queueName: "event.ingestion", deadLetterQueueName: "event.ingestion.dlq" }),
      jobTypes: ["event.ingestion"],
      handler: createEventIngestionHandler(input.services, input.clock),
    },
    {
      name: "score-recomputation-worker",
      queue: createQueueContract({ tenantId: input.tenantId, queueName: scoreRecomputationQueueContract.queueName, deadLetterQueueName: `${scoreRecomputationQueueContract.queueName}.dlq` }),
      jobTypes: [scoreRecomputationQueueContract.jobType],
      handler: createScoreRecomputationHandler(input.services),
    },
    {
      name: "notification-worker",
      queue: createQueueContract({ tenantId: input.tenantId, queueName: "notification", deadLetterQueueName: "notification.dlq" }),
      jobTypes: ["notification.trial_reminder"],
      handler: createNotificationTrialReminderHandler(input.services),
    },
    {
      name: "publish-worker",
      queue: createQueueContract({ tenantId: input.tenantId, queueName: "publish", deadLetterQueueName: "publish.dlq" }),
      jobTypes: ["publish.dispatch"],
      handler: createPlaceholderHandler("publish-worker"),
    },
    {
      name: "scheduler-worker",
      queue: createQueueContract({ tenantId: input.tenantId, queueName: "scheduler", deadLetterQueueName: "scheduler.dlq", capabilities: placeholderQueueCapabilities }),
      jobTypes: ["scheduler.tick"],
      handler: createPlaceholderHandler("scheduler-worker"),
    },
  ];

  for (const definition of definitions) {
    workerDefinitionSchema.parse({ name: definition.name, jobTypes: definition.jobTypes });
  }
  return definitions;
};

export class WorkerApplication {
  private status: WorkerApplicationStatus = "CREATED";
  private readonly definitions: readonly RegisteredWorkerDefinition[];
  private readonly clock: WorkerClock;
  private readonly telemetry: WorkerTelemetryHooks;
  private readonly logger: Logger;
  private metrics = { runningJobs: 0, completedJobs: 0, failedJobs: 0, deadLetteredJobs: 0 };

  constructor(private readonly deps: WorkerApplicationDependencies) {
    this.clock = deps.clock ?? { now: defaultNow };
    this.telemetry = deps.telemetry ?? deps.runtimePorts.telemetry ?? {};
    this.logger = deps.logger ?? createConsoleLogger();
    this.definitions = createWorkerDefinitions({ tenantId: deps.config.tenantId, services: deps.services, clock: this.clock });
  }

  getRegisteredWorkers(): readonly RegisteredWorkerDefinition[] {
    return this.definitions;
  }

  getStatus(): WorkerApplicationStatus {
    return this.status;
  }

  async start(): Promise<readonly QueueRegistration[]> {
    if (this.status === "READY") {
      return this.registrations();
    }
    this.status = "STARTING";
    const correlation = this.deps.config.correlation ?? correlationFromEnvironment(this.deps.config.workerId);
    const registrations: QueueRegistration[] = [];
    const registeredAt = this.clock.now();

    for (const definition of this.definitions) {
      const worker = createRegistrationContract({
        tenantId: this.deps.config.tenantId,
        workerId: `${this.deps.config.workerId}:${definition.name}`,
        runtimeVersion: this.deps.config.runtimeVersion,
        queueNames: [definition.queue.queueName],
        jobTypes: definition.jobTypes,
        registeredAt,
        correlation,
      });
      const registration = { queue: definition.queue, worker };
      await this.deps.queues.register(registration);
      await this.deps.queues.startWorker(definition);
      registrations.push(registration);
    }

    this.status = "READY";
    this.logger.info("worker started", {
      tenantId: this.deps.config.tenantId,
      workerId: this.deps.config.workerId,
      workerCount: registrations.length,
      correlationId: correlation.correlationId,
    });
    return registrations;
  }

  async stop(reason = "shutdown requested"): Promise<WorkerShutdownContract> {
    if (this.status === "STOPPED") {
      return this.createShutdownContract(reason);
    }
    this.status = "DRAINING";
    const shutdown = this.createShutdownContract(reason);

    for (const definition of [...this.definitions].reverse()) {
      await this.deps.queues.stopWorker(definition.name);
    }

    const event = workerTelemetryEventSchema.parse({
      id: `${this.deps.config.workerId}:shutdown:${shutdown.requestedAt}`,
      type: "WORKER_SHUTDOWN",
      tenantId: this.deps.config.tenantId,
      workerId: this.deps.config.workerId,
      occurredAt: shutdown.requestedAt,
      correlation: shutdown.correlation,
      attributes: { reason, mode: shutdown.mode },
      replaySafe: true,
    });
    await this.telemetry.recordEvent?.(event);
    this.status = "STOPPED";
    this.logger.info("worker stopped", {
      tenantId: this.deps.config.tenantId,
      workerId: this.deps.config.workerId,
      correlationId: shutdown.correlation.correlationId,
    });
    return shutdown;
  }

  getHealth(): WorkerHealthContract {
    const status = this.status === "READY" ? "HEALTHY" : this.status === "DRAINING" ? "DRAINING" : this.status === "STOPPED" ? "STOPPED" : this.status === "UNHEALTHY" ? "UNHEALTHY" : "DEGRADED";
    return workerHealthContractSchema.parse({
      tenantId: this.deps.config.tenantId,
      workerId: this.deps.config.workerId,
      status,
      checkedAt: this.clock.now().toISOString(),
      reasons: this.healthReasons(status),
      correlation: this.deps.config.correlation ?? correlationFromEnvironment(this.deps.config.workerId),
    });
  }

  getReadiness(): WorkerHealthContract {
    const health = this.getHealth();
    return workerHealthContractSchema.parse({
      ...health,
      status: this.status === "READY" ? "HEALTHY" : "DEGRADED",
      reasons: this.status === "READY" ? [] : [`worker status is ${this.status}`],
    });
  }

  createHeartbeat(): WorkerHeartbeatContract {
    return createWorkerHeartbeatContract({
      tenantId: this.deps.config.tenantId,
      workerId: this.deps.config.workerId,
      recordedAt: this.clock.now(),
      heartbeatIntervalMs: this.deps.config.heartbeatIntervalMs,
      health: this.getReadiness().status === "HEALTHY" ? "HEALTHY" : "DEGRADED",
      correlation: this.deps.config.correlation ?? correlationFromEnvironment(this.deps.config.workerId),
      metrics: this.metrics,
    });
  }

  async processJob(input: WorkerProcessJobInput): Promise<WorkerProcessJobResult> {
    const job = parseWorkerRuntimeContract(jobContractSchema, input.job, input.job.correlation);
    const definition = this.definitionFor(job);
    if (definition === undefined) {
      throw new WorkerRuntimeError({
        code: "WORKER_RUNTIME_VALIDATION_FAILED",
        message: `No worker registered for queue ${job.queueName} and job type ${job.jobType}`,
        status: 400,
        correlation: job.correlation,
      });
    }

    const lease = workerLeaseContractSchema.parse({
      tenantId: job.tenantId,
      leaseId: input.lease?.leaseId ?? `${job.jobId}:lease`,
      workerId: this.deps.config.workerId,
      jobId: job.jobId,
      queueName: job.queueName,
      acquiredAt: (input.lease?.acquiredAt ?? this.clock.now()).toISOString(),
      expiresAt: new Date((input.lease?.acquiredAt ?? this.clock.now()).getTime() + (input.lease?.ttlMs ?? 300_000)).toISOString(),
      heartbeatIntervalMs: input.lease?.heartbeatIntervalMs ?? this.deps.config.heartbeatIntervalMs,
      fencingToken: input.lease?.fencingToken ?? `${job.jobId}:fence`,
      correlation: job.correlation,
    });
    const token = createExecutionTokenContract({
      tenantId: job.tenantId,
      jobId: job.jobId,
      queueName: job.queueName,
      leaseId: lease.leaseId,
      tokenId: `${job.jobId}:token`,
      issuedAt: new Date(lease.acquiredAt),
      ttlMs: input.lease?.ttlMs ?? 300_000,
      replayMode: job.workflow?.replayMode ?? "LIVE",
      permissions: ["ACK", "NACK", "EXTEND_VISIBILITY", "EMIT_TELEMETRY", "SCHEDULE_CHILD_JOB"],
      correlation: job.correlation,
    });

    this.metrics = { ...this.metrics, runningJobs: this.metrics.runningJobs + 1 };
    try {
      const result = await executeReplaySafeJob({
        job,
        lease,
        token,
        handler: definition.handler,
        ports: { ...this.deps.runtimePorts, telemetry: this.telemetry, clock: this.clock },
      });
      this.metrics = { ...this.metrics, runningJobs: this.metrics.runningJobs - 1, completedJobs: this.metrics.completedJobs + 1 };
      return { status: result.status, result: workerRuntimeMetadataSchema.parse(result.result) };
    } catch (error) {
      this.metrics = { ...this.metrics, runningJobs: Math.max(0, this.metrics.runningJobs - 1), failedJobs: this.metrics.failedJobs + 1 };
      return this.handleJobFailure(job, error);
    }
  }

  private async handleJobFailure(job: JobContract, error: unknown): Promise<WorkerProcessJobResult> {
    const runtimeError = toRuntimeError(error, job.correlation);
    const decision = computeRetryDecision({
      policy: job.retryPolicy,
      attempt: 0,
      errorCode: runtimeError.code,
      now: this.clock.now(),
      tenantId: job.tenantId,
      correlation: job.correlation,
    });
    if (decision.action === "RETRY") {
      return { status: "RETRY_SCHEDULED", result: { nextAttempt: decision.nextAttempt, nextRunAt: decision.nextRunAt ?? "" } };
    }

    const deadLetter = buildDeadLetterContract({
      job,
      sourceQueueName: job.queueName,
      deadLetterQueueName: job.retryPolicy.deadLetterAfterMaxAttempts ? `${job.queueName}.dlq` : `${job.queueName}.dlq`,
      reason: decision.reason ?? "NON_RETRYABLE_ERROR",
      failedAt: this.clock.now(),
      attempt: decision.nextAttempt,
      error: runtimeError,
      correlation: job.correlation,
    });
    await this.deps.queues.deadLetter(deadLetter);
    const event: WorkerTelemetryEvent = workerTelemetryEventSchema.parse({
      id: `${job.jobId}:dead-lettered`,
      type: "JOB_DEAD_LETTERED",
      tenantId: job.tenantId,
      jobId: job.jobId,
      workerId: this.deps.config.workerId,
      occurredAt: deadLetter.failedAt,
      correlation: job.correlation,
      attributes: { reason: deadLetter.reason, "queue.name": job.queueName, "job.type": job.jobType },
      replaySafe: true,
    });
    await this.telemetry.recordEvent?.(event);
    this.metrics = { ...this.metrics, deadLetteredJobs: this.metrics.deadLetteredJobs + 1 };
    return { status: "DEAD_LETTERED", result: { reason: deadLetter.reason }, deadLetter };
  }

  private createShutdownContract(reason: string): WorkerShutdownContract {
    return workerShutdownContractSchema.parse({
      tenantId: this.deps.config.tenantId,
      workerId: this.deps.config.workerId,
      requestedAt: this.clock.now().toISOString(),
      gracePeriodMs: this.deps.config.gracefulShutdownMs,
      mode: "DRAIN",
      reason,
      correlation: this.deps.config.correlation ?? correlationFromEnvironment(this.deps.config.workerId),
    });
  }

  private registrations(): readonly QueueRegistration[] {
    const registeredAt = this.clock.now();
    const correlation = this.deps.config.correlation ?? correlationFromEnvironment(this.deps.config.workerId);
    return this.definitions.map((definition) => ({
      queue: definition.queue,
      worker: createRegistrationContract({
        tenantId: this.deps.config.tenantId,
        workerId: `${this.deps.config.workerId}:${definition.name}`,
        runtimeVersion: this.deps.config.runtimeVersion,
        queueNames: [definition.queue.queueName],
        jobTypes: definition.jobTypes,
        registeredAt,
        correlation,
      }),
    }));
  }

  private healthReasons(status: WorkerHealthContract["status"]): readonly string[] {
    if (status === "HEALTHY") {
      return [];
    }
    return [`worker status is ${this.status}`];
  }

  private definitionFor(job: JobContract): RegisteredWorkerDefinition | undefined {
    return this.definitions.find((definition) => definition.queue.queueName === job.queueName && definition.jobTypes.includes(job.jobType));
  }
}

export const createWorkerApplication = (dependencies: WorkerApplicationDependencies): WorkerApplication => new WorkerApplication(dependencies);

export const runWorkerFromEnv = async (dependencies: Omit<WorkerApplicationDependencies, "config">): Promise<WorkerApplication> => {
  const app = createWorkerApplication({ ...dependencies, config: createWorkerBootstrapConfigFromEnv() });
  await app.start();

  const shutdown = (signal: NodeJS.Signals): void => {
    void app.stop(`received ${signal}`).catch((error: unknown) => {
      const logger = dependencies.logger ?? createConsoleLogger();
      logger.error("worker shutdown failed", { signal, errorMessage: error instanceof Error ? error.message : "unknown error" });
      process.exitCode = 1;
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return app;
};


const isMainModule = (): boolean => process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule()) {
  const logger = createConsoleLogger();
  try {
    const config = createWorkerBootstrapConfigFromEnv();
    await runWorkerFromEnv(createBootstrapOnlyWorkerDependencies(config));
    await new Promise<void>((resolve) => {
      process.once("SIGINT", () => resolve());
      process.once("SIGTERM", () => resolve());
    });
  } catch (error) {
    logger.error("worker bootstrap failed", { errorMessage: error instanceof Error ? error.message : "unknown error" });
    process.exitCode = 1;
  }
}
