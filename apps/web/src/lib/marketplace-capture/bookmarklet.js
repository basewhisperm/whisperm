const marketplaceCaptureMaxPayloadBytes = 12000;

/** @param {string} value */
function byteLength(value) { return new TextEncoder().encode(value).length; }

/** @param {unknown} value @param {number} [limit] */
const clean = (value, limit = 500) => typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim().slice(0, limit) : '';

/** @param {string} url */
export function detectMarketplaceSource(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./u, '').split('.').slice(-2).join('.'); } catch { return 'unknown'; }
}

/** @param {string} url */
export function deriveMarketplaceListingId(url) {
  try {
    const parsed = new URL(url);
    for (const key of ['listingId', 'listing_id', 'itemId', 'item_id', 'id']) {
      const value = clean(parsed.searchParams.get(key) || '', 255);
      if (value) return value;
    }
    return clean(parsed.pathname.split('/').filter(Boolean).pop() || '', 255) || undefined;
  } catch { return undefined; }
}

/**
 * Extracts public listing snapshot fields from the current document without reading private browser state.
 * @param {Document} doc
 * @param {Location | URL | { readonly href: string, readonly hostname: string }} locationLike
 * @param {string} [userAgent]
 */
export function extractMarketplaceCapturePayload(doc, locationLike, userAgent = '') {
  const href = clean(locationLike.href, 2000);
  const hostname = clean(locationLike.hostname, 255).toLowerCase();
  const meta = (name) => clean(doc.querySelector(`meta[property="${name}"],meta[name="${name}"]`)?.getAttribute('content') || '', 1000);
  const arr = (value) => Array.isArray(value) ? value : [value];
  const typeOf = (value) => arr(value && value['@type']).map((type) => clean(String(type), 80).toLowerCase());
  const findSchema = (value, depth = 0, names = ['product', 'offer']) => {
    if (!value || depth > 4) return null;
    if (Array.isArray(value)) { for (const item of value.slice(0, 20)) { const found = findSchema(item, depth + 1, names); if (found) return found; } return null; }
    if (typeof value === 'object') {
      if (typeOf(value).some((type) => names.includes(type))) return value;
      if (value['@graph']) return findSchema(value['@graph'], depth + 1, names);
    }
    return null;
  };
  let product = null;
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).slice(0, 8)) {
    try { product = findSchema(JSON.parse(script.textContent || 'null')); } catch {}
    if (product) break;
  }
  const offer = Array.isArray(product && product.offers) ? product.offers[0] : product && product.offers;
  const selectorText = (selectors, limit = 500) => {
    for (const selector of selectors) { const value = clean(doc.querySelector(selector)?.textContent || '', limit); if (value) return value; }
    return '';
  };
  const selectorHref = (selectors) => {
    for (const selector of selectors) { const value = clean(doc.querySelector(selector)?.getAttribute('href') || '', 2000); if (value) { try { return new URL(value, href).toString(); } catch { return value; } } }
    return '';
  };
  const bodyText = clean(doc.body?.innerText || '', 5000);
  const email = clean((bodyText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu) || [])[0] || '', 320);
  const phone = clean((bodyText.match(/(?:\+?\d[\d\s().-]{7,}\d)/u) || [])[0] || '', 64);
  const price = clean((offer?.priceCurrency ? `${offer.priceCurrency} ` : '') + (offer?.price || ''), 120) || meta('product:price:amount') || meta('og:price:amount') || selectorText([
    '.qa-advert-price-view',
    '[itemprop="price"]',
    '[class*="price" i]',
    '[data-testid*="price" i]'
  ], 120);
  const images = arr(product?.image).concat([meta('og:image'), meta('twitter:image')], Array.from(doc.querySelectorAll('[itemprop="image"], img')).map((img) => img.getAttribute('content') || img.getAttribute('src'))).map((url) => { try { return new URL(clean(String(url), 2000), href).toString(); } catch { return clean(String(url), 2000); } }).filter(Boolean);
  const sellerName = clean(product?.brand?.name, 255) || selectorText(['[itemprop="seller"]', '[rel="author"]', 'a[href*="seller" i]', 'a[href*="profile" i]', '[class*="seller" i]', '[data-testid*="seller" i]'], 255);
  const sellerProfileUrl = selectorHref(['a[href*="seller" i]', 'a[href*="profile" i]', '[rel="author"]']);
  const strategy = product ? 'jsonld' : (meta('og:title') || meta('og:description') ? 'opengraph' : 'fallback');
  return {
    sourceUrl: href,
    sourceHost: hostname,
    listingUrl: href,
    marketplaceSource: detectMarketplaceSource(href),
    sourceMarketplace: detectMarketplaceSource(href),
    marketplaceListingId: deriveMarketplaceListingId(href),
    title: clean(product?.name, 300) || meta('og:title') || clean(doc.title, 300),
    description: clean(product?.description, 1000) || meta('og:description') || meta('description'),
    priceText: price,
    price,
    currency: clean(offer?.priceCurrency || meta('product:price:currency'), 16),
    images: Array.from(new Set(images)).slice(0, 6),
    imageUrls: Array.from(new Set(images)).slice(0, 6),
    category: clean(product?.category, 255) || meta('product:category') || selectorText(['[itemprop="category"]', '[class*="category" i]'], 255),
    sellerName,
    sellerProfileUrl,
    marketplaceIdentifier: sellerProfileUrl || sellerName || undefined,
    phone: phone || undefined,
    email: email || undefined,
    location: selectorText(['[itemprop="address"]', '[class*="location" i]', '[data-testid*="location" i]'], 255) || undefined,
    capturedAt: new Date().toISOString(),
    pageUrl: href,
    userAgent: clean(userAgent, 1024) || undefined,
    rawExtract: { strategy },
  };
}

export function encodeMarketplaceCapturePayload(payload) {
  const serialized = JSON.stringify(payload);
  if (byteLength(serialized) > marketplaceCaptureMaxPayloadBytes) return null;
  return encodeURIComponent(serialized);
}

export function createMarketplaceCaptureBookmarklet(options) {
  const intakeUrlLiteral = JSON.stringify(options.intakeUrl);
  const source = `const clean=${clean.toString()};${detectMarketplaceSource.toString()};${deriveMarketplaceListingId.toString()};${extractMarketplaceCapturePayload.toString()};const MAX=${marketplaceCaptureMaxPayloadBytes};const INTAKE=${intakeUrlLiteral};const payload=extract(document,window.location,navigator.userAgent);const json=JSON.stringify(payload);if(new TextEncoder().encode(json).length>MAX){alert('WhispeRM capture is too large. Capture a single public listing page and try again.');return}window.open(INTAKE+'?payload='+encodeURIComponent(json),'_blank','noopener,noreferrer')`;
  return `javascript:(function(){${source}})()`;
}

export { marketplaceCaptureMaxPayloadBytes as MARKETPLACE_CAPTURE_MAX_PAYLOAD_BYTES };
