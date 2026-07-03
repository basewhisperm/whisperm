import { z } from "zod";

const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();

export const campaignTargetingConfigSchema = z.object({
  marketplaceSourceId: optionalText(255),
  marketplaceSourceKey: optionalText(255),
  category: optionalText(255),
  location: optionalText(255),
  keyword: optionalText(255),
  priceMin: z.number().nonnegative().optional(),
  priceMax: z.number().nonnegative().optional(),
  sellerType: optionalText(120),
  executionLimit: z.number().int().min(1).max(500).default(50),
  exclusionTerms: z.array(z.string().trim().min(1).max(120)).max(25).default([]),
  minimumQualificationThreshold: z.number().int().min(0).max(100).optional(),
}).strict().superRefine((targeting, ctx) => {
  if (targeting.priceMin !== undefined && targeting.priceMax !== undefined && targeting.priceMin > targeting.priceMax) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["priceMax"], message: "Targeting maximum price must be greater than or equal to minimum price." });
  }
});

export type CampaignTargetingConfig = z.output<typeof campaignTargetingConfigSchema>;

export interface CampaignTargetingValidationResult {
  readonly status: "VALID" | "INVALID";
  readonly targeting?: CampaignTargetingConfig | undefined;
  readonly failureReason?: string | undefined;
}

const metadataObject = (metadata: unknown): Readonly<Record<string, unknown>> =>
  typeof metadata === "object" && metadata !== null && !Array.isArray(metadata) ? metadata as Readonly<Record<string, unknown>> : {};

export const targetingFromCampaignMetadata = (metadata: unknown): unknown => metadataObject(metadata).targeting;

export const validateCampaignTargeting = (metadata: unknown): CampaignTargetingValidationResult => {
  const raw = targetingFromCampaignMetadata(metadata);
  if (raw === undefined || raw === null) {
    return { status: "INVALID", failureReason: "Campaign targeting configuration is required before autonomous discovery can run." };
  }
  const parsed = campaignTargetingConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "INVALID", failureReason: parsed.error.issues[0]?.message ?? "Campaign targeting configuration is invalid." };
  }
  const targeting = parsed.data;
  if (targeting.marketplaceSourceId === undefined && targeting.marketplaceSourceKey === undefined) {
    return { status: "INVALID", failureReason: "Campaign targeting must include a marketplace source." };
  }
  if (targeting.keyword === undefined && targeting.category === undefined && targeting.location === undefined) {
    return { status: "INVALID", failureReason: "Campaign targeting must include a keyword, category, or location." };
  }
  return { status: "VALID", targeting };
};

export const mergeCampaignTargetingMetadata = (metadata: unknown, targeting: CampaignTargetingConfig | null): Readonly<Record<string, unknown>> => {
  const existing = metadataObject(metadata);
  if (targeting === null) {
    const { targeting: _targeting, ...rest } = existing;
    void _targeting;
    return rest;
  }
  return { ...existing, targeting };
};
