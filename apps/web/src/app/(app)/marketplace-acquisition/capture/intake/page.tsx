"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

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

function CaptureForm({ payload }: { readonly payload: MarketplaceCapturePayload }) {
  const initial = useMemo(() => Object.fromEntries(editableFields.map((field) => [field, String(payload[field] ?? "")])), [payload]);
  const [fields, setFields] = useState<Record<string, string>>(initial);
  const [state, setState] = useState<SubmitState>({ status: "idle" });

  const update = (name: string, value: string) => setFields((current) => ({ ...current, [name]: value }));

  const submit = async () => {
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

      <button className="rounded-full bg-whisper px-5 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={state.status === "submitting"} onClick={submit} type="button">
        {state.status === "submitting" ? "Saving capture…" : "Submit capture"}
      </button>

      {state.status === "success" && <CaptureResult data={state.data} />}
      {state.status === "error" && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}
    </div>
  );
}

export default function MarketplaceCaptureIntakePage({ searchParams }: { readonly searchParams: { readonly payload?: string } }) {
  const result = decodeMarketplaceCapturePayload(searchParams.payload);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <section className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid hsl(var(--border))" }}>
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Marketplace acquisition</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Capture intake</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Review and correct the seller snapshot before creating the acquisition record.</p>
      </section>

      {result.payload ? <CaptureForm payload={result.payload} /> : (
        <section className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid hsl(var(--border))" }}>
          <h2 className="text-sm font-semibold text-red-600">Capture payload could not be loaded</h2>
          <p className="mt-2 text-sm text-muted-foreground">{result.error}</p>
          <Link className="mt-4 inline-flex text-sm font-medium text-whisper hover:underline" href="/marketplace-acquisition/capture">Return to bookmarklet setup</Link>
        </section>
      )}
    </div>
  );
}
