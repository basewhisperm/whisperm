"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { decodeMarketplaceCapturePayload, type MarketplaceCapturePayload } from "@/lib/marketplace-capture/payload";

type SubmitState = { readonly status: "idle" | "submitting" | "success" | "error"; readonly data?: Record<string, unknown>; readonly error?: string };
const editableFields = ["sellerName", "sellerProfileUrl", "phone", "email", "location", "title", "description", "priceText", "currency", "category", "listingUrl", "marketplaceSource", "marketplaceListingId"] as const;

function Field({ name, value, onChange }: { readonly name: string; readonly value: string; readonly onChange: (name: string, value: string) => void }) {
  return <label className="block rounded-xl bg-secondary p-3 text-sm" style={{ border: "0.5px solid hsl(var(--border))" }}><span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{name}</span><input className="mt-2 w-full rounded-md bg-background px-3 py-2 text-foreground" value={value} onChange={(event) => onChange(name, event.target.value)} /></label>;
}

function CaptureForm({ payload }: { readonly payload: MarketplaceCapturePayload }) {
  const initial = useMemo(() => Object.fromEntries(editableFields.map((field) => [field, String(payload[field] ?? "")])), [payload]);
  const [fields, setFields] = useState<Record<string, string>>(initial);
  const [state, setState] = useState<SubmitState>({ status: "idle" });
  const update = (name: string, value: string) => setFields((current) => ({ ...current, [name]: value }));
  const submit = async () => {
    setState({ status: "submitting" });
    const clean = (value: string) => value.trim() || undefined;
    const body = { ...payload, ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, clean(value)])), images: payload.images, imageUrls: payload.imageUrls, sourceUrl: payload.sourceUrl, sourceHost: payload.sourceHost, pageUrl: payload.pageUrl ?? payload.sourceUrl };
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
  return <div className="space-y-5"><section><h2 className="text-lg font-semibold">Seller preview</h2><div className="mt-3 grid gap-3 md:grid-cols-2">{editableFields.slice(0, 5).map((field) => <Field key={field} name={field} value={fields[field] ?? ""} onChange={update} />)}</div></section><section><h2 className="text-lg font-semibold">Inventory preview</h2><div className="mt-3 grid gap-3 md:grid-cols-2">{editableFields.slice(5).map((field) => <Field key={field} name={field} value={fields[field] ?? ""} onChange={update} />)}</div><div className="mt-3 rounded-2xl bg-background p-4" style={{ border: "0.5px solid hsl(var(--border))" }}><h3 className="text-sm font-semibold">Images</h3>{payload.imageUrls.length > 0 ? <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">{payload.imageUrls.map((url) => <li className="break-words" key={url}>{url}</li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">No public image metadata was detected.</p>}</div></section><button className="rounded-full bg-whisper px-5 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={state.status === "submitting"} onClick={submit} type="button">{state.status === "submitting" ? "Saving capture…" : "Submit capture"}</button>{state.status === "success" && <section className="rounded-2xl bg-secondary p-4" style={{ border: "0.5px solid hsl(var(--border))" }}><h2 className="font-semibold text-foreground">Capture saved</h2><dl className="mt-3 grid gap-2 text-sm md:grid-cols-2">{["captureId", "contactId", "dealId", "draftInventoryId", "status"].map((key) => <div key={key}><dt className="text-muted-foreground">{key}</dt><dd className="break-all font-medium">{String(state.data?.[key] ?? "Not available")}</dd></div>)}</dl></section>}{state.status === "error" && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}</div>;
}

export default function MarketplaceCaptureIntakePage({ searchParams }: { readonly searchParams: { readonly payload?: string } }) {
  const result = decodeMarketplaceCapturePayload(searchParams.payload);
  return <div className="mx-auto max-w-3xl space-y-6"><section className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid hsl(var(--border))" }}><p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Marketplace acquisition</p><h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Capture intake</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Review and correct the Marketplace Sellers snapshot before creating the acquisition record. Mobile number is required for qualification; WhatsApp is attempted first, SMS is fallback, and email is optional for non-cellphone-first markets.</p></section>{result.payload ? <CaptureForm payload={result.payload} /> : <section className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid hsl(var(--border))" }}><h2 className="text-sm font-semibold text-red-600">Capture payload could not be loaded</h2><p className="mt-2 text-sm text-muted-foreground">{result.error}</p><Link className="mt-4 inline-flex text-sm font-medium text-whisper hover:underline" href="/marketplace-acquisition/capture">Return to bookmarklet setup</Link></section>}<section className="rounded-2xl bg-secondary p-4" style={{ border: "0.5px solid hsl(var(--border))" }}><h2 className="text-sm font-semibold text-foreground">Security confirmation</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">This intake page submits only validated page snapshot metadata. It does not receive cookies, browser storage, credentials, private account data, full page HTML, or perform marketplace re-scraping.</p></section></div>;
}
