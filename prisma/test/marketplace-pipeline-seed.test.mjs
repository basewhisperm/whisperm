import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultPipelineStages,
  marketplaceAcquisitionPipelineDefaultKey,
  marketplaceAcquisitionPipelineName,
  marketplaceAcquisitionPipelineStages,
  seedDefaultPipelines,
  seedMarketplaceAcquisitionPipeline,
  seedPipelines,
} from "../pipeline-seed.mjs";

const now = new Date("2026-06-11T00:00:00.000Z");

const createDatabase = () => ({
  tenants: [
    { id: "tenant-1", tenantId: "tenant-1", name: "Tenant One", createdAt: now, updatedAt: now },
  ],
  pipelines: [],
  pipelineStages: [],
});

const nextId = (name, rows) => `${name}-${rows.length + 1}`;

const createPipelineSeedClient = (database = createDatabase()) => ({
  tenant: {
    findMany: async () => [...database.tenants].sort((left, right) => left.id.localeCompare(right.id)),
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
      const existing = database.pipelineStages.find((row) => (
        row.tenantId === key.tenantId
          && row.pipelineId === key.pipelineId
          && row.name === key.name
      ));
      if (existing !== undefined) {
        Object.assign(existing, update, { updatedAt: now });
        return existing;
      }
      const row = { id: nextId("pipeline-stage", database.pipelineStages), createdAt: now, updatedAt: now, ...create };
      database.pipelineStages.push(row);
      return row;
    },
  },
  database,
});

test("marketplace acquisition seed creates one tenant-scoped pipeline with six ordered lifecycle stages", async () => {
  const prisma = createPipelineSeedClient();

  const result = await seedMarketplaceAcquisitionPipeline(prisma);

  assert.deepEqual(result, { workspaces: 1, pipelines: 1, stages: 6 });
  const pipeline = prisma.database.pipelines.find((row) => row.defaultKey === marketplaceAcquisitionPipelineDefaultKey);
  assert.notEqual(pipeline, undefined);
  assert.equal(pipeline.name, marketplaceAcquisitionPipelineName);
  assert.equal(pipeline.isDefault, false);
  assert.equal(pipeline.tenantId, "tenant-1");

  const stages = prisma.database.pipelineStages.filter((row) => row.pipelineId === pipeline.id);
  assert.deepEqual(stages.map((stage) => stage.name), marketplaceAcquisitionPipelineStages.map((stage) => stage.name));
  assert.deepEqual(stages.map((stage) => stage.position), [1, 2, 3, 4, 5, 6]);
});

test("marketplace acquisition seed is idempotent for pipelines and stages", async () => {
  const prisma = createPipelineSeedClient();

  await seedMarketplaceAcquisitionPipeline(prisma);
  await seedMarketplaceAcquisitionPipeline(prisma);

  assert.equal(prisma.database.pipelines.length, 1);
  assert.equal(prisma.database.pipelineStages.length, 6);
});

test("combined pipeline seed preserves existing default pipeline stages", async () => {
  const prisma = createPipelineSeedClient();

  const result = await seedPipelines(prisma);

  assert.deepEqual(result, { workspaces: 1, pipelines: 2, stages: 11 });
  const defaultPipeline = prisma.database.pipelines.find((row) => row.defaultKey === "default");
  assert.notEqual(defaultPipeline, undefined);
  assert.equal(defaultPipeline.name, "Default Pipeline");
  assert.equal(defaultPipeline.isDefault, true);

  const defaultStages = prisma.database.pipelineStages.filter((row) => row.pipelineId === defaultPipeline.id);
  assert.deepEqual(defaultStages.map((stage) => stage.name), defaultPipelineStages.map((stage) => stage.name));
  assert.deepEqual(defaultStages.map((stage) => stage.position), [1, 2, 3, 4, 5]);
});

test("default pipeline seed behavior remains unchanged when called directly", async () => {
  const prisma = createPipelineSeedClient();

  const result = await seedDefaultPipelines(prisma);

  assert.deepEqual(result, { workspaces: 1, pipelines: 1, stages: 5 });
  assert.equal(prisma.database.pipelines.length, 1);
  assert.equal(prisma.database.pipelineStages.length, 5);
  assert.deepEqual(prisma.database.pipelineStages.map((stage) => stage.name), defaultPipelineStages.map((stage) => stage.name));
});
