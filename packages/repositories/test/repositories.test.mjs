import assert from "node:assert/strict";
import test from "node:test";

import {
  PersistenceError,
  PrismaEventRepository,
  PrismaTenantRepository,
  PrismaUserRepository,
  createPrismaRepositories
} from "../dist/index.js";

const now = "2026-05-29T00:00:00.000Z";

const createDelegate = (name) => {
  const calls = [];
  const delegate = {
    calls,
    create: async (args) => {
      calls.push({ name, method: "create", args });
      return { id: `${name}-id`, createdAt: now, updatedAt: now, ...args.data };
    },
    findFirst: async (args) => {
      calls.push({ name, method: "findFirst", args });
      return null;
    },
    findMany: async (args) => {
      calls.push({ name, method: "findMany", args });
      return [];
    },
    update: async (args) => {
      calls.push({ name, method: "update", args });
      return { id: args.where.id ?? `${name}-id`, tenantId: args.where.tenantId, createdAt: now, updatedAt: now, ...args.data };
    },
    updateMany: async (args) => {
      calls.push({ name, method: "updateMany", args });
      return { count: 1 };
    },
    createMany: async (args) => {
      calls.push({ name, method: "createMany", args });
      return { count: args.data.length };
    },
    count: async (args) => {
      calls.push({ name, method: "count", args });
      return 7;
    },
    upsert: async (args) => {
      calls.push({ name, method: "upsert", args });
      return { id: `${name}-id`, tenantId: args.create.tenantId, createdAt: now, updatedAt: now, ...args.create, ...args.update };
    }
  };
  return delegate;
};

const createClient = () => {
  const names = [
    "tenant", "tenantUser", "contact", "leadEvent", "contentItem", "contentVariant", "publishJob", "workflowExecution",
    "workflowStepExecution", "eventIngestion", "outboxEvent", "inboxEvent", "idempotencyKey", "aiExecution", "auditLog"
  ];
  return Object.fromEntries(names.map((name) => [name, createDelegate(name)]));
};

test("tenant-scoped user reads always include tenantId", async () => {
  const prisma = createClient();
  const users = new PrismaUserRepository(prisma);

  await users.findById({ tenantId: "tenant-a" }, "user-1");
  await users.findByEmail({ tenantId: "tenant-a" }, "person@example.com");

  assert.deepEqual(prisma.tenantUser.calls[0].args.where, { tenantId: "tenant-a", id: "user-1" });
  assert.deepEqual(prisma.tenantUser.calls[1].args.where, { tenantId: "tenant-a", email: "person@example.com" });
});

test("tenant mismatch is rejected before Prisma is called", async () => {
  const prisma = createClient();
  const users = new PrismaUserRepository(prisma);

  await assert.rejects(
    users.create({ tenantId: "tenant-a" }, { tenantId: "tenant-b", email: "person@example.com", role: "MEMBER" }),
    (error) => error instanceof PersistenceError && error.code === "PERSISTENCE_TENANT_MISMATCH"
  );
  assert.equal(prisma.tenantUser.calls.length, 0);
});

test("optimistic updates use tenantId and expected updatedAt", async () => {
  const prisma = createClient();
  prisma.tenantUser.findFirst = async (args) => {
    prisma.tenantUser.calls.push({ name: "tenantUser", method: "findFirst", args });
    return { id: "user-1", tenantId: "tenant-a", email: "new@example.com", role: "ADMIN", isActive: true, createdAt: now, updatedAt: now };
  };
  const users = new PrismaUserRepository(prisma);

  await users.update({ tenantId: "tenant-a" }, "user-1", { expectedUpdatedAt: now, email: "new@example.com" });

  assert.deepEqual(prisma.tenantUser.calls[0].args.where, { tenantId: "tenant-a", id: "user-1", updatedAt: new Date(now) });
  assert.deepEqual(prisma.tenantUser.calls[0].args.data, { email: "new@example.com" });
});

