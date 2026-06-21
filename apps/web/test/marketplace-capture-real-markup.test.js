import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import {
  createMarketplaceCaptureBookmarklet,
  detectMarketplaceSource,
  extractMarketplaceCapturePayload,
} from '../src/lib/marketplace-capture/bookmarklet.js';

const node = ({ textContent = '', attributes = {} } = {}) => ({
  textContent,
  getAttribute(name) { return attributes[name] ?? null; },
  scrollIntoView() {},
  dispatchEvent() {},
});

function createMockDocument({
  title = 'Fallback title',
  bodyText = '',
  selectors = {},
  selectorAll = {},
} = {}) {
  return {
    title,
    body: { innerText: bodyText },
    querySelector(selector) {
      const matches = this.querySelectorAll(selector);
      return matches[0] ?? null;
    },
    querySelectorAll(selector) {
      if (Object.hasOwn(selectorAll, selector)) return selectorAll[selector];
      if (Object.hasOwn(selectors, selector)) return [selectors[selector]];
      if (selector.includes(',')) {
        return selector.split(',').flatMap((part) => this.querySelectorAll(part.trim()));
      }
      return [];
    },
  };
}

const listingUrl = new URL('https://jiji.com.gh/cantonments/cars/mazda-cx-5-abc123.html');

test('detectMarketplaceSource preserves compound marketplace host suffixes', () => {
  assert.equal(detectMarketplaceSource('https://jiji.com.gh/cantonments/cars/mazda-cx-5'), 'jiji.com.gh');
  assert.equal(detectMarketplaceSource('https://tonaton.com/en/ad/used-car'), 'tonaton.com');
  assert.equal(detectMarketplaceSource('https://www.jiji.com.gh/cantonments/cars/mazda-cx-5'), 'jiji.com.gh');
});

test('extractor prefers precise Jiji seller name leaf over broad seller link text', () => {
  const document = createMockDocument({
    selectors: {
      '.b-seller-block__name': node({ textContent: 'Sampson Asomani' }),
      'a[href*="seller" i]': node({
        textContent: 'Sampson Asomani1+ years on JijiVerified IDTypically replies within minutes',
        attributes: { href: '/seller/sampson-asomani' },
      }),
    },
  });

  const payload = extractMarketplaceCapturePayload(document, listingUrl, 'test-agent');

  assert.equal(payload.sellerName, 'Sampson Asomani');
  assert.doesNotMatch(payload.sellerName, /years on Jiji|Verified ID|Last seen/u);
});

test('extractor prefers precise Jiji price leaf over negotiable container text', () => {
  const document = createMockDocument({
    selectors: {
      '.qa-advert-price-view-value': node({ textContent: 'GH₵ 250,000' }),
      '.qa-advert-price-view': node({ textContent: 'GH₵ 250,000Negotiable' }),
    },
  });

  const payload = extractMarketplaceCapturePayload(document, listingUrl, 'test-agent');

  assert.equal(payload.priceText, 'GH₵ 250,000');
  assert.doesNotMatch(payload.priceText, /Negotiable/u);
});

test('phone extraction still falls back to body text when seller block is absent', () => {
  const document = createMockDocument({
    bodyText: 'Call +1 555 555 0123 or email seller@example.com',
  });

  const payload = extractMarketplaceCapturePayload(document, listingUrl, 'test-agent');

  assert.equal(payload.phone, '+1 555 555 0123');
});

test('phone extraction prefers seller block text over decoy body phone numbers', () => {
  const document = createMockDocument({
    bodyText: 'Report this ad at +1 555 555 0123. Seller contact is available below.',
    selectors: {
      '.b-seller-block': node({ textContent: 'Prince Darko +233 24 123 4567 Verified ID' }),
    },
  });

  const payload = extractMarketplaceCapturePayload(document, listingUrl, 'test-agent');

  assert.equal(payload.phone, '+233 24 123 4567');
});

test('extractor flags likely grid pages based on product microdata count', () => {
  const gridDocument = createMockDocument({
    selectorAll: { '[itemtype*="schema.org/Product"]': [node(), node()] },
  });
  const listingDocument = createMockDocument({
    selectorAll: { '[itemtype*="schema.org/Product"]': [node()] },
  });

  assert.equal(extractMarketplaceCapturePayload(gridDocument, listingUrl, 'test-agent').looksLikeGridPage, true);
  assert.equal(extractMarketplaceCapturePayload(listingDocument, listingUrl, 'test-agent').looksLikeGridPage, false);
});

test('generated bookmarklet uses canonical extractor output for the same document', () => {
  const document = createMockDocument({
    title: 'Mazda CX-5',
    bodyText: 'Call +1 555 555 0123 or email seller@example.com',
    selectors: {
      '.b-seller-block__name': node({ textContent: 'Sampson Asomani' }),
      '.qa-advert-price-view-value': node({ textContent: 'GH₵ 250,000' }),
      'a[href*="seller" i]': node({ attributes: { href: '/seller/sampson-asomani' } }),
      '[itemprop="address"]': node({ textContent: 'Accra, Ghana' }),
    },
  });
  const directPayload = extractMarketplaceCapturePayload(document, listingUrl, 'bookmarklet-agent');
  const opened = [];
  const bookmarklet = createMarketplaceCaptureBookmarklet({
    intakeUrl: 'https://app.whisperm.test/marketplace-acquisition/capture/intake',
  });
  const source = bookmarklet.replace(/^javascript:/u, '');

  vm.runInNewContext(source, {
    document,
    location: listingUrl,
    navigator: { userAgent: 'bookmarklet-agent' },
    TextEncoder,
    URL,
    JSON,
    Date,
    encodeURIComponent,
    MouseEvent: function MouseEvent() {},
    window: {
      open(url) { opened.push(url); },
    },
    alert(message) { throw new Error(message); },
    confirm() { return true; },
    setTimeout(callback) { callback(); },
  });

  assert.equal(opened.length, 1);
  const capturedPayload = JSON.parse(decodeURIComponent(new URL(opened[0]).searchParams.get('payload')));
  delete capturedPayload.capturedAt;
  delete directPayload.capturedAt;

  assert.deepEqual(capturedPayload, directPayload);
});
