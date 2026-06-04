import assert from "node:assert/strict";
import test from "node:test";

import {
  countryCurrencyByCountry,
  foundingWorkspaces,
  seedFoundingWorkspaces,
} from "../../../prisma/founding-workspaces-seed.mjs";
import { defaultPipelineStages } from "../../../prisma/pipeline-seed.mjs";

const now = new Date("2026-06-04T00:00:00.000Z");

const createDatabase = () => ({
  tenants: [],
  tenantUsers: [],
  pipelines: [],
  pipelineStages: [],
  subscriptions: [],
  contacts: [],
});

const nextId = (name, rows) => `${name}-${rows.length + 1}`;

const createFoundingSeedClient = (database = createDatabase()) => ({
  tenant: {
    upsert: async ({ where, create, update }) => {
      const existing = database.tenants.find((row) => row.slug === where.slug);
      if (existing !== undefined) {
        Object.assign(existing, update, { updatedAt: now });
        return existing;
      }
      const row = { id: nextId("tenant", database.tenants), createdAt: now, updatedAt: now, ...create };
      database.tenants.push(row);
      return row;
    },
  },
  tenantUser: {
    upsert: async ({ where, create, update }) => {
      const key = where.tenantId_email;
      const existing = database.tenantUsers.find((row) => row.tenantId === key.tenantId && row.email === key.email);
      if (existing !== undefined) {
        Object.assign(existing, update, { updatedAt: now });
        return existing;
      }
      const row = { id: nextId("tenant-user", database.tenantUsers), externalUserId: null, createdAt: now, updatedAt: now, ...create };
      database.tenantUsers.push(row);
      return row;
    },
  },
  pipeline: {
    upsert: async ({ where, create, update }) => {
      const key = where.tenantId_defaultKey;
      const existing = database.pipelines.find((row) => row.tenantId === key.tenantId && row.defaultKey === key.defaultKey);
      if (existing !== undefined) {
        Object.assign(existing, update, { updatedAt: now });
        return existing;
      }
      const row = { id: nextId("pipeline", database.pipelines), createdAt: now, updatedAt: now, ...create };
      database.pipelines.push(row);
      return row;
    },
  },
  pipelineStage: {
    upsert: async ({ where, create, update }) => {
      const key = where.tenantId_pipelineId_name;
      const existing = database.pipelineStages.find((row) => row.tenantId === key.tenantId && row.pipelineId === key.pipelineId && row.name === key.name);
      if (existing !== undefined) {
        Object.assign(existing, update, { updatedAt: now });
        return existing;
      }
      const row = { id: nextId("pipeline-stage", database.pipelineStages), createdAt: now, updatedAt: now, ...create };
      database.pipelineStages.push(row);
      return row;
    },
  },
  subscription: {
    findFirst: async ({ where }) => database.subscriptions.find((row) => row.tenantId === where.tenantId) ?? null,
    update: async ({ where, data }) => {
      const key = where.tenantId_id;
      const existing = database.subscriptions.find((row) => row.tenantId === key.tenantId && row.id === key.id);
      assert.notEqual(existing, undefined, "subscription update must target an existing tenant-scoped row");
      Object.assign(existing, data, { updatedAt: now });
      return existing;
    },
    create: async ({ data }) => {
      const row = { id: nextId("subscription", database.subscriptions), createdAt: now, updatedAt: now, ...data };
      database.subscriptions.push(row);
      return row;
    },
  },
  contact: {
    create: async ({ data }) => {
      assert.ok(database.tenants.some((tenant) => tenant.id === data.tenantId), "contact tenant relation must exist");
      const row = { id: nextId("contact", database.contacts), stage: "PROSPECT", createdAt: now, updatedAt: now, ...data };
      database.contacts.push(row);
      return row;
    },
  },
  $transaction: async (work) => work(createFoundingSeedClient(database)),
  database,
});

