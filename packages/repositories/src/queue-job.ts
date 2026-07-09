import { z } from "zod";

import { PersistenceError, type TenantScoped } from "@whisperm/types";
import type { PrismaPersistenceClient } from "./index.js";

type PrismaWhere = Readonly<Record<string, unknown>>;
type PrismaData = Readonly<Record<string, unknown>>;

interface QueueJobDelegate {
  create(args: { readonly data: PrismaData }): Promise<unknown>;
  findFirst(args: { readonly where: PrismaWhere; readonly orderBy?: PrismaData; readonly take?: number }): Promise<unknown | null>;
  findMany(args: { readonly where: PrismaWhere; readonly orderBy?: PrismaData; readonly take?: number }): Promise<readonly unknown[]>;
  updateMany(args: { readonly where: PrismaWhere; readonly data: PrismaData }): Promise<{ readonly count: number }>;
}

interface DeadLetterJobDelegate {
  create(args: { readonly data: PrismaData }): Promise<unknown>;
}

// ST1-013M: canonical durable job lifecycle -- see docs/runtime/runtime-surface.md and
// docs/runtime/status-vocabulary.md for the full state machine and ownership map. This mirrors
// the Prisma `QueueJobState` enum exactly; do not add a second status vocabulary for jobs.
export const queueJobStateSchema = z.enum([
  "WAITING",
  "DELAYED",
  "ACTIVE",
  "COMPLETED",
  "FAILED",
  "RETRY_SCHEDULED",
  "DEAD_LETTERED",
  "CANCELLED",
]);
export type QueueJobState = z.infer<typeof queueJobStateSchema>;

const claimableStates = ["WAITING", "RETRY_SCHEDULED"] as const;
const activeState = "ACTIVE" as const;

const isoDateSchema = z.string().datetime();
const jsonObjectSchema = z.record(z.string(), z.unknown());

export const queueJobRecordSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  queueName: z.string().min(1),
  jobName: z.string().min(1),
  jobKey: z.string().min(1),
  state: queueJobStateSchema,
  payload: jsonObjectSchema,
  attemptsMade: z.number().int().min(0),
  maxAttempts: z.number().int().min(1),
  scheduledAt: isoDateSchema.nullable().optional(),
  availableAt: isoDateSchema,
  lockedUntil: isoDateSchema.nullable().optional(),
  lastError: jsonObjectSchema.nullable().optional(),
  correlationId: z.string().min(1),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
}).strict();
export type QueueJobRecord = z.output<typeof queueJobRecordSchema>;

export type CreateQueueJobInput = TenantScoped & {
  readonly queueName: string;
  readonly jobName: string;
  readonly jobKey: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly correlationId: string;
  readonly maxAttempts?: number | undefined;
  readonly availableAt?: string | undefined;
};

export interface ClaimQueueJobsInput extends TenantScoped {
  readonly queueNames: readonly string[];
  readonly now: Date;
  readonly lockDurationMs: number;
  readonly limit?: number | undefined;
}

