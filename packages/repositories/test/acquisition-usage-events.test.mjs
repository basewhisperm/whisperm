import assert from "node:assert/strict";
import test from "node:test";

import { PersistenceError, PrismaAcquisitionUsageEventRepository } from "../dist/index.js";

const now = "2026-07-15T00:00:00.000Z";

const record = (overrides = {}) => ({
  id: "event-1",
  tenantId: "tenant-a",
  eventType: "SELLER_DISCOVERED",
  quantity: 1,
  billable: true,
  campaignId: null,
  captureId: null,
  contactId: null,
  dealId: null,
  runtimeExecutionId: null,
  idempotencyKey: "usage:SELLER_DISCOVERED:tenant-a:campaign-1:capture-1",
  occurredAt: now,
  metadata: null,
  createdAt: now,
  ...overrides,
});

const createDelegate = (rows = []) => {
  const calls = [];
  return {
    calls,
    rows,
    create: async (args) => {
      calls.push({ method: "create", args });
      const existing = rows.find((row) => row.tenantId === args.data.tenantId && row.idempotencyKey === args.data.idempotencyKey);
      if (existing !== undefined) {
        const error = new Error("Unique constraint failed");
        error.code = "P2002";
        throw error;
      }
      const created = record({ id: `event-${rows.length + 1}`, ...args.data });
      rows.push(created);
      return created;
    },
    findFirst: async (args) => {
      calls.push({ method: "findFirst", args });
      return rows.find((row) => row.tenantId === args.where.tenantId && row.idempotencyKey === args.where.idempotencyKey) ?? null;
    },
    findMany: async (args) => {
      calls.push({ method: "findMany", args });
      return rows.filter((row) => row.tenantId === args.where.tenantId);
    },
  };
};

const clientWith = (delegate) => ({ acquisitionUsageEvent: delegate });

test("createIfNotExists creates a new usage event", async () => {
  const delegate = createDelegate();
  const repo = new PrismaAcquisitionUsageEventRepository(clientWith(delegate));

  const created = await repo.createIfNotExists({ tenantId: "tenant-a" }, {
    tenantId: "tenant-a",
    eventType: "SELLER_DISCOVERED",
    idempotencyKey: "usage:SELLER_DISCOVERED:tenant-a:campaign-1:capture-1",
    occurredAt: now,
  });

  assert.equal(created.tenantId, "tenant-a");
  assert.equal(created.quantity, 1);
  assert.equal(created.billable, true);
  assert.equal(delegate.rows.length, 1);
});

test("unique idempotency prevents double counting on retry", async () => {
  const delegate = createDelegate();
  const repo = new PrismaAcquisitionUsageEventRepository(clientWith(delegate));
  const input = {
    tenantId: "tenant-a",
    eventType: "INVITATION_SENT",
    idempotencyKey: "usage:INVITATION_SENT:tenant-a:execution-1",
    occurredAt: now,
  };

  const first = await repo.createIfNotExists({ tenantId: "tenant-a" }, input);
  const retry = await repo.createIfNotExists({ tenantId: "tenant-a" }, input);

  assert.equal(delegate.rows.length, 1);
  assert.equal(first.id, retry.id);
});

test("summary query is tenant-scoped", async () => {
  const delegate = createDelegate([
    record({ id: "e1", tenantId: "tenant-a", eventType: "SELLER_DISCOVERED", idempotencyKey: "a1" }),
    record({ id: "e2", tenantId: "tenant-b", eventType: "SELLER_DISCOVERED", idempotencyKey: "b1" }),
  ]);
  const repo = new PrismaAcquisitionUsageEventRepository(clientWith(delegate));

  const summary = await repo.summarizeByTenantAndPeriod({ tenantId: "tenant-a" }, new Date("2026-01-01T00:00:00.000Z"), new Date("2026-12-31T23:59:59.999Z"));

  assert.equal(summary.totalQuantity, 1);
  assert.deepEqual(delegate.calls[0].args.where.tenantId, "tenant-a");
});

test("period filtering is applied in the where clause", async () => {
  const delegate = createDelegate();
  const repo = new PrismaAcquisitionUsageEventRepository(clientWith(delegate));
  const periodStart = new Date("2026-07-01T00:00:00.000Z");
  const periodEnd = new Date("2026-07-31T23:59:59.999Z");

  await repo.summarizeByTenantAndPeriod({ tenantId: "tenant-a" }, periodStart, periodEnd);

  const call = delegate.calls.find((entry) => entry.method === "findMany");
  assert.deepEqual(call.args.where.occurredAt, { gte: periodStart, lte: periodEnd });
});

test("listByTenantAndPeriod paginates and is tenant-scoped", async () => {
  const rows = Array.from({ length: 3 }, (_, index) => record({ id: `event-${index + 1}`, idempotencyKey: `key-${index + 1}` }));
  const delegate = createDelegate(rows);
  const repo = new PrismaAcquisitionUsageEventRepository(clientWith(delegate));

  const page = await repo.listByTenantAndPeriod({ tenantId: "tenant-a" }, new Date("2026-01-01T00:00:00.000Z"), new Date("2026-12-31T23:59:59.999Z"), { limit: 2 });

  assert.equal(page.items.length, 2);
  assert.ok(page.nextCursor);
});

test("createIfNotExists rejects tenant mismatch before hitting Prisma", async () => {
  const delegate = createDelegate();
  const repo = new PrismaAcquisitionUsageEventRepository(clientWith(delegate));

  await assert.rejects(
    repo.createIfNotExists({ tenantId: "tenant-a" }, {
      tenantId: "tenant-b",
      eventType: "SELLER_DISCOVERED",
      idempotencyKey: "k",
      occurredAt: now,
    }),
    (error) => error instanceof PersistenceError,
  );
  assert.equal(delegate.calls.length, 0);
});
