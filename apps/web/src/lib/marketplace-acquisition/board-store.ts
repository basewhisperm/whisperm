"use client";

import useSWR, { type KeyedMutator } from "swr";

export const marketplaceAcquisitionDealsPath = "/api/deals?pipelineDefaultKey=marketplace_acquisition" as const;

export interface MarketplaceAcquisitionPipelineStage {
  readonly id: string;
  readonly name: string;
  readonly position?: number | null;
  readonly sortOrder?: number | null;
}

export interface MarketplaceAcquisitionPipeline {
  readonly id: string;
  readonly tenantId?: string;
  readonly name: string;
  readonly stages: readonly MarketplaceAcquisitionPipelineStage[];
}

export interface MarketplaceAcquisitionDealContact {
  readonly id: string;
  readonly firstName?: string | null;
  readonly lastName?: string | null;
  readonly email?: string | null;
  readonly company?: string | null;
}

export interface MarketplaceAcquisitionDeal {
  readonly id: string;
  readonly title?: string | null;
  readonly value?: number | string | null;
  readonly currency?: string | null;
  readonly pipelineId: string;
  readonly pipelineStageId: string;
  readonly contactId?: string | null;
  readonly captureId?: string | null;
  readonly updatedAt: string;
  readonly contact?: MarketplaceAcquisitionDealContact | null;
}

export interface MarketplaceAcquisitionBoardResponse {
  readonly pipeline: MarketplaceAcquisitionPipeline | null;
  readonly deals: readonly MarketplaceAcquisitionDeal[];
}

export interface MarketplaceAcquisitionBoardStore {
  readonly pipeline: MarketplaceAcquisitionPipeline | null;
  readonly deals: readonly MarketplaceAcquisitionDeal[];
  readonly isLoading: boolean;
  readonly isValidating: boolean;
  readonly error: Error | undefined;
  readonly refresh: KeyedMutator<MarketplaceAcquisitionBoardResponse>;
}

async function fetchMarketplaceAcquisitionBoard(url: string): Promise<MarketplaceAcquisitionBoardResponse> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Unable to load marketplace acquisition deals");
  const payload = await response.json() as Partial<MarketplaceAcquisitionBoardResponse>;
  return {
    pipeline: payload.pipeline ?? null,
    deals: payload.deals ?? [],
  };
}

export function useMarketplaceAcquisitionBoardStore(): MarketplaceAcquisitionBoardStore {
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    marketplaceAcquisitionDealsPath,
    fetchMarketplaceAcquisitionBoard,
  );

  return {
    pipeline: data?.pipeline ?? null,
    deals: data?.deals ?? [],
    isLoading,
    isValidating,
    error,
    refresh: mutate,
  };
}
