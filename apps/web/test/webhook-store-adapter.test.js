import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

// applySubscriptionChange is the fix for a real bug: the previous webhook handler reserved an
// idempotency key, then upserted the subscription, then published an outbox event as three
// separate non-transactional steps. If the upsert (or anything after the reserve) threw, a
// retry from Stripe/Paystack would see "duplicate" and return 200 without the subscription
// change ever having been applied -- permanent, silent loss of a billing state transition. This
// proves the fixed version does the dedup-marker-insert and the subscription write in one
// transaction, so a failure anywhere rolls back the whole thing and a retry can actually succeed.

const transpileModule = (sourcePath, tempDir, replacements) => {
  let source = readFileSync(sourcePath, "utf8");
  for (const [specifier, file] of Object.entries(replacements)) {
    source = source.replaceAll(`from "${specifier}"`, `from "${join(tempDir, file)}"`);
  }
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const outFile = join(tempDir, "webhook-store-adapter.mjs");
  writeFileSync(outFile, output);
  return import(outFile);
};

// Written once to a fixed path so every per-test tempDir's "@prisma/client" mock re-exports the
// *same* class object -- required for `error instanceof Prisma.PrismaClientKnownRequestError`
// inside the real adapter code to actually match errors constructed here in the test.
const sharedPrismaClientMock = join(tmpdir(), "whisperm-webhook-store-prisma-client-mock.mjs");
writeFileSync(sharedPrismaClientMock, [
  "export class PrismaClientKnownRequestError extends Error {",
  "  constructor(message, { code }) { super(message); this.code = code; }",
  "}",
  "export const Prisma = { PrismaClientKnownRequestError, InputJsonValue: undefined };",
].join("\n"));
const { Prisma: MockPrisma } = await import(sharedPrismaClientMock);

const createHarness = async (state) => {
  const tempDir = join(tmpdir(), `whisperm-webhook-store-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempDir);

  writeFileSync(join(tempDir, "prisma-client.mjs"), `export * from "${sharedPrismaClientMock}";\n`);

  writeFileSync(join(tempDir, "prisma.mjs"), [
    "export const prisma = {",
    "  async $transaction(work) {",
    "    const tx = globalThis.__webhookStoreState.tx;",
    "    return work(tx);",
    "  },",
    "};",
  ].join("\n"));

  globalThis.__webhookStoreState = state;
  const source = new URL("../src/lib/billing/webhook-store-adapter.ts", import.meta.url).pathname;
  const module = await transpileModule(source, tempDir, {
    "@prisma/client": "prisma-client.mjs",
    "@/lib/prisma": "prisma.mjs",
  });

  return { module, cleanup: () => { delete globalThis.__webhookStoreState; rmSync(tempDir, { recursive: true, force: true }); } };
};

const baseSnapshot = {
  tenantId: "tenant-1",
  provider: "STRIPE",
  providerCustomerId: "cus_123",
  providerSubscriptionId: "sub_123",
  status: "ACTIVE",
  cancelAtPeriodEnd: false,
  metadata: { plan: "GROWTH" },
};

const makeState = () => {
  const events = [];
  const subscriptions = [];
  const tx = {
    billingWebhookEvent: {
      async create({ data }) {
        if (events.some((e) => e.tenantId === data.tenantId && e.provider === data.provider && e.providerEventId === data.providerEventId)) {
          throw new MockPrisma.PrismaClientKnownRequestError("unique constraint", { code: "P2002" });
        }
        events.push(data);
        return data;
      },
    },
    subscription: {
      async findFirst({ where }) {
        return subscriptions.find((s) => s.tenantId === where.tenantId && s[Object.keys(where).find((k) => k !== "tenantId")] === where[Object.keys(where).find((k) => k !== "tenantId")]) ?? null;
      },
      async create({ data }) {
        const row = { id: `sub-${subscriptions.length + 1}`, ...data };
        subscriptions.push(row);
        return row;
      },
      async update({ where, data }) {
        const row = subscriptions.find((s) => s.tenantId === where.tenantId_id.tenantId && s.id === where.tenantId_id.id);
        Object.assign(row, data);
        return row;
      },
    },
  };
  return { tx, events, subscriptions };
};

test("first delivery of an event creates the dedup marker and the subscription atomically", async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    const outcome = await harness.module.webhookStoreAdapter.applySubscriptionChange({
      tenantId: "tenant-1", provider: "STRIPE", providerEventId: "evt_1", eventType: "customer.subscription.created", snapshot: baseSnapshot,
    });

    assert.equal(outcome, "applied");
    assert.equal(state.events.length, 1);
    assert.equal(state.subscriptions.length, 1);
    assert.equal(state.subscriptions[0].status, "ACTIVE");
    assert.equal(state.subscriptions[0].plan, "GROWTH");
    assert.equal(state.subscriptions[0].stripeCustomerId, "cus_123");
  } finally {
    harness.cleanup();
  }
});

test("a retried event (dedup marker already exists) is reported as duplicate and never touches the subscription", async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    await harness.module.webhookStoreAdapter.applySubscriptionChange({
      tenantId: "tenant-1", provider: "STRIPE", providerEventId: "evt_1", eventType: "customer.subscription.created", snapshot: baseSnapshot,
    });
    const second = await harness.module.webhookStoreAdapter.applySubscriptionChange({
      tenantId: "tenant-1", provider: "STRIPE", providerEventId: "evt_1", eventType: "customer.subscription.created", snapshot: { ...baseSnapshot, status: "CANCELED" },
    });

    assert.equal(second, "duplicate");
    assert.equal(state.subscriptions.length, 1);
    assert.equal(state.subscriptions[0].status, "ACTIVE", "the duplicate delivery must never mutate the already-applied state");
  } finally {
    harness.cleanup();
  }
});

test("a second, different event for the same customer updates the existing subscription instead of creating a new one", async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    await harness.module.webhookStoreAdapter.applySubscriptionChange({
      tenantId: "tenant-1", provider: "STRIPE", providerEventId: "evt_1", eventType: "customer.subscription.created", snapshot: baseSnapshot,
    });
    await harness.module.webhookStoreAdapter.applySubscriptionChange({
      tenantId: "tenant-1", provider: "STRIPE", providerEventId: "evt_2", eventType: "customer.subscription.updated", snapshot: { ...baseSnapshot, status: "PAST_DUE" },
    });

    assert.equal(state.subscriptions.length, 1, "must update the existing row, not create a second one");
    assert.equal(state.subscriptions[0].status, "PAST_DUE");
  } finally {
    harness.cleanup();
  }
});

test("Stripe INCOMPLETE/INCOMPLETE_EXPIRED statuses (no equivalent in the persisted enum) map to PAST_DUE", async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    await harness.module.webhookStoreAdapter.applySubscriptionChange({
      tenantId: "tenant-1", provider: "STRIPE", providerEventId: "evt_1", eventType: "customer.subscription.updated", snapshot: { ...baseSnapshot, status: "INCOMPLETE" },
    });
    assert.equal(state.subscriptions[0].status, "PAST_DUE");
  } finally {
    harness.cleanup();
  }
});
