import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

// The webhook processing logic itself (signature verification, event mapping, idempotency) is
// exhaustively tested in packages/billing-runtime. What's unique to these route files is: do they
// read the raw body/signature header correctly, fail closed (503) when billing isn't configured
// for this environment, and never throw an unhandled exception back to the caller.

const transpileRoute = (routePath, tempDir, replacements) => {
  let source = readFileSync(routePath, "utf8");
  for (const [specifier, file] of Object.entries(replacements)) {
    source = source.replaceAll(`from "${specifier}"`, `from "${join(tempDir, file)}"`);
  }
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const outFile = join(tempDir, "route.mjs");
  writeFileSync(outFile, output);
  return import(outFile);
};

const createHarness = async (routeRelativePath, processFnName, processOutcome) => {
  const tempDir = join(tmpdir(), `whisperm-webhook-route-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempDir);

  writeFileSync(join(tempDir, "next-server.mjs"), "export class NextResponse extends Response { static json(body, init) { return Response.json(body, init); } }\nexport class NextRequest extends Request {}\n");
  writeFileSync(join(tempDir, "billing-runtime.mjs"), [
    `export const ${processFnName} = async (input) => {`,
    "  globalThis.__webhookRouteState.calls.push(input);",
    "  if (globalThis.__webhookRouteState.throwError) throw new Error('boom');",
    `  return globalThis.__webhookRouteState.outcome ?? ${JSON.stringify(processOutcome)};`,
    "};",
  ].join("\n"));
  writeFileSync(join(tempDir, "webhook-store-adapter.mjs"), "export const webhookStoreAdapter = {};\n");

  const state = { calls: [], outcome: undefined };
  globalThis.__webhookRouteState = state;

  const source = new URL(routeRelativePath, import.meta.url).pathname;
  const module = await transpileRoute(source, tempDir, {
    "next/server": "next-server.mjs",
    "@whisperm/billing-runtime": "billing-runtime.mjs",
    "@/lib/billing/webhook-store-adapter": "webhook-store-adapter.mjs",
  });

  return { module, state, cleanup: () => { delete globalThis.__webhookRouteState; rmSync(tempDir, { recursive: true, force: true }); } };
};

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

test("Stripe webhook route returns 503 when STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET are not configured", async () => {
  await withEnv({ STRIPE_SECRET_KEY: undefined, STRIPE_WEBHOOK_SECRET: undefined }, async () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const harness = await createHarness("../src/app/api/webhooks/stripe/route.ts", "processStripeWebhook", { status: 200, body: {} });
    try {
      const response = await harness.module.POST(new Request("https://example.com/api/webhooks/stripe", { method: "POST", body: "{}" }));
      assert.equal(response.status, 503);
      assert.equal(harness.state.calls.length, 0);
    } finally {
      harness.cleanup();
    }
  });
});

test("Stripe webhook route passes the raw body and signature header through and echoes the processor's result", async () => {
  await withEnv({ STRIPE_SECRET_KEY: "sk_test", STRIPE_WEBHOOK_SECRET: "whsec_test" }, async () => {
    const harness = await createHarness("../src/app/api/webhooks/stripe/route.ts", "processStripeWebhook", { status: 200, body: { ok: true, received: true } });
    try {
      const response = await harness.module.POST(new Request("https://example.com/api/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": "t=1,v1=abc" },
        body: '{"id":"evt_1"}',
      }));
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.deepEqual(body, { ok: true, received: true });
      assert.equal(harness.state.calls.length, 1);
      assert.equal(harness.state.calls[0].rawBody, '{"id":"evt_1"}');
      assert.equal(harness.state.calls[0].signature, "t=1,v1=abc");
    } finally {
      harness.cleanup();
    }
  });
});

test("Stripe webhook route returns 500 (not an unhandled rejection) when processing throws", async () => {
  await withEnv({ STRIPE_SECRET_KEY: "sk_test", STRIPE_WEBHOOK_SECRET: "whsec_test" }, async () => {
    const harness = await createHarness("../src/app/api/webhooks/stripe/route.ts", "processStripeWebhook", { status: 200, body: {} });
    harness.state.throwError = true;
    try {
      const response = await harness.module.POST(new Request("https://example.com/api/webhooks/stripe", { method: "POST", body: "{}" }));
      assert.equal(response.status, 500);
    } finally {
      harness.cleanup();
    }
  });
});

test("Paystack webhook route returns 503 when PAYSTACK_SECRET_KEY is not configured", async () => {
  await withEnv({ PAYSTACK_SECRET_KEY: undefined }, async () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    const harness = await createHarness("../src/app/api/webhooks/paystack/route.ts", "processPaystackWebhook", { status: 200, body: {} });
    try {
      const response = await harness.module.POST(new Request("https://example.com/api/webhooks/paystack", { method: "POST", body: "{}" }));
      assert.equal(response.status, 503);
      assert.equal(harness.state.calls.length, 0);
    } finally {
      harness.cleanup();
    }
  });
});

test("Paystack webhook route passes the raw body and signature header through", async () => {
  await withEnv({ PAYSTACK_SECRET_KEY: "sk_test" }, async () => {
    const harness = await createHarness("../src/app/api/webhooks/paystack/route.ts", "processPaystackWebhook", { status: 200, body: { ok: true, received: true } });
    try {
      const response = await harness.module.POST(new Request("https://example.com/api/webhooks/paystack", {
        method: "POST",
        headers: { "x-paystack-signature": "sig123" },
        body: '{"event":"subscription.create"}',
      }));
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.deepEqual(body, { ok: true, received: true });
      assert.equal(harness.state.calls[0].rawBody, '{"event":"subscription.create"}');
      assert.equal(harness.state.calls[0].signature, "sig123");
    } finally {
      harness.cleanup();
    }
  });
});
