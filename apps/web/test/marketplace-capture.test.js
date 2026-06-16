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

test('extractor captures marketplace seller and inventory snapshot fields', async () => {
  const { extractMarketplaceCapturePayload } = await import('../src/lib/marketplace-capture/bookmarklet.js');
  const document = {
    title: 'Fallback listing title',
    body: { innerText: 'Call +1 555 555 0123 or email seller@example.com' },
    querySelector(selector) {
      const nodes = this.querySelectorAll(selector);
      return nodes[0] ?? null;
    },
    querySelectorAll(selector) {
      if (selector === 'script[type="application/ld+json"]') return [{ textContent: JSON.stringify({ '@type': 'Product', name: 'Road bike', description: 'Fast bike', category: 'Bicycles', image: ['https://market.example/bike.jpg'], brand: { name: 'Sam Seller' }, offers: { priceCurrency: 'USD', price: '500' } }) }];
      if (selector.includes('seller')) return [{ textContent: 'Sam Seller', getAttribute: (name) => name === 'href' ? '/seller/sam' : null }];
      if (selector.includes('location')) return [{ textContent: 'Austin, TX', getAttribute: () => null }];
      return [];
    },
  };
  const payload = extractMarketplaceCapturePayload(document, new URL('https://market.example/listings/abc-123'), 'test-agent');
  assert.equal(payload.title, 'Road bike');
  assert.equal(payload.priceText, 'USD 500');
  assert.equal(payload.imageUrls[0], 'https://market.example/bike.jpg');
  assert.equal(payload.listingUrl, 'https://market.example/listings/abc-123');
  assert.equal(payload.marketplaceSource, 'market.example');
  assert.equal(payload.marketplaceListingId, 'abc-123');
  assert.equal(payload.sellerName, 'Sam Seller');
  assert.equal(payload.sellerProfileUrl, 'https://market.example/seller/sam');
  assert.equal(payload.phone, '+1 555 555 0123');
  assert.equal(payload.email, 'seller@example.com');
});

test('intake page submits seller and inventory data to capture API', () => {
  const source = readFileSync(new URL('../src/app/(app)/marketplace-acquisition/capture/intake/page.tsx', import.meta.url), 'utf8');
  for (const field of ['sellerName', 'sellerProfileUrl', 'phone', 'email', 'location', 'title', 'priceText', 'category', 'listingUrl', 'marketplaceSource', 'marketplaceListingId']) {
    assert.match(source, new RegExp(field, 'u'));
  }
  assert.match(source, /fetch\("\/marketplace-acquisition\/captures"/u);
});

test('mobile URL capture posts URL only and does not require manual seller fields', () => {
  const capturePage = readFileSync(new URL('../src/app/(app)/marketplace-acquisition/capture/page.tsx', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../src/app/api/marketplace-acquisition/captures/from-url/route.ts', import.meta.url), 'utf8');

  assert.match(capturePage, /Mobile URL capture/u);
  assert.match(capturePage, /name="url"/u);
  assert.match(capturePage, /\/api\/marketplace-acquisition\/captures\/from-url/u);

  assert.match(route, /parseRequest/u);
  assert.match(route, /fetch\(url/u);
  assert.match(route, /extractMarketplaceUrlCapture/u);
  assert.match(route, /marketplaceAcquisition\.capture/u);

  assert.doesNotMatch(route, /claimantName|manual seller|sellerName.*request|phone.*request|priceText.*request/u);
});

test('URL extractor detects Jiji and preserves phone-first seller identity', async () => {
  const { extractMarketplaceUrlCapture } = await import('../src/lib/marketplace-capture/url-extractors.ts');
  const html = `
    <html>
      <head>
        <meta property="og:title" content="Toyota Corolla 2018 Silver">
        <meta property="og:description" content="Clean Toyota Corolla in Accra Metropolitan">
        <meta property="og:image" content="/images/corolla.jpg">
      </head>
      <body>
        <p>GH₵ 125,000</p>
        <p>Seller: Manny Autos</p>
        <p>Accra Metropolitan</p>
        <p>Call 0241234567</p>
        <a href="/seller/manny-autos">Seller profile</a>
      </body>
    </html>
  `;

  const payload = extractMarketplaceUrlCapture(
    'https://jiji.com.gh/accra-metropolitan/cars/toyota-corolla-2018-silver.html?lid=GanMPxtBQ1gltBBv',
    html,
    new Date('2026-06-16T00:00:00.000Z'),
  );

  assert.equal(payload.rawExtract.adapter, 'jiji');
  assert.equal(payload.marketplaceSource, 'jiji.com.gh');
  assert.equal(payload.marketplaceListingId, 'GanMPxtBQ1gltBBv');
  assert.equal(payload.title, 'Toyota Corolla 2018 Silver');
  assert.equal(payload.priceText, 'GH₵ 125,000');
  assert.equal(payload.currency, 'GHS');
  assert.equal(payload.phone, '0241234567');
  assert.equal(payload.marketplaceIdentifier, '0241234567');
  assert.equal(payload.sellerName, 'Manny Autos');
  assert.equal(payload.location, 'Accra Metropolitan');
  assert.equal(payload.sellerProfileUrl, 'https://jiji.com.gh/seller/manny-autos');
  assert.equal(payload.imageUrls[0], 'https://jiji.com.gh/images/corolla.jpg');
});

test('URL extractor detects Tonaton and keeps fallback extraction available', async () => {
  const { extractMarketplaceUrlCapture } = await import('../src/lib/marketplace-capture/url-extractors.ts');
  const html = `
    <html>
      <head>
        <title>Honda Civic Touring Sedan 2020 Blue</title>
        <meta name="description" content="Honda Civic from verified seller">
      </head>
      <body>
        <span>GHS 220,000</span>
        <span>Posted by Kwame Motors</span>
        <span>Tema</span>
        <span>+233501234567</span>
      </body>
    </html>
  `;

  const payload = extractMarketplaceUrlCapture(
    'https://tonaton.com/a-MfYFNdCgHM2YwdcCyTjFw1McsQVtqhwr-honda-civic-touring-sedan-2020-blue.html?lid=IgaGwTZE31OQJLAX',
    html,
    new Date('2026-06-16T00:00:00.000Z'),
  );

  assert.equal(payload.rawExtract.adapter, 'tonaton');
  assert.equal(payload.marketplaceSource, 'tonaton.com');
  assert.equal(payload.marketplaceListingId, 'IgaGwTZE31OQJLAX');
  assert.equal(payload.title, 'Honda Civic Touring Sedan 2020 Blue');
  assert.equal(payload.priceText, 'GHS 220,000');
  assert.equal(payload.currency, 'GHS');
  assert.equal(payload.phone, '+233501234567');
  assert.equal(payload.marketplaceIdentifier, '+233501234567');
  assert.equal(payload.sellerName, 'Kwame Motors');
  assert.equal(payload.location, 'Tema');
});
