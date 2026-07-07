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
  const outFile = join(tempDir, "upgrade-route.mjs");
  writeFileSync(outFile, output);
  return import(outFile);
};

const createHarness = async (state) => {
  const tempDir = join(tmpdir(), `whisperm-upgrade-route-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempDir);

  writeFileSync(join(tempDir, "next-server.mjs"), "export class NextResponse extends Response { static json(body, init) { return Response.json(body, init); } }\nexport class NextRequest extends Request {}\n");
  writeFileSync(join(tempDir, "clerk.mjs"), "export const currentUser = async () => globalThis.__upgradeRouteState.user;\n");
  writeFileSync(join(tempDir, "get-tenant.mjs"), "export const getTenantForCurrentUser = async () => globalThis.__upgradeRouteState.tenant;\n");
  writeFileSync(join(tempDir, "stripe-adapter.mjs"), "export const createStripeUpgradePort = () => ({ id: 'stripe-port' });\n");
  writeFileSync(join(tempDir, "paystack-adapter.mjs"), "export const createPaystackUpgradePort = () => ({ id: 'paystack-port' });\n");
  writeFileSync(join(tempDir, "billing-runtime.mjs"), [
    "export class BillingError extends Error {",
    "  constructor(input) { super(input.message); this.code = input.code; this.statusCode = input.statusCode; }",
    "}",
    "export const initiateUpgrade = async (ports, context, plan) => {",
    "  globalThis.__upgradeRouteState.calls.push({ context, plan });",
    "  if (globalThis.__upgradeRouteState.throwBillingError) {",
    "    throw new BillingError({ code: 'TRIAL_EXPIRED', message: 'Your trial has expired.', statusCode: 402 });",
    "  }",
    "  return { provider: 'STRIPE', customerId: 'cus_1', checkoutUrl: 'https://checkout.stripe.com/test' };",
    "};",
  ].join("\n"));

  globalThis.__upgradeRouteState = state;
  const source = new URL("../src/app/api/billing/upgrade/route.ts", import.meta.url).pathname;
  const module = await transpileRoute(source, tempDir, {
    "next/server": "next-server.mjs",
    "@clerk/nextjs/server": "clerk.mjs",
    "@/lib/get-tenant": "get-tenant.mjs",
    "@/lib/billing/stripe-checkout-adapter": "stripe-adapter.mjs",
    "@/lib/billing/paystack-checkout-adapter": "paystack-adapter.mjs",
    "@whisperm/billing-runtime": "billing-runtime.mjs",
  });

  return { module, cleanup: () => { delete globalThis.__upgradeRouteState; rmSync(tempDir, { recursive: true, force: true }); } };
};

const makeRequest = (body) => new Request("https://example.com/api/billing/upgrade", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const withEnv = async (vars, fn) => {
  const previous = {};
  for (const key of Object.keys(vars)) previous[key] = process.env[key];
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
};

const configuredEnv = { STRIPE_SECRET_KEY: "sk_test", PAYSTACK_SECRET_KEY: "sk_paystack_test", NEXT_PUBLIC_APP_URL: "https://app.example.com" };

test("unauthenticated request is rejected", async () => {
  await withEnv(configuredEnv, async () => {
    const harness = await createHarness({ tenant: null, user: null, calls: [] });
    try {
      const response = await harness.module.POST(makeRequest({ plan: "GROWTH" }));
      assert.equal(response.status, 401);
    } finally {
      harness.cleanup();
    }
  });
});

test("an unsupported plan is rejected with 400 before calling initiateUpgrade", async () => {
  await withEnv(configuredEnv, async () => {
    const state = { tenant: { id: "tenant-1", name: "Acme" }, user: { emailAddresses: [{ id: "e1", emailAddress: "owner@acme.com" }], primaryEmailAddressId: "e1" }, calls: [] };
    const harness = await createHarness(state);
    try {
      const response = await harness.module.POST(makeRequest({ plan: "ENTERPRISE" }));
      assert.equal(response.status, 400);
      assert.equal(state.calls.length, 0);
    } finally {
      harness.cleanup();
    }
  });
});

test("returns 503 when billing secret keys are not configured for this environment", async () => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.PAYSTACK_SECRET_KEY;
  const state = { tenant: { id: "tenant-1", name: "Acme" }, user: { emailAddresses: [{ id: "e1", emailAddress: "owner@acme.com" }], primaryEmailAddressId: "e1" }, calls: [] };
  const harness = await createHarness(state);
  try {
    const response = await harness.module.POST(makeRequest({ plan: "GROWTH" }));
    assert.equal(response.status, 503);
  } finally {
    harness.cleanup();
  }
});

test("a valid request initiates the upgrade with the requester's verified primary email and returns the checkout URL", async () => {
  await withEnv(configuredEnv, async () => {
    const state = {
      tenant: { id: "tenant-1", name: "Acme" },
      user: {
        emailAddresses: [{ id: "e1", emailAddress: "old@acme.com" }, { id: "e2", emailAddress: "owner@acme.com" }],
        primaryEmailAddressId: "e2",
      },
      calls: [],
    };
    const harness = await createHarness(state);
    try {
      const response = await harness.module.POST(makeRequest({ plan: "growth" }));
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.equal(body.data.checkoutUrl, "https://checkout.stripe.com/test");
      assert.equal(state.calls[0].plan, "GROWTH");
      assert.equal(state.calls[0].context.ownerEmail, "owner@acme.com");
      assert.equal(state.calls[0].context.tenantId, "tenant-1");
    } finally {
      harness.cleanup();
    }
  });
});

test("a BillingError from initiateUpgrade surfaces with its own status/code instead of a generic 500", async () => {
  await withEnv(configuredEnv, async () => {
    const state = {
      tenant: { id: "tenant-1", name: "Acme" },
      user: { emailAddresses: [{ id: "e1", emailAddress: "owner@acme.com" }], primaryEmailAddressId: "e1" },
      calls: [],
      throwBillingError: true,
    };
    const harness = await createHarness(state);
    try {
      const response = await harness.module.POST(makeRequest({ plan: "GROWTH" }));
      const body = await response.json();
      assert.equal(response.status, 402);
      assert.equal(body.error.code, "TRIAL_EXPIRED");
    } finally {
      harness.cleanup();
    }
  });
});
