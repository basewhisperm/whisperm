import type { PrismaPersistenceClient } from "@whisperm/repositories";
import {
  claimAndProcessOneDurableQueueJob,
  createBootstrapOnlyWorkerDependencies,
  createProductionWorkerServices,
  createWorkerApplication,
  createWorkerBootstrapConfigFromEnv,
  PRODUCTION_CONFIGURED_WORKER_NAMES,
  PrismaQueueRuntime,
} from "@whisperm/worker";

import { prisma } from "@/lib/prisma";

const CLAIMABLE_STATES = ["WAITING", "DELAYED", "RETRY_SCHEDULED"] as const;

/**
 * `QueueJob.claimNext` is strictly per-tenant (see packages/repositories/src/queue-job.ts) --
 * apps/worker's own poll loop only ever drains the single tenant named by
 * WHISPERM_WORKER_TENANT_ID, which is fine for a long-running process dedicated to one tenant but
 * not for a serverless drain covering every tenant. This finds every tenant with at least one
 * job actually due right now, so the caller can loop claimAndProcessOneDurableQueueJob per
 * tenant instead of guessing which tenants have work.
 */
async function listTenantIdsWithDueJobs(queueNames: readonly string[], now: Date): Promise<readonly string[]> {
  const rows = await prisma.queueJob.findMany({
    where: {
      queueName: { in: [...queueNames] },
      OR: [
        { state: { in: [...CLAIMABLE_STATES] }, availableAt: { lte: now } },
        { state: "ACTIVE", lockedUntil: { lt: now } },
      ],
    },
    distinct: ["tenantId"],
    select: { tenantId: true },
  });
  return rows.map((row) => row.tenantId);
}

export interface DrainDueQueueJobsResult {
  readonly tenantsWithWork: number;
  readonly jobsProcessed: number;
  readonly jobsCompleted: number;
  readonly jobsRetried: number;
  readonly jobsDeadLettered: number;
  readonly stoppedReason: "NO_MORE_DUE_JOBS" | "TIME_BUDGET_EXCEEDED";
}

export interface DrainDueQueueJobsOptions {
  /** Wall-clock budget for one invocation -- must stay comfortably under the calling route's own execution limit. */
  readonly timeBudgetMs?: number;
  /** Safety cap so one runaway tenant can't starve every other tenant within a single invocation. */
  readonly maxJobsPerTenantPerTick?: number;
}

/**
 * Drains every tenant's durable QueueJob table by one batch -- this is what makes claim expiry
 * (7-day claim links), claim reminders (Day 3/Day 6), and growth-loop evaluation actually run in
 * production. Meant to be invoked repeatedly (via Vercel Cron hitting
 * /api/internal/queue-drain) rather than run once forever like apps/worker's own poll loop,
 * since nothing in this repo's deployment actually keeps apps/worker running continuously.
 *
 * Reuses apps/worker's exact production wiring (createProductionWorkerServices) so the same
 * tested job handlers run here -- this is not a second implementation of the claim-lifecycle /
 * campaign-runtime / growth-loop logic, only a different (HTTP-cron-triggered, multi-tenant)
 * driver for it.
 */
export async function drainDueQueueJobs(options: DrainDueQueueJobsOptions = {}): Promise<DrainDueQueueJobsResult> {
  const timeBudgetMs = options.timeBudgetMs ?? 8_000;
  const maxJobsPerTenantPerTick = options.maxJobsPerTenantPerTick ?? 25;
  const deadline = Date.now() + timeBudgetMs;

  const persistence = prisma as unknown as PrismaPersistenceClient;
  const { services, queueJobs } = createProductionWorkerServices(persistence, process.env);

  const config = createWorkerBootstrapConfigFromEnv({
    ...process.env,
    // Decorative only -- see createWorkerDefinitions in apps/worker, which uses this solely to
    // label each queue's contract metadata. Per-job tenant scoping comes from each QueueJob
    // row's own tenantId, passed explicitly to claimAndProcessOneDurableQueueJob below.
    WHISPERM_WORKER_TENANT_ID: "queue-drain",
    WHISPERM_WORKER_ID: process.env.WHISPERM_WORKER_ID ?? "queue-drain",
  });

  const app = createWorkerApplication({
    ...createBootstrapOnlyWorkerDependencies(config),
    queues: new PrismaQueueRuntime({ queueJobs }),
    services,
  });

  const queueNames = [...new Set(
    app.getRegisteredWorkers()
      .filter((definition) => PRODUCTION_CONFIGURED_WORKER_NAMES.has(definition.name))
      .map((definition) => definition.queue.queueName),
  )];

  let jobsProcessed = 0;
  let jobsCompleted = 0;
  let jobsRetried = 0;
  let jobsDeadLettered = 0;
  let tenantsWithWork = 0;

  while (Date.now() < deadline) {
    const tenantIds = await listTenantIdsWithDueJobs(queueNames, new Date());
    if (tenantIds.length === 0) {
      return { tenantsWithWork, jobsProcessed, jobsCompleted, jobsRetried, jobsDeadLettered, stoppedReason: "NO_MORE_DUE_JOBS" };
    }

    let claimedAnyThisPass = false;
    for (const tenantId of tenantIds) {
      if (Date.now() >= deadline) {
        return { tenantsWithWork, jobsProcessed, jobsCompleted, jobsRetried, jobsDeadLettered, stoppedReason: "TIME_BUDGET_EXCEEDED" };
      }

      let tenantHadWork = false;
      for (let claimed = 0; claimed < maxJobsPerTenantPerTick && Date.now() < deadline; claimed += 1) {
        const outcome = await claimAndProcessOneDurableQueueJob({ app, queueJobs, tenantId, queueNames });
        if (!outcome.claimed) break;

        tenantHadWork = true;
        claimedAnyThisPass = true;
        jobsProcessed += 1;
        if (outcome.outcome === "COMPLETED") jobsCompleted += 1;
        else if (outcome.outcome === "RETRY_SCHEDULED") jobsRetried += 1;
        else if (outcome.outcome === "DEAD_LETTERED") jobsDeadLettered += 1;
      }
      if (tenantHadWork) tenantsWithWork += 1;
    }

    if (!claimedAnyThisPass) {
      return { tenantsWithWork, jobsProcessed, jobsCompleted, jobsRetried, jobsDeadLettered, stoppedReason: "NO_MORE_DUE_JOBS" };
    }
  }

  return { tenantsWithWork, jobsProcessed, jobsCompleted, jobsRetried, jobsDeadLettered, stoppedReason: "TIME_BUDGET_EXCEEDED" };
}
