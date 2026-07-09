import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import ts from 'typescript';

// ST1-013J: workbench-domain.ts is pure logic with no web-only imports beyond real
// `@whisperm/services/*` subpaths (already built) and a type-only records-store import (erased
// by transpilation) -- transpile and run the real source directly instead of hand-copying the
// logic into the test.
let mod;
let tempDir;

before(async () => {
  tempDir = join(tmpdir(), `whisperm-workbench-domain-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempDir);
  const libPath = new URL('../src/lib/marketplace-acquisition/workbench-domain.ts', import.meta.url).pathname;
  const source = readFileSync(libPath, 'utf8')
    .replace('from "@whisperm/services/acquisition-workflow"', `from "${import.meta.resolve('@whisperm/services/acquisition-workflow')}"`)
    .replace('from "@whisperm/services/acquisition-metrics"', `from "${import.meta.resolve('@whisperm/services/acquisition-metrics')}"`)
    .replace('from "@whisperm/services/seller-presentation"', `from "${import.meta.resolve('@whisperm/services/seller-presentation')}"`);
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const file = join(tempDir, 'workbench-domain.mjs');
  writeFileSync(file, output);
  mod = await import(file);
});

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const now = '2026-07-01T00:00:00.000Z';
const baseRecord = (overrides = {}) => ({
  capture: { id: 'capture-1', tenantId: 'tenant-1', status: 'CAPTURED', metadata: {}, capturedAt: now, createdAt: now, updatedAt: now },
  contact: null,
  draftInventory: null,
  latestInvitation: null,
  images: [],
  currentStage: 'Captured',
  healthStatus: 'ON_TRACK',
  nextAction: 'SEND_INVITATION',
  missingRequirements: [],
  ...overrides,
});

const readyAvailability = { whatsapp: true, sms: true, email: true };
const noneAvailable = { whatsapp: false, sms: false, email: false };

test('hasEmail reads contact email, then sellerEmail metadata', () => {
  assert.equal(mod.hasEmail(baseRecord({ contact: { email: 'seller@example.com' } })), true);
  assert.equal(mod.hasEmail(baseRecord({ capture: { ...baseRecord().capture, metadata: { sellerEmail: 'seller@example.com' } } })), true);
  assert.equal(mod.hasEmail(baseRecord()), false);
});

test('isInvitationProviderReady is true for non-invitation actions regardless of availability', () => {
  const record = baseRecord({ nextAction: 'WAIT_FOR_CLAIM' });
  assert.equal(mod.isInvitationProviderReady(record, noneAvailable), true);
});

test('phone + WhatsApp available is ready', () => {
  const record = baseRecord({ contact: { phone: '+15555550100' } });
  assert.equal(mod.isInvitationProviderReady(record, { whatsapp: true, sms: false, email: false }), true);
});

test('phone + only SMS available is ready (WhatsApp fallback to SMS)', () => {
  const record = baseRecord({ contact: { phone: '+15555550100' } });
  assert.equal(mod.isInvitationProviderReady(record, { whatsapp: false, sms: true, email: false }), true);
});

test('email only + email provider available is ready without a phone', () => {
  const record = baseRecord({ contact: { email: 'seller@example.com' } });
  assert.equal(mod.isInvitationProviderReady(record, { whatsapp: false, sms: false, email: true }), true);
});

test('contact channel exists but no provider is available is not ready', () => {
  const record = baseRecord({ contact: { phone: '+15555550100', email: 'seller@example.com' } });
  assert.equal(mod.isInvitationProviderReady(record, noneAvailable), false);
});

test('RETRY_INVITATION is governed by provider readiness the same as SEND_INVITATION', () => {
  const record = baseRecord({ nextAction: 'RETRY_INVITATION', contact: { phone: '+15555550100' } });
  assert.equal(mod.isInvitationProviderReady(record, noneAvailable), false);
  assert.equal(mod.isInvitationProviderReady(record, readyAvailability), true);
});
