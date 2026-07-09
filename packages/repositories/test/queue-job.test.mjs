import assert from "node:assert/strict";
import test from "node:test";

import { PersistenceError, PrismaQueueJobRepository } from "../dist/index.js";

// ST1-013M: a minimal in-memory Prisma-shaped store, sufficient to exercise
// PrismaQueueJobRepository's claim/complete/retry/dead-letter lifecycle without a real database
// -- matches the where-clause shapes PrismaQueueJobRepository actually issues (equality, `in`,
// `lt`/`lte`, and a top-level `OR` array), not a general Prisma query engine.
const matchesClause = (row, clause) => Object.entries(clause).every(([key, expected]) => {
  const actual = row[key];
  if (expected !== null && typeof expected === "object" && !(expected instanceof Date)) {
    if ("in" in expected) return expected.in.includes(actual);
    if ("lt" in expected) return actual instanceof Date && actual.getTime() < expected.lt.getTime();
    if ("lte" in expected) return actual instanceof Date && actual.getTime() <= expected.lte.getTime();
  }
  if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime();
  return actual === expected;
});

const matchesWhere = (row, where) => {
  const { OR, ...rest } = where;
  if (!matchesClause(row, rest)) return false;
  if (OR === undefined) return true;
  return OR.some((clause) => matchesClause(row, clause));
};

const applyData = (row, data) => {
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && typeof value === "object" && "increment" in value) {
      row[key] = (row[key] ?? 0) + value.increment;
    } else {
      row[key] = value;
    }
  }
  row.updatedAt = new Date();
};

const createFakePrisma = () => {
  const jobs = [];
  const deadLetters = [];
  let nextId = 1;

  return {
    jobs,
    deadLetters,
    queueJob: {
      async create({ data }) {
        if (jobs.some((row) => row.tenantId === data.tenantId && row.queueName === data.queueName && row.jobKey === data.jobKey)) {
          const error = new Error("Unique constraint failed");
          error.code = "P2002";
          throw error;
        }
        const now = new Date();
        const row = {
          id: `job-${nextId++}`,
          state: "WAITING",
          attemptsMade: 0,
          maxAttempts: 1,
          scheduledAt: null,
          lockedUntil: null,
          lastError: null,
          createdAt: now,
          updatedAt: now,
          availableAt: now,
          ...data,
        };
        jobs.push(row);
        return { ...row };
      },
      async findFirst({ where }) {
        const row = jobs.find((candidate) => matchesWhere(candidate, where));
        return row === undefined ? null : { ...row };
      },
      async findMany({ where, orderBy, take }) {
        let matches = jobs.filter((candidate) => matchesWhere(candidate, where));
        if (orderBy?.availableAt === "asc") matches = [...matches].sort((a, b) => a.availableAt.getTime() - b.availableAt.getTime());
        if (take !== undefined) matches = matches.slice(0, take);
        return matches.map((row) => ({ ...row }));
      },
      async updateMany({ where, data }) {
        const matches = jobs.filter((candidate) => matchesWhere(candidate, where));
        for (const row of matches) applyData(row, data);
        return { count: matches.length };
      },
    },
    deadLetterJob: {
      async create({ data }) {
        if (deadLetters.some((row) => row.tenantId === data.tenantId && row.queueName === data.queueName && row.jobKey === data.jobKey)) {
          const error = new Error("Unique constraint failed");
          error.code = "P2002";
          throw error;
        }
        const row = { id: `dlq-${deadLetters.length + 1}`, failedAt: new Date(), ...data };
        deadLetters.push(row);
        return row;
      },
    },
  };
};

const tenant = { tenantId: "tenant-1" };

test("enqueue creates a WAITING job with the given idempotency key", async () => {
  const prisma = createFakePrisma();
  const repo = new PrismaQueueJobRepository(prisma);
  const row = await repo.enqueue(tenant, {
    tenantId: "tenant-1",
    queueName: "marketplace.invite",
    jobName: "marketplace.invite.send",
    jobKey: "job-key-1",
    payload: { tenantId: "tenant-1" },
    correlationId: "corr-1",
  });
  assert.equal(row.state, "WAITING");
  assert.equal(row.jobKey, "job-key-1");
  assert.equal(row.attemptsMade, 0);
});

test("duplicate enqueue on the same (tenantId, queueName, jobKey) returns the existing row instead of erroring or duplicating", async () => {
  const prisma = createFakePrisma();
  const repo = new PrismaQueueJobRepository(prisma);
  const input = {
    tenantId: "tenant-1",
    queueName: "marketplace.invite",
    jobName: "marketplace.invite.send",
    jobKey: "dup-key",
    payload: { tenantId: "tenant-1" },
    correlationId: "corr-1",
  };
  const first = await repo.enqueue(tenant, input);
  const second = await repo.enqueue(tenant, input);
  assert.equal(first.id, second.id);
  assert.equal(prisma.jobs.length, 1);
});

