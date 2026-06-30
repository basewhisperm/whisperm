"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { decodeMarketplaceCapturePayload, type MarketplaceCapturePayload } from "@/lib/marketplace-capture/payload";

type SubmitState = {
  readonly status: "idle" | "submitting" | "success" | "error";
  readonly data?: Record<string, unknown>;
  readonly error?: string;
};

const editableFields = ["sellerName", "sellerProfileUrl", "phone", "email", "location", "title", "description", "priceText", "currency", "category", "listingUrl", "marketplaceSource", "marketplaceListingId"] as const;

const resultId = (data: Record<string, unknown> | undefined, key: string): string | undefined => {
  const value = data?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
};

function Field({ name, value, onChange }: { readonly name: string; readonly value: string; readonly onChange: (name: string, value: string) => void }) {
  return (
    <label className="block rounded-xl bg-secondary p-3 text-sm" style={{ border: "0.5px solid hsl(var(--border))" }}>
      <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{name}</span>
      <input className="mt-2 w-full rounded-md bg-background px-3 py-2 text-foreground" value={value} onChange={(event) => onChange(name, event.target.value)} />
    </label>
  );
}

function ResultRow({ label, ok, detail }: { readonly label: string; readonly ok: boolean; readonly detail: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl bg-background p-3" style={{ border: "0.5px solid hsl(var(--border))" }}>
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </div>
      <span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: ok ? "var(--color-secondary)" : "var(--color-muted)", color: ok ? "var(--color-growth)" : "var(--color-health-amber)" }}>
        {ok ? "Created" : "Missing"}
      </span>
    </div>
  );
}

function CaptureResult({ data }: { readonly data: Record<string, unknown> | undefined }) {
  const captureId = resultId(data, "captureId");
  const contactId = resultId(data, "contactId");
  const dealId = resultId(data, "dealId");
  const draftInventoryId = resultId(data, "draftInventoryId");
  const isQualified = contactId !== undefined && dealId !== undefined;
  const nextAction = isQualified ? "Send WhatsApp invitation" : "Edit phone and retry qualification";

  return (
    <section className="rounded-2xl bg-secondary p-4" style={{ border: "0.5px solid hsl(var(--border))" }}>
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Capture result</p>
      <h2 className="mt-2 text-lg font-semibold text-foreground">{isQualified ? "Qualified seller captured" : "Capture saved, qualification incomplete"}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {isQualified ? "Contact, deal, and draft inventory are ready for seller acquisition." : "Draft inventory was saved, but the seller still needs a contact and acquisition deal before invitation."}
      </p>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <ResultRow label="Capture" ok={captureId !== undefined} detail={captureId ?? "Capture was not returned."} />
        <ResultRow label="Contact" ok={contactId !== undefined} detail={contactId ?? "No CRM contact was created."} />
        <ResultRow label="Deal" ok={dealId !== undefined} detail={dealId ?? "No acquisition deal was created."} />
        <ResultRow label="Draft inventory" ok={draftInventoryId !== undefined} detail={draftInventoryId ?? "No draft inventory was created."} />
      </div>

      <div className="mt-4 rounded-xl bg-background p-3" style={{ border: "0.5px solid hsl(var(--border))" }}>
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Next action</p>
        <p className="mt-1 text-sm font-semibold text-foreground">{nextAction}</p>
      </div>
    </section>
  );
}

interface CampaignOption { readonly id: string; readonly name: string; }

