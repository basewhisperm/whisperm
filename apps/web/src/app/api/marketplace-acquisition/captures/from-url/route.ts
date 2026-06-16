import { NextRequest, NextResponse } from "next/server";
import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { createPrismaRepositories, type PrismaPersistenceClient } from "@whisperm/repositories";
import { createWhispeRMServices, ServiceError } from "@whisperm/services";

const parseRequest = (value: unknown): { readonly url: string } | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const url = typeof (value as { readonly url?: unknown }).url === "string" ? (value as { readonly url: string }).url.trim() : "";
  if (url.length === 0 || url.length > 2048) return null;
  try {
    new URL(url);
    return { url };
  } catch {
    return null;
  }
};

const text = (value: string | undefined | null, max = 1000): string =>
  (value ?? "").replace(/\s+/gu, " ").trim().slice(0, max);

const decodeHtml = (value: string): string =>
  value
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&nbsp;/giu, " ");

const meta = (html: string, name: string): string => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
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

const detectMarketplaceSource = (url: string): string => {
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
  const match = bodyText.match(/(?:GH₵|GHS|₵)\s?[0-9][0-9,.\s]*/iu);
  return match ? text(match[0], 120) : undefined;
};

const phoneFromText = (bodyText: string): string | undefined => {
  const match = bodyText.match(/(?:\+233|0)\s?\d{2,3}[\s.-]?\d{3}[\s.-]?\d{3,4}/u);
  return match ? text(match[0], 64) : undefined;
};

const imagesFromHtml = (html: string, url: string): readonly string[] => {
  const candidates = [
    meta(html, "og:image"),
    meta(html, "twitter:image"),
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

const extractFromHtml = (url: string, html: string) => {
  const parsed = new URL(url);
  const bodyText = visibleText(html);
  const marketplaceSource = detectMarketplaceSource(url);
  const priceText = meta(html, "product:price:amount") || meta(html, "og:price:amount") || priceFromText(bodyText) || "";
  const title = meta(html, "og:title") || meta(html, "twitter:title") || titleFromHtml(html) || parsed.pathname.split("/").filter(Boolean).at(-1) || url;
  const description = meta(html, "og:description") || meta(html, "description") || "";

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
    currency: /GH₵|GHS|₵/iu.test(priceText) ? "GHS" : undefined,
    images: imagesFromHtml(html, url),
    imageUrls: imagesFromHtml(html, url),
    sellerName: undefined,
    phone: phoneFromText(bodyText),
    location: undefined,
    pageUrl: url,
    capturedAt: new Date().toISOString(),
    rawExtract: { strategy: "url-fetch" },
  };
};

export async function POST(request: NextRequest) {
  const tenant = await getTenantForCurrentUser();
  if (!tenant) return NextResponse.json({ ok: false, error: { message: "Unauthorized" } }, { status: 401 });

  const parsed = parseRequest(await request.json().catch(() => ({})));
  if (parsed === null) return NextResponse.json({ ok: false, error: { message: "A valid listing URL is required." } }, { status: 400 });

  const url = parsed.url;
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return NextResponse.json({ ok: false, error: { message: "URL must use http or https." } }, { status: 400 });
  }

  try {
    const response = await fetch(url, {
      headers: {
        "accept": "text/html,application/xhtml+xml",
        "user-agent": "WhispeRM Seller Capture/1.0",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return NextResponse.json({ ok: false, error: { message: `Listing fetch failed with status ${response.status}.` } }, { status: 502 });
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) {
      return NextResponse.json({ ok: false, error: { message: "Listing URL did not return HTML." } }, { status: 415 });
    }

    const html = (await response.text()).slice(0, 500_000);
    const captureInput = extractFromHtml(response.url || url, html);

    const repositories = createPrismaRepositories(prisma as unknown as PrismaPersistenceClient);
    const services = createWhispeRMServices(repositories);

    const result = await services.marketplaceAcquisition.capture(
      {
        tenantId: tenant.id,
        correlation: {
          correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
          requestId: request.headers.get("x-request-id") ?? undefined,
        },
      },
      { tenantId: tenant.id, ...captureInput, images: [...captureInput.images], imageUrls: [...captureInput.imageUrls] },
    );

    return NextResponse.json({ ok: true, data: result, extracted: captureInput });
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json({ ok: false, error: { message: error.message, code: error.code } }, { status: error.status });
    }

    return NextResponse.json({ ok: false, error: { message: "URL capture failed." } }, { status: 500 });
  }
}
