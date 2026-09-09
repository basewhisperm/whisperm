import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const sourcePath = new URL('../src/lib/marketplace-capture/payload.ts', import.meta.url);
const tempDir = mkdtempSync(join(tmpdir(), 'whisperm-c31-payload-'));
const modulePath = join(tempDir, 'payload.mjs');
const source = readFileSync(sourcePath, 'utf8');
writeFileSync(modulePath, ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText);

const {
  MARKETPLACE_CAPTURE_MAX_IMAGE_URLS,
  MARKETPLACE_CAPTURE_MAX_PAYLOAD_BYTES,
  decodeMarketplaceCapturePayload,
  validateMarketplaceCapturePayload,
} = await import(modulePath);

const validPayload = (overrides = {}) => ({
  sourceUrl: 'https://market.example/listings/123',
  sourceHost: 'market.example',
  listingUrl: 'https://market.example/listings/123',
  title: 'Public listing',
  price: '100',
  currency: 'USD',
  images: ['https://market.example/image.jpg'],
  rawExtract: { strategy: 'opengraph' },
  ...overrides,
});

test('single listing payload validates and normalizes sellerPhone alias', () => {
  const result = validateMarketplaceCapturePayload(validPayload({ sellerPhone: '+1 555 555 0123' }));
  assert.equal(result.error, null);
  assert.equal(result.payload.phone, '+1 555 555 0123');
  assert.equal(result.payload.listingUrl, 'https://market.example/listings/123');
});

test('bulk portfolio keeps distinct listings and enforces caps', () => {
  const portfolioListings = Array.from({ length: 30 }, (_, index) => ({
    listingUrl: `https://market.example/listings/${index}`,
    title: `Listing ${index}`,
  }));
  const images = Array.from({ length: 15 }, (_, index) => `https://market.example/images/${index}.jpg`);
  const result = validateMarketplaceCapturePayload(validPayload({ portfolioListings, images }));
  assert.equal(result.error, null);
  assert.equal(result.payload.portfolioListings.length, 25);
  assert.equal(result.payload.images.length, MARKETPLACE_CAPTURE_MAX_IMAGE_URLS);
  assert.notEqual(result.payload.portfolioListings[0].listingUrl, result.payload.portfolioListings[1].listingUrl);
});

test('source host mismatch is rejected before intake', () => {
  const result = validateMarketplaceCapturePayload(validPayload({ sourceHost: 'attacker.example' }));
  assert.equal(result.payload, null);
  assert.equal(result.error, 'Capture source host does not match the source URL.');
});

test('unsafe source URL protocol is rejected', () => {
  const result = validateMarketplaceCapturePayload(validPayload({
    sourceUrl: 'javascript:alert(1)',
    sourceHost: 'market.example',
  }));
  assert.equal(result.payload, null);
  assert.equal(result.error, 'Capture source URL must use http or https.');
});

test('invalid JSON and oversized encoded payloads fail with bounded errors', () => {
  const invalid = decodeMarketplaceCapturePayload('{not-json');
  assert.equal(invalid.payload, null);
  assert.equal(invalid.error, 'Capture payload is not valid JSON.');

  const oversized = decodeMarketplaceCapturePayload('x'.repeat(MARKETPLACE_CAPTURE_MAX_PAYLOAD_BYTES + 1));
  assert.equal(oversized.payload, null);
  assert.equal(oversized.error, 'Capture payload exceeds the intake size limit.');
});
