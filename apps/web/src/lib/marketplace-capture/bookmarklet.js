const marketplaceCaptureMaxPayloadBytes = 12000;

/**
 * @typedef {Readonly<{
 *   sourceUrl: string;
 *   sourceHost: string;
 *   title: string;
 *   description: string;
 *   priceText: string;
 *   imageUrls: readonly string[];
 *   rawExtract: Readonly<{ strategy: 'jsonld' | 'opengraph' | 'fallback' }>;
 * }>} MarketplaceCapturePayload
 */

/** @param {string} value */
function byteLength(value) {
  return new TextEncoder().encode(value).length;
}

/**
 * Encodes a capture payload for the intake query string after enforcing the shared size limit.
 *
 * @param {MarketplaceCapturePayload} payload
 * @returns {string | null}
 */
export function encodeMarketplaceCapturePayload(payload) {
  const serialized = JSON.stringify(payload);
  if (byteLength(serialized) > marketplaceCaptureMaxPayloadBytes) return null;
  return encodeURIComponent(serialized);
}

/**
 * Creates the operator bookmarklet. The runtime intentionally reads public document metadata only.
 *
 * @param {Readonly<{ intakeUrl: string }>} options
 * @returns {string}
 */
export function createMarketplaceCaptureBookmarklet(options) {
  const intakeUrlLiteral = JSON.stringify(options.intakeUrl);
  return `javascript:(function(){const MAX=${marketplaceCaptureMaxPayloadBytes};const INTAKE=${intakeUrlLiteral};const clean=function(v,l){return typeof v==='string'?v.replace(/\\s+/g,' ').trim().slice(0,l||500):''};const meta=function(n){const el=document.querySelector('meta[property="'+n+'"],meta[name="'+n+'"]');return clean(el&&el.getAttribute('content'),1000)};const arr=function(v){return Array.isArray(v)?v:[v]};const typeOf=function(v){return arr(v&&v['@type']).map(function(t){return clean(String(t),80).toLowerCase()})};const findProduct=function(v,d){if(!v||d>3)return null;if(Array.isArray(v)){for(let i=0;i<Math.min(v.length,10);i++){const found=findProduct(v[i],d+1);if(found)return found}return null}if(typeof v==='object'){if(typeOf(v).indexOf('product')!==-1)return v;const graph=v['@graph'];if(graph)return findProduct(graph,d+1)}return null};const scripts=Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0,5);let product=null;for(const script of scripts){try{product=findProduct(JSON.parse(script.textContent||'null'),0)}catch(e){}if(product)break}const offer=Array.isArray(product&&product.offers)?product.offers[0]:product&&product.offers;const price=clean((offer&&offer.priceCurrency?offer.priceCurrency+' ':'')+(offer&&offer.price?offer.price:''),120)||meta('product:price:amount')||meta('og:price:amount');const images=arr(product&&product.image).concat([meta('og:image'),meta('twitter:image')]).map(function(v){return clean(String(v),1000)}).filter(Boolean).slice(0,3);const strategy=product?'jsonld':(meta('og:title')||meta('og:description')?'opengraph':'fallback');const payload={sourceUrl:window.location.href,sourceHost:window.location.hostname,title:clean(product&&product.name,300)||meta('og:title')||clean(document.title,300),description:clean(product&&product.description,1000)||meta('og:description')||meta('description'),priceText:price,imageUrls:Array.from(new Set(images)),rawExtract:{strategy:strategy}};const json=JSON.stringify(payload);if(new TextEncoder().encode(json).length>MAX){alert('WhispeRM capture is too large. Capture a single public listing page and try again.');return}window.open(INTAKE+'?payload='+encodeURIComponent(json),'_blank','noopener,noreferrer')})()`;
}

export { marketplaceCaptureMaxPayloadBytes as MARKETPLACE_CAPTURE_MAX_PAYLOAD_BYTES };
