import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import {
  createMarketplaceCaptureBookmarklet,
  detectMarketplaceSource,
  extractMarketplaceCapturePayload,
} from '../src/lib/marketplace-capture/bookmarklet.js';

const node = ({ textContent = '', attributes = {}, click = () => {}, matches = () => false } = {}) => ({
  textContent,
  getAttribute(name) { return attributes[name] ?? null; },
  scrollIntoView() {},
  focus() {},
  click,
  matches,
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

test('extractor detects a Jiji results page from unique visible listing links', () => {
  const document = createMockDocument({
    selectorAll: {
      'a[href]': [
        node({ textContent: 'Cleaning machine GH₵ 4,000', attributes: { href: '/accra/cleaning-equipment/cleaning-machine-one.html' } }),
        node({ textContent: 'Industrial vacuum GH₵ 2,500', attributes: { href: '/accra/cleaning-equipment/industrial-vacuum-two.html' } }),
        node({ textContent: 'Search', attributes: { href: '/search?query=cleaning' } }),
      ],
    },
  });

  const payload = extractMarketplaceCapturePayload(document, new URL('https://jiji.com.gh/accra/search?query=cleaning'), 'test-agent');
  assert.equal(payload.looksLikeGridPage, true);
  assert.equal(payload.portfolioListings.length, 2);
  assert.equal(payload.portfolioListings[0].listingUrl, 'https://jiji.com.gh/accra/cleaning-equipment/cleaning-machine-one.html');
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

test('bookmarklet native-clicks a Jiji contact control and waits for the revealed phone', () => {
  let contactText = 'Show contact';
  let nativeClicks = 0;
  const contactButton = {
    get textContent() { return contactText; },
    getAttribute() { return null; },
    scrollIntoView() {},
    focus() {},
    click() {
      nativeClicks += 1;
      contactText = 'Call seller 0540320112';
    },
    matches(selector) { return selector.includes('contact'); },
    dispatchEvent() {},
  };
  const document = createMockDocument({
    selectorAll: {
      'button,[role="button"],a.js-show-contact,a.qa-show-contact,a.cy-show-contact,button[class*="phone" i],button[class*="contact" i],[data-testid*="phone" i],[data-testid*="contact" i]': [contactButton],
      '[data-testid*="contact" i]': [contactButton],
    },
  });
  const opened = [];
  const source = createMarketplaceCaptureBookmarklet({
    intakeUrl: 'https://app.whisperm.test/marketplace-acquisition/capture/intake',
  }).replace(/^javascript:/u, '');

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
    window: { open(url) { opened.push(url); } },
    alert(message) { throw new Error(message); },
    confirm() { return true; },
    setTimeout(callback) { callback(); },
  });

  assert.equal(nativeClicks, 1);
  assert.equal(opened.length, 1);
  const payload = JSON.parse(decodeURIComponent(new URL(opened[0]).searchParams.get('payload')));
  assert.equal(payload.phone, '0540320112');
});

test('extractor captures phone from revealed contact button text', () => {
  const document = createMockDocument({
    selectors: {
      '[data-testid*="phone" i]': node({ textContent: 'Call seller +233 55 123 4567' }),
    },
  });

  const payload = extractMarketplaceCapturePayload(document, listingUrl, 'test-agent');

  assert.equal(payload.phone, '+233 55 123 4567');
});

test('extractor infers GHS currency from Ghana cedi price text', () => {
  const document = createMockDocument({
    selectors: {
      '.qa-advert-price-view-value': node({ textContent: 'GH₵ 250,000' }),
    },
  });

  const payload = extractMarketplaceCapturePayload(document, listingUrl, 'test-agent');

  assert.equal(payload.priceText, 'GH₵ 250,000');
  assert.equal(payload.currency, 'GHS');
});

test('extractor captures portfolio listing cards when present', () => {
  const document = createMockDocument({
    selectorAll: {
      'a[href]': [
        node({
          textContent: 'Toyota Corolla GH₵ 120,000',
          attributes: {
            href: '/accra/cars/toyota-corolla-abc.html',
          },
        }),
        node({
          textContent: 'Honda Civic GH₵ 95,000',
          attributes: {
            href: '/accra/cars/honda-civic-def.html',
          },
        }),
      ],
    },
  });

  const payload = extractMarketplaceCapturePayload(document, listingUrl, 'test-agent');

  assert.ok(Array.isArray(payload.portfolioListings));
  assert.ok(payload.portfolioListings.length >= 2);
});


test('phone extraction captures compact Ghana mobile numbers revealed in Jiji body text', () => {
  const document = createMockDocument({
    bodyText: 'Show contact 0540320112 Copy 0558368943 Copy',
  });

  const payload = extractMarketplaceCapturePayload(document, listingUrl, 'test-agent');

  assert.equal(payload.phone, '0540320112');
});