test("idempotency completion is tenant-scoped and only completes in-progress records", async () => {
  const prisma = createClient();
  prisma.idempotencyKey.findFirst = async (args) => {
    prisma.idempotencyKey.calls.push({ name: "idempotencyKey", method: "findFirst", args });
    return { id: "idem-1", tenantId: "tenant-a", scope: "events", key: "key-1", requestHash: "hash", state: "COMPLETED", response: { ok: true }, expiresAt: now, createdAt: now, updatedAt: now };
  };
  const events = new PrismaEventRepository(prisma);

  await events.completeIdempotency({ tenantId: "tenant-a", scope: "events", key: "key-1", response: { ok: true } });

  assert.deepEqual(prisma.idempotencyKey.calls[0].args.where, { tenantId: "tenant-a", scope: "events", key: "key-1", state: "IN_PROGRESS" });
  assert.deepEqual(prisma.idempotencyKey.calls[0].args.data, { state: "COMPLETED", response: { ok: true } });
});

test("transaction runner passes the transaction-scoped Prisma client to work", async () => {
  const prisma = createClient();
  const txClient = createClient();
  prisma.$transaction = async (work, options) => {
    assert.deepEqual(options, { maxWait: 10, timeout: 20 });
    return work(txClient);
  };
  const tenants = new PrismaTenantRepository(prisma);

  const result = await tenants.runInTransaction(
    { tenantId: "tenant-a", correlation: { correlationId: "corr-1" } },
    async (transaction) => transaction.prisma === txClient,
    { maxWaitMs: 10, timeoutMs: 20 }
  );

  assert.equal(result, true);
});

test("factory wires all repository interfaces", () => {
  const repositories = createPrismaRepositories(createClient());

  assert.deepEqual(Object.keys(repositories).sort(), [
    "approvals", "auditLogs", "billing", "campaigns", "contacts", "events", "executions", "tenants", "users", "workflows"
  ].sort());
});


test("tenant-scoped contact reads include tenantId and lead events stay contact-scoped", async () => {
  const prisma = createClient();
  const { PrismaContactRepository } = await import("../dist/index.js");
  const contacts = new PrismaContactRepository(prisma);

  await contacts.findById({ tenantId: "tenant-a" }, "contact-1");
  await contacts.listLeadEvents({ tenantId: "tenant-a" }, "contact-1");

  assert.deepEqual(prisma.contact.calls[0].args.where, { tenantId: "tenant-a", id: "contact-1" });
  assert.deepEqual(prisma.leadEvent.calls[0].args.where, { tenantId: "tenant-a", contactId: "contact-1" });
});

test("contact bulk import repository methods are tenant-scoped", async () => {
  const prisma = createClient();
  prisma.contact.findMany = async (args) => {
    prisma.contact.calls.push({ name: "contact", method: "findMany", args });
    return [{ id: "contact-1", tenantId: "tenant-a", email: "existing@example.com", stage: "PROSPECT", createdAt: now, updatedAt: now }];
  };
  const { PrismaContactRepository } = await import("../dist/index.js");
  const contacts = new PrismaContactRepository(prisma);

  await contacts.createMany({ tenantId: "tenant-a" }, [{ tenantId: "tenant-a", email: "new@example.com", stage: "QUALIFIED" }]);
  await contacts.count({ tenantId: "tenant-a" });
  await contacts.findByEmails({ tenantId: "tenant-a" }, ["existing@example.com"]);

  assert.deepEqual(prisma.contact.calls[0].args.data, [{ tenantId: "tenant-a", email: "new@example.com", stage: "QUALIFIED" }]);
  assert.deepEqual(prisma.contact.calls[1].args.where, { tenantId: "tenant-a" });
  assert.deepEqual(prisma.contact.calls[2].args.where, { tenantId: "tenant-a", email: { in: ["existing@example.com"] } });
});
