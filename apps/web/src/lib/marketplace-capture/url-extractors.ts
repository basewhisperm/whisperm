export interface UrlCaptureExtraction {
  readonly sourceUrl: string;
  readonly sourceHost: string;
  readonly listingUrl: string;
  readonly marketplaceSource: string;
  readonly sourceMarketplace: string;
  readonly marketplaceListingId?: string | undefined;
  readonly title: string;
  readonly description: string;
  readonly priceText: string;
  readonly price: string;
  readonly currency?: string | undefined;
  readonly images: string[];
  readonly imageUrls: string[];
  readonly sellerName?: string | undefined;
  readonly sellerProfileUrl?: string | undefined;
  readonly marketplaceIdentifier?: string | undefined;
  readonly phone?: string | undefined;
  readonly location?: string | undefined;
  readonly pageUrl: string;
  readonly capturedAt: string;
  readonly rawExtract: {
    readonly strategy: "url-fetch";
    readonly adapter: "jiji" | "tonaton" | "fallback";
    readonly rawSellerText?: string | undefined;
    readonly extractionWarnings?: readonly string[] | undefined;
  };
}

const text = (value: string | undefined | null, max = 1000): string =>
  (value ?? "").replace(/\s+/gu, " ").trim().slice(0, max);

const decodeHtml = (value: string): string =>
  value
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#34;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&nbsp;/giu, " ");

const escapedRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

export const metaFromHtml = (html: string, name: string): string => {
  const escaped = escapedRegex(name);
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "iu"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "iu"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return text(decodeHtml(match[1]), 1000);
  }

  return "";
};

const titleFromHtml = (html: string): string => {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/iu);
  return text(decodeHtml(match?.[1] ?? ""), 300);
};

const visibleText = (html: string): string =>
  text(
    decodeHtml(
      html
        .replace(/<script[\s\S]*?<\/script>/giu, " ")
        .replace(/<style[\s\S]*?<\/style>/giu, " ")
        .replace(/<[^>]+>/gu, " "),
    ),
    12000,
  );

export const detectMarketplaceSource = (url: string): string => {
  const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./u, "");
  if (hostname.endsWith("jiji.com.gh")) return "jiji.com.gh";
  if (hostname.endsWith("tonaton.com")) return "tonaton.com";
  return hostname;
};

const listingIdFromUrl = (url: string): string | undefined => {
  const parsed = new URL(url);
  return text(parsed.searchParams.get("lid") ?? parsed.pathname.split("/").filter(Boolean).at(-1), 255) || undefined;
};

const priceFromText = (bodyText: string): string | undefined => {
  const match = bodyText.match(/(?:GH₵|GHS|₵|GH¢)\s?[0-9][0-9,.\s]*/iu);
  return match ? text(match[0], 120) : undefined;
};

const priceFromHtml = (html: string, bodyText: string): string | undefined => {
  const decoded = decodeHtml(html);

  const jsonPrice =
    decoded.match(/"price"\s*:\s*"([^"]+)"/iu)?.[1] ||
    decoded.match(/"price"\s*:\s*([0-9][0-9,.]*)/iu)?.[1] ||
    decoded.match(/"amount"\s*:\s*"([^"]+)"/iu)?.[1];

  const metaPrice =
    metaFromHtml(html, "product:price:amount") ||
    metaFromHtml(html, "og:price:amount") ||
    metaFromHtml(html, "twitter:data1");

  const raw = text(jsonPrice || metaPrice || priceFromText(bodyText), 120);
  if (!raw) return undefined;
  return /^(?:GH₵|GHS|₵|GH¢)/iu.test(raw) ? raw : `GH₵ ${raw}`;
};

const phoneFromText = (bodyText: string): string | undefined => {
  const match = bodyText.match(/(?:\+233|233|0)\s?\d{2,3}[\s.-]?\d{3}[\s.-]?\d{3,4}/u);
  return match ? text(match[0].replace(/\s|\.|-/gu, ""), 64) : undefined;
};

const phoneFromHtml = (html: string, bodyText: string): string | undefined => {
  const decoded = decodeHtml(html);
  const candidates = [
    ...Array.from(decoded.matchAll(/href=["']tel:([^"']+)["']/giu)).map((match) => match[1]),
    ...Array.from(decoded.matchAll(/"phone(?:Number)?"\s*:\s*"([^"]+)"/giu)).map((match) => match[1]),
    ...Array.from(decoded.matchAll(/"telephone"\s*:\s*"([^"]+)"/giu)).map((match) => match[1]),
    phoneFromText(bodyText),
  ];

  return candidates.map((candidate) => text(candidate, 64).replace(/\s|\.|-/gu, "")).find(Boolean);
};

