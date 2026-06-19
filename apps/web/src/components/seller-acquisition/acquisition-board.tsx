"use client";

import Link from "next/link";
import { useMemo, useState, type DragEvent, type ReactNode } from "react";
import { type AcquisitionDeal, type AcquisitionPipeline, acquisitionStages, canTransitionAcquisitionStage, stageKey } from "@/lib/marketplace-acquisition/board-store";
import { SellerAcquisitionInvitePanel } from "@/components/seller-acquisition/invite-panel";

interface AcquisitionBoardProps { readonly pipeline: AcquisitionPipeline; readonly deals: readonly AcquisitionDeal[]; readonly onStageUpdated?: (dealId: string, pipelineStageId: string, updatedAt?: string) => void; readonly onRefresh?: () => Promise<void> | void; }
function formatValue(value?: number | null, currency?: string | null): string { return new Intl.NumberFormat("en-US", { style: "currency", currency: currency ?? "USD", maximumFractionDigits: 0 }).format(value ?? 0); }
function formatUpdatedAt(value: string): string { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)); }
function isSafeListingUrl(value?: string | null): value is string { if (!value) return false; try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:"; } catch { return false; } }
function DroppableColumn({ stageId, children, onDropDeal }: { readonly stageId: string; readonly children: ReactNode; readonly onDropDeal: (dealId: string, stageId: string) => void }) { return <div className="space-y-2" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onDropDeal(event.dataTransfer.getData("text/plain"), stageId); }}>{children}</div>; }
function AcquisitionCard({ deal, stageName }: { readonly deal: AcquisitionDeal; readonly stageName: string }) {
  return <article draggable onDragStart={(event: DragEvent<HTMLElement>) => event.dataTransfer.setData("text/plain", deal.id)} className="rounded-2xl bg-background p-4" aria-labelledby={`acquisition-card-${deal.id}`}>
    <div className="flex items-start justify-between gap-3"><Link href={`/marketplace-acquisition/${deal.id}`} className="min-w-0 flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pulse"><h3 id={`acquisition-card-${deal.id}`} className="truncate text-sm font-semibold text-foreground">{deal.title ?? "Untitled acquisition deal"}</h3></Link><span aria-label={`Move ${deal.title ?? "acquisition deal"}`} className="rounded-lg px-2 py-1 text-xs text-muted-foreground">Drag</span></div>
    <p className="mt-2 text-xs text-muted-foreground">{formatValue(deal.value, deal.currency)}</p><p className="mt-2 text-xs text-muted-foreground">Updated {formatUpdatedAt(deal.updatedAt)}</p>{isSafeListingUrl(deal.listingUrl) && <a className="mt-2 block truncate text-xs font-medium text-whisper hover:underline" href={deal.listingUrl} rel="noreferrer" target="_blank">View original listing</a>}{stageName === "Captured" && deal.captureId ? <div className="mt-3"><SellerAcquisitionInvitePanel captureId={deal.captureId} /></div> : null}
  </article>;
}
export function AcquisitionBoard({ pipeline, deals, onStageUpdated, onRefresh }: AcquisitionBoardProps) {
  const [moveError, setMoveError] = useState<string | null>(null);
  const stageByName = useMemo(() => new Map((pipeline.stages ?? []).map((stage) => [stageKey(stage.name), stage])), [pipeline.stages]);
  const stageById = useMemo(() => new Map((pipeline.stages ?? []).map((stage) => [stage.id, stage])), [pipeline.stages]);
  const dealById = useMemo(() => new Map(deals.map((deal) => [deal.id, deal])), [deals]);
  async function moveDealToStage(dealId: string, targetStageId: string) {
    const deal = dealById.get(dealId); const targetStage = stageById.get(targetStageId); const currentStage = deal ? stageById.get(deal.pipelineStageId) : undefined;
    if (!deal || !targetStage || !currentStage || targetStage.id === currentStage.id) return;
    if (!canTransitionAcquisitionStage(currentStage.name, targetStage.name)) { setMoveError(`Marketplace Acquisition stage transition ${currentStage.name} → ${targetStage.name} is not allowed`); return; }
    setMoveError(null); onStageUpdated?.(deal.id, targetStage.id);
    const response = await fetch(`/api/marketplace-acquisition/deals/${encodeURIComponent(deal.id)}/stage`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ stageName: targetStage.name }) });
    if (!response.ok) { const payload = await response.json().catch(() => ({})) as { readonly error?: string }; setMoveError(payload.error ?? "Marketplace Acquisition stage move failed"); onStageUpdated?.(deal.id, currentStage.id, deal.updatedAt); await onRefresh?.(); return; }
    const payload = await response.json().catch(() => ({})) as { readonly deal?: { readonly pipelineStageId?: string; readonly updatedAt?: string } }; onStageUpdated?.(deal.id, payload.deal?.pipelineStageId ?? targetStage.id, payload.deal?.updatedAt); await onRefresh?.();
  }
  return <>{moveError !== null && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{moveError}</p>}<div className="overflow-x-auto pb-2"><div className="grid min-w-[760px] grid-cols-3 gap-3">{acquisitionStages.map((stageName) => { const stage = stageByName.get(stageKey(stageName)); const stageDeals = stage === undefined ? [] : deals.filter((deal) => deal.pipelineStageId === stage.id); return <section key={stageName} className="rounded-2xl bg-secondary p-3" style={{ border: "0.5px solid var(--color-border)" }} aria-labelledby={`acquisition-stage-${stageKey(stageName)}`}><div className="flex items-center justify-between px-1 pb-3"><h2 id={`acquisition-stage-${stageKey(stageName)}`} className="text-xs font-semibold text-foreground">{stageName}</h2><span className="flex size-5 items-center justify-center rounded-full bg-background text-[11px] font-semibold text-muted-foreground">{stageDeals.length}</span></div><DroppableColumn stageId={stage?.id ?? stageName} onDropDeal={moveDealToStage}>{stageDeals.length === 0 ? <p className="rounded-xl bg-background px-3 py-6 text-center text-xs text-muted-foreground">No deals</p> : stageDeals.map((deal) => <AcquisitionCard key={deal.id} deal={deal} stageName={stageName} />)}</DroppableColumn></section>; })}</div></div></>;
}
