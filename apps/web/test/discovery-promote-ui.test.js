import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const helpersPath = new URL('../src/app/(app)/marketplace-acquisition/campaigns/[campaignId]/discovery/promote-helpers.ts', import.meta.url).pathname;

const loadHelpers = async () => {
  const tempDir = join(tmpdir(), `whisperm-promote-helpers-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempDir);
  const source = readFileSync(helpersPath, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const file = join(tempDir, 'promote-helpers.mjs');
  writeFileSync(file, output);
  const helpers = await import(file);
  return { helpers, cleanup: () => rmSync(tempDir, { recursive: true, force: true }) };
};

test('clicking Add to Campaign calls the promote endpoint scoped to campaign and discovered seller ids', async () => {
  const { helpers, cleanup } = await loadHelpers();
  try {
    assert.equal(helpers.promoteEndpoint('campaign-1', 'seller-1'), '/api/marketplace-acquisition/campaigns/campaign-1/discovery/sellers/seller-1/promote');
  } finally {
    cleanup();
  }
});

test('the promote request never sends sellerId as captureId', async () => {
  const { helpers, cleanup } = await loadHelpers();
  try {
    const init = helpers.buildPromoteRequestInit();
    assert.equal(init.method, 'POST');
    assert.equal(init.body, undefined);
    assert.equal(JSON.stringify(init).includes('captureId'), false);
  } finally {
    cleanup();
  }
});

test('success message appears only when a real marketplaceCaptureId is returned', async () => {
  const { helpers, cleanup } = await loadHelpers();
  try {
    const withCapture = helpers.derivePromoteOutcome(true, { ok: true, data: { discoveredSellerId: 'seller-1', marketplaceCaptureId: 'capture-1', campaignMemberId: 'member-1', alreadyPromoted: false } });
    assert.equal(withCapture.success, true);
    assert.equal(withCapture.message, 'Seller added to campaign.');
    assert.equal(withCapture.data.marketplaceCaptureId, 'capture-1');

    const missingCapture = helpers.derivePromoteOutcome(true, { ok: true, data: {} });
    assert.equal(missingCapture.success, false);
    assert.notEqual(missingCapture.message, 'Seller added to campaign.');
  } finally {
    cleanup();
  }
});

test('failure message surfaces the backend error and falls back to a generic message', async () => {
  const { helpers, cleanup } = await loadHelpers();
  try {
    const withBackendMessage = helpers.derivePromoteOutcome(false, { ok: false, error: { message: 'Seller acquisition campaign was not found for this workspace.' } });
    assert.equal(withBackendMessage.success, false);
    assert.equal(withBackendMessage.message, 'Seller acquisition campaign was not found for this workspace.');

    const withoutBackendMessage = helpers.derivePromoteOutcome(false, null);
    assert.equal(withoutBackendMessage.success, false);
    assert.equal(withoutBackendMessage.message, helpers.PROMOTE_GENERIC_FAILURE_MESSAGE);
  } finally {
    cleanup();
  }
});

test('promoted seller row updates accurately without touching other sellers', async () => {
  const { helpers, cleanup } = await loadHelpers();
  try {
    const sellers = [
      { id: 'seller-1', status: 'QUALIFIED' },
      { id: 'seller-2', status: 'QUALIFIED' },
    ];
    const updated = helpers.markSellerPromoted(sellers, 'seller-1');
    assert.equal(updated.find((seller) => seller.id === 'seller-1').status, 'PROMOTED');
    assert.equal(updated.find((seller) => seller.id === 'seller-2').status, 'QUALIFIED');
  } finally {
    cleanup();
  }
});
