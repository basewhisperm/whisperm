"use client";

import { useEffect, useState } from "react";

type ClaimPreview = {
  tokenStatus: string;
  expiresAt: string;
  capture: { id: string; marketplaceSource: string | null; listingUrl: string };
  seller: { name: string | null; phoneMasked: string | null; emailMasked: string | null; location: string | null };
  draftInventory: { id: string; title: string; description?: string | null; price?: string | number | null; currency?: string | null; category?: string | null; images?: unknown; listingUrl?: string | null; marketplaceSource?: string | null } | null;
  currentStage: string;
};

export default function SellerClaimPage({ params }: { readonly params: { readonly token: string } }) {
  const [preview, setPreview] = useState<ClaimPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [claimantName, setClaimantName] = useState("");
  const [success, setSuccess] = useState<{ status: string; claimedAt: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/marketplace-acquisition/claims/${encodeURIComponent(params.token)}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Claim link could not be loaded");
        return body as ClaimPreview;
      })
      .then((body) => { if (active) setPreview(body); })
      .catch((cause: Error) => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [params.token]);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/marketplace-acquisition/claims/${encodeURIComponent(params.token)}/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ claimantName: claimantName.trim() || undefined, acceptedTerms }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Claim acceptance failed");
      setSuccess(body);
      setPreview((current) => current === null ? current : { ...current, tokenStatus: "CLAIMED", currentStage: "Claimed" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Claim acceptance failed");
    } finally {
      setSubmitting(false);
    }
  };

  const inventory = preview?.draftInventory;
  const images = Array.isArray(inventory?.images) ? inventory.images.filter((image): image is string => typeof image === "string") : [];

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-10">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-whisper">Seller claim portal</p>
        <h1 className="mt-2 text-3xl font-bold text-foreground">Review and claim your inventory</h1>
      </header>
      {preview === null && error === null ? <section className="rounded-2xl border border-border bg-card p-6">Loading claim details…</section> : null}
      {error !== null ? <section className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">{error}</section> : null}
      {preview?.tokenStatus === "EXPIRED" ? <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-800">This claim link expired on {new Date(preview.expiresAt).toLocaleString()}.</section> : null}
      {preview?.tokenStatus === "CLAIMED" ? <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-800">This inventory has already been claimed.</section> : null}
      {success !== null ? <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-800">Claim accepted at {new Date(success.claimedAt).toLocaleString()}.</section> : null}
      {preview !== null ? (
        <section className="grid gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div>
            <h2 className="text-xl font-semibold">Seller snapshot</h2>
            <p className="mt-2 text-sm text-muted-foreground">Name: {preview.seller.name ?? "Not captured"}</p>
            <p className="text-sm text-muted-foreground">Phone: {preview.seller.phoneMasked ?? "Not captured"}</p>
            <p className="text-sm text-muted-foreground">Email: {preview.seller.emailMasked ?? "Not captured"}</p>
            <p className="text-sm text-muted-foreground">Location: {preview.seller.location ?? "Not captured"}</p>
          </div>
          <div>
            <h2 className="text-xl font-semibold">Inventory snapshot</h2>
            <h3 className="mt-2 text-lg font-medium">{inventory?.title ?? "Captured listing"}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{inventory?.description ?? "No description captured."}</p>
            <p className="mt-2 text-sm">{inventory?.price != null ? `${inventory.currency ?? "USD"} ${inventory.price}` : "Price not captured"}</p>
            <p className="text-sm text-muted-foreground">Category: {inventory?.category ?? "Not captured"}</p>
            <a className="text-sm font-medium text-whisper underline" href={inventory?.listingUrl ?? preview.capture.listingUrl} rel="noreferrer" target="_blank">View original listing</a>
            {images.length > 0 ? <div className="mt-3 grid grid-cols-2 gap-3">{images.map((src) => <img key={src} alt="Captured inventory" className="rounded-xl border border-border" src={src} />)}</div> : null}
          </div>
          {preview.tokenStatus !== "EXPIRED" && preview.tokenStatus !== "CLAIMED" && success === null ? (
            <div className="grid gap-3 border-t border-border pt-4">
              <label className="grid gap-1 text-sm font-medium">Your name<input className="rounded-xl border border-border bg-background px-3 py-2" value={claimantName} onChange={(event) => setClaimantName(event.target.value)} /></label>
              <label className="flex gap-2 text-sm"><input type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} /> I confirm I am authorized to claim this captured inventory.</label>
              <button className="rounded-xl bg-whisper px-4 py-2 font-semibold text-white disabled:opacity-50" disabled={!acceptedTerms || submitting} onClick={submit}>{submitting ? "Claiming…" : "Accept ownership"}</button>
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
