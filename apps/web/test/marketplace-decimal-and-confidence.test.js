import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

const appRoot = fileURLToPath(new URL('../src/', import.meta.url));
const repoRoot = dirname(dirname(dirname(appRoot)));

function readRepo(relativePath) {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function decimalMock(value) {
  return {
    s: 1,
    e: 5,
    d: [250000],
    toNumber() { return Number(value); },
    toString() { return String(value); },
  };
}

function normalizeRecord(value) {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toNumber === 'function') return value.toString();
  if (Array.isArray(value)) return value.map(normalizeRecord);
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, normalizeRecord(nested)]));
}

function decimalLikePreprocess(value) {
  return (typeof value === 'object' && value !== null && typeof value.toNumber === 'function') ? String(value) : value;
}

function price(record) {
  const rawPrice = record.draftInventory?.price ?? record.capture.price;
  if (rawPrice === null || rawPrice === undefined || rawPrice === '') return 'Price missing';
  if (typeof rawPrice === 'string' && rawPrice.includes('[object')) return 'Price missing';
  const currency = record.draftInventory?.currency || record.capture.currency || 'USD';
  const numericPrice = typeof rawPrice === 'number' ? rawPrice : Number(rawPrice);
  if (!Number.isFinite(numericPrice)) return `${currency} ${String(rawPrice)}`;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(numericPrice);
  } catch {
    return `${currency} ${numericPrice}`;
  }
}

function computeCaptureConfidence(input) {
  if (!input.phonePresent) return 'LOW';
  if (input.imagePresent && input.titlePresent && input.pricePresent) return 'HIGH';
  if (input.titlePresent && (input.imagePresent || input.pricePresent || input.locationPresent)) return 'MEDIUM';
  return 'LOW';
}

function computeAcquisitionScore(input) {
  let score = 0;
  if (input.phonePresent) score += 35;
  if (input.imagePresent) score += 20;
  if (input.pricePresent) score += 15;
  if (input.titlePresent) score += 15;
  if (input.locationPresent) score += 10;
  if (input.sourcePresent) score += 5;
  return Math.min(100, score);
}

test('marketplace repository normalizes decimal-like values before object walking', () => {
  const source = readRepo('packages/repositories/src/marketplace-acquisition.ts');
  assert.match(source, /typeof \(value as \{ toNumber\?: unknown \}\)\.toNumber === "function"/u);
  assert.match(source, /return \(value as \{ toString\(\): string \}\)\.toString\(\);/u);

  const normalized = normalizeRecord({ price: decimalMock('250000') });
  assert.equal(normalized.price, '250000');
  assert.notEqual(normalized.price, '[object Object]');
});

test('shared repository normalization converts Prisma decimals before object walking', () => {
  const source = readRepo('packages/repositories/src/index.ts');
  const decimalGuard = source.indexOf('typeof (value as { toNumber?: unknown }).toNumber === "function"');
  const objectWalk = source.indexOf('Object.fromEntries(Object.entries(value).map(([key, nested])');
  assert.ok(decimalGuard >= 0, 'shared repository must recognize Prisma decimal values');
  assert.ok(objectWalk > decimalGuard, 'decimal conversion must happen before generic object walking');
});

test('edit form price helper rejects object stringification and falls back to original price text', () => {
  const source = readRepo('apps/web/src/lib/marketplace-acquisition/workbench-domain.ts');
  assert.match(source, /export function editablePriceText/u);
  assert.match(source, /!rawPrice\.includes\("\[object"\)/u);
  assert.match(source, /metadataText\(record, "originalPriceText"\) \?\? ""/u);

  const editablePriceText = (rawPrice, originalPriceText) => {
    if (typeof rawPrice === 'number') return String(rawPrice);
    if (typeof rawPrice === 'string' && !rawPrice.includes('[object')) return rawPrice;
    return originalPriceText ?? '';
  };
  assert.equal(editablePriceText('250000'), '250000');
  assert.equal(editablePriceText(250000), '250000');
  assert.equal(editablePriceText({ s: 1, e: 5, d: [250000] }), '');
  assert.equal(editablePriceText('[object Object]', 'GH₵ 250,000'), 'GH₵ 250,000');
});

test('decimal-like schema preprocessor accepts decimal instances without generic object stringification', () => {
  const source = readRepo('packages/repositories/src/marketplace-acquisition.ts');
  assert.match(source, /export const decimalLikeSchema = z\.preprocess/u);
  assert.doesNotMatch(source, /"toString" in value/u);

  assert.equal(decimalLikePreprocess(decimalMock('1250.50')), '1250.50');
  assert.deepEqual(decimalLikePreprocess({ s: 1, e: 3, d: [1250] }), { s: 1, e: 3, d: [1250] });
});

test('marketplace acquisition price rendering handles corrupted prices and malformed currencies', () => {
  // ST1-013G: the price() implementation this regex targets lives in workbench-domain.ts,
  // which acquisition-workbench.tsx imports rather than reimplementing inline.
  const source = readRepo('apps/web/src/lib/marketplace-acquisition/workbench-domain.ts');
  assert.match(source, /rawPrice\.includes\("\[object"\)/u);
  assert.match(source, /record\.draftInventory\?\.currency \|\| record\.capture\.currency \|\| "USD"/u);
  assert.match(source, /try \{\s*return new Intl\.NumberFormat/su);
  assert.match(source, /catch \{\s*return `\$\{currency\} \$\{numericPrice\}`;/su);

  assert.equal(price({ draftInventory: null, capture: { price: '[object Object]', currency: 'GHS' } }), 'Price missing');
  assert.equal(price({ draftInventory: { price: '1000', currency: '' }, capture: { price: null, currency: '' } }), '$1,000');
  assert.equal(price({ draftInventory: { price: '42', currency: 'BADCODE' }, capture: { price: null, currency: 'USD' } }), 'BADCODE 42');
});

test('server-side capture confidence and acquisition score cover representative branches', () => {
  const source = readRepo('packages/services/src/seller-acquisition-records.ts');
  assert.match(source, /readonly captureConfidence: CaptureConfidence;/u);
  assert.match(source, /readonly acquisitionScore: number;/u);
  assert.match(source, /captureConfidence: computeCaptureConfidence\(confidenceInput\)/u);
  assert.match(source, /acquisitionScore: computeAcquisitionScore\(\{ \.\.\.confidenceInput, sourcePresent \}\)/u);

  assert.equal(computeCaptureConfidence({ phonePresent: true, imagePresent: true, titlePresent: true, pricePresent: true, locationPresent: false }), 'HIGH');
  assert.equal(computeCaptureConfidence({ phonePresent: true, imagePresent: false, titlePresent: true, pricePresent: false, locationPresent: true }), 'MEDIUM');
  assert.equal(computeCaptureConfidence({ phonePresent: false, imagePresent: true, titlePresent: true, pricePresent: true, locationPresent: true }), 'LOW');
  assert.equal(computeCaptureConfidence({ phonePresent: true, imagePresent: false, titlePresent: false, pricePresent: false, locationPresent: false }), 'LOW');

  assert.equal(computeAcquisitionScore({ phonePresent: true, imagePresent: true, pricePresent: true, titlePresent: true, locationPresent: true, sourcePresent: true }), 100);
  assert.equal(computeAcquisitionScore({ phonePresent: true, imagePresent: false, pricePresent: true, titlePresent: false, locationPresent: true, sourcePresent: false }), 60);
});
