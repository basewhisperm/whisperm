import { z } from "zod";

import { type TenantScoped } from "@whisperm/types";
import type { PrismaPersistenceClient } from "./index.js";

const ensureContext = (context: TenantScoped): void => {
  z.object({ tenantId: z.string().min(1) }).strict().parse(context);
};

export interface AcquisitionGovernanceTenantStatus {
  readonly featureEnabled: boolean;
  readonly discoveryFeatureEnabled: boolean;
  readonly planName: string | null;
  readonly subscriptionStatus: string | null;
}

export interface AcquisitionGovernanceUsageCounts {
  readonly discoveryRuns: number;
  readonly invitationsSent: number;
}

/**
 * Narrow, read-only reads that AcquisitionGovernanceService needs and that no
 * existing repository exposes: tenant feature/plan/subscription status,
 * provider connection existence, and conservative usage counts derived from
 * canonical discovery-run/invitation records (CS-023 will formalize real
 * metering; this slice never writes usage).
 */
export interface AcquisitionGovernanceRepository {
  getTenantStatus(context: TenantScoped): Promise<AcquisitionGovernanceTenantStatus>;
  hasActiveProvider(context: TenantScoped, providerKey: string): Promise<boolean>;
  hasActiveDiscoverySource(context: TenantScoped): Promise<boolean>;
  countUsageSince(context: TenantScoped, since: Date): Promise<AcquisitionGovernanceUsageCounts>;
}

const activeSubscriptionStatuses = new Set(["ACTIVE", "TRIALING", "PAST_DUE"]);

interface TenantFeatureDelegate {
  findUnique(args: { readonly where: { readonly tenantId_featureKey: { readonly tenantId: string; readonly featureKey: string } } }): Promise<{ readonly enabled: boolean } | null>;
}

interface SubscriptionDelegate {
  findFirst(args: { readonly where: Readonly<Record<string, unknown>>; readonly orderBy?: Readonly<Record<string, "asc" | "desc">> }): Promise<{ readonly plan: string; readonly status: string } | null>;
}

interface ProviderConnectionDelegate {
  count(args: { readonly where: Readonly<Record<string, unknown>> }): Promise<number>;
}

interface MarketplaceSourceDelegate {
  count(args: { readonly where: Readonly<Record<string, unknown>> }): Promise<number>;
}

interface DiscoveryRunCountDelegate {
  count(args: { readonly where: Readonly<Record<string, unknown>> }): Promise<number>;
}

interface InvitationCountDelegate {
  count(args: { readonly where: Readonly<Record<string, unknown>> }): Promise<number>;
}

export const SELLER_ACQUISITION_FEATURE_KEY = "SELLER_ACQUISITION";
export const DISCOVERY_FEATURE_KEY = "DISCOVERY";

export class PrismaAcquisitionGovernanceRepository implements AcquisitionGovernanceRepository {
  private readonly tenantFeatures: TenantFeatureDelegate;
  private readonly subscriptions: SubscriptionDelegate;
  private readonly providerConnections: ProviderConnectionDelegate;
  private readonly marketplaceSources: MarketplaceSourceDelegate;
  private readonly discoveryRuns: DiscoveryRunCountDelegate;
  private readonly invitations: InvitationCountDelegate;

  constructor(prisma: PrismaPersistenceClient) {
    const client = prisma as unknown as {
      readonly tenantFeature: TenantFeatureDelegate;
      readonly providerConnection: ProviderConnectionDelegate;
      readonly marketplaceSource: MarketplaceSourceDelegate;
      readonly marketplaceDiscoveryRun: DiscoveryRunCountDelegate;
    };
    this.tenantFeatures = client.tenantFeature;
    this.subscriptions = prisma.subscription as unknown as SubscriptionDelegate;
    this.providerConnections = client.providerConnection;
    this.marketplaceSources = client.marketplaceSource;
    this.discoveryRuns = client.marketplaceDiscoveryRun;
    this.invitations = prisma.marketplaceSellerInvitation as unknown as InvitationCountDelegate;
  }

  async getTenantStatus(context: TenantScoped): Promise<AcquisitionGovernanceTenantStatus> {
    ensureContext(context);
    const [feature, discoveryFeature, subscription] = await Promise.all([
      this.tenantFeatures.findUnique({ where: { tenantId_featureKey: { tenantId: context.tenantId, featureKey: SELLER_ACQUISITION_FEATURE_KEY } } }),
      this.tenantFeatures.findUnique({ where: { tenantId_featureKey: { tenantId: context.tenantId, featureKey: DISCOVERY_FEATURE_KEY } } }),
      this.subscriptions.findFirst({ where: { tenantId: context.tenantId }, orderBy: { createdAt: "desc" } }),
    ]);
    const planIncludesDiscovery = subscription !== null && ["STARTER", "GROWTH", "PRO"].includes(subscription.plan);
    return {
      featureEnabled: feature?.enabled === true,
      // All commercial plans have an explicit discovery allowance in the
      // governance policy. A TenantFeature row remains an ops override, but
      // a missing row must not make a paid/trialing plan unreachable.
      discoveryFeatureEnabled: discoveryFeature?.enabled ?? planIncludesDiscovery,
      planName: subscription?.plan ?? null,
      subscriptionStatus: subscription?.status ?? null,
    };
  }

  async hasActiveProvider(context: TenantScoped, providerKey: string): Promise<boolean> {
    ensureContext(context);
    const count = await this.providerConnections.count({ where: { tenantId: context.tenantId, providerKey, status: "ACTIVE" } });
    return count > 0;
  }

  async hasActiveDiscoverySource(context: TenantScoped): Promise<boolean> {
    ensureContext(context);
    const count = await this.marketplaceSources.count({ where: { tenantId: context.tenantId, isActive: true } });
    return count > 0;
  }

  async countUsageSince(context: TenantScoped, since: Date): Promise<AcquisitionGovernanceUsageCounts> {
    ensureContext(context);
    const [discoveryRuns, invitationsSent] = await Promise.all([
      this.discoveryRuns.count({ where: { tenantId: context.tenantId, createdAt: { gte: since } } }),
      this.invitations.count({ where: { tenantId: context.tenantId, createdAt: { gte: since } } }),
    ]);
    return { discoveryRuns, invitationsSent };
  }
}

export const isActiveSubscriptionStatus = (status: string | null): boolean => status === null || activeSubscriptionStatuses.has(status);
