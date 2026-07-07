import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

// Distinguishes "has any valid access" (createRequireActiveSubscription in
// @whisperm/billing-runtime, which allows TRIALING too) from "has specifically upgraded to a
// paid plan" -- automated acquisition (campaigns/discovery/bulk-invite) requires the latter.
// Manual capture is the free/trial-tier path and is gated separately (see
// require-manual-capture-quota.test.js), not by this.

const transpileModule = (sourcePath, tempDir, replacements) => {
  let source = readFileSync(sourcePath, "utf8");
  for (const [specifier, file] of Object.entries(replacements)) {
    source = source.replaceAll(`from "${specifier}"`, `from "${join(tempDir, file)}"`);
  }
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const outFile = join(tempDir, "require-paid-plan.mjs");
  writeFileSync(outFile, output);
  return import(outFile);
};

const createHarness = async (subscriptions) => {
  const tempDir = join(tmpdir(), `whisperm-require-paid-plan-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempDir);

  writeFileSync(join(tempDir, "next-server.mjs"), "export class NextResponse extends Response { static json(body, init) { return Response.json(body, init); } }\n");
  writeFileSync(join(tempDir, "prisma.mjs"), [
    "export const prisma = {",
    "  subscription: {",
    "    async findFirst({ where }) {",
    `      const subs = ${JSON.stringify(subscriptions)};`,
    "      return subs.find((s) => s.tenantId === where.tenantId && s.status === where.status) ?? null;",
    "    },",
    "  },",
    "};",
  ].join("\n"));

  const source = new URL("../src/lib/billing/require-paid-plan.ts", import.meta.url).pathname;
  const module = await transpileModule(source, tempDir, {
    "next/server": "next-server.mjs",
    "@/lib/prisma": "prisma.mjs",
  });

  return { module, cleanup: () => rmSync(tempDir, { recursive: true, force: true }) };
};

test("an ACTIVE (paid) subscription passes -- automated acquisition is allowed", async () => {
  const harness = await createHarness([{ tenantId: "tenant-1", status: "ACTIVE" }]);
  try {
    const result = await harness.module.requireActivePlanForApi("tenant-1");
    assert.equal(result, null);
  } finally {
    harness.cleanup();
  }
});

test("a TRIALING (unexpired trial, but not paid) subscription is blocked from automated acquisition", async () => {
  const harness = await createHarness([{ tenantId: "tenant-1", status: "TRIALING" }]);
  try {
    const result = await harness.module.requireActivePlanForApi("tenant-1");
    assert.notEqual(result, null);
    assert.equal(result.status, 402);
    const body = await result.json();
    assert.equal(body.error.code, "PAID_PLAN_REQUIRED");
  } finally {
    harness.cleanup();
  }
});

test("no subscription at all is blocked", async () => {
  const harness = await createHarness([]);
  try {
    const result = await harness.module.requireActivePlanForApi("tenant-1");
    assert.notEqual(result, null);
    assert.equal(result.status, 402);
  } finally {
    harness.cleanup();
  }
});

test("an ACTIVE subscription on a different tenant does not grant access", async () => {
  const harness = await createHarness([{ tenantId: "tenant-other", status: "ACTIVE" }]);
  try {
    const result = await harness.module.requireActivePlanForApi("tenant-1");
    assert.notEqual(result, null);
  } finally {
    harness.cleanup();
  }
});