const imagesFromHtml = (html: string, url: string): string[] => {
  const candidates = [
    metaFromHtml(html, "og:image"),
    metaFromHtml(html, "twitter:image"),
    ...Array.from(html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/giu)).map((match) => match[1] ?? ""),
  ];

  return Array.from(
    new Set(
      candidates
        .map((candidate) => {
          try {
            return new URL(text(candidate, 2048), url).toString();
          } catch {
            return "";
          }
        })
        .filter(Boolean),
    ),
  ).slice(0, 10);
};

const sellerProfileFromHtml = (html: string, url: string): string | undefined => {
  const href = Array.from(html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>/giu))
    .map((match) => text(match[1], 2048))
    .find((candidate) => /seller|profile|user|shop|store/iu.test(candidate));

  if (!href) return undefined;

  try {
    return new URL(href, url).toString();
  } catch {
    return href;
  }
};

const locationFromText = (bodyText: string): string | undefined => {
  const match = bodyText.match(/\b(?:Accra Metropolitan|East Legon|Cape Coast|Accra|Kumasi|Tema|Takoradi|Tamale|Spintex|Osu|Madina|Kasoa|Achimota|Dansoman|Adenta|Ashaiman)\b(?:[\w\s,-]{0,80}?)(?=\s+(?:Call|Seller|Posted by|Dealer|Vendor|\+233|0\d)|$)/iu);
  return match ? text(match[0], 255) : undefined;
};

const sellerNameFromText = (bodyText: string): string | undefined => {
  const match = bodyText.match(/(?:Seller|Posted by|Dealer|Vendor)\s*:?\s*([A-Z][\w .'-]{2,80}?)(?=\s+(?:Accra|Kumasi|Tema|Takoradi|Cape Coast|Tamale|East Legon|Spintex|Osu|Madina|Kasoa|Achimota|Dansoman|Adenta|Ashaiman|Accra Metropolitan|Call|\+233|0\d)|$)/u);
  return match?.[1] ? text(match[1], 120) : undefined;
};

const cleanSellerName = (value: string | undefined): string | undefined => {
  const raw = text(value, 255);
  if (!raw) return undefined;
  const cleaned = raw
    .replace(/\bVerified ID\b/giu, " ")
    .replace(/\bNew on Jiji\b/giu, " ")
    .replace(/\bLast seen\s+.+?(?=\s+Typically replies|\s+Verified ID|\s+New on Jiji|$)/giu, " ")
    .replace(/\bTypically replies\s+.+?(?=\s+Last seen|\s+Verified ID|\s+New on Jiji|$)/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return cleaned || raw;
};

const adapterFor = (url: string): UrlCaptureExtraction["rawExtract"]["adapter"] => {
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./u, "");
  if (host.endsWith("jiji.com.gh")) return "jiji";
  if (host.endsWith("tonaton.com")) return "tonaton";
  return "fallback";
};

export const extractMarketplaceUrlCapture = (url: string, html: string, now: Date = new Date()): UrlCaptureExtraction => {
  const parsed = new URL(url);
  const bodyText = visibleText(html);
  const marketplaceSource = detectMarketplaceSource(url);
  const adapter = adapterFor(url);

  const priceText = priceFromHtml(html, bodyText) || "";
  const title =
    metaFromHtml(html, "og:title") ||
    metaFromHtml(html, "twitter:title") ||
    titleFromHtml(html) ||
    parsed.pathname.split("/").filter(Boolean).at(-1) ||
    url;

  const description =
    metaFromHtml(html, "og:description") ||
    metaFromHtml(html, "description") ||
    "";

  const sellerProfileUrl = sellerProfileFromHtml(html, url);
  const phone = phoneFromHtml(html, bodyText);
  const rawSellerName = sellerNameFromText(bodyText);
  const sellerName = cleanSellerName(rawSellerName);
  const location = locationFromText(bodyText);
  const images = imagesFromHtml(html, url);

  return {
    sourceUrl: url,
    sourceHost: parsed.hostname.toLowerCase(),
    listingUrl: url,
    marketplaceSource,
    sourceMarketplace: marketplaceSource,
    marketplaceListingId: listingIdFromUrl(url),
    title,
    description,
    priceText,
    price: priceText,
    currency: /GH₵|GHS|₵|GH¢/iu.test(priceText) ? "GHS" : undefined,
    images,
    imageUrls: images,
    sellerName,
    sellerProfileUrl,
    marketplaceIdentifier: phone ?? sellerProfileUrl ?? sellerName,
    phone,
    location,
    pageUrl: url,
    capturedAt: now.toISOString(),
    rawExtract: { strategy: "url-fetch", adapter, rawSellerText: rawSellerName, extractionWarnings: phone === undefined ? ["PHONE_NOT_VISIBLE_URL_CAPTURE_BLOCKED_FOR_QUALIFICATION"] : [] },
  };
};
