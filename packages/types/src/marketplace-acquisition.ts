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

export const marketplaceCaptureStatusValues = ["CAPTURED", "INVITED", "CLAIM_STARTED", "CLAIMED", "CONVERTED", "EXPIRED"] as const;
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

export const OWNERSHIP_ATTESTATION_STATEMENT = "I confirm that I am the owner or authorized representative of this seller profile and that I am authorized to claim the associated inventory." as const;

export const ownershipClaimAcceptRequestSchema = z.object({
  claimantName: textSchema(255),
  claimantPhone: optionalTextSchema(64),
  claimantEmail: z.string().trim().email().max(320).optional(),
  marketplaceIdentity: optionalTextSchema(255),
  acceptedTerms: z.literal(true),
}).strict();
export type OwnershipClaimAcceptRequest = z.output<typeof ownershipClaimAcceptRequestSchema>;

export const ownershipClaimAcceptResponseSchema = z.object({
  status: z.literal("CLAIMED"),
  captureId: idSchema,
  draftInventoryId: idSchema,
  attestationId: idSchema,
  claimedAt: isoDateSchema,
}).strict();
export type OwnershipClaimAcceptResponse = z.output<typeof ownershipClaimAcceptResponseSchema>;

export const draftInventoryStatusValues = ["DRAFT", "CLAIM_PENDING", "CLAIMED", "CONVERTED", "EXPIRED"] as const;
export const draftInventoryStatusSchema = z.enum(draftInventoryStatusValues);
export type DraftInventoryStatus = z.output<typeof draftInventoryStatusSchema>;

export const marketplaceCaptureCreateRequestSchema = z.object({
  sourceUrl: z.string().trim().url().max(2048),
  sourceHost: optionalTextSchema(255),
  externalId: optionalTextSchema(255),
  listingUrl: z.string().trim().url().max(2048).optional(),
  marketplaceSource: optionalTextSchema(255),
  marketplaceListingId: optionalTextSchema(255),
  sellerName: optionalTextSchema(255),
  marketplaceIdentifier: optionalTextSchema(255),
  phone: optionalTextSchema(64),
  email: z.string().trim().email().max(320).optional(),
  location: optionalTextSchema(255),
  price: optionalTextSchema(120),
  currency: optionalTextSchema(16),
  category: optionalTextSchema(255),
  images: z.array(z.string().trim().url().max(2048)).max(10).default([]),
  capturedAt: isoDateSchema.optional(),
  capturedBy: optionalTextSchema(255),
  pageUrl: z.string().trim().url().max(2048).optional(),
  sourceMarketplace: optionalTextSchema(255),
  userAgent: optionalTextSchema(1024),
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
  contactId: idSchema.optional(),
  dealId: idSchema.optional(),
  draftInventoryId: idSchema.optional(),
  status: marketplaceCaptureStatusSchema,
  duplicate: z.boolean().optional(),
  normalizationWarnings: z.array(z.string()).optional(),
  createdAt: isoDateSchema,
}).strict();
export type MarketplaceCaptureResponse = z.output<typeof marketplaceCaptureResponseSchema>;

export const sellerAcquisitionAnalyticsFiltersSchema = z.object({
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  marketplaceSource: z.string().trim().min(1).max(255).optional(),
  channel: sellerInvitationChannelSchema.optional(),
}).strict();
export type SellerAcquisitionAnalyticsFilters = z.output<typeof sellerAcquisitionAnalyticsFiltersSchema>;

export const sellerAcquisitionAnalyticsResponseSchema = z.object({
  dateRange: z.object({ from: isoDateSchema, to: isoDateSchema }).strict(),
  acquisition: z.object({
    captures: z.number().int().nonnegative(),
    capturesPerDay: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u), count: z.number().int().nonnegative() }).strict()),
    invitationsSent: z.number().int().nonnegative(),
    claimRate: z.number().nonnegative(),
    conversionRate: z.number().nonnegative(),
    expiredCount: z.number().int().nonnegative(),
  }).strict(),
  inventory: z.object({
    listingsCaptured: z.number().int().nonnegative(),
    listingsClaimed: z.number().int().nonnegative(),
    listingsConverted: z.number().int().nonnegative(),
    listingsExpired: z.number().int().nonnegative(),
  }).strict(),
  operations: z.object({
    averageTimeToInviteHours: z.number().nonnegative().nullable(),
    averageTimeToClaimHours: z.number().nonnegative().nullable(),
    averageTimeToConversionHours: z.number().nonnegative().nullable(),
  }).strict(),
  conversion: z.object({
    sellerConversionsSucceeded: z.number().int().nonnegative(),
    inventoryConversionsSucceeded: z.number().int().nonnegative(),
    conversionFailures: z.number().int().nonnegative(),
    deadLetteredConversions: z.number().int().nonnegative(),
  }).strict(),
}).strict();
export type SellerAcquisitionAnalyticsResponse = z.output<typeof sellerAcquisitionAnalyticsResponseSchema>;
