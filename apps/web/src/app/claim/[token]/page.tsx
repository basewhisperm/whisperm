"use client";

import { useEffect, useMemo, useState } from "react";

type ClaimPreview = {
  tokenStatus: string;
  expiresAt: string;
  capture: { id: string; marketplaceSource: string | null; listingUrl: string };
  seller: { name: string | null; phoneMasked: string | null; emailMasked: string | null; location: string | null };
  draftInventory: {
    id: string;
    title: string;
    description?: string | null;
    price?: string | number | null;
    currency?: string | null;
    category?: string | null;
    images?: unknown;
    listingUrl?: string | null;
    marketplaceSource?: string | null;
  } | null;
  currentStage: string;
};

type ClaimSuccess = { status: string; claimedAt: string; attestationId?: string | null };

const terminalStatuses = new Set(["EXPIRED", "CLAIMED"]);

const formatDate = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

export default function SellerClaimPage({ params }: { readonly params: { readonly token: string } }) {
  const [preview, setPreview] = useState<ClaimPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [claimantName, setClaimantName] = useState("");
  const [claimantPhone, setClaimantPhone] = useState("");
  const [claimantEmail, setClaimantEmail] = useState("");
  const [marketplaceIdentity, setMarketplaceIdentity] = useState("");
  const [success, setSuccess] = useState<ClaimSuccess | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    fetch(`/api/marketplace-acquisition/claims/${encodeURIComponent(params.token)}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "This claim link could not be loaded.");
        return body as ClaimPreview;
      })
      .then((body) => {
        if (active) setPreview(body);
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      });

    return () => {
      active = false;
    };
  }, [params.token]);

  const inventory = preview?.draftInventory;
  const images = useMemo(
    () => Array.isArray(inventory?.images) ? inventory.images.filter((image): image is string => typeof image === "string") : [],
    [inventory?.images],
  );

  const canSubmit = acceptedTerms && claimantName.trim().length > 0 && !submitting;
  const hideForm = success !== null || preview === null || terminalStatuses.has(preview.tokenStatus);

  const submit = async () => {
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/marketplace-acquisition/claims/${encodeURIComponent(params.token)}/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          claimantName: claimantName.trim(),
          claimantPhone: claimantPhone.trim() || undefined,
          claimantEmail: claimantEmail.trim() || undefined,
          marketplaceIdentity: marketplaceIdentity.trim() || undefined,
          acceptedTerms,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Claim acceptance failed.");

      setSuccess(body);
      setPreview((current) => current === null ? current : { ...current, tokenStatus: "CLAIMED", currentStage: "Claimed" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Claim acceptance failed.");
    } finally {
      setSubmitting(false);
    }
  };

  if (preview === null && error === null) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-10">
        <section className="rounded-3xl border border-border bg-card p-8 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wide text-whisper">Seller claim portal</p>
          <h1 className="mt-3 text-3xl font-bold text-foreground">Loading your claim link…</h1>
          <p className="mt-3 text-muted-foreground">Please wait while we prepare your captured inventory snapshot.</p>
        </section>
      </main>
    );
  }

  if (preview === null && error !== null) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-10">
        <section className="rounded-3xl border border-red-200 bg-red-50 p-8 text-red-800">
          <p className="text-sm font-semibold uppercase tracking-wide">Claim link unavailable</p>
          <h1 className="mt-3 text-3xl font-bold">We could not load this invitation.</h1>
          <p className="mt-3">{error}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-5 py-8 sm:px-6 sm:py-10">
      <header className="rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-whisper">Seller claim portal</p>
        <h1 className="mt-3 text-3xl font-bold text-foreground sm:text-4xl">Claim your captured seller inventory</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
          You received this link because a marketplace seller profile or listing was captured for onboarding. Review the snapshot, confirm ownership, and we will prepare it for activation.
        </p>
      </header>

      {error !== null ? (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">{error}</section>
      ) : null}

      {preview?.tokenStatus === "EXPIRED" ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
          <h2 className="text-xl font-semibold">This invitation has expired.</h2>
          <p className="mt-2 text-sm">This claim link expired on {formatDate(preview.expiresAt)}. Please request a new invitation from the sender, preferably through WhatsApp.</p>
        </section>
      ) : null}

      {preview?.tokenStatus === "CLAIMED" && success === null ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-900">
          <h2 className="text-xl font-semibold">This seller profile has already been claimed.</h2>
          <p className="mt-2 text-sm">No further action is needed from this link.</p>
        </section>
      ) : null}

      {success !== null ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-900">
          <h2 className="text-xl font-semibold">Claim successful.</h2>
          <p className="mt-2 text-sm">Accepted at {formatDate(success.claimedAt)}. Your inventory is being prepared for activation.</p>
        </section>
      ) : null}

      {preview !== null ? (
        <section className="grid gap-5 rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-8">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-border bg-background p-5">
              <h2 className="text-xl font-semibold text-foreground">Seller snapshot</h2>
              <dl className="mt-4 grid gap-2 text-sm">
                <div><dt className="font-medium">Name</dt><dd className="text-muted-foreground">{preview.seller.name ?? "Not captured"}</dd></div>
                <div><dt className="font-medium">Phone</dt><dd className="text-muted-foreground">{preview.seller.phoneMasked ?? "Not captured"}</dd></div>
                <div><dt className="font-medium">Email</dt><dd className="text-muted-foreground">{preview.seller.emailMasked ?? "Not captured"}</dd></div>
                <div><dt className="font-medium">Location</dt><dd className="text-muted-foreground">{preview.seller.location ?? "Not captured"}</dd></div>
              </dl>
            </div>

            <div className="rounded-2xl border border-border bg-background p-5">
              <h2 className="text-xl font-semibold text-foreground">Claim status</h2>
              <dl className="mt-4 grid gap-2 text-sm">
                <div><dt className="font-medium">Current stage</dt><dd className="text-muted-foreground">{preview.currentStage}</dd></div>
                <div><dt className="font-medium">Invitation expires</dt><dd className="text-muted-foreground">{formatDate(preview.expiresAt)}</dd></div>
                <div><dt className="font-medium">Marketplace</dt><dd className="text-muted-foreground">{inventory?.marketplaceSource ?? preview.capture.marketplaceSource ?? "Captured marketplace"}</dd></div>
              </dl>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-background p-5">
            <h2 className="text-xl font-semibold text-foreground">Inventory snapshot</h2>
            <h3 className="mt-3 text-lg font-medium">{inventory?.title ?? "Captured listing"}</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{inventory?.description ?? "No description captured."}</p>
            <p className="mt-3 text-sm font-medium">{inventory?.price != null ? `${inventory.currency ?? "USD"} ${inventory.price}` : "Price not captured"}</p>
            <p className="mt-1 text-sm text-muted-foreground">Category: {inventory?.category ?? "Not captured"}</p>
            <a className="mt-3 inline-flex text-sm font-semibold text-whisper underline" href={inventory?.listingUrl ?? preview.capture.listingUrl} rel="noreferrer" target="_blank">View original listing</a>
            {images.length > 0 ? (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {images.map((src) => <img key={src} alt="Captured inventory" className="aspect-square rounded-xl border border-border object-cover" src={src} />)}
              </div>
            ) : null}
          </div>

          {!hideForm ? (
            <div className="grid gap-4 rounded-2xl border border-border bg-background p-5">
              <div>
                <h2 className="text-xl font-semibold text-foreground">Confirm ownership</h2>
                <p className="mt-2 text-sm text-muted-foreground">Use the same phone or email you use on WhatsApp or the marketplace where possible.</p>
              </div>

              <label className="grid gap-1 text-sm font-medium">
                Your name *
                <input className="rounded-xl border border-border bg-card px-3 py-2" required value={claimantName} onChange={(event) => setClaimantName(event.target.value)} />
              </label>

              <label className="grid gap-1 text-sm font-medium">
                Mobile / WhatsApp number
                <input className="rounded-xl border border-border bg-card px-3 py-2" type="tel" value={claimantPhone} onChange={(event) => setClaimantPhone(event.target.value)} />
              </label>

              <label className="grid gap-1 text-sm font-medium">
                Email
                <input className="rounded-xl border border-border bg-card px-3 py-2" type="email" value={claimantEmail} onChange={(event) => setClaimantEmail(event.target.value)} />
              </label>

              <label className="grid gap-1 text-sm font-medium">
                Marketplace username or profile
                <input className="rounded-xl border border-border bg-card px-3 py-2" value={marketplaceIdentity} onChange={(event) => setMarketplaceIdentity(event.target.value)} />
              </label>

              <label className="flex items-start gap-3 rounded-xl border border-border p-4 text-sm">
                <input className="mt-1" type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} />
                <span>I confirm that I am the seller or authorized representative for this captured profile and inventory.</span>
              </label>

              <button className="rounded-xl bg-whisper px-4 py-3 font-semibold text-white disabled:opacity-50" disabled={!canSubmit} onClick={submit}>
                {submitting ? "Claiming…" : "Accept ownership"}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
