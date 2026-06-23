const marketplaceCaptureMaxPayloadBytes = 12000;

/** @param {string} value */
function byteLength(value) { return new TextEncoder().encode(value).length; }

/** @param {unknown} value @param {number} [limit] */
const clean = (value, limit = 500) => typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim().slice(0, limit) : '';
const scalar = (value) => typeof value === 'string' || typeof value === 'number' ? String(value) : '';

const compoundSecondLevelHostSuffixes = new Set(['com', 'co', 'org', 'net', 'gov', 'edu', 'ac']);

/** @param {string} url */
export function detectMarketplaceSource(url) {
  try {
    const segments = new URL(url).hostname.toLowerCase().replace(/^www\./u, '').split('.');
    const lastTwo = segments.slice(-2);
    if (segments.length > 2 && compoundSecondLevelHostSuffixes.has(lastTwo[0])) {
      return segments.slice(-3).join('.');
    }
    return lastTwo.join('.');
  } catch { return 'unknown'; }
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
  const phoneRegex = /(?:\+233|233|0)\s?\d{2,3}[\s.-]?\d{3}[\s.-]?\d{3,4}|(?:\+233|233|0)\d{9}|(?:\+?\d[\d\s().-]{7,}\d)/u;
  const phoneFromHref = (raw) => {
    const value = clean(raw || "", 500);
    if (!value) return "";
    try {
      const parsed = new URL(value, href);
      const direct = parsed.protocol === "tel:" ? parsed.pathname : "";
      const whatsapp = parsed.hostname.includes("wa.me")
        ? parsed.pathname.replace(/^\//u, "")
        : parsed.searchParams.get("phone") || "";
      return clean((direct || whatsapp).replace(/[^+\d]/gu, ""), 64);
    } catch {
      return clean(value.replace(/^tel:/iu, "").replace(/[^+\d]/gu, ""), 64);
    }
  };
  const hrefPhone = Array.from(doc.querySelectorAll('a[href]'))
    .map((a) => phoneFromHref(a.getAttribute('href')))
    .find((value) => phoneRegex.test(value)) || "";
  const contactText = selectorText([
    '[data-testid*="phone" i]',
    '[data-testid*="contact" i]',
    '[class*="phone" i]',
    '[class*="contact" i]',
    '.b-seller-block',
    '.b-seller-block__contacts',
    '.b-seller-block__phone',
  ], 2000);
  const sellerBlockText = clean(doc.querySelector('.b-seller-block')?.textContent || '', 2000);
  const phoneSearchText = phoneRegex.test(contactText) ? contactText : (phoneRegex.test(sellerBlockText) ? sellerBlockText : bodyText);
  const phone = hrefPhone || clean((phoneSearchText.match(phoneRegex) || [])[0] || '', 64);

  const offerPrice = scalar(offer?.price);
  const offerCurrency = scalar(offer?.priceCurrency);
  const price = clean((offerCurrency ? `${offerCurrency} ` : '') + offerPrice, 120) || meta('product:price:amount') || meta('og:price:amount') || selectorText([
    '.qa-advert-price-view-value',
    '[itemprop="price"]',
    '[data-testid*="price" i]',
    '.qa-advert-price-view',
    '[class*="price" i]'
  ], 120);
  const inferCurrency = (value) => /(?:GH₵|GH¢|GHS|₵)/iu.test(value || '') ? 'GHS' : '';
  const currency = clean(offer?.priceCurrency || meta('product:price:currency') || inferCurrency(price), 16);

  const images = arr(product?.image).concat([meta('og:image'), meta('twitter:image')], Array.from(doc.querySelectorAll('[itemprop="image"], img')).map((img) => img.getAttribute('content') || img.getAttribute('src'))).map((url) => { try { return new URL(clean(String(url), 2000), href).toString(); } catch { return clean(String(url), 2000); } }).filter(Boolean);
  const sellerName = clean(product?.brand?.name, 255) || selectorText(['[itemprop="seller"]', '.b-seller-block__name', '[rel="author"]', 'a[href*="profile" i]', 'a[href*="seller" i]', '[class*="seller" i]'], 255);
  const sellerProfileUrl = selectorHref(['a[href*="seller" i]', 'a[href*="profile" i]', '[rel="author"]']);

  const portfolioListings = Array.from(doc.querySelectorAll('a[href]')).map((link) => {
    const listingUrl = selectorHref([link.matches ? '' : '']);
    const hrefValue = clean(link.getAttribute('href') || '', 2000);
    let absoluteUrl = '';
    try { absoluteUrl = new URL(hrefValue, href).toString(); } catch { absoluteUrl = hrefValue; }
    const title = clean(link.textContent || '', 300);
    const priceMatch = title.match(/(?:GH₵|GH¢|GHS|₵|USD|\$)\s?[\d,.]+/iu);
    const priceText = clean((priceMatch || [])[0] || '', 120);
    return {
      listingUrl: absoluteUrl || undefined,
      marketplaceListingId: deriveMarketplaceListingId(absoluteUrl),
      title,
      price: priceText || undefined,
      priceText: priceText || undefined,
      currency: inferCurrency(priceText) || undefined,
      metadata: { source: 'bookmarklet-link' },
    };
  }).filter((item) => item.title && item.listingUrl && item.listingUrl !== href).slice(0, 25);

  const strategy = product ? 'jsonld' : (meta('og:title') || meta('og:description') ? 'opengraph' : 'fallback');
  const productMicrodataCount = doc.querySelectorAll('[itemtype*="schema.org/Product"]').length;
  const looksLikeGridPage = productMicrodataCount > 1;

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
    currency,
    images: Array.from(new Set(images)).slice(0, 6),
    imageUrls: Array.from(new Set(images)).slice(0, 6),
    category: clean(product?.category, 255) || meta('product:category') || selectorText(['[itemprop="category"]', '[class*="category" i]'], 255),
    sellerName,
    rawSellerText: sellerName || undefined,
    sellerProfileUrl,
    marketplaceIdentifier: phone || sellerProfileUrl || sellerName || undefined,
    phone: phone || undefined,
    email: email || undefined,
    location: selectorText(['[itemprop="address"]', '[class*="location" i]', '[data-testid*="location" i]'], 255) || undefined,
    capturedAt: new Date().toISOString(),
    pageUrl: href,
    userAgent: clean(userAgent, 1024) || undefined,
    rawExtract: { strategy },
    portfolioListings,
    looksLikeGridPage,
  };
}

