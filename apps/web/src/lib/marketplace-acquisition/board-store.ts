"use client";

import { useCallback, useEffect, useState } from "react";

export interface AcquisitionPipelineStage {
  readonly id: string;
  readonly name: AcquisitionStageName | string;
  readonly sortOrder?: number | null;
  readonly position?: number | null;
}
export interface AcquisitionPipeline { readonly id: string; readonly tenantId?: string; readonly name: string; readonly stages: readonly AcquisitionPipelineStage[]; }
export interface AcquisitionDeal { readonly id: string; readonly title?: string | null; readonly value?: number | null; readonly currency?: string | null; readonly pipelineId: string; readonly pipelineStageId: string; readonly updatedAt: string; readonly captureId?: string | null; readonly listingUrl?: string | null; readonly marketplaceSource?: string | null; readonly sellerName?: string | null; }
export interface AcquisitionBoardData { readonly pipeline: AcquisitionPipeline | null; readonly deals: readonly AcquisitionDeal[]; }
interface AcquisitionBoardState extends AcquisitionBoardData { readonly loading: boolean; readonly error: string | null; readonly refresh: () => Promise<void>; readonly updateDealStage: (dealId: string, pipelineStageId: string, updatedAt?: string) => void; }

export const acquisitionStages = ["Captured", "Invited", "Claim Started", "Claimed", "Converted", "Expired"] as const;
export type AcquisitionStageName = (typeof acquisitionStages)[number];
export const allowedAcquisitionStageTransitions: Readonly<Record<AcquisitionStageName, readonly AcquisitionStageName[]>> = { Captured: ["Invited", "Expired"], Invited: ["Claim Started", "Expired"], "Claim Started": ["Claimed", "Expired"], Claimed: ["Converted"], Converted: [], Expired: [] };
export function stageKey(name: string): string { return name.trim().toLowerCase(); }
export function isAcquisitionStageName(value: string): value is AcquisitionStageName { return (acquisitionStages as readonly string[]).includes(value); }
export function canTransitionAcquisitionStage(fromStageName: string, toStageName: string): boolean { return isAcquisitionStageName(fromStageName) && isAcquisitionStageName(toStageName) && allowedAcquisitionStageTransitions[fromStageName].includes(toStageName); }

async function fetchBoard(): Promise<AcquisitionBoardData> {
  const response = await fetch("/api/deals?pipelineDefaultKey=marketplace_acquisition");
  if (!response.ok) throw new Error("Seller Acquisition board could not be loaded");
  const data = (await response.json()) as AcquisitionBoardData;
  return { pipeline: data.pipeline ?? null, deals: [...(data.deals ?? [])] };
}

export function useAcquisitionBoardData(): AcquisitionBoardState {
  const [pipeline, setPipeline] = useState<AcquisitionPipeline | null>(null);
  const [deals, setDeals] = useState<readonly AcquisitionDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => { setError(null); const data = await fetchBoard(); setPipeline(data.pipeline); setDeals(data.deals); }, []);
  useEffect(() => { let cancelled = false; setLoading(true); refresh().catch(() => { if (!cancelled) setError("Seller Acquisition board could not be loaded"); }).finally(() => { if (!cancelled) setLoading(false); }); return () => { cancelled = true; }; }, [refresh]);
  const updateDealStage = useCallback((dealId: string, pipelineStageId: string, updatedAt?: string) => { setDeals((current) => current.map((deal) => deal.id === dealId ? { ...deal, pipelineStageId, updatedAt: updatedAt ?? deal.updatedAt } : deal)); }, []);
  return { pipeline, deals, loading, error, refresh, updateDealStage };
}