const seedOptions = {
  logger: false,
  now: () => now,
  env: {
    FOUNDING_RENDER_OWNER_EMAIL: "render-owner@example.com",
    FOUNDING_SKILLPOST_OWNER_EMAIL: "skillpost-owner@example.com",
    FOUNDING_TRUSTLAYER_OWNER_EMAIL: "trustlayer-owner@example.com",
    FOUNDING_US_FIRM_OWNER_EMAIL: "us-firm-owner@example.com",
  },
};

const seed = async () => {
  const prisma = createFoundingSeedClient();
  const result = await seedFoundingWorkspaces(prisma, seedOptions);
  return { prisma, result };
};

test("founding workspace seed first run creates all four workspaces", async () => {
  const { prisma, result } = await seed();

  assert.deepEqual(result, { workspaces: 4, tenants: 4, owners: 4, pipelines: 4, stages: 20, subscriptions: 4 });
  assert.deepEqual(prisma.database.tenants.map((tenant) => tenant.name), ["Render", "Skillpost", "TrustLayer", "US Firm"]);
});

test("founding workspace seed re-run creates no duplicates", async () => {
  const { prisma } = await seed();
  await seedFoundingWorkspaces(prisma, seedOptions);

  assert.equal(prisma.database.tenants.length, 4);
  assert.equal(prisma.database.tenantUsers.length, 4);
  assert.equal(prisma.database.subscriptions.length, 4);
  assert.equal(prisma.database.pipelines.length, 4);
  assert.equal(prisma.database.pipelineStages.length, 20);
});

test("each founding workspace receives one active owner user", async () => {
  const { prisma } = await seed();

  for (const tenant of prisma.database.tenants) {
    const owners = prisma.database.tenantUsers.filter((user) => user.tenantId === tenant.id && user.role === "OWNER" && user.isActive === true);
    assert.equal(owners.length, 1, `${tenant.name} should have one owner`);
  }
});

test("each founding workspace receives one subscription with mapped currency and expected plan", async () => {
  const { prisma } = await seed();

  for (const workspace of foundingWorkspaces) {
    const tenant = prisma.database.tenants.find((row) => row.slug === workspace.slug);
    const subscriptions = prisma.database.subscriptions.filter((subscription) => subscription.tenantId === tenant.id);
    assert.equal(subscriptions.length, 1);
    assert.equal(subscriptions[0].plan, workspace.plan);
    assert.equal(subscriptions[0].currency, countryCurrencyByCountry[workspace.country]);
  }
});

test("each founding workspace receives a default pipeline and five default stages", async () => {
  const { prisma } = await seed();

  for (const tenant of prisma.database.tenants) {
    const pipeline = prisma.database.pipelines.find((row) => row.tenantId === tenant.id && row.defaultKey === "default");
    assert.notEqual(pipeline, undefined, `${tenant.name} should have a default pipeline`);
    const stages = prisma.database.pipelineStages.filter((row) => row.tenantId === tenant.id && row.pipelineId === pipeline.id);
    assert.deepEqual(stages.map((stage) => stage.name), defaultPipelineStages.map((stage) => stage.name));
    assert.equal(stages.length, 5);
  }
});

test("founding workspace currency conventions map GH to GHS and US to USD", () => {
  assert.equal(countryCurrencyByCountry.GH, "GHS");
  assert.equal(countryCurrencyByCountry.US, "USD");
});

test("seeded founding workspace can create contacts immediately through existing tenant relations", async () => {
  const { prisma } = await seed();
  const renderTenant = prisma.database.tenants.find((tenant) => tenant.slug === "render");

  const contact = await prisma.contact.create({
    data: {
      tenantId: renderTenant.id,
      email: "lead@example.com",
      firstName: "Lead",
      lastName: "One",
    },
  });

  assert.equal(contact.tenantId, renderTenant.id);
  assert.equal(contact.stage, "PROSPECT");
});
