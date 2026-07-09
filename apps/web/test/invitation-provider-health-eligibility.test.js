import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

// ST1-013J: invitation-eligibility.ts has no web-only (`@/lib/...`) dependencies beyond a
// type-only `@prisma/client` import (erased by transpilation), so it can be transpiled and run
// directly against the real `@whisperm/provider-adapters` package instead of a hand-written stub.
const providerAdaptersUrl = import.meta.resolve('@whisperm/provider-adapters');

const loadEligibilityModule = () => {
  const tempDir = join(tmpdir(), `whisperm-eligibility-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempDir);
  const libPath = new URL('../src/lib/marketplace-acquisition/invitation-eligibility.ts', import.meta.url).pathname;
  const source = readFileSync(libPath, 'utf8').replace('from "@whisperm/provider-adapters"', `from "${providerAdaptersUrl}"`);
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const file = join(tempDir, 'invitation-eligibility.mjs');
  writeFileSync(file, output);
  return { modulePromise: import(file), cleanup: () => rmSync(tempDir, { recursive: true, force: true }) };
};

const now = '2026-07-01T00:00:00.000Z';

const baseCapture = (overrides = {}) => ({
  id: 'capture-1',
  status: 'CAPTURED',
  metadata: {},
  contactId: null,
  contact: null,
  campaignMemberships: [{ campaignId: 'campaign-1' }],
  sellerInvitations: [],
  claimTokens: [],
  ...overrides,
});

const prismaFor = (capture) => ({
  marketplaceCapture: {
    async findFirst(args) {
      assert.equal(args.where.tenantId, 'tenant-1');
      return args.where.id === capture.id ? capture : null;
    },
  },
});

const okHealth = { ok: true, provider: 'meta_whatsapp', channel: 'whatsapp', claimBaseUrl: 'https://app.example/claim', diagnostics: { requiredEnvPresent: [] } };
const failHealth = { ok: false, code: 'MISSING_REQUIRED_ENV', message: 'Invitation provider is missing required configuration.' };

test('provider healthy + contact channel + campaign assignment is eligible', async () => {
  const { modulePromise, cleanup } = loadEligibilityModule();
  try {
    const { resolveInvitationEligibility } = await modulePromise;
    const capture = baseCapture({ contactId: 'contact-1', contact: { phone: '+15555550100', email: null } });
    const result = await resolveInvitationEligibility(prismaFor(capture), { tenantId: 'tenant-1', captureId: capture.id, channel: 'WHATSAPP' }, { checkProviderHealth: () => okHealth });
    assert.deepEqual(result, { eligible: true, captureId: capture.id, campaignId: 'campaign-1', reason: 'READY' });
  } finally {
    cleanup();
  }
});

test('provider not configured blocks eligibility even though the seller has a reachable contact channel', async () => {
  const { modulePromise, cleanup } = loadEligibilityModule();
  try {
    const { resolveInvitationEligibility } = await modulePromise;
    const capture = baseCapture({ contactId: 'contact-1', contact: { phone: '+15555550100', email: null } });
    const result = await resolveInvitationEligibility(prismaFor(capture), { tenantId: 'tenant-1', captureId: capture.id, channel: 'WHATSAPP' }, { checkProviderHealth: () => failHealth });
    assert.equal(result.eligible, false);
    assert.equal(result.code, 'PROVIDER_NOT_CONFIGURED');
    assert.equal(result.message, 'Invitation provider is not configured for this workspace/environment.');
  } finally {
    cleanup();
  }
});

test('missing contact channel is reported before the provider is even checked', async () => {
  const { modulePromise, cleanup } = loadEligibilityModule();
  try {
    const { resolveInvitationEligibility } = await modulePromise;
    const capture = baseCapture({ contactId: 'contact-1', contact: { phone: null, email: null } });
    let checkedProvider = false;
    const result = await resolveInvitationEligibility(prismaFor(capture), { tenantId: 'tenant-1', captureId: capture.id, channel: 'WHATSAPP' }, { checkProviderHealth: () => { checkedProvider = true; return okHealth; } });
    assert.equal(result.eligible, false);
    assert.equal(result.code, 'MISSING_CONTACT_CHANNEL');
    assert.equal(checkedProvider, false, 'provider health must not be checked before the contact channel is known to exist');
  } finally {
    cleanup();
  }
});

test('email contact channel with no phone is eligible once an email provider is configured (no phone-first bias)', async () => {
  const { modulePromise, cleanup } = loadEligibilityModule();
  try {
    const { resolveInvitationEligibility } = await modulePromise;
    const capture = baseCapture({ contactId: 'contact-1', contact: { phone: null, email: 'seller@example.com' } });
    const result = await resolveInvitationEligibility(prismaFor(capture), { tenantId: 'tenant-1', captureId: capture.id, channel: 'EMAIL' }, { checkProviderHealth: () => ({ ...okHealth, provider: 'email', channel: 'email' }) });
    assert.equal(result.eligible, true);
  } finally {
    cleanup();
  }
});

test('provider health blocks even when the campaign context is also missing, reported as PROVIDER_NOT_CONFIGURED not MISSING_CAMPAIGN_CONTEXT', async () => {
  const { modulePromise, cleanup } = loadEligibilityModule();
  try {
    const { resolveInvitationEligibility } = await modulePromise;
    const capture = baseCapture({ contactId: 'contact-1', contact: { phone: '+15555550100', email: null }, campaignMemberships: [] });
    const result = await resolveInvitationEligibility(prismaFor(capture), { tenantId: 'tenant-1', captureId: capture.id, channel: 'WHATSAPP' }, { checkProviderHealth: () => failHealth });
    assert.equal(result.code, 'PROVIDER_NOT_CONFIGURED');
  } finally {
    cleanup();
  }
});

test('default provider health checker (no override) reflects real unconfigured environment', async () => {
  const { modulePromise, cleanup } = loadEligibilityModule();
  const originalEnv = { ...process.env };
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('META_WHATSAPP') || key.startsWith('WHATSAPP_') || key === 'SELLER_INVITATION_BASE_URL') delete process.env[key];
  }
  try {
    const { resolveInvitationEligibility } = await modulePromise;
    const capture = baseCapture({ contactId: 'contact-1', contact: { phone: '+15555550100', email: null } });
    const result = await resolveInvitationEligibility(prismaFor(capture), { tenantId: 'tenant-1', captureId: capture.id, channel: 'WHATSAPP' });
    assert.equal(result.eligible, false);
    assert.equal(result.code, 'PROVIDER_NOT_CONFIGURED');
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
    cleanup();
  }
});
