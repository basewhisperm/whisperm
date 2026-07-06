import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// ST1-010: the accept route's runtime behavior -- canonical CRM conversion never duplicating a
// Contact/Deal on claim, idempotent repeat accepts, expired/unknown token handling -- is now
// proven executably in apps/web/test/marketplace-acquisition-crm-conversion.test.js, which
// transpiles and invokes the real route against fake repositories instead of regex-matching its
// source. What remains here are UI/content checks that are not behavioral claims.
const page = readFileSync(new URL('../src/app/claim/[token]/page.tsx', import.meta.url), 'utf8');
const route = readFileSync(new URL('../src/app/api/marketplace-acquisition/claims/[token]/route.ts', import.meta.url), 'utf8');
const accept = readFileSync(new URL('../src/app/api/marketplace-acquisition/claims/[token]/accept/route.ts', import.meta.url), 'utf8');

test('claim portal renders preview states and accept action', () => {
  assert.match(page, /Seller claim portal/u);
  assert.match(page, /tokenStatus === "EXPIRED"/u);
  assert.match(page, /tokenStatus === "CLAIMED"/u);
  assert.match(page, /acceptedTerms/u);
  assert.match(page, /Accept ownership/u);
});

test('claim API routes do not return raw token or introduce TrustLayer dependency', () => {
  assert.match(route, /\.preview/u);
  assert.match(accept, /\.accept/u);
  assert.doesNotMatch(`${route}\n${accept}\n${page}`, /TrustLayer|trustLayer|rawToken|tokenHash/u);
});
