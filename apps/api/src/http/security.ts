/**
 * security.ts — Centralized security middleware for WhispeRM API.
 * Provides: security headers, input sanitization, in-memory rate limiter.
 */
import type { FastifyReplyLike, FastifyRequestLike } from "./fastify.js";
import { firstHeaderValue } from "./fastify.js";

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://js.stripe.com https://js.paystack.co https://accounts.google.com",
  "connect-src 'self' https://api.stripe.com https://hooks.stripe.com https://api.paystack.co https://oauth2.googleapis.com https://www.googleapis.com",
  "frame-src https://js.stripe.com https://hooks.stripe.com",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const HSTS = "max-age=31536000; includeSubDomains; preload";

export const applySecurityHeaders = (reply: FastifyReplyLike): void => {
  reply.header("x-content-type-options", "nosniff");
  reply.header("x-frame-options", "DENY");
  reply.header("content-security-policy", CSP);
  reply.header("strict-transport-security", HSTS);
  reply.header("x-xss-protection", "0");
  reply.header("referrer-policy", "strict-origin-when-cross-origin");
};

const SCRIPT_TAG_RE = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
const EVENT_ATTR_RE = /\s+on\w+\s*=\s*["'][^"']*["']/gi;
const JAVASCRIPT_RE = /javascript\s*:/gi;
const DATA_URI_RE = /data\s*:\s*[^,]*base64/gi;

export const sanitizeString = (value: string): string =>
  value.replace(SCRIPT_TAG_RE, "").replace(EVENT_ATTR_RE, "").replace(JAVASCRIPT_RE, "").replace(DATA_URI_RE, "");

const sanitizeValue = (value: unknown): unknown => {
  if (typeof value === "string") return sanitizeString(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, sanitizeValue(v)]));
  }
  return value;
};

export const sanitizeRequestBody = (request: FastifyRequestLike & { body?: unknown }): void => {
  const method = (request as unknown as { method?: string }).method;
  if (method === "POST" || method === "PATCH" || method === "PUT") {
    if (request.body !== undefined && request.body !== null) {
      request.body = sanitizeValue(request.body);
    }
  }
};

export interface RateLimiter { check(key: string): boolean; reset(): void; }
export interface RateLimiterOptions { maxRequests: number; windowMs: number; }

interface RateLimitBucket { count: number; windowStart: number; }

export const createRateLimiter = (options: RateLimiterOptions): RateLimiter => {
  const buckets = new Map<string, RateLimitBucket>();
  const check = (key: string): boolean => {
    const now = Date.now();
    const bucket = buckets.get(key);
    if (bucket === undefined || now - bucket.windowStart >= options.windowMs) {
      buckets.set(key, { count: 1, windowStart: now });
      return true;
    }
    if (bucket.count >= options.maxRequests) return false;
    bucket.count++;
    return true;
  };
  return { check, reset: () => buckets.clear() };
};

export const authRateLimiter = createRateLimiter({ maxRequests: 10, windowMs: 60_000 });

export const getClientIp = (request: FastifyRequestLike): string =>
  firstHeaderValue(request.headers, "x-forwarded-for")?.split(",")[0]?.trim() ??
  firstHeaderValue(request.headers, "x-real-ip") ??
  "unknown";
