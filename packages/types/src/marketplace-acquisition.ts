import { z } from "zod";

const idSchema = z.string().min(1);
const isoDateSchema = z.string().datetime();
const textSchema = (max: number) => z.string().trim().min(1).max(max);
const optionalTextSchema = (max: number) => z.string().trim().max(max).optional();

const safeRawExtractSchema = z.record(z.string(), z.unknown()).default({}).superRefine((value, context) => {
  const forbiddenKeys = new Set(["cookie", "cookies", "localstorage", "sessionstorage", "html", "pagehtml", "documenthtml", "outerhtml", "innerhtml"]);
  const containsHtml = (input: unknown): boolean => {
    if (typeof input === "string") {
      return /<(?:!doctype|html|head|body|script|iframe|form|style|meta|link)\b/iu.test(input);
    }
    if (Array.isArray(input)) return input.some(containsHtml);
    if (input !== null && typeof input === "object") return Object.values(input as Readonly<Record<string, unknown>>).some(containsHtml);
    return false;
  };
  for (const key of Object.keys(value)) {
    if (forbiddenKeys.has(key.toLowerCase().replace(/[^a-z]/gu, ""))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "rawExtract must not include browser storage, cookies, or page HTML" });
    }
  }
  if (containsHtml(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "rawExtract must not include page HTML" });
  }
});

export const marketplaceCaptureStatusValues = ["CAPTURED"] as const;
export const marketplaceCaptureStatusSchema = z.enum(marketplaceCaptureStatusValues);
export type MarketplaceCaptureStatus = z.output<typeof marketplaceCaptureStatusSchema>;

export const marketplaceCaptureCreateRequestSchema = z.object({
  sourceUrl: z.string().trim().url().max(2048),
  sourceHost: optionalTextSchema(255),
  title: textSchema(500),
  description: optionalTextSchema(5000),
  priceText: optionalTextSchema(120),
  imageUrls: z.array(z.string().trim().url().max(2048)).max(10).default([]),
  rawExtract: safeRawExtractSchema,
}).strict();
export type MarketplaceCaptureCreateRequest = z.output<typeof marketplaceCaptureCreateRequestSchema>;

export const marketplaceCaptureResponseSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  sourceListingUrl: z.string().url(),
  title: idSchema,
  status: marketplaceCaptureStatusSchema,
  createdAt: isoDateSchema,
}).strict();
export type MarketplaceCaptureResponse = z.output<typeof marketplaceCaptureResponseSchema>;