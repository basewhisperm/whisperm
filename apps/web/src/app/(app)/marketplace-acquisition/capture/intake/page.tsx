import Link from "next/link";

import { decodeMarketplaceCapturePayload, type MarketplaceCapturePayload } from "@/lib/marketplace-capture/payload";

function Field({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-xl bg-secondary p-3" style={{ border: "0.5px solid hsl(var(--border))" }}>
      <dt className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm text-foreground">{value || "Not detected"}</dd>
    </div>
  );
}

function CapturePreview({ payload }: { readonly payload: MarketplaceCapturePayload }) {
  return (
    <div className="space-y-4">
      <dl className="grid gap-3 md:grid-cols-2">
        <Field label="Source URL" value={payload.sourceUrl} />
        <Field label="Marketplace host" value={payload.sourceHost} />
        <Field label="Title" value={payload.title} />
        <Field label="Price text" value={payload.priceText} />
        <Field label="Description" value={payload.description} />
        <Field label="Extraction strategy" value={payload.rawExtract.strategy} />
      </dl>

      <div className="rounded-2xl bg-background p-4" style={{ border: "0.5px solid hsl(var(--border))" }}>
        <h2 className="text-sm font-semibold text-foreground">Image URLs</h2>
        {payload.imageUrls.length > 0 ? (
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            {payload.imageUrls.map((imageUrl) => (
              <li className="break-words" key={imageUrl}>{imageUrl}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No public image metadata was detected.</p>
        )}
      </div>
    </div>
  );
}

export default function MarketplaceCaptureIntakePage({ searchParams }: { readonly searchParams: { readonly payload?: string } }) {
  const result = decodeMarketplaceCapturePayload(searchParams.payload);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <section className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid hsl(var(--border))" }}>
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Marketplace acquisition</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Capture intake preview</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Review the public metadata captured from the listing before it is submitted to WhispeRM. Backend persistence will be enabled in the next capture slice.
        </p>
      </section>

      {result.payload ? (
        <CapturePreview payload={result.payload} />
      ) : (
        <section className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid hsl(var(--border))" }}>
          <h2 className="text-sm font-semibold text-red-600">Capture payload could not be loaded</h2>
          <p className="mt-2 text-sm text-muted-foreground">{result.error}</p>
          <Link className="mt-4 inline-flex text-sm font-medium text-whisper hover:underline" href="/marketplace-acquisition/capture">
            Return to bookmarklet setup
          </Link>
        </section>
      )}

      <section className="rounded-2xl bg-secondary p-4" style={{ border: "0.5px solid hsl(var(--border))" }}>
        <h2 className="text-sm font-semibold text-foreground">Security confirmation</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          This intake page validates the source URL and hostname, limits text fields and image URLs, and previews metadata only.
          It does not receive cookies, browser storage, credentials, private account data, or full page HTML from the bookmarklet.
        </p>
      </section>
    </div>
  );
}