export interface RecordDeadLetterInput extends TenantScoped {
  readonly queueName: string;
  readonly jobName: string;
  readonly jobKey: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly reason: string;
  readonly attemptsMade: number;
  readonly correlationId: string;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface QueueJobRepository {
  /** Idempotent on (tenantId, queueName, jobKey): a duplicate enqueue returns the existing row. */
  enqueue(context: TenantScoped, input: CreateQueueJobInput): Promise<QueueJobRecord>;
  /**
   * Atomically claims the oldest available WAITING/RETRY_SCHEDULED job, or a stale ACTIVE job
   * whose lock has expired (a crashed/duplicate worker). Returns null when nothing is claimable.
   */
  claimNext(input: ClaimQueueJobsInput): Promise<QueueJobRecord | null>;
  markCompleted(context: TenantScoped, id: string): Promise<QueueJobRecord>;
  markRetryScheduled(context: TenantScoped, id: string, input: { readonly availableAt: string; readonly lastError?: Readonly<Record<string, unknown>> | undefined }): Promise<QueueJobRecord>;
  markDeadLettered(context: TenantScoped, id: string, input: { readonly lastError?: Readonly<Record<string, unknown>> | undefined }): Promise<QueueJobRecord>;
  markCancelled(context: TenantScoped, id: string): Promise<QueueJobRecord>;
  findById(context: TenantScoped, id: string): Promise<QueueJobRecord | null>;
  /** Idempotent on (tenantId, queueName, jobKey); a duplicate record is a silent no-op. */
  recordDeadLetter(context: TenantScoped, input: RecordDeadLetterInput): Promise<void>;
}

// Note: deliberately validates only `tenantId` rather than `.strict()`-parsing the whole input --
// several callers here (e.g. claimNext) pass a single object that combines TenantScoped with
// other fields (queueNames, now, lockDurationMs), not a bare `{ tenantId }` context.
const ensureContext = (context: TenantScoped): void => {
  z.object({ tenantId: z.string().min(1) }).parse(context);
};

const normalizeRecord = (value: unknown): unknown => {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeRecord);
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, normalizeRecord(nested)]));
};

const parseRecord = (value: unknown): QueueJobRecord => queueJobRecordSchema.parse(normalizeRecord(value));
const dataWithDefined = (input: Readonly<Record<string, unknown>>): PrismaData => Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));

const errorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error ? String((error as { readonly code: unknown }).code) : undefined;

const mapPrismaError = (error: unknown, conflictMessage: string): never => {
  if (error instanceof PersistenceError) throw error;
  if (errorCode(error) === "P2002") {
    throw new PersistenceError({ code: "PERSISTENCE_CONFLICT", message: conflictMessage, status: 409 });
  }
  throw new PersistenceError({ code: "PERSISTENCE_TRANSIENT", message: "Queue job operation failed", status: 503, details: { prismaCode: errorCode(error) } });
};

export class PrismaQueueJobRepository implements QueueJobRepository {
  private readonly jobs: QueueJobDelegate;
  private readonly deadLetters: DeadLetterJobDelegate;

  constructor(prisma: PrismaPersistenceClient) {
    this.jobs = prisma.queueJob as unknown as QueueJobDelegate;
    this.deadLetters = prisma.deadLetterJob as unknown as DeadLetterJobDelegate;
  }

  async enqueue(context: TenantScoped, input: CreateQueueJobInput): Promise<QueueJobRecord> {
    ensureContext(context);
    if (context.tenantId !== input.tenantId) {
      throw new PersistenceError({ code: "PERSISTENCE_TENANT_MISMATCH", message: "Queue job tenantId must match context", status: 403 });
    }
    try {
      const row = await this.jobs.create({
        data: dataWithDefined({
          tenantId: input.tenantId,
          queueName: input.queueName,
          jobName: input.jobName,
          jobKey: input.jobKey,
          payload: input.payload,
          maxAttempts: input.maxAttempts,
          availableAt: input.availableAt === undefined ? undefined : new Date(input.availableAt),
          correlationId: input.correlationId,
        }),
      });
      return parseRecord(row);
    } catch (error) {
      if (errorCode(error) === "P2002") {
        const existing = await this.jobs.findFirst({ where: { tenantId: input.tenantId, queueName: input.queueName, jobKey: input.jobKey } });
        if (existing !== null) return parseRecord(existing);
      }
      return mapPrismaError(error, "Queue job with this idempotency key already exists");
    }
  }

