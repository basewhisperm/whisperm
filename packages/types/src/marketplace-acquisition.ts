import { z } from "zod";

const idSchema = z.string().min(1);
const optionalTextSchema = z.string().trim().min(1).optional();
const metadataSchema = z.record(z.string(), z.unknown());
const isoDateSchema = z.string().datetime();
const decimalLikeSchema = z.preprocess((value) => (typeof value === "object" && value !== null && "toString" in value) ? String(value) : value, z.union([z.number(), z.string()]));

export const marketplaceCaptureStatusSchema = z.enum(["CAPTURED"]);
export type MarketplaceCaptureStatus = z.output<typeof marketplaceCaptureStatusSchema>;

export const createMarketplaceCaptureRequestSchema = z.object({
  tenantId: idSchema,
  marketplaceSourceId: idSchema.nullable().optional(),
  externalId: optionalTextSchema,
  listingUrl: z.string().url(),
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().min(1).max(10000).nullable().optional(),
  price: z.union([z.number(), z.string()]).nullable().optional(),
  currency: z.string().trim().min(3).max(3).nullable().optional(),
  sellerName: optionalTextSchema,
  sellerDisplayName: optionalTextSchema,
  sellerProfileUrl: z.string().url().nullable().optional(),
  sourceSellerUrl: z.string().url().nullable().optional(),
  sourceHost: optionalTextSchema,
  sellerEmail: z.string().email().nullable().optional(),
  sellerPhone: optionalTextSchema,
  metadata: metadataSchema.nullable().optional(),
}).strict();
export type CreateMarketplaceCaptureRequest = z.output<typeof createMarketplaceCaptureRequestSchema>;

export const marketplaceCaptureRecordSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  marketplaceSourceId: idSchema.nullable().optional(),
  contactId: idSchema.nullable().optional(),
  dealId: idSchema.nullable().optional(),
  externalId: idSchema.nullable().optional(),
  listingUrl: z.string().url(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  price: decimalLikeSchema.nullable().optional(),
  currency: z.string().nullable().optional(),
  sellerName: z.string().nullable().optional(),
  sellerProfileUrl: z.string().nullable().optional(),
  status: marketplaceCaptureStatusSchema,
  capturedAt: isoDateSchema,
  metadata: metadataSchema.nullable().optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
}).strict();
export type MarketplaceCaptureRecord = z.output<typeof marketplaceCaptureRecordSchema>;

export const marketplaceCaptureResponseSchema = z.object({
  id: idSchema,
  contactId: idSchema,
  contactLinkage: z.enum(["created", "matched"]),
  listingUrl: z.string().url(),
  status: marketplaceCaptureStatusSchema,
}).strict();
export type MarketplaceCaptureResponse = z.output<typeof marketplaceCaptureResponseSchema>;