function CaptureForm({ payload, campaignId }: { readonly payload: MarketplaceCapturePayload; readonly campaignId?: string }) {
  const initial = useMemo(() => Object.fromEntries(editableFields.map((field) => [field, String(payload[field] ?? "")])), [payload]);
  const [fields, setFields] = useState<Record<string, string>>(initial);
  const [state, setState] = useState<SubmitState>({ status: "idle" });
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>(campaignId ?? "");
  const [campaigns, setCampaigns] = useState<readonly CampaignOption[]>([]);

  useEffect(() => {
    if (campaignId) return; // already set from URL
    fetch("/api/marketplace-acquisition/campaigns?status=ACTIVE,DRAFT")
      .then((r) => r.json())
      .then((payload) => {
        const list = (payload?.data?.campaigns ?? []) as CampaignOption[];
        setCampaigns(list);
        if (list.length === 1 && list[0] !== undefined) setSelectedCampaignId(list[0].id);
      })
      .catch(() => {});
  }, [campaignId]);

  const update = (name: string, value: string) => setFields((current) => ({ ...current, [name]: value }));

  const submit = async () => {
    if (selectedCampaignId.trim().length === 0) {
      setState({ status: "error", error: "A campaign is required. All captures must belong to a campaign." });
      return;
    }
    setState({ status: "submitting" });
    const clean = (value: string) => {
      const trimmed = value.trim();
      if (trimmed.length === 0 || trimmed === "[object Object]") return undefined;
      return trimmed;
    };
    const cleanedFields = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, clean(value)]));
    const body = {
      ...payload,
      ...cleanedFields,
      campaignId: selectedCampaignId.trim().length > 0 ? selectedCampaignId : undefined,
      sellerPhone: clean(fields.phone ?? ""),
      price: clean(fields.priceText ?? ""),
      images: payload.images,
      imageUrls: payload.imageUrls,
      sourceUrl: payload.sourceUrl,
      sourceHost: payload.sourceHost,
      pageUrl: payload.pageUrl ?? payload.sourceUrl,
    };

    try {
      const response = await fetch("/api/marketplace-acquisition/captures", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const responseText = await response.text();
      const json = responseText ? JSON.parse(responseText) as { readonly ok?: boolean; readonly data?: Record<string, unknown>; readonly error?: { readonly message?: string } } : {};
      if (!response.ok || json.ok === false) throw new Error(json.error?.message ?? "Capture failed");
      setState({ status: "success", data: json.data ?? {} });
    } catch (error) {
      setState({ status: "error", error: error instanceof Error ? error.message : "Capture failed" });
    }
  };

  return (
    <div className="space-y-5">
      <section>
        <h2 className="text-lg font-semibold">Seller preview</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">{editableFields.slice(0, 5).map((field) => <Field key={field} name={field} value={fields[field] ?? ""} onChange={update} />)}</div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Inventory preview</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">{editableFields.slice(5).map((field) => <Field key={field} name={field} value={fields[field] ?? ""} onChange={update} />)}</div>
      </section>

      {!campaignId && campaigns.length > 0 ? (
        <label className="block rounded-xl bg-secondary p-3 text-sm" style={{ border: "0.5px solid hsl(var(--border))" }}>
          <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Assign to campaign <span className="text-red-600">*</span></span>
          <select
            className="mt-2 w-full rounded-md bg-background px-3 py-2 text-foreground"
            value={selectedCampaignId}
            onChange={(e) => setSelectedCampaignId(e.target.value)}
          >
            <option value="" disabled>Select a campaign…</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      ) : null}

      <button className="rounded-full bg-whisper px-5 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={state.status === "submitting" || selectedCampaignId.trim().length === 0} onClick={submit} type="button">
        {state.status === "submitting" ? "Saving capture…" : "Submit capture"}
      </button>

      {state.status === "success" && <CaptureResult data={state.data} />}
      {state.status === "error" && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}
    </div>
  );
}


interface GridPageDiscoveryFormProps {
  readonly payload: import('@/lib/marketplace-capture/payload').MarketplaceCapturePayload;
  readonly campaignId?: string;
}

