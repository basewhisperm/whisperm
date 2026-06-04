import assert from "node:assert/strict";
import test from "node:test";

import {
  PersistenceError,
  PrismaDealsRepository,
  PrismaEventRepository,
  PrismaPipelineRepository,
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
    deleteMany: async (args) => {
      calls.push({ name, method: "deleteMany", args });
      return { count: 1 };
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
    "workflowStepExecution", "eventIngestion", "outboxEvent", "inboxEvent", "idempotencyKey", "aiExecution", "auditLog",
    "pipeline", "pipelineStage", "deal", "activity"
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
    "activities", "approvals", "auditLogs", "billing", "campaigns", "contacts", "deals", "events", "executions", "pipelines", "tenants", "users", "workflows"
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


test("pipeline_seed_creates_one_default_pipeline_per_workspace", async () => {
  const { seedDefaultPipelines } = await import("../../../prisma/pipeline-seed.mjs");
  const prisma = createClient();
  prisma.tenant.findMany = async (args) => {
    prisma.tenant.calls.push({ name: "tenant", method: "findMany", args });
    return [{ id: "tenant-a" }, { id: "tenant-b" }];
  };
  const result = await seedDefaultPipelines(prisma);

  assert.equal(result.pipelines, 2);
  assert.equal(prisma.pipeline.calls.filter((call) => call.method === "upsert").length, 2);
  assert.deepEqual(prisma.pipeline.calls[0].args.where, { tenantId_defaultKey: { tenantId: "tenant-a", defaultKey: "default" } });
  assert.deepEqual(prisma.pipeline.calls[1].args.where, { tenantId_defaultKey: { tenantId: "tenant-b", defaultKey: "default" } });
});

test("pipeline_seed_creates_five_default_stages", async () => {
  const { defaultPipelineStages, seedDefaultPipelines } = await import("../../../prisma/pipeline-seed.mjs");
  const prisma = createClient();
  await seedDefaultPipelines(prisma, { workspaces: [{ id: "tenant-a" }] });

  const upserts = prisma.pipelineStage.calls.filter((call) => call.method === "upsert");
  assert.equal(upserts.length, 5);
  assert.deepEqual(upserts.map((call) => call.args.create.name), ["Prospect", "Qualified", "Proposal", "Engagement", "Renewal"]);
  assert.deepEqual(upserts.map((call) => call.args.create.position), [1, 2, 3, 4, 5]);
  assert.deepEqual(defaultPipelineStages.map((stage) => stage.color), ["#64748B", "#2563EB", "#7C3AED", "#16A34A", "#F59E0B"]);
});

test("pipeline_seed_is_idempotent", async () => {
  const { seedDefaultPipelines } = await import("../../../prisma/pipeline-seed.mjs");
  const prisma = createClient();
  await seedDefaultPipelines(prisma, { workspaces: [{ id: "tenant-a" }] });
  await seedDefaultPipelines(prisma, { workspaces: [{ id: "tenant-a" }] });

  const pipelineUpserts = prisma.pipeline.calls.filter((call) => call.method === "upsert");
  const stageUpserts = prisma.pipelineStage.calls.filter((call) => call.method === "upsert");
  assert.equal(pipelineUpserts.length, 2);
  assert.equal(stageUpserts.length, 10);
  assert.deepEqual(new Set(pipelineUpserts.map((call) => JSON.stringify(call.args.where))).size, 1);
  assert.deepEqual(new Set(stageUpserts.map((call) => JSON.stringify(call.args.where))).size, 5);
});

test("findByWorkspace_is_tenant_scoped", async () => {
  const prisma = createClient();
  prisma.pipeline.findFirst = async (args) => {
    prisma.pipeline.calls.push({ name: "pipeline", method: "findFirst", args });
    return { id: "pipeline-a", tenantId: "tenant-a", name: "Default Pipeline", isDefault: true, defaultKey: "default", createdAt: now, updatedAt: now };
  };
  prisma.pipelineStage.findMany = async (args) => {
    prisma.pipelineStage.calls.push({ name: "pipelineStage", method: "findMany", args });
    return [{ id: "stage-a", tenantId: "tenant-a", pipelineId: "pipeline-a", name: "Prospect", position: 1, color: "#64748B", createdAt: now, updatedAt: now }];
  };
  const pipelines = new PrismaPipelineRepository(prisma);

  const pipeline = await pipelines.findByWorkspace("tenant-a");

  assert.equal(pipeline.id, "pipeline-a");
  assert.deepEqual(prisma.pipeline.calls[0].args.where, { tenantId: "tenant-a", isDefault: true });
  assert.deepEqual(prisma.pipelineStage.calls[0].args.where, { tenantId: "tenant-a", pipelineId: "pipeline-a" });
});

test("updateStages_is_tenant_scoped", async () => {
  const prisma = createClient();
  const txClient = createClient();
  prisma.$transaction = async (work) => work(txClient);
  txClient.pipeline.findFirst = async (args) => {
    txClient.pipeline.calls.push({ name: "pipeline", method: "findFirst", args });
    return { id: "pipeline-a", tenantId: "tenant-a", name: "Default Pipeline", isDefault: true, defaultKey: "default", createdAt: now, updatedAt: now };
  };
  txClient.pipelineStage.findMany = async (args) => {
    txClient.pipelineStage.calls.push({ name: "pipelineStage", method: "findMany", args });
    if (args.orderBy !== undefined) return [{ id: "stage-a", tenantId: "tenant-a", pipelineId: "pipeline-a", name: "Prospect", position: 1, color: "#64748B", createdAt: now, updatedAt: now }];
    return [{ id: "stage-a", tenantId: "tenant-a", pipelineId: "pipeline-a", name: "Prospect", position: 1, color: "#64748B", createdAt: now, updatedAt: now }];
  };
  const pipelines = new PrismaPipelineRepository(prisma);

  await pipelines.updateStages("tenant-a", "pipeline-a", [{ id: "stage-a", name: "Prospect", color: "#64748B" }]);

  assert.deepEqual(txClient.pipeline.calls[0].args.where, { tenantId: "tenant-a", id: "pipeline-a" });
  assert.deepEqual(txClient.pipelineStage.calls.find((call) => call.method === "updateMany").args.where, { tenantId: "tenant-a", pipelineId: "pipeline-a", id: "stage-a" });
});

test("deal_create_is_tenant_scoped", async () => {
  const prisma = createClient();
  prisma.pipelineStage.findFirst = async (args) => {
    prisma.pipelineStage.calls.push({ name: "pipelineStage", method: "findFirst", args });
    return { id: "stage-a", tenantId: "tenant-a", pipelineId: "pipeline-a", name: "Prospect", position: 1, color: "#64748B", createdAt: now, updatedAt: now };
  };
  prisma.contact.findFirst = async (args) => {
    prisma.contact.calls.push({ name: "contact", method: "findFirst", args });
    return { id: "contact-a", tenantId: "tenant-a", email: "lead@example.com", stage: "PROSPECT", createdAt: now, updatedAt: now };
  };
  const deals = new PrismaDealsRepository(prisma);

  await deals.create("tenant-a", { tenantId: "tenant-a", title: "Deal A", contactId: "contact-a", pipelineStageId: "stage-a" });

  assert.deepEqual(prisma.pipelineStage.calls[0].args.where, { tenantId: "tenant-a", id: "stage-a" });
  assert.deepEqual(prisma.contact.calls[0].args.where, { tenantId: "tenant-a", id: "contact-a" });
  assert.deepEqual(prisma.deal.calls[0].args.data, { currency: "USD", tenantId: "tenant-a", title: "Deal A", contactId: "contact-a", pipelineStageId: "stage-a", pipelineId: "pipeline-a" });
});

test("deal_create_rejects_cross_tenant_contact_or_stage", async () => {
  const prisma = createClient();
  const deals = new PrismaDealsRepository(prisma);

  await assert.rejects(
    deals.create("tenant-a", { tenantId: "tenant-a", title: "Deal A", contactId: "contact-b", pipelineStageId: "stage-b" }),
    (error) => error instanceof PersistenceError && error.code === "PERSISTENCE_NOT_FOUND"
  );
  assert.deepEqual(prisma.pipelineStage.calls[0].args.where, { tenantId: "tenant-a", id: "stage-b" });
  assert.equal(prisma.deal.calls.length, 0);
});

test("deal_list_is_tenant_scoped", async () => {
  const prisma = createClient();
  const deals = new PrismaDealsRepository(prisma);

  await deals.list("tenant-a", { pipelineStageId: "stage-a" });

  assert.deepEqual(prisma.deal.calls[0].args.where, { pipelineStageId: "stage-a", tenantId: "tenant-a" });
});

test("deal_updateStage_is_tenant_scoped", async () => {
  const prisma = createClient();
  prisma.pipelineStage.findFirst = async (args) => {
    prisma.pipelineStage.calls.push({ name: "pipelineStage", method: "findFirst", args });
    return { id: "stage-a", tenantId: "tenant-a", pipelineId: "pipeline-a", name: "Qualified", position: 2, color: "#2563EB", createdAt: now, updatedAt: now };
  };
  prisma.deal.findFirst = async (args) => {
    prisma.deal.calls.push({ name: "deal", method: "findFirst", args });
    return { id: "deal-a", tenantId: "tenant-a", title: "Deal A", pipelineId: "pipeline-a", pipelineStageId: "stage-a", currency: "USD", createdAt: now, updatedAt: now };
  };
  const deals = new PrismaDealsRepository(prisma);

  await deals.updateStage("tenant-a", "deal-a", "stage-a");

  assert.deepEqual(prisma.pipelineStage.calls[0].args.where, { tenantId: "tenant-a", id: "stage-a" });
  assert.deepEqual(prisma.deal.calls[0].args.where, { tenantId: "tenant-a", id: "deal-a" });
  assert.deepEqual(prisma.deal.calls[0].args.data, { pipelineId: "pipeline-a", pipelineStageId: "stage-a" });
});

test("deal_findByContact_is_tenant_scoped", async () => {
  const prisma = createClient();
  prisma.contact.findFirst = async (args) => {
    prisma.contact.calls.push({ name: "contact", method: "findFirst", args });
    return { id: "contact-a", tenantId: "tenant-a", email: "lead@example.com", stage: "PROSPECT", createdAt: now, updatedAt: now };
  };
  const deals = new PrismaDealsRepository(prisma);

  await deals.findByContact("tenant-a", "contact-a");

  assert.deepEqual(prisma.contact.calls[0].args.where, { tenantId: "tenant-a", id: "contact-a" });
  assert.deepEqual(prisma.deal.calls[0].args.where, { tenantId: "tenant-a", contactId: "contact-a" });
});

test("board query returns tenant-scoped columns with paginated deal cards", async () => {
  const prisma = createClient();
  prisma.pipeline.findFirst = async (args) => {
    prisma.pipeline.calls.push({ name: "pipeline", method: "findFirst", args });
    return { id: "pipeline-a", tenantId: "tenant-a", name: "Sales", isDefault: true, defaultKey: "default", createdAt: now, updatedAt: now };
  };
  prisma.pipelineStage.findMany = async (args) => {
    prisma.pipelineStage.calls.push({ name: "pipelineStage", method: "findMany", args });
    return [{ id: "stage-a", tenantId: "tenant-a", pipelineId: "pipeline-a", name: "Prospect", position: 1, color: "#64748B", createdAt: now, updatedAt: now }];
  };
  prisma.deal.findMany = async (args) => {
    prisma.deal.calls.push({ name: "deal", method: "findMany", args });
    return Array.from({ length: 26 }, (_, index) => ({ id: `deal-${String(index).padStart(2, "0")}`, tenantId: "tenant-a", pipelineId: "pipeline-a", pipelineStageId: "stage-a", contactId: "contact-1", ownerId: "owner-1", title: `Deal ${index}`, value: "100.00", currency: "USD", probability: 50, createdAt: now, updatedAt: now }));
  };
  prisma.contact.findMany = async (args) => {
    prisma.contact.calls.push({ name: "contact", method: "findMany", args });
    return [{ id: "contact-1", tenantId: "tenant-a", firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", phone: null, company: "Analytical", createdAt: now, updatedAt: now }];
  };
  prisma.tenantUser.findMany = async (args) => {
    prisma.tenantUser.calls.push({ name: "tenantUser", method: "findMany", args });
    return [{ id: "owner-1", tenantId: "tenant-a", email: "owner@example.com", displayName: "Owner One", role: "MEMBER", isActive: true, createdAt: now, updatedAt: now }];
  };
  const deals = new PrismaDealsRepository(prisma);

  const board = await deals.findBoardByPipeline("tenant-a", "pipeline-a", { limit: 25 });

  assert.equal(board.columns[0].deals.items.length, 25);
  assert.equal(board.columns[0].deals.nextCursor, "deal-24");
  assert.equal(board.columns[0].deals.items[0].contactName, "Ada Lovelace");
  assert.deepEqual(prisma.pipeline.calls[0].args.where, { tenantId: "tenant-a", id: "pipeline-a" });
  assert.deepEqual(prisma.deal.calls[0].args.where, { tenantId: "tenant-a", pipelineId: "pipeline-a", pipelineStageId: "stage-a" });
  assert.equal(prisma.contact.calls.length, 1);
  assert.equal(prisma.tenantUser.calls.length, 1);
});

test("stage move uses tenant scoped optimistic lock and rejects stale updates", async () => {
  const prisma = createClient();
  prisma.deal.findFirst = async (args) => {
    prisma.deal.calls.push({ name: "deal", method: "findFirst", args });
    return { id: "deal-1", tenantId: "tenant-a", pipelineId: "pipeline-a", pipelineStageId: "stage-old", title: "Deal", value: "100", currency: "USD", createdAt: now, updatedAt: now };
  };
  prisma.pipelineStage.findFirst = async (args) => {
    prisma.pipelineStage.calls.push({ name: "pipelineStage", method: "findFirst", args });
    return { id: "stage-new", tenantId: "tenant-a", pipelineId: "pipeline-a", name: "Qualified", position: 2, color: "#2563EB", createdAt: now, updatedAt: now };
  };
  prisma.deal.updateMany = async (args) => {
    prisma.deal.calls.push({ name: "deal", method: "updateMany", args });
    return { count: 0 };
  };
  const deals = new PrismaDealsRepository(prisma);

  await assert.rejects(
    deals.updateStageWithOptimisticLock("tenant-a", "deal-1", "stage-new", now),
    (error) => error instanceof PersistenceError && error.status === 409
  );
  assert.deepEqual(prisma.deal.calls.find((call) => call.method === "updateMany").args.where, { tenantId: "tenant-a", id: "deal-1", updatedAt: new Date(now) });
});

test("activity create is tenant-scoped transactional and writes contact touch audit and outbox", async () => {
  const prisma = createClient();
  const txClient = createClient();
  let transactionUsed = false;
  prisma.$transaction = async (work) => {
    transactionUsed = true;
    return work(txClient);
  };
  txClient.deal.findFirst = async (args) => {
    txClient.deal.calls.push({ name: "deal", method: "findFirst", args });
    return { id: "deal-1", tenantId: "tenant-a", title: "Deal", pipelineId: "pipeline-a", pipelineStageId: "stage-a", currency: "USD", createdAt: now, updatedAt: now };
  };
  const { activities } = createPrismaRepositories(prisma);

  const activity = await activities.create(
    { tenantId: "tenant-a", actorId: "user-1", correlation: { correlationId: "corr-1", requestId: "req-1" } },
    { tenantId: "tenant-a", contactId: "contact-1", dealId: "deal-1", createdById: "body-user", type: "NOTE", note: "Followed up" }
  );

  assert.equal(transactionUsed, true);
  assert.equal(activity.createdById, "user-1");
  assert.deepEqual(txClient.contact.calls[0].args.where, { tenantId: "tenant-a", id: "contact-1" });
  assert.equal(txClient.contact.calls[0].args.data.lastTouchAt instanceof Date, true);
  assert.equal(txClient.auditLog.calls[0].args.data.action, "ACTIVITY_CREATED");
  assert.equal(txClient.auditLog.calls[0].args.data.actorId, "user-1");
  assert.equal(txClient.outboxEvent.calls[0].args.data.eventType, "activity.created");
  assert.equal(txClient.outboxEvent.calls[0].args.data.payload.activityId, activity.id);
});

test("activity list applies tenant scope and supported filters newest first", async () => {
  const prisma = createClient();
  const { activities } = createPrismaRepositories(prisma);

  await activities.list({ tenantId: "tenant-a" }, { contactId: "contact-1", dealId: "deal-1", type: "EMAIL", createdById: "user-1", from: now, to: now }, { limit: 25 });

  assert.deepEqual(prisma.activity.calls[0].args.where, {
    tenantId: "tenant-a",
    contactId: "contact-1",
    dealId: "deal-1",
    type: "EMAIL",
    createdById: "user-1",
    createdAt: { gte: new Date(now), lte: new Date(now) }
  });
  assert.deepEqual(prisma.activity.calls[0].args.orderBy, { createdAt: "desc" });
});