test("claimNext atomically claims the oldest WAITING job and increments attemptsMade", async () => {
  const prisma = createFakePrisma();
  const repo = new PrismaQueueJobRepository(prisma);
  const now = new Date("2026-07-09T00:00:00.000Z");
  prisma.jobs.push({ id: "job-a", tenantId: "tenant-1", queueName: "marketplace.invite", jobName: "marketplace.invite.send", jobKey: "a", state: "WAITING", payload: {}, attemptsMade: 0, maxAttempts: 3, availableAt: new Date(now.getTime() - 1000), lockedUntil: null, lastError: null, correlationId: "corr-a", createdAt: now, updatedAt: now });

  const claimed = await repo.claimNext({ tenantId: "tenant-1", queueNames: ["marketplace.invite"], now, lockDurationMs: 60_000 });

  assert.equal(claimed.id, "job-a");
  assert.equal(claimed.state, "ACTIVE");
  assert.equal(claimed.attemptsMade, 1);
  assert.ok(claimed.lockedUntil);
});

test("claimNext does not claim a WAITING job whose availableAt is in the future", async () => {
  const prisma = createFakePrisma();
  const repo = new PrismaQueueJobRepository(prisma);
  const now = new Date("2026-07-09T00:00:00.000Z");
  prisma.jobs.push({ id: "job-future", tenantId: "tenant-1", queueName: "marketplace.invite", jobName: "marketplace.invite.send", jobKey: "future", state: "WAITING", payload: {}, attemptsMade: 0, maxAttempts: 3, availableAt: new Date(now.getTime() + 60_000), lockedUntil: null, lastError: null, correlationId: "corr", createdAt: now, updatedAt: now });

  const claimed = await repo.claimNext({ tenantId: "tenant-1", queueNames: ["marketplace.invite"], now, lockDurationMs: 60_000 });

  assert.equal(claimed, null);
});

test("claimNext reclaims a stale ACTIVE job whose lock has expired (crashed worker)", async () => {
  const prisma = createFakePrisma();
  const repo = new PrismaQueueJobRepository(prisma);
  const now = new Date("2026-07-09T00:00:00.000Z");
  prisma.jobs.push({ id: "job-stale", tenantId: "tenant-1", queueName: "marketplace.invite", jobName: "marketplace.invite.send", jobKey: "stale", state: "ACTIVE", payload: {}, attemptsMade: 1, maxAttempts: 3, availableAt: new Date(now.getTime() - 120_000), lockedUntil: new Date(now.getTime() - 1000), lastError: null, correlationId: "corr", createdAt: now, updatedAt: now });

  const claimed = await repo.claimNext({ tenantId: "tenant-1", queueNames: ["marketplace.invite"], now, lockDurationMs: 60_000 });

  assert.equal(claimed.id, "job-stale");
  assert.equal(claimed.attemptsMade, 2, "reclaiming a stale job counts as a new attempt");
});

test("claimNext does not claim an ACTIVE job whose lock has not yet expired (no duplicate execution)", async () => {
  const prisma = createFakePrisma();
  const repo = new PrismaQueueJobRepository(prisma);
  const now = new Date("2026-07-09T00:00:00.000Z");
  prisma.jobs.push({ id: "job-locked", tenantId: "tenant-1", queueName: "marketplace.invite", jobName: "marketplace.invite.send", jobKey: "locked", state: "ACTIVE", payload: {}, attemptsMade: 1, maxAttempts: 3, availableAt: new Date(now.getTime() - 120_000), lockedUntil: new Date(now.getTime() + 60_000), lastError: null, correlationId: "corr", createdAt: now, updatedAt: now });

  const claimed = await repo.claimNext({ tenantId: "tenant-1", queueNames: ["marketplace.invite"], now, lockDurationMs: 60_000 });

  assert.equal(claimed, null);
});

