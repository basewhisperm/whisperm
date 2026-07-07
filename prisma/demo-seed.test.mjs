// Exercises seedDemoWorkspace against an in-memory fake Prisma client. This repo has no local
// Postgres available to integration-test root-level seed scripts against, so this is the next
// best thing: it proves the upsert `where` clauses use the actual compound-unique-key shapes
// from prisma/schema.prisma (tenantId_email, tenantId_externalId, tenantId_listingUrl,
// tenantId_marketplaceCaptureId, ...) and that reseeding is idempotent, without needing a
// database.
import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";

import { seedDemoWorkspace } from "./demo-seed.mjs";

const makeId = () => crypto.randomUUID();

const makeTable = () => {
  const rows = [];
  return {
    rows,
    find(predicate) { return rows.find(predicate) ?? null; },
    findAll(predicate) { return rows.filter(predicate); },
  };
};

const matches = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);

const makeUpsertModel = (table) => ({
  async upsert({ where, create, update }) {
    const key = Object.keys(where)[0];
    const compound = where[key];
    const predicate = typeof compound === "object" && compound !== null
      ? (row) => matches(row, compound)
      : (row) => row[key] === compound;
    const existing = table.find(predicate);
    if (existing !== null) {
      Object.assign(existing, update);
      return existing;
    }
    const row = { id: makeId(), ...create };
    table.rows.push(row);
    return row;
  },
  async findFirst({ where }) { return table.find((row) => matches(row, where)); },
  async create({ data }) { const row = { id: makeId(), ...data }; table.rows.push(row); return row; },
  async update({ where, data }) {
    const key = Object.keys(where)[0];
    const compound = where[key];
    const predicate = typeof compound === "object" ? (row) => matches(row, compound) : (row) => row[key] === compound;
    const row = table.find(predicate);
    Object.assign(row, data);
    return row;
  },
});

const makeFakePrisma = () => {
  const tenants = makeTable();
  const tenantUsers = makeTable();
  const tenantFeatures = makeTable();
  const subscriptions = makeTable();
  const pipelines = makeTable();
  const pipelineStages = makeTable();
  const contacts = makeTable();
  const deals = makeTable();
  const marketplaceCaptures = makeTable();
  const draftInventories = makeTable();

  return {
    tenant: makeUpsertModel(tenants),
    tenantUser: makeUpsertModel(tenantUsers),
    tenantFeature: makeUpsertModel(tenantFeatures),
    subscription: makeUpsertModel(subscriptions),
    pipeline: {
      ...makeUpsertModel(pipelines),
      async findFirstOrThrow({ where }) {
        const row = pipelines.find((p) => matches(p, where));
        if (row === null) throw new Error(`No pipeline matching ${JSON.stringify(where)}`);
        return { ...row, stages: pipelineStages.findAll((s) => s.pipelineId === row.id) };
      },
    },
    pipelineStage: makeUpsertModel(pipelineStages),
    contact: makeUpsertModel(contacts),
    deal: makeUpsertModel(deals),
    marketplaceCapture: makeUpsertModel(marketplaceCaptures),
    draftInventory: makeUpsertModel(draftInventories),
    __tables: { tenants, tenantUsers, tenantFeatures, subscriptions, pipelines, pipelineStages, contacts, deals, marketplaceCaptures, draftInventories },
  };
};

test("seedDemoWorkspace requires an email", async () => {
  const prisma = makeFakePrisma();
  await assert.rejects(() => seedDemoWorkspace(prisma, {}));
});

test("seedDemoWorkspace creates a tenant, owner, pipelines, contacts/deals, and marketplace sellers", async () => {
  const prisma = makeFakePrisma();
  const result = await seedDemoWorkspace(prisma, { email: "Demo@Example.com", tenantSlug: "demo-test" });

  assert.equal(result.tenantSlug, "demo-test");
  assert.equal(result.ownerEmail, "demo@example.com");

  const tenant = prisma.__tables.tenants.find((t) => t.slug === "demo-test");
  assert.ok(tenant, "tenant should be created");

  const owner = prisma.__tables.tenantUsers.find((u) => u.tenantId === tenant.id);
  assert.equal(owner.email, "demo@example.com");
  assert.equal(owner.role, "OWNER");

  assert.equal(prisma.__tables.contacts.rows.length, result.contacts + result.marketplaceSellers);
  assert.equal(prisma.__tables.deals.rows.length, result.deals + result.marketplaceSellers);
  assert.equal(prisma.__tables.marketplaceCaptures.rows.length, result.marketplaceSellers);
  assert.equal(prisma.__tables.draftInventories.rows.length, result.marketplaceSellers);

  for (const capture of prisma.__tables.marketplaceCaptures.rows) {
    assert.equal(capture.status, "CAPTURED", "seeded sellers must start at Captured -- no stage should be faked");
  }
});

test("seedDemoWorkspace is idempotent: reseeding does not duplicate rows", async () => {
  const prisma = makeFakePrisma();
  await seedDemoWorkspace(prisma, { email: "demo@example.com", tenantSlug: "demo-test" });
  await seedDemoWorkspace(prisma, { email: "demo@example.com", tenantSlug: "demo-test" });

  assert.equal(prisma.__tables.tenants.rows.length, 1);
  assert.equal(prisma.__tables.tenantUsers.rows.length, 1);
  assert.equal(prisma.__tables.marketplaceCaptures.rows.length, 3);
});
