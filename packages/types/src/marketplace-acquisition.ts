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

export const marketplaceCaptureStatusValues = ["CAPTURED", "INVITED"] as const;
export const marketplaceCaptureStatusSchema = z.enum(marketplaceCaptureStatusValues);
export type MarketplaceCaptureStatus = z.output<typeof marketplaceCaptureStatusSchema>;

export const sellerInvitationChannelValues = ["WHATSAPP", "SMS", "EMAIL"] as const;
export const sellerInvitationChannelSchema = z.enum(sellerInvitationChannelValues);
export type SellerInvitationChannel = z.output<typeof sellerInvitationChannelSchema>;

export const sellerInvitationStatusValues = ["PENDING", "SENT", "FAILED", "OPENED", "EXPIRED"] as const;
export const sellerInvitationStatusSchema = z.enum(sellerInvitationStatusValues);
export type SellerInvitationStatus = z.output<typeof sellerInvitationStatusSchema>;

export const sellerInvitationCreateRequestSchema = z.object({
  preferredChannel: sellerInvitationChannelSchema.optional(),
}).strict();
export type SellerInvitationCreateRequest = z.output<typeof sellerInvitationCreateRequestSchema>;

export const sellerInvitationResponseSchema = z.object({
  captureId: idSchema,
  invitationId: idSchema,
  channel: sellerInvitationChannelSchema,
  status: sellerInvitationStatusSchema,
  inviteUrl: z.string().url(),
  expiresAt: isoDateSchema,
}).strict();
export type SellerInvitationResponse = z.output<typeof sellerInvitationResponseSchema>;

export const draftInventoryStatusValues = ["DRAFT", "CLAIM_PENDING", "CLAIMED", "CONVERTED", "EXPIRED"] as const;
export const draftInventoryStatusSchema = z.enum(draftInventoryStatusValues);
export type DraftInventoryStatus = z.output<typeof draftInventoryStatusSchema>;

export const marketplaceCaptureCreateRequestSchema = z.object({
  sourceUrl: z.string().trim().url().max(2048),
  sourceHost: optionalTextSchema(255),
  externalId: optionalTextSchema(255),
  title: textSchema(500),
  description: optionalTextSchema(5000),
  priceText: optionalTextSchema(120),
  sellerProfileUrl: z.string().trim().url().max(2048).optional(),
  imageUrls: z.array(z.string().trim().url().max(2048)).max(10).default([]),
  rawExtract: safeRawExtractSchema,
}).strict();
export type MarketplaceCaptureCreateRequest = z.output<typeof marketplaceCaptureCreateRequestSchema>;

export const marketplaceCaptureResponseSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  listingUrl: z.string().url(),
  sourceListingUrl: z.string().url(),
  marketplaceSourceId: idSchema.nullable().optional(),
  externalId: z.string().min(1).nullable().optional(),
  title: idSchema,
  draftInventoryId: idSchema.optional(),
  status: marketplaceCaptureStatusSchema,
  duplicate: z.boolean().optional(),
  normalizationWarnings: z.array(z.string()).optional(),
  createdAt: isoDateSchema,
}).strict();
export type MarketplaceCaptureResponse = z.output<typeof marketplaceCaptureResponseSchema>;