test("claimNext racing twice for the same row: the second caller gets nothing (no double-execution)", async () => {
  const prisma = createFakePrisma();
  const repo = new PrismaQueueJobRepository(prisma);
  const now = new Date("2026-07-09T00:00:00.000Z");
  prisma.jobs.push({ id: "job-race", tenantId: "tenant-1", queueName: "marketplace.invite", jobName: "marketplace.invite.send", jobKey: "race", state: "WAITING", payload: {}, attemptsMade: 0, maxAttempts: 3, availableAt: new Date(now.getTime() - 1000), lockedUntil: null, lastError: null, correlationId: "corr", createdAt: now, updatedAt: now });

  const [first, second] = await Promise.all([
    repo.claimNext({ tenantId: "tenant-1", queueNames: ["marketplace.invite"], now, lockDurationMs: 60_000 }),
    repo.claimNext({ tenantId: "tenant-1", queueNames: ["marketplace.invite"], now, lockDurationMs: 60_000 }),
  ]);

  const claimedResults = [first, second].filter((result) => result !== null);
  assert.equal(claimedResults.length, 1, "exactly one of the two racing claims must succeed");
});

test("markCompleted transitions an ACTIVE job to COMPLETED", async () => {
  const prisma = createFakePrisma();
  const repo = new PrismaQueueJobRepository(prisma);
  const now = new Date();
  prisma.jobs.push({ id: "job-c", tenantId: "tenant-1", queueName: "q", jobName: "j", jobKey: "k", state: "ACTIVE", payload: {}, attemptsMade: 1, maxAttempts: 3, availableAt: now, lockedUntil: now, lastError: null, correlationId: "corr", createdAt: now, updatedAt: now });

  const updated = await repo.markCompleted(tenant, "job-c");

  assert.equal(updated.state, "COMPLETED");
  assert.equal(updated.lockedUntil, null);
});

test("markCompleted on a job that is not ACTIVE throws a conflict instead of silently succeeding", async () => {
  const prisma = createFakePrisma();
  const repo = new PrismaQueueJobRepository(prisma);
  const now = new Date();
  prisma.jobs.push({ id: "job-w", tenantId: "tenant-1", queueName: "q", jobName: "j", jobKey: "k", state: "WAITING", payload: {}, attemptsMade: 0, maxAttempts: 3, availableAt: now, lockedUntil: null, lastError: null, correlationId: "corr", createdAt: now, updatedAt: now });

  await assert.rejects(
    () => repo.markCompleted(tenant, "job-w"),
    (error) => error instanceof PersistenceError && error.code === "PERSISTENCE_CONFLICT",
  );
});

test("markRetryScheduled moves availableAt forward and records lastError", async () => {
  const prisma = createFakePrisma();
  const repo = new PrismaQueueJobRepository(prisma);
  const now = new Date();
  prisma.jobs.push({ id: "job-r", tenantId: "tenant-1", queueName: "q", jobName: "j", jobKey: "k", state: "ACTIVE", payload: {}, attemptsMade: 1, maxAttempts: 3, availableAt: now, lockedUntil: now, lastError: null, correlationId: "corr", createdAt: now, updatedAt: now });

  const retryAt = new Date(now.getTime() + 60_000).toISOString();
  const updated = await repo.markRetryScheduled(tenant, "job-r", { availableAt: retryAt, lastError: { code: "TRANSIENT", message: "boom" } });

  assert.equal(updated.state, "RETRY_SCHEDULED");
  assert.equal(updated.availableAt, retryAt);
  assert.deepEqual(updated.lastError, { code: "TRANSIENT", message: "boom" });
});

test("markDeadLettered is terminal and clears the lock", async () => {
  const prisma = createFakePrisma();
  const repo = new PrismaQueueJobRepository(prisma);
  const now = new Date();
  prisma.jobs.push({ id: "job-dl", tenantId: "tenant-1", queueName: "q", jobName: "j", jobKey: "k", state: "ACTIVE", payload: {}, attemptsMade: 3, maxAttempts: 3, availableAt: now, lockedUntil: now, lastError: null, correlationId: "corr", createdAt: now, updatedAt: now });

  const updated = await repo.markDeadLettered(tenant, "job-dl", { lastError: { code: "MAX_ATTEMPTS_EXCEEDED", message: "boom" } });

  assert.equal(updated.state, "DEAD_LETTERED");
  assert.equal(updated.lockedUntil, null);
});

test("recordDeadLetter writes a DeadLetterJob row and is idempotent under the same key", async () => {
  const prisma = createFakePrisma();
  const repo = new PrismaQueueJobRepository(prisma);

  const input = {
    tenantId: "tenant-1",
    queueName: "marketplace.invite",
    jobName: "marketplace.invite.send",
    jobKey: "dlq-key",
    payload: {},
    reason: "MAX_ATTEMPTS_EXCEEDED",
    attemptsMade: 3,
    correlationId: "corr-1",
  };
  await repo.recordDeadLetter(tenant, input);
  await repo.recordDeadLetter(tenant, input); // duplicate call must not throw or duplicate

  assert.equal(prisma.deadLetters.length, 1);
});
