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
  const outFile = join(tempDir, "provision.mjs");
  writeFileSync(outFile, output);
  return import(outFile);
};

const createHarness = async () => {
  const tempDir = join(tmpdir(), `whisperm-provision-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempDir);

  const state = { createWorkspaceCalls: [], initTrialCalls: [] };

  writeFileSync(join(tempDir, "billing-runtime.mjs"), [
    "export const createWorkspace = async (port, input) => {",
    "  globalThis.__provisionState.createWorkspaceCalls.push(input);",
    "  return { workspaceId: 'tenant-1', slug: 'slug', name: input.firmName, currency: 'USD', country: input.country, pipeline: { id: 'p1', tenantId: 'tenant-1', name: 'Client Pipeline', isDefault: true, stageCount: 5 } };",
    "};",
    "export const initWorkspaceTrial = async (store, scheduler, input) => {",
    "  globalThis.__provisionState.initTrialCalls.push(input);",
    "  return { subscription: { tenantId: input.tenantId, status: 'TRIALING', trialEndsAt: '2026-01-15T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' }, reminderJobsScheduled: 3 };",
    "};",
  ].join("\n"));
  writeFileSync(join(tempDir, "workspace-provisioning-adapter.mjs"), "export const workspaceProvisioningPort = {};\n");
  writeFileSync(join(tempDir, "trial-store-adapter.mjs"), "export const trialStoreAdapter = {};\n");
  writeFileSync(join(tempDir, "notification-schedule-adapter.mjs"), "export const notificationScheduleAdapter = {};\n");

  globalThis.__provisionState = state;
  const source = new URL("../src/lib/billing/provision-workspace-for-user.ts", import.meta.url).pathname;
  const module = await transpileModule(source, tempDir, {
    "@whisperm/billing-runtime": "billing-runtime.mjs",
    "./workspace-provisioning-adapter": "workspace-provisioning-adapter.mjs",
    "./trial-store-adapter": "trial-store-adapter.mjs",
    "./notification-schedule-adapter": "notification-schedule-adapter.mjs",
  });

  return { module, state, cleanup: () => { delete globalThis.__provisionState; rmSync(tempDir, { recursive: true, force: true }); } };
};

test("defaults the firm name from the user's full name when available", async () => {
  const harness = await createHarness();
  try {
    await harness.module.provisionWorkspaceForUser({ id: "user_1", firstName: "Jane", lastName: "Doe", username: null }, "jane@example.com");
    assert.equal(harness.state.createWorkspaceCalls[0].firmName, "Jane Doe's Workspace");
    assert.equal(harness.state.createWorkspaceCalls[0].userId, "user_1");
    assert.equal(harness.state.createWorkspaceCalls[0].userEmail, "jane@example.com");
  } finally {
    harness.cleanup();
  }
});

test("falls back to username, then to the email local-part, when no name is set", async () => {
  const harness = await createHarness();
  try {
    await harness.module.provisionWorkspaceForUser({ id: "user_2", firstName: null, lastName: null, username: "janedoe" }, "jane@example.com");
    assert.equal(harness.state.createWorkspaceCalls[0].firmName, "janedoe's Workspace");

    await harness.module.provisionWorkspaceForUser({ id: "user_3", firstName: null, lastName: null, username: null }, "kwame@example.com");
    assert.equal(harness.state.createWorkspaceCalls[1].firmName, "kwame's Workspace");
  } finally {
    harness.cleanup();
  }
});

test("initializes a trial for the newly-created workspace", async () => {
  const harness = await createHarness();
  try {
    const result = await harness.module.provisionWorkspaceForUser({ id: "user_1", firstName: "Jane", lastName: "Doe", username: null }, "jane@example.com");
    assert.equal(result.tenantId, "tenant-1");
    assert.equal(harness.state.initTrialCalls.length, 1);
    assert.equal(harness.state.initTrialCalls[0].tenantId, "tenant-1");
    assert.equal(harness.state.initTrialCalls[0].ownerEmail, "jane@example.com");
  } finally {
    harness.cleanup();
  }
});