function GridPageDiscoveryForm({ payload, campaignId: initialCampaignId }: GridPageDiscoveryFormProps) {
  const listings = payload.portfolioListings ?? [];
  const validListings = listings.filter((l) => l.listingUrl && l.listingUrl.trim().length > 0);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>(initialCampaignId ?? '');
  const [campaigns, setCampaigns] = useState<readonly { id: string; name: string }[]>([]);
  const [sourceId] = useState<string>('');
  const [customSourceId, setCustomSourceId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ queued: number; qualified: number; rejected: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/marketplace-acquisition/campaigns?status=ACTIVE,DRAFT')
      .then((r) => r.json())
      .then((p) => {
        const list = (p?.data?.campaigns ?? []) as { id: string; name: string }[];
        setCampaigns(list);
      })
      .catch(() => {});
  }, [initialCampaignId]);

  const runDiscovery = async () => {
    const srcId = customSourceId.trim();
    if (validListings.length === 0) { setError('No valid listing URLs found on this page.'); return; }

    setBusy(true);
    setError(null);
    try {
      const entries = validListings.map((l) => ({
        title: l.title,
        price: l.price,
        currency: l.currency,
        category: l.category,
        location: l.location,
      }));

      const res = await fetch(`/api/marketplace-acquisition/campaigns/${selectedCampaignId}/discovery/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketplaceSourceId: srcId,
          marketplaceSourceKey: payload.marketplaceSource ?? 'jiji',
          mode: 'MANUAL_SEED',
          entries,
        }),
      });
      const data = await res.json().catch(() => ({}));
      const run = data?.data?.run ?? {};
      setResult({ queued: run.sellersFound ?? 0, qualified: run.sellersQualified ?? 0, rejected: run.sellersRejected ?? 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className='space-y-5'>
      <section className='rounded-2xl bg-secondary p-4' style={{ border: '0.5px solid hsl(var(--border))' }}>
        <p className='text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground'>Category page detected</p>
        <h2 className='mt-2 text-lg font-semibold text-foreground'>Run bulk discovery</h2>
        <p className='mt-1 text-sm text-muted-foreground'>
          {validListings.length} listings found on this page. Feed them into a discovery run to qualify sellers automatically.
        </p>
      </section>

      <div className='space-y-3'>
        <label className='block rounded-xl bg-secondary p-3 text-sm' style={{ border: '0.5px solid hsl(var(--border))' }}>
          <span className='text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground'>Marketplace Source ID <span className='text-red-600'>*</span></span>
          <input
            className='mt-2 w-full rounded-md bg-background px-3 py-2 text-foreground'
            placeholder='UUID of the marketplace source'
            value={customSourceId}
            onChange={(e) => setCustomSourceId(e.target.value)}
          />
        </label>

{!initialCampaignId && campaigns.length > 0 ? (
          <label className='block rounded-xl bg-secondary p-3 text-sm' style={{ border: '0.5px solid hsl(var(--border))' }}>
            <span className='text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground'>Campaign <span className='text-red-600'>*</span></span>
            <select
              className='mt-2 w-full rounded-md bg-background px-3 py-2 text-foreground'
              value={selectedCampaignId}
              onChange={(e) => setSelectedCampaignId(e.target.value)}
            >
              <option value='' disabled>Select a campaign…</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        ) : null}
      </div>

      <div className='rounded-xl bg-secondary p-3' style={{ border: '0.5px solid hsl(var(--border))' }}>
        <p className='text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground'>Listings to discover</p>
        <div className='mt-2 max-h-40 overflow-y-auto space-y-1'>
          {validListings.slice(0, 10).map((l, i) => (
            <p key={i} className='text-xs text-muted-foreground truncate'>{l.title || l.listingUrl}</p>
          ))}
          {validListings.length > 10 ? <p className='text-xs text-muted-foreground'>+{validListings.length - 10} more</p> : null}
        </div>
      </div>

      {error ? <p className='rounded-xl bg-red-50 p-3 text-sm text-red-700'>{error}</p> : null}

      {result ? (
        <div className='rounded-2xl bg-secondary p-4 space-y-2' style={{ border: '0.5px solid hsl(var(--border))' }}>
          <p className='text-sm font-semibold text-foreground'>Discovery run complete</p>
          <p className='text-sm text-muted-foreground'>{result.queued} sellers found · {result.qualified} qualified · {result.rejected} rejected</p>
          <p className='text-xs text-muted-foreground'>Go to the campaign Discovery tab to review and promote qualified sellers.</p>
        </div>
      ) : (
        <button
          className='rounded-full bg-whisper px-5 py-2 text-sm font-semibold text-white disabled:opacity-60'
          disabled={busy || selectedCampaignId.trim().length === 0 || customSourceId.trim().length === 0}
          onClick={() => void runDiscovery()}
          type='button'
        >
          {busy ? 'Running discovery…' : `Run discovery on ${validListings.length} listings`}
        </button>
      )}
    </div>
  );
}

export default function MarketplaceCaptureIntakePage({ searchParams }: { readonly searchParams: { readonly payload?: string; readonly campaignId?: string } }) {
  const result = decodeMarketplaceCapturePayload(searchParams.payload);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <section className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid hsl(var(--border))" }}>
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Marketplace acquisition</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Capture intake</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Review and correct the seller snapshot before creating the acquisition record.</p>
      </section>

      {result.payload ? (result.payload.looksLikeGridPage ? <GridPageDiscoveryForm payload={result.payload} {...(searchParams.campaignId !== undefined ? { campaignId: searchParams.campaignId } : {})} /> : <CaptureForm payload={result.payload} {...(searchParams.campaignId !== undefined ? { campaignId: searchParams.campaignId } : {})} />) : (
        <section className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid hsl(var(--border))" }}>
          <h2 className="text-sm font-semibold text-red-600">Capture payload could not be loaded</h2>
          <p className="mt-2 text-sm text-muted-foreground">{result.error}</p>
          <Link className="mt-4 inline-flex text-sm font-medium text-whisper hover:underline" href="/marketplace-acquisition/capture">Return to bookmarklet setup</Link>
        </section>
      )}
    </div>
  );
}
