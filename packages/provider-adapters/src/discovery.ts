export type DiscoveryProviderErrorCategory =
  | "TRANSIENT_PROVIDER_FAILURE"
  | "UNSUPPORTED_PROVIDER"
  | "AUTHENTICATION_CONFIGURATION_FAILURE"
  | "RATE_LIMITED"
  | "VALIDATION_NORMALIZATION_FAILURE"
  | "TERMINAL_PROVIDER_FAILURE";

export class DiscoveryProviderError extends Error {
  readonly code: string;
  readonly category: DiscoveryProviderErrorCategory;
  readonly retryable: boolean;
  readonly providerKey?: string | undefined;
  readonly marketplaceSource?: string | undefined;

  constructor(input: {
    readonly code: string;
    readonly message: string;
    readonly category: DiscoveryProviderErrorCategory;
    readonly retryable?: boolean | undefined;
    readonly providerKey?: string | undefined;
    readonly marketplaceSource?: string | undefined;
  }) {
    super(input.message);
    this.name = "DiscoveryProviderError";
    this.code = input.code;
    this.category = input.category;
    this.retryable = input.retryable ?? (input.category === "TRANSIENT_PROVIDER_FAILURE" || input.category === "RATE_LIMITED");
    this.providerKey = input.providerKey;
    this.marketplaceSource = input.marketplaceSource;
    Object.setPrototypeOf(this, DiscoveryProviderError.prototype);
  }
}

export interface DiscoveryProviderTenantContext {
  readonly tenantId: string;
  readonly correlationId?: string | undefined;
}

export interface DiscoveryProviderCampaignContext {
  readonly campaignId: string;
  readonly executionId: string;
}

export interface DiscoveryProviderSearchInput {
  readonly query?: string | undefined;
  readonly category?: string | undefined;
  readonly location?: string | undefined;
  readonly filters?: Readonly<Record<string, unknown>> | undefined;
  readonly seeds?: readonly Readonly<Record<string, unknown>>[] | undefined;
}

export interface DiscoveryProviderExecutionLimits {
  readonly limit: number;
}

export interface DiscoveryProviderRequest {
  readonly tenant: DiscoveryProviderTenantContext;
  readonly campaign: DiscoveryProviderCampaignContext;
  readonly marketplaceSource: string;
  readonly search: DiscoveryProviderSearchInput;
  readonly limits: DiscoveryProviderExecutionLimits;
}

export interface NormalizedDiscoveryResult {
  readonly source: string;
  readonly externalListingId?: string | undefined;
  readonly listingUrl: string;
  readonly sellerName?: string | undefined;
  readonly sellerPhone?: string | undefined;
  readonly sellerEmail?: string | undefined;
  readonly sellerProfileUrl?: string | undefined;
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly price?: string | number | undefined;
  readonly currency?: string | undefined;
  readonly category?: string | undefined;
  readonly location?: string | undefined;
  readonly rawProviderPayload?: Readonly<Record<string, unknown>> | undefined;
}

export interface DiscoveryProviderResponse {
  readonly providerKey: string;
  readonly marketplaceSource: string;
  readonly results: readonly NormalizedDiscoveryResult[];
}

export interface DiscoveryProvider {
  readonly providerKey: string;
  readonly marketplaceSource: string;
  discover(request: DiscoveryProviderRequest): Promise<DiscoveryProviderResponse>;
}

const normalizeKey = (key: string): string => key.trim().toLowerCase();

export class DiscoveryProviderResolver {
  private readonly providersBySource: ReadonlyMap<string, DiscoveryProvider>;

  constructor(providers: readonly DiscoveryProvider[]) {
    this.providersBySource = new Map(providers.map((provider) => [normalizeKey(provider.marketplaceSource), provider]));
  }

  resolve(marketplaceSource: string): DiscoveryProvider {
    const provider = this.providersBySource.get(normalizeKey(marketplaceSource));
    if (provider === undefined) {
      throw new DiscoveryProviderError({
        code: "DISCOVERY_PROVIDER_UNSUPPORTED",
        message: `Discovery provider is not configured for marketplace source ${marketplaceSource}`,
        category: "UNSUPPORTED_PROVIDER",
        retryable: false,
        marketplaceSource,
      });
    }
    return provider;
  }
}
