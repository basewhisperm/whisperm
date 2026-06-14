import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  createMarketplaceCaptureBookmarklet,
  encodeMarketplaceCapturePayload,
  MARKETPLACE_CAPTURE_MAX_PAYLOAD_BYTES,
} from '../src/lib/marketplace-capture/bookmarklet.js';

const basePayload = Object.freeze({
  sourceUrl: 'https://market.example/listings/123',
  sourceHost: 'market.example',
  title: 'Public listing',
  description: 'Public description',
  priceText: 'USD 100',
  imageUrls: Object.freeze(['https://market.example/image.jpg']),
  rawExtract: Object.freeze({ strategy: 'opengraph' }),
});

test('marketplace capture payload encoding is size-limited and URL safe', () => {
  const encoded = encodeMarketplaceCapturePayload(basePayload);

  assert.equal(typeof encoded, 'string');
  assert.deepEqual(JSON.parse(decodeURIComponent(encoded)), basePayload);

  const oversizedPayload = {
    ...basePayload,
    description: 'x'.repeat(MARKETPLACE_CAPTURE_MAX_PAYLOAD_BYTES + 1),
  };
  assert.equal(encodeMarketplaceCapturePayload(oversizedPayload), null);
});

test('bookmarklet opens authenticated intake with one encoded payload', () => {
  const bookmarklet = createMarketplaceCaptureBookmarklet({
    intakeUrl: 'https://app.whisperm.test/marketplace-acquisition/capture/intake',
  });

  assert.match(bookmarklet, /^javascript:\(function\(\)\{/u);
  assert.match(bookmarklet, /window\.open\(INTAKE\+'\?payload='\+encodeURIComponent\(json\),'_blank','noopener,noreferrer'\)/u);
  assert.match(bookmarklet, new RegExp(`const MAX=${MARKETPLACE_CAPTURE_MAX_PAYLOAD_BYTES}`, 'u'));
});

test('bookmarklet source omits private browser state and full page HTML collection', () => {
  const bookmarklet = createMarketplaceCaptureBookmarklet({
    intakeUrl: 'https://app.whisperm.test/marketplace-acquisition/capture/intake',
  });

  assert.doesNotMatch(bookmarklet, /cookie/u);
  assert.doesNotMatch(bookmarklet, /localStorage/u);
  assert.doesNotMatch(bookmarklet, /sessionStorage/u);
  assert.doesNotMatch(bookmarklet, /innerHTML|outerHTML|documentElement/u);
  assert.doesNotMatch(bookmarklet, /fetch\(/u);
});

test('marketplace acquisition detail route links safe capture fields without raw metadata', () => {
  const detailPage = readFileSync(new URL('../src/app/(app)/marketplace-acquisition/[dealId]/page.tsx', import.meta.url), 'utf8');
  const boardPage = readFileSync(new URL('../src/app/(app)/marketplace-acquisition/page.tsx', import.meta.url), 'utf8');

  assert.match(boardPage, /href=\{`\/marketplace-acquisition\/\$\{deal\.id\}`\}/u);
  for (const safeField of ['listingUrl', 'marketplaceSource', 'sellerName', 'status', 'price', 'currency']) {
    assert.match(detailPage, new RegExp(safeField, 'u'));
  }

  assert.doesNotMatch(detailPage, /\.metadata\b/u);
  assert.doesNotMatch(detailPage, /claimToken|tokenHash|providerCredentials|rawPayload/u);
});
