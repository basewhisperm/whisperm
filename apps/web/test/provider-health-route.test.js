import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import ts from 'typescript';

const tenantId = 'tenant-1';
let tempDir;
let route;
let NextRequestStub;

const providerAdaptersUrl = import.meta.resolve('@whisperm/provider-adapters');

before(async () => {
  tempDir = join(tmpdir(), `whisperm-provider-health-route-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempDir);
  writeFileSync(join(tempDir, 'next-server.mjs'), [
    'export class NextResponse extends Response { static json(body, init) { return Response.json(body, init); } }',
    'export class NextRequest extends Request { get nextUrl() { return new URL(this.url); } }',
    '',
  ].join('\n'));
  writeFileSync(join(tempDir, 'get-tenant.mjs'), 'export const getTenantForCurrentUser = async () => globalThis.__providerHealthRouteTenant;\n');
  writeFileSync(join(tempDir, 'tenant-features.mjs'), 'export const requireSellerAcquisitionFeatureForApi = async () => globalThis.__providerHealthFeatureDenied ?? null;\n');

  ({ NextRequest: NextRequestStub } = await import(join(tempDir, 'next-server.mjs')));

  const routePath = new URL('../src/app/api/marketplace-acquisition/provider-health/route.ts', import.meta.url).pathname;
  const source = readFileSync(routePath, 'utf8')
    .replace(/from "next\/server"/gu, `from "${join(tempDir, 'next-server.mjs')}"`)
    .replace(/from "@\/lib\/get-tenant"/gu, `from "${join(tempDir, 'get-tenant.mjs')}"`)
    .replace(/from "@\/lib\/tenant-features"/gu, `from "${join(tempDir, 'tenant-features.mjs')}"`)
    .replace('from "@whisperm/provider-adapters"', `from "${providerAdaptersUrl}"`);
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const file = join(tempDir, 'provider-health-route.mjs');
  writeFileSync(file, output);
  route = await import(file);
});

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const withEnv = async (overrides, fn) => {
  const original = { ...process.env };
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('META_WHATSAPP') || key.startsWith('WHATSAPP_') || key.startsWith('SELLER_INVITATION') || key === 'RESEND_API_KEY') delete process.env[key];
  }
  Object.assign(process.env, overrides);
  try {
    await fn();
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  }
};

test('unauthenticated request returns 401', async () => {
  globalThis.__providerHealthRouteTenant = null;
  globalThis.__providerHealthFeatureDenied = null;
  const response = await route.GET(new NextRequestStub('https://app.test/api/marketplace-acquisition/provider-health'));
  assert.equal(response.status, 401);
});

test('feature-gated tenant returns the feature-not-enabled response', async () => {
  globalThis.__providerHealthRouteTenant = { id: tenantId };
  globalThis.__providerHealthFeatureDenied = Response.json({ ok: false, error: { code: 'FEATURE_NOT_ENABLED' } }, { status: 403 });
  const response = await route.GET(new NextRequestStub('https://app.test/api/marketplace-acquisition/provider-health'));
  assert.equal(response.status, 403);
  globalThis.__providerHealthFeatureDenied = null;
});

test('rejects an unsupported channel query param', async () => {
  globalThis.__providerHealthRouteTenant = { id: tenantId };
  const response = await route.GET(new NextRequestStub('https://app.test/api/marketplace-acquisition/provider-health?channel=CARRIER_PIGEON'));
  assert.equal(response.status, 400);
});

test('reports ok:false with a safe diagnostic when the provider is unconfigured', async () => {
  globalThis.__providerHealthRouteTenant = { id: tenantId };
  await withEnv({}, async () => {
    const response = await route.GET(new NextRequestStub('https://app.test/api/marketplace-acquisition/provider-health?channel=WHATSAPP'));
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(typeof body.error.code, 'string');
    assert.ok(Array.isArray(body.error.missingEnv) || body.error.code === 'INVALID_CLAIM_BASE_URL');
    assert.doesNotMatch(JSON.stringify(body), /secret|token=/iu);
  });
});

test('reports ok:true with the resolved provider/channel when fully configured', async () => {
  globalThis.__providerHealthRouteTenant = { id: tenantId };
  await withEnv({
    SELLER_INVITATION_BASE_URL: 'https://app.example/claim',
    META_WHATSAPP_ACCESS_TOKEN: 'super-secret-token',
    META_WHATSAPP_PHONE_NUMBER_ID: 'phone-id',
  }, async () => {
    const response = await route.GET(new NextRequestStub('https://app.test/api/marketplace-acquisition/provider-health?channel=WHATSAPP'));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { ok: true, provider: 'meta_whatsapp', channel: 'whatsapp', claimBaseUrlConfigured: true });
    assert.doesNotMatch(JSON.stringify(body), /super-secret-token/u);
  });
});

test('defaults to the WHATSAPP channel when none is provided', async () => {
  globalThis.__providerHealthRouteTenant = { id: tenantId };
  await withEnv({
    SELLER_INVITATION_BASE_URL: 'https://app.example/claim',
    META_WHATSAPP_ACCESS_TOKEN: 'token',
    META_WHATSAPP_PHONE_NUMBER_ID: 'phone-id',
  }, async () => {
    const response = await route.GET(new NextRequestStub('https://app.test/api/marketplace-acquisition/provider-health'));
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.channel, 'whatsapp');
  });
});
