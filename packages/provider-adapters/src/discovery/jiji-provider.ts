import {
  DiscoveryProviderError,
  type DiscoveryProvider,
  type DiscoveryProviderRequest,
  type DiscoveryProviderResponse,
  type NormalizedDiscoveryResult,
} from "../discovery.js";

const JIJI_ORIGIN = "https://jiji.com.gh";
const DEFAULT_TIMEOUT_MS = 15_000;

export interface JijiDiscoveryProviderOptions {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

const slug = (value: string | undefined): string | undefined => {
  const normalized = value?.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
  return normalized && normalized.length > 0 ? normalized : undefined;
};

const decodeHtml = (value: string): string => value
  .replace(/&amp;/gu, "&")
  .replace(/&quot;/gu, '"')
  .replace(/&#39;|&apos;/gu, "'")
  .replace(/&lt;/gu, "<")
  .replace(/&gt;/gu, ">");

const stripTags = (value: string): string => decodeHtml(value.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim());

export const buildJijiSearchUrl = (request: DiscoveryProviderRequest): string => {
  const location = slug(request.search.location);
  const query = [request.search.query, request.search.category].filter((value): value is string => Boolean(value?.trim())).join(" ").trim();
  const url = new URL(location === undefined ? "/search" : `/${location}/search`, JIJI_ORIGIN);
  if (query.length > 0) url.searchParams.set("query", query);
  return url.toString();
};

export const parseJijiSearchResults = (html: string, limit: number): readonly NormalizedDiscoveryResult[] => {
  const results: NormalizedDiscoveryResult[] = [];
  const seen = new Set<string>();
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu;
  for (const match of html.matchAll(anchorPattern)) {
    const href = decodeHtml(match[1] ?? "");
    if (!href.startsWith("/") || href.includes("/search") || href.includes("/login") || href.includes("/register")) continue;
    const candidate = new URL(href, JIJI_ORIGIN);
    const listingUrl = candidate.toString();
    if (candidate.origin !== JIJI_ORIGIN || !candidate.pathname.endsWith(".html") || seen.has(listingUrl)) continue;
    const title = stripTags(match[2] ?? "");
    if (title.length === 0) continue;
    seen.add(listingUrl);
    results.push({ source: "JIJI", listingUrl, title });
    if (results.length >= limit) break;
  }
  return results;
};

export class JijiDiscoveryProvider implements DiscoveryProvider {
  readonly providerKey = "jiji-public-search";
  readonly marketplaceSource = "JIJI";
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: JijiDiscoveryProviderOptions = {}) {
    this.fetcher = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async discover(request: DiscoveryProviderRequest): Promise<DiscoveryProviderResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(buildJijiSearchUrl(request), {
        headers: { Accept: "text/html", "User-Agent": "WhispeRM-Discovery/1.0" },
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new DiscoveryProviderError({
          code: response.status === 429 ? "DISCOVERY_PROVIDER_RATE_LIMITED" : "DISCOVERY_PROVIDER_HTTP_FAILURE",
          message: `JIJI discovery returned HTTP ${response.status}`,
          category: response.status === 429 ? "RATE_LIMITED" : response.status >= 500 ? "TRANSIENT_PROVIDER_FAILURE" : "TERMINAL_PROVIDER_FAILURE",
          providerKey: this.providerKey,
          marketplaceSource: this.marketplaceSource,
        });
      }
      const results = parseJijiSearchResults(await response.text(), request.limits.limit);
      return { providerKey: this.providerKey, marketplaceSource: this.marketplaceSource, results };
    } catch (error) {
      if (error instanceof DiscoveryProviderError) throw error;
      throw new DiscoveryProviderError({
        code: "DISCOVERY_PROVIDER_TRANSIENT_FAILURE",
        message: error instanceof Error && error.name === "AbortError" ? "JIJI discovery timed out" : "JIJI discovery request failed",
        category: "TRANSIENT_PROVIDER_FAILURE",
        providerKey: this.providerKey,
        marketplaceSource: this.marketplaceSource,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}