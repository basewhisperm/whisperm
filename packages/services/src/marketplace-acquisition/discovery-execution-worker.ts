import { z } from "zod";
import type { CampaignRuntimeWorker, CampaignRuntimeWorkerInput, CampaignRuntimeWorkerResult } from "@whisperm/campaign-runtime";
import type { SellerAcquisitionCampaignRepository } from "@whisperm/repositories";
import {
  DiscoveryProviderError,
  DiscoveryProviderResolver,
  type DiscoveryProvider,
  type DiscoveryProviderSearchInput,
  type NormalizedDiscoveryResult,
} from "@whisperm/provider-adapters";
import { MarketplaceDiscoveryService, type ManualSeedEntry } from "./discovery-service.js";

const discoveryExecutionConfigSchema = z.object({
  marketplaceSourceId: z.string().min(1),
  marketplaceSourceKey: z.string().min(1),
  providerKey: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(500).default(100),
  search: z.object({
    query: z.string().min(1).optional(),
    category: z.string().min(1).optional(),
    location: z.string().min(1).optional(),
    filters: z.record(z.string(), z.unknown()).optional(),
    seeds: z.array(z.record(z.string(), z.unknown())).optional(),
  }).strict().default({}),
  qualificationPolicy: z.record(z.string(), z.unknown()).optional(),
  discoveryCreditsRemaining: z.number().int().min(1).max(500).default(100),
}).strict();

type DiscoveryExecutionConfig = z.output<typeof discoveryExecutionConfigSchema>;

export interface DiscoveryExecutionWorkerDependencies {
  readonly campaigns: SellerAcquisitionCampaignRepository;
  readonly discoveryService: MarketplaceDiscoveryService;
  readonly providers: readonly DiscoveryProvider[];
}

const recordValue = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null && key in value ? (value as Readonly<Record<string, unknown>>)[key] : undefined;

const campaignDiscoveryConfig = (metadata: Readonly<Record<string, unknown>> | null | undefined): DiscoveryExecutionConfig => {
  const raw = recordValue(metadata, "discoveryExecution") ?? recordValue(metadata, "discovery") ?? {};
  return discoveryExecutionConfigSchema.parse(raw);
};

const asSearchInput = (search: DiscoveryExecutionConfig["search"]): DiscoveryProviderSearchInput => ({
  ...(search.query !== undefined ? { query: search.query } : {}),
  ...(search.category !== undefined ? { category: search.category } : {}),
  ...(search.location !== undefined ? { location: search.location } : {}),
  ...(search.filters !== undefined ? { filters: search.filters } : {}),
  ...(search.seeds !== undefined ? { seeds: search.seeds } : {}),
});

const nonEmpty = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
};

export const normalizeProviderResultForDiscovery = (result: NormalizedDiscoveryResult): ManualSeedEntry => {
  const listingUrl = nonEmpty(result.listingUrl);
  if (listingUrl === undefined) {
    throw new DiscoveryProviderError({
      code: "DISCOVERY_RESULT_LISTING_URL_REQUIRED",
      message: "Discovery provider result must include listingUrl",
      category: "VALIDATION_NORMALIZATION_FAILURE",
      retryable: false,
      providerKey: result.source,
      marketplaceSource: result.source,
    });
  }
  const sellerName = nonEmpty(result.sellerName);
  const phone = nonEmpty(result.sellerPhone);
  const email = nonEmpty(result.sellerEmail);
  const sellerProfileUrl = nonEmpty(result.sellerProfileUrl);
  const title = nonEmpty(result.title);
  const description = nonEmpty(result.description);
  const currency = nonEmpty(result.currency);
  const category = nonEmpty(result.category);
  const location = nonEmpty(result.location);
  return {
    listingUrl,
    ...(sellerName !== undefined ? { sellerName } : {}),
    ...(phone !== undefined ? { phone } : {}),
    ...(email !== undefined ? { email } : {}),
    ...(sellerProfileUrl !== undefined ? { sellerProfileUrl } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(result.price !== undefined ? { price: result.price } : {}),
    ...(currency !== undefined ? { currency } : {}),
    ...(category !== undefined ? { category } : {}),
    ...(location !== undefined ? { location } : {}),
  };
};

const classifyProviderError = (error: unknown): { readonly code: string; readonly message: string; readonly category: string; readonly retryable: boolean } => {
  if (error instanceof DiscoveryProviderError) {
    return { code: error.code, message: error.message, category: error.category, retryable: error.retryable };
  }
  if (error instanceof z.ZodError) {
    return { code: "DISCOVERY_CONFIGURATION_INVALID", message: "Discovery execution configuration is invalid", category: "VALIDATION_NORMALIZATION_FAILURE", retryable: false };
  }
  return { code: "DISCOVERY_PROVIDER_TRANSIENT_FAILURE", message: error instanceof Error ? error.message : "Discovery provider failed", category: "TRANSIENT_PROVIDER_FAILURE", retryable: true };
};

export class DiscoveryExecutionWorker implements CampaignRuntimeWorker {
  readonly type = "marketplace-discovery";
  private readonly resolver: DiscoveryProviderResolver;

  constructor(private readonly deps: DiscoveryExecutionWorkerDependencies) {
    this.resolver = new DiscoveryProviderResolver(deps.providers);
  }

  async execute(input: CampaignRuntimeWorkerInput): Promise<CampaignRuntimeWorkerResult> {
    const context = { tenantId: input.tenantId };
    try {
      const campaign = await this.deps.campaigns.findById(context, input.campaignId);
      if (campaign === null) {
        return { status: "FAILED", errorCode: "DISCOVERY_CAMPAIGN_NOT_FOUND", errorMessage: "Seller acquisition campaign not found", metrics: { discoveryStatus: "FAILED" } };
      }
      const config = campaignDiscoveryConfig(campaign.metadata);
      const provider = this.resolver.resolve(config.providerKey ?? config.marketplaceSourceKey);
      const providerResponse = await provider.discover({
        tenant: { tenantId: input.tenantId, correlationId: input.correlation?.correlationId },
        campaign: { campaignId: input.campaignId, executionId: input.executionId },
        marketplaceSource: config.marketplaceSourceKey,
        search: asSearchInput(config.search),
        limits: { limit: config.limit },
      });
      const entries = providerResponse.results.slice(0, config.limit).map(normalizeProviderResultForDiscovery);
      const result = await this.deps.discoveryService.runDiscovery(
        { tenantId: input.tenantId, actorId: "campaign-runtime" },
        {
          campaignId: input.campaignId,
          marketplaceSourceId: config.marketplaceSourceId,
          marketplaceSourceKey: config.marketplaceSourceKey,
          mode: config.marketplaceSourceKey === "JIJI" ? "JIJI_SITEMAP" : config.marketplaceSourceKey === "TONATON" ? "TONATON_SITEMAP" : "MANUAL_SEED",
          entries,
          discoveryCreditsRemaining: Math.min(config.discoveryCreditsRemaining, config.limit),
        },
      );
      return {
        status: "COMPLETED",
        metrics: {
          discoveryStatus: "COMPLETED",
          providerKey: provider.providerKey,
          marketplaceSource: config.marketplaceSourceKey,
          requestedLimit: config.limit,
          returnedCount: providerResponse.results.length,
          normalizedCount: entries.length,
          capturedCount: result.sellersFound - result.sellersDuplicate,
          skippedDuplicateCount: result.sellersDuplicate,
          discoveryRunId: result.run.id,
        },
      };
    } catch (error) {
      const failure = classifyProviderError(error);
      return {
        status: "FAILED",
        errorCode: failure.code,
        errorMessage: failure.message.slice(0, 500),
        metrics: {
          discoveryStatus: "FAILED",
          failureCategory: failure.category,
          failureCode: failure.code,
          failureMessage: failure.message.slice(0, 500),
          retryable: failure.retryable,
        },
      };
    }
  }
}
