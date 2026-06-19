import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schemaPath = new URL("../../../prisma/schema.prisma", import.meta.url);

const requiredModels = [
  "AuditLog",
  "WorkflowExecution",
  "WorkflowStepExecution",
  "AiExecution",
  "EventIngestion",
  "IdempotencyKey",
  "VectorDocument",
  "ExecutionTrace",
  "ExecutionTraceSpan",
  "QueueJob",
  "DeadLetterJob",
  "ScheduledJob",
  "ExecutionLease",
  "DistributedLock",
  "OutboxEvent",
  "InboxEvent"
];

const getModelBlock = (schema, modelName) => {
  const match = schema.match(new RegExp(`model ${modelName} \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `Expected Prisma model ${modelName} to exist`);
  return match[0];
};

test("Prisma persistence foundation is PostgreSQL tenant-scoped and additive", async () => {
  const schema = await readFile(schemaPath, "utf8");

  assert.match(schema, /provider\s+=\s+"postgresql"/);
  assert.match(schema, /no migrations are\n\/\/ generated or executed/);

  for (const modelName of requiredModels) {
    const block = getModelBlock(schema, modelName);
    assert.match(block, /tenantId\s+String\s+.*@db\.Uuid/, `${modelName} must carry tenantId`);
    assert.match(block, /@@unique\(\[tenantId, id\]\)/, `${modelName} must have tenant-scoped identity`);
    assert.match(block, /@@index\(\[tenantId/, `${modelName} must expose tenant-scoped indexes`);
  }
});

test("Prisma schema includes future-compatible execution and messaging primitives", async () => {
  const schema = await readFile(schemaPath, "utf8");

  assert.match(getModelBlock(schema, "VectorDocument"), /embeddingDimension\s+Int\?/);
  assert.match(getModelBlock(schema, "ExecutionLease"), /fencingToken\s+BigInt/);
  assert.match(getModelBlock(schema, "DistributedLock"), /fencingToken\s+BigInt/);
  assert.match(getModelBlock(schema, "OutboxEvent"), /@@unique\(\[tenantId, idempotencyKey\]\)/);
  assert.match(getModelBlock(schema, "InboxEvent"), /@@unique\(\[tenantId, source, messageId\]\)/);
  assert.match(getModelBlock(schema, "QueueJob"), /@@unique\(\[tenantId, queueName, jobKey\]\)/);
  assert.match(getModelBlock(schema, "ScheduledJob"), /cron\s+String\?/);
});

test("MarketplaceCapture enforces tenant-scoped listing URL uniqueness", async () => {
  const schema = await readFile(schemaPath, "utf8");
  const block = getModelBlock(schema, "MarketplaceCapture");

  assert.match(block, /@@unique\(\[tenantId, id\]\)/);
  assert.match(block, /@@unique\(\[tenantId, marketplaceSourceId, externalId\]\)/);
  assert.match(block, /@@unique\(\[tenantId, listingUrl\]\)/);
});