export function encodeMarketplaceCapturePayload(payload) {
  const serialized = JSON.stringify(payload);
  if (byteLength(serialized) > marketplaceCaptureMaxPayloadBytes) return null;
  return encodeURIComponent(serialized);
}

export function createMarketplaceCaptureBookmarklet(options) {
  const intakeUrlLiteral = JSON.stringify(options.intakeUrl);
  const source = String.raw`
const INTAKE=__INTAKE_URL__;
const MAX=12000;
const clean=(value,limit=500)=>typeof value==="string"?value.replace(/\s+/gu," ").trim().slice(0,limit):"";
const scalar=(value)=>typeof value==="string"||typeof value==="number"?String(value):"";
const suffixes=new Set(["com","co","org","net","gov","edu","ac"]);
const detectMarketplaceSource=(url)=>{try{const segments=new URL(url).hostname.toLowerCase().replace(/^www\./u,"").split(".");const lastTwo=segments.slice(-2);return segments.length>2&&suffixes.has(lastTwo[0])?segments.slice(-3).join("."):lastTwo.join(".")}catch{return"unknown"}};
const deriveMarketplaceListingId=(url)=>{try{const parsed=new URL(url);for(const key of["listingId","listing_id","itemId","item_id","id"]){const value=clean(parsed.searchParams.get(key)||"",255);if(value)return value}return clean(parsed.pathname.split("/").filter(Boolean).pop()||"",255)||undefined}catch{return undefined}};
const extractMarketplaceCapturePayload=(doc,locationLike,userAgent="")=>{
  const href=clean(locationLike.href,2000);
  const hostname=clean(locationLike.hostname,255).toLowerCase();
  const meta=(name)=>clean(doc.querySelector("meta[property=\"" + name + "\"],meta[name=\"" + name + "\"]")?.getAttribute("content")||"",1000);
  const arr=(value)=>Array.isArray(value)?value:[value];
  const typeOf=(value)=>arr(value&&value["@type"]).map((type)=>clean(String(type),80).toLowerCase());
  const findSchema=(value,depth=0,names=["product","offer"])=>{
    if(!value||depth>4)return null;
    if(Array.isArray(value)){for(const item of value.slice(0,20)){const found=findSchema(item,depth+1,names);if(found)return found}return null}
    if(typeof value==="object"){if(typeOf(value).some((type)=>names.includes(type)))return value;if(value["@graph"])return findSchema(value["@graph"],depth+1,names)}
    return null;
  };
  let product=null;
  for(const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).slice(0,8)){try{product=findSchema(JSON.parse(script.textContent||"null"))}catch{}if(product)break}
  const offer=Array.isArray(product&&product.offers)?product.offers[0]:product&&product.offers;
  const selectorText=(selectors,limit=500)=>{for(const selector of selectors){const value=clean(doc.querySelector(selector)?.textContent||"",limit);if(value)return value}return""};
  const selectorHref=(selectors)=>{for(const selector of selectors){const value=clean(doc.querySelector(selector)?.getAttribute("href")||"",2000);if(value){try{return new URL(value,href).toString()}catch{return value}}}return""};
  const bodyText=clean(doc.body?.innerText||"",5000);
  const email=clean((bodyText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu)||[])[0]||"",320);
  const phoneRegex=/(?:\+233|233|0)\s?\d{2,3}[\s.-]?\d{3}[\s.-]?\d{3,4}|(?:\+?\d[\d\s().-]{7,}\d)/u;
  const phoneFromHref=(raw)=>{const value=clean(raw||"",500);if(!value)return"";try{const parsed=new URL(value,href);const direct=parsed.protocol==="tel:"?parsed.pathname:"";const whatsapp=parsed.hostname.includes("wa.me")?parsed.pathname.replace(/^\//u,""):parsed.searchParams.get("phone")||"";return clean((direct||whatsapp).replace(/[^+\d]/gu,""),64)}catch{return clean(value.replace(/^tel:/iu,"").replace(/[^+\d]/gu,""),64)}};
  const hrefPhone=Array.from(doc.querySelectorAll("a[href]")).map((a)=>phoneFromHref(a.getAttribute("href"))).find((value)=>phoneRegex.test(value))||"";
  const contactText=selectorText(['[data-testid*="phone" i]','[data-testid*="contact" i]','[class*="phone" i]','[class*="contact" i]','.b-seller-block','.b-seller-block__contacts','.b-seller-block__phone'],2000);
  const sellerBlockText=clean(doc.querySelector(".b-seller-block")?.textContent||"",2000);
  const phoneSearchText=phoneRegex.test(contactText)?contactText:(phoneRegex.test(sellerBlockText)?sellerBlockText:bodyText);
  const phone=hrefPhone||clean((phoneSearchText.match(phoneRegex)||[])[0]||"",64);
  const offerPrice=scalar(offer?.price);
const offerCurrency=scalar(offer?.priceCurrency);
const price=clean((offerCurrency ? offerCurrency + " " : "")+offerPrice,120)||meta("product:price:amount")||meta("og:price:amount")||selectorText([".qa-advert-price-view-value",'[itemprop="price"]','[data-testid*="price" i]',".qa-advert-price-view",'[class*="price" i]'],120);
  const inferCurrency=(value)=>/(?:GH₵|GH¢|GHS|₵)/iu.test(value||"")?"GHS":"";
  const currency=clean(offer?.priceCurrency||meta("product:price:currency")||inferCurrency(price),16);
  const images=arr(product?.image).concat([meta("og:image"),meta("twitter:image")],Array.from(doc.querySelectorAll('[itemprop="image"], img')).map((img)=>img.getAttribute("content")||img.getAttribute("src"))).map((url)=>{try{return new URL(clean(String(url),2000),href).toString()}catch{return clean(String(url),2000)}}).filter(Boolean);
  const sellerName=clean(product?.brand?.name,255)||selectorText(['[itemprop="seller"]',".b-seller-block__name",'[rel="author"]','a[href*="profile" i]','a[href*="seller" i]','[class*="seller" i]'],255);
  const sellerProfileUrl=selectorHref(['a[href*="seller" i]','a[href*="profile" i]','[rel="author"]']);
  const portfolioListings=Array.from(doc.querySelectorAll("a[href]")).map((link)=>{const hrefValue=clean(link.getAttribute("href")||"",2000);let absoluteUrl="";try{absoluteUrl=new URL(hrefValue,href).toString()}catch{absoluteUrl=hrefValue}const title=clean(link.textContent||"",300);const priceMatch=title.match(/(?:GH₵|GH¢|GHS|₵|USD|\$)\s?[\d,.]+/iu);const priceText=clean((priceMatch||[])[0]||"",120);return{listingUrl:absoluteUrl||undefined,marketplaceListingId:deriveMarketplaceListingId(absoluteUrl),title,price:priceText||undefined,priceText:priceText||undefined,currency:inferCurrency(priceText)||undefined,metadata:{source:"bookmarklet-link"}}}).filter((item)=>item.title&&item.listingUrl&&item.listingUrl!==href).slice(0,25);
  const strategy=product?"jsonld":(meta("og:title")||meta("og:description")?"opengraph":"fallback");
  const productMicrodataCount=doc.querySelectorAll('[itemtype*="schema.org/Product"]').length;
  return{sourceUrl:href,sourceHost:hostname,listingUrl:href,marketplaceSource:detectMarketplaceSource(href),sourceMarketplace:detectMarketplaceSource(href),marketplaceListingId:deriveMarketplaceListingId(href),title:clean(product?.name,300)||meta("og:title")||clean(doc.title,300),description:clean(product?.description,1000)||meta("og:description")||meta("description"),priceText:price,price,currency,images:Array.from(new Set(images)).slice(0,6),imageUrls:Array.from(new Set(images)).slice(0,6),category:clean(product?.category,255)||meta("product:category")||selectorText(['[itemprop="category"]','[class*="category" i]'],255),sellerName,rawSellerText:sellerName||undefined,sellerProfileUrl,marketplaceIdentifier:phone||sellerProfileUrl||sellerName||undefined,phone:phone||undefined,email:email||undefined,location:selectorText(['[itemprop="address"]','[class*="location" i]','[data-testid*="location" i]'],255)||undefined,capturedAt:new Date().toISOString(),pageUrl:href,userAgent:clean(userAgent,1024)||undefined,rawExtract:{strategy},portfolioListings,looksLikeGridPage:productMicrodataCount>1};
};
const reveal=()=>{const nodes=Array.from(document.querySelectorAll('button,[role="button"],a.js-show-contact,a.qa-show-contact,a.cy-show-contact,button[class*="phone" i],button[class*="contact" i],[data-testid*="phone" i],[data-testid*="contact" i]'));const targets=nodes.filter((e)=>{const href=(e.getAttribute&&e.getAttribute("href")||"").toLowerCase();if(href.startsWith("tel:")||href.includes("wa.me")||href.includes("whatsapp"))return false;return /show\s+contact|show\s+phone|reveal\s+phone|phone|contact/i.test((e.textContent||"").trim())||e.matches('a.js-show-contact,a.qa-show-contact,a.cy-show-contact,button[class*="phone" i],button[class*="contact" i],[data-testid*="phone" i],[data-testid*="contact" i]')}).slice(0,3);for(const c of targets){try{c.scrollIntoView({block:"center"});["mouseover","mousedown","mouseup","click"].forEach((t)=>c.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window})))}catch{}}};
const finish=()=>{const payload=extractMarketplaceCapturePayload(document,location,(navigator&&navigator.userAgent)||"");const json=JSON.stringify(payload);if(new TextEncoder().encode(json).length>MAX){alert("WhispeRM capture is too large. Capture a single public listing page and try again.");return}if(payload.looksLikeGridPage&&!confirm("This looks like a search results page, not a single listing. Capture anyway?"))return;window.open(INTAKE+"?payload="+encodeURIComponent(json),"_blank","noopener,noreferrer")};
reveal();
setTimeout(finish,2500);
`.replace("__INTAKE_URL__", intakeUrlLiteral);
  return `javascript:(function(){${source}})()`;
}
export { marketplaceCaptureMaxPayloadBytes as MARKETPLACE_CAPTURE_MAX_PAYLOAD_BYTES };