  async claimNext(input: ClaimQueueJobsInput): Promise<QueueJobRecord | null> {
    ensureContext(input);
    if (input.queueNames.length === 0) return null;
    const candidates = await this.jobs.findMany({
      where: {
        tenantId: input.tenantId,
        queueName: { in: input.queueNames },
        OR: [
          { state: { in: [...claimableStates] }, availableAt: { lte: input.now } },
          { state: activeState, lockedUntil: { lt: input.now } },
        ],
      },
      orderBy: { availableAt: "asc" },
      take: input.limit ?? 10,
    });

    const lockedUntil = new Date(input.now.getTime() + input.lockDurationMs);
    for (const candidate of candidates) {
      const id = (candidate as { readonly id: string }).id;
      // Conditional UPDATE claim: two workers racing on the same row serialize at the DB, and
      // the loser's WHERE (state still WAITING/RETRY_SCHEDULED/stale-ACTIVE) no longer matches
      // once the winner's transaction commits, so `count` is 0 for the loser -- no double-claim.
      const result = await this.jobs.updateMany({
        where: {
          tenantId: input.tenantId,
          id,
          OR: [
            { state: { in: [...claimableStates] } },
            { state: activeState, lockedUntil: { lt: input.now } },
          ],
        },
        data: { state: activeState, lockedUntil, attemptsMade: { increment: 1 } },
      });
      if (result.count === 1) {
        const claimed = await this.jobs.findFirst({ where: { tenantId: input.tenantId, id } });
        return claimed === null ? null : parseRecord(claimed);
      }
    }
    return null;
  }

  markCompleted(context: TenantScoped, id: string): Promise<QueueJobRecord> {
    return this.transition(context, id, { state: "COMPLETED", lockedUntil: null }, [activeState]);
  }

  markRetryScheduled(context: TenantScoped, id: string, input: { readonly availableAt: string; readonly lastError?: Readonly<Record<string, unknown>> | undefined }): Promise<QueueJobRecord> {
    return this.transition(context, id, { state: "RETRY_SCHEDULED", availableAt: new Date(input.availableAt), lockedUntil: null, lastError: input.lastError ?? undefined }, [activeState]);
  }

  markDeadLettered(context: TenantScoped, id: string, input: { readonly lastError?: Readonly<Record<string, unknown>> | undefined }): Promise<QueueJobRecord> {
    return this.transition(context, id, { state: "DEAD_LETTERED", lockedUntil: null, lastError: input.lastError ?? undefined }, [activeState]);
  }

  markCancelled(context: TenantScoped, id: string): Promise<QueueJobRecord> {
    return this.transition(context, id, { state: "CANCELLED", lockedUntil: null }, ["WAITING", "DELAYED", "RETRY_SCHEDULED"]);
  }

  async findById(context: TenantScoped, id: string): Promise<QueueJobRecord | null> {
    ensureContext(context);
    const row = await this.jobs.findFirst({ where: { tenantId: context.tenantId, id } });
    return row === null ? null : parseRecord(row);
  }

  async recordDeadLetter(context: TenantScoped, input: RecordDeadLetterInput): Promise<void> {
    ensureContext(context);
    try {
      await this.deadLetters.create({
        data: dataWithDefined({
          tenantId: input.tenantId,
          queueName: input.queueName,
          jobName: input.jobName,
          jobKey: input.jobKey,
          payload: input.payload,
          reason: input.reason,
          attemptsMade: input.attemptsMade,
          correlationId: input.correlationId,
          metadata: input.metadata,
        }),
      });
    } catch (error) {
      if (errorCode(error) === "P2002") return; // idempotent: already dead-lettered under this key
      mapPrismaError(error, "Dead letter job already exists");
    }
  }

  private async transition(context: TenantScoped, id: string, data: Readonly<Record<string, unknown>>, fromStates: readonly string[]): Promise<QueueJobRecord> {
    ensureContext(context);
    const result = await this.jobs.updateMany({
      where: { tenantId: context.tenantId, id, state: { in: fromStates } },
      data: dataWithDefined(data),
    });
    if (result.count !== 1) {
      throw new PersistenceError({ code: "PERSISTENCE_CONFLICT", message: `Queue job ${id} is not in an expected state for this transition`, status: 409, details: { id, fromStates } });
    }
    const row = await this.jobs.findFirst({ where: { tenantId: context.tenantId, id } });
    if (row === null) throw new PersistenceError({ code: "PERSISTENCE_NOT_FOUND", message: "Queue job not found after update", status: 404 });
    return parseRecord(row);
  }
}
