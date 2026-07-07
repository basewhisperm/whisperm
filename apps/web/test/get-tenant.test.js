import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

// getTenantContextForCurrentUser is the single place the live app resolves "which workspace does
// this signed-in Clerk user belong to". Previously it only ever returned an existing TenantUser
// row or null -- there was no path from "I signed up" to "I have a workspace" anywhere in the
// codebase; every workspace had to be hand-seeded. This proves the auto-provisioning path: a
// first-time signed-in user with no TenantUser row gets one created for them, and a returning
// user is never re-provisioned.

const transpileModule = (sourcePath, tempDir, replacements) => {
  let source = readFileSync(sourcePath, "utf8");
  for (const [specifier, file] of Object.entries(replacements)) {
    source = source.replaceAll(`from "${specifier}"`, `from "${join(tempDir, file)}"`);
  }
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const outFile = join(tempDir, "get-tenant.mjs");
  writeFileSync(outFile, output);
  return import(outFile);
};

const createHarness = async (state) => {
  const tempDir = join(tmpdir(), `whisperm-get-tenant-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempDir);

  writeFileSync(join(tempDir, "clerk.mjs"), "export const currentUser = async () => globalThis.__getTenantState.clerkUser;\n");
  writeFileSync(join(tempDir, "prisma.mjs"), [
    "export const prisma = {",
    "  tenantUser: {",
    "    async findFirst({ where }) {",
    "      const emails = where.email.in;",
    "      return globalThis.__getTenantState.tenantUsers.find((u) => emails.includes(u.email) && u.isActive) ?? null;",
    "    },",
    "  },",
    "};",
  ].join("\n"));
  writeFileSync(join(tempDir, "provision.mjs"), [
    "export const provisionWorkspaceForUser = async (user, email) => {",
    "  globalThis.__getTenantState.provisionCalls.push({ userId: user.id, email });",
    "  const tenant = { id: 'tenant-new', slug: 'new-workspace', name: \"New Workspace\" };",
    "  globalThis.__getTenantState.tenantUsers.push({ id: 'tu-new', tenantId: tenant.id, email, isActive: true, tenant });",
    "  return { tenantId: tenant.id };",
    "};",
  ].join("\n"));

  globalThis.__getTenantState = state;
  const source = new URL("../src/lib/get-tenant.ts", import.meta.url).pathname;
  const module = await transpileModule(source, tempDir, {
    "@clerk/nextjs/server": "clerk.mjs",
    "@/lib/prisma": "prisma.mjs",
    "@/lib/billing/provision-workspace-for-user": "provision.mjs",
  });

  return {
    module,
    cleanup: () => { delete globalThis.__getTenantState; rmSync(tempDir, { recursive: true, force: true }); },
  };
};

const makeClerkUser = (overrides = {}) => ({
  id: "user_123",
  primaryEmailAddressId: "email_1",
  emailAddresses: [{ id: "email_1", emailAddress: "Jane@Example.com" }],
  firstName: "Jane",
  lastName: "Doe",
  username: null,
  ...overrides,
});

test("returns null when no one is signed in", async () => {
  const harness = await createHarness({ clerkUser: null, tenantUsers: [], provisionCalls: [] });
  try {
    const result = await harness.module.getTenantContextForCurrentUser();
    assert.equal(result, null);
  } finally {
    harness.cleanup();
  }
});

test("returns the existing tenant for a known user without provisioning anything", async () => {
  const tenant = { id: "tenant-1", slug: "acme", name: "Acme" };
  const state = {
    clerkUser: makeClerkUser(),
    tenantUsers: [{ id: "tu-1", tenantId: "tenant-1", email: "jane@example.com", isActive: true, tenant }],
    provisionCalls: [],
  };
  const harness = await createHarness(state);
  try {
    const result = await harness.module.getTenantContextForCurrentUser();
    assert.equal(result.tenant.id, "tenant-1");
    assert.equal(result.tenantUserId, "tu-1");
    assert.equal(state.provisionCalls.length, 0, "an existing user must never trigger provisioning");
  } finally {
    harness.cleanup();
  }
});

test("SELF-SERVE SIGNUP: a first-time signed-in user with no TenantUser row gets a workspace auto-provisioned", async () => {
  const state = { clerkUser: makeClerkUser(), tenantUsers: [], provisionCalls: [] };
  const harness = await createHarness(state);
  try {
    const result = await harness.module.getTenantContextForCurrentUser();
    assert.equal(state.provisionCalls.length, 1);
    assert.equal(state.provisionCalls[0].userId, "user_123");
    assert.equal(state.provisionCalls[0].email, "jane@example.com", "must provision using the verified primary email, not an arbitrary one");
    assert.ok(result, "must return the newly-provisioned tenant, not null");
    assert.equal(result.tenant.id, "tenant-new");
  } finally {
    harness.cleanup();
  }
});

test("provisioning uses the Clerk-verified primary email even when other email addresses are present", async () => {
  const state = {
    clerkUser: makeClerkUser({
      primaryEmailAddressId: "email_2",
      emailAddresses: [
        { id: "email_1", emailAddress: "old@example.com" },
        { id: "email_2", emailAddress: "primary@example.com" },
      ],
    }),
    tenantUsers: [],
    provisionCalls: [],
  };
  const harness = await createHarness(state);
  try {
    await harness.module.getTenantContextForCurrentUser();
    assert.equal(state.provisionCalls[0].email, "primary@example.com");
  } finally {
    harness.cleanup();
  }
});
