import { z } from "zod";

import type { SellerAcquisitionAnalyticsFilters, SellerAcquisitionAnalyticsResponse } from "@whisperm/types";
import { sellerAcquisitionAnalyticsFiltersSchema } from "@whisperm/types";

export interface SellerAcquisitionAnalyticsRepository {
  getSellerAcquisitionAnalytics(input: SellerAcquisitionAnalyticsFilters & { readonly tenantId: string }): Promise<SellerAcquisitionAnalyticsResponse>;
}

export interface SellerAcquisitionAnalyticsDependencies {
  readonly repository: SellerAcquisitionAnalyticsRepository;
  readonly now?: () => Date;
}

const contextSchema = z.object({ tenantId: z.string().trim().min(1) }).strict();

const normalizeDate = (value: string | undefined, fallback: Date): string => (value === undefined ? fallback : new Date(value)).toISOString();

export class SellerAcquisitionAnalyticsService {
  constructor(private readonly dependencies: SellerAcquisitionAnalyticsDependencies) {}

  async get(context: { readonly tenantId: string }, filters: unknown): Promise<SellerAcquisitionAnalyticsResponse> {
    const parsedContext = contextSchema.parse(context);
    const parsedFilters = sellerAcquisitionAnalyticsFiltersSchema.parse(filters ?? {});
    const now = this.dependencies.now?.() ?? new Date();
    const dateRange = {
      from: normalizeDate(parsedFilters.dateFrom, new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)),
      to: normalizeDate(parsedFilters.dateTo, now),
    };
    const analytics = await this.dependencies.repository.getSellerAcquisitionAnalytics({
      tenantId: parsedContext.tenantId,
      dateFrom: dateRange.from,
      dateTo: dateRange.to,
      marketplaceSource: parsedFilters.marketplaceSource,
      channel: parsedFilters.channel,
    });
    return { ...analytics, dateRange };
  }
}
