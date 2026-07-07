import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

const transpileModule = (sourcePath, tempDir, replacements) => {
  let source = readFileSync(sourcePath, "utf8");
  for (const [specifier, file] of Object.entries(replacements)) {
    source = source.replaceAll(`from "${specifier}"`, `from "${join(tempDir, file)}"`);
  }
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const outFile = join(tempDir, "require-manual-capture-quota.mjs");
  writeFileSync(outFile, output);
  return import(outFile);
};

const createHarness = async ({ subscription, captureCount }) => {
  const tempDir = join(tmpdir(), `whisperm-manual-capture-quota-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempDir);

  writeFileSync(join(tempDir, "next-server.mjs"), "export class NextResponse extends Response { static json(body, init) { return Response.json(body, init); } }\n");
  writeFileSync(join(tempDir, "prisma.mjs"), [
    "export const prisma = {",
    `  subscription: { async findFirst() { return ${JSON.stringify(subscription)}; } },`,
    `  marketplaceCapture: { async count() { return ${JSON.stringify(captureCount)}; } },`,
    "};",
  ].join("\n"));

  const source = new URL("../src/lib/billing/require-manual-capture-quota.ts", import.meta.url).pathname;
  const module = await transpileModule(source, tempDir, {
    "next/server": "next-server.mjs",
    "@/lib/prisma": "prisma.mjs",
  });

  return { module, cleanup: () => rmSync(tempDir, { recursive: true, force: true }) };
};

test("an ACTIVE subscription has no manual capture cap", async () => {
  const harness = await createHarness({ subscription: { status: "ACTIVE" }, captureCount: 999 });
  try {
    const result = await harness.module.requireManualCaptureQuota("tenant-1");
    assert.equal(result, null);
  } finally {
    harness.cleanup();
  }
});

test("no subscription at all is not this gate's concern (falls through, caught elsewhere)", async () => {
  const harness = await createHarness({ subscription: null, captureCount: 999 });
  try {
    const result = await harness.module.requireManualCaptureQuota("tenant-1");
    assert.equal(result, null);
  } finally {
    harness.cleanup();
  }
});

// Mirrors MANUAL_CAPTURE_TRIAL_LIMIT in the module under test; kept as a literal here (not
// imported) so this test independently locks in the intended limit value.
const TRIAL_LIMIT = 10;

test("a TRIALING workspace under the limit is allowed to capture", async () => {
  const harness = await createHarness({ subscription: { status: "TRIALING" }, captureCount: TRIAL_LIMIT - 1 });
  try {
    const result = await harness.module.requireManualCaptureQuota("tenant-1");
    assert.equal(result, null);
  } finally {
    harness.cleanup();
  }
});

test("a TRIALING workspace at the limit is blocked with 402 QUOTA_EXCEEDED", async () => {
  const harness = await createHarness({ subscription: { status: "TRIALING" }, captureCount: TRIAL_LIMIT });
  try {
    const result = await harness.module.requireManualCaptureQuota("tenant-1");
    assert.notEqual(result, null);
    assert.equal(result.status, 402);
    const body = await result.json();
    assert.equal(body.error.code, "QUOTA_EXCEEDED");
  } finally {
    harness.cleanup();
  }
});

test("a TRIALING workspace past the limit is also blocked", async () => {
  const harness = await createHarness({ subscription: { status: "TRIALING" }, captureCount: 25 });
  try {
    const result = await harness.module.requireManualCaptureQuota("tenant-1");
    assert.notEqual(result, null);
    assert.equal(result.status, 402);
  } finally {
    harness.cleanup();
  }
});

test("a PAST_DUE subscription is not this gate's concern", async () => {
  const harness = await createHarness({ subscription: { status: "PAST_DUE" }, captureCount: 999 });
  try {
    const result = await harness.module.requireManualCaptureQuota("tenant-1");
    assert.equal(result, null);
  } finally {
    harness.cleanup();
  }
});
