import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

const transpileRoute = (routePath, tempDir, replacements) => {
  let source = readFileSync(routePath, "utf8");
  for (const [specifier, file] of Object.entries(replacements)) {
    source = source.replaceAll(`from "${specifier}"`, `from "${join(tempDir, file)}"`);
  }
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const outFile = join(tempDir, "status-route.mjs");
  writeFileSync(outFile, output);
  return import(outFile);
};

const createHarness = async (state) => {
  const tempDir = join(tmpdir(), `whisperm-billing-status-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempDir);

  writeFileSync(join(tempDir, "next-server.mjs"), "export class NextResponse extends Response { static json(body, init) { return Response.json(body, init); } }\n");
  writeFileSync(join(tempDir, "get-tenant.mjs"), "export const getTenantForCurrentUser = async () => globalThis.__billingStatusState.tenant;\n");
  writeFileSync(join(tempDir, "prisma.mjs"), [
    "export const prisma = {",
    "  subscription: {",
    "    async findFirst() { return globalThis.__billingStatusState.subscription; },",
    "  },",
    "};",
  ].join("\n"));

  globalThis.__billingStatusState = state;
  const source = new URL("../src/app/api/billing/status/route.ts", import.meta.url).pathname;
  const module = await transpileRoute(source, tempDir, {
    "next/server": "next-server.mjs",
    "@/lib/get-tenant": "get-tenant.mjs",
    "@/lib/prisma": "prisma.mjs",
  });

  return { module, cleanup: () => { delete globalThis.__billingStatusState; rmSync(tempDir, { recursive: true, force: true }); } };
};

test("unauthenticated request returns 401", async () => {
  const harness = await createHarness({ tenant: null, subscription: null });
  try {
    const response = await harness.module.GET();
    assert.equal(response.status, 401);
  } finally {
    harness.cleanup();
  }
});

test("a tenant with no subscription row returns nulls rather than erroring", async () => {
  const harness = await createHarness({ tenant: { id: "tenant-1" }, subscription: null });
  try {
    const response = await harness.module.GET();
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.data, { plan: null, status: null, trialEndsAt: null });
  } finally {
    harness.cleanup();
  }
});

test("returns the tenant's current plan, status, and trial end date", async () => {
  const harness = await createHarness({
    tenant: { id: "tenant-1" },
    subscription: { plan: "GROWTH", status: "TRIALING", trialEndsAt: "2026-01-15T00:00:00.000Z", currentPeriodEnd: null },
  });
  try {
    const response = await harness.module.GET();
    const body = await response.json();
    assert.equal(body.data.plan, "GROWTH");
    assert.equal(body.data.status, "TRIALING");
    assert.equal(body.data.trialEndsAt, "2026-01-15T00:00:00.000Z");
  } finally {
    harness.cleanup();
  }
});
