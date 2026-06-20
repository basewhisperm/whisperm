import { headers } from "next/headers";

import { createMarketplaceCaptureBookmarklet, MARKETPLACE_CAPTURE_MAX_PAYLOAD_BYTES } from "@/lib/marketplace-capture/bookmarklet";

function getAppBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/u, "");

  const headerList = headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const protocol = headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

export default function MarketplaceCapturePage() {
  const intakeUrl = `${getAppBaseUrl()}/marketplace-acquisition/capture/intake`;
  const bookmarkletHref = createMarketplaceCaptureBookmarklet({ intakeUrl });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <section className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid hsl(var(--border))" }}>
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Marketplace acquisition</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">One-touch listing capture</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Drag this bookmarklet to your browser bookmarks bar or copy the link. While viewing a single public marketplace listing,
          click it to capture lightweight public metadata into WhispeRM. Reveal the seller phone/mobile number before capture:
          Mobile number is required for qualification, and WhatsApp will be attempted first.
        </p>

        <div className="mt-5 grid gap-4">
          <form action="/api/marketplace-acquisition/captures/from-url" className="rounded-2xl bg-secondary p-4" method="post" style={{ border: "0.5px solid hsl(var(--border))" }}>
            <p className="text-sm font-medium text-foreground">Mobile URL capture</p>
            <p className="mt-1 text-xs text-muted-foreground">Paste a public listing URL. Phone-missing URL captures are blocked from qualification until a mobile number is visible.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input className="min-h-11 flex-1 rounded-xl bg-background px-3 py-2 text-sm text-foreground" name="url" placeholder="https://jiji.com.gh/... or https://tonaton.com/..." type="url" required />
              <button className="min-h-11 rounded-xl bg-whisper px-4 text-sm font-semibold text-white" type="submit">Capture URL</button>
            </div>
          </form>

          <div className="flex flex-col gap-3 rounded-2xl bg-secondary p-4 sm:flex-row sm:items-center sm:justify-between" style={{ border: "0.5px solid hsl(var(--border))" }}>
            <div>
              <p className="text-sm font-medium text-foreground">Desktop bookmarklet capture</p>
              <p className="mt-1 text-xs text-muted-foreground">Drag the button below to your desktop bookmarks bar.</p>
            </div>
            <a
              className="inline-flex h-10 items-center justify-center rounded-xl px-4 text-sm font-semibold text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pulse"
              draggable="true"
              href={bookmarkletHref}
              style={{ background: "var(--color-whisper)" }}
            >
              Render Seller Capture
            </a>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid hsl(var(--border))" }}>
          <h2 className="text-sm font-semibold text-foreground">Operator instructions</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
            <li>Open one public marketplace listing page in your browser.</li>
            <li>Reveal the seller phone/mobile number before capture so WhatsApp can be attempted first.</li>
            <li>Click the “Render Seller Capture” bookmark.</li>
            <li>Review the captured fields on the authenticated WhispeRM intake page.</li>
            <li>Bulk seller portfolio capture can include multiple listings visible on the current seller/profile page.</li>
          </ol>
        </div>

        <div className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid hsl(var(--border))" }}>
          <h2 className="text-sm font-semibold text-foreground">Supported public fields</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
            <li>Page URL and visible marketplace hostname</li>
            <li>Document title, OpenGraph title, and description</li>
            <li>OpenGraph or Twitter image URLs</li>
            <li>JSON-LD Product or Offer price text when present</li>
          </ul>
        </div>
      </section>

      <section className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid hsl(var(--border))" }}>
        <h2 className="text-sm font-semibold text-foreground">Safety note</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          The bookmarklet extracts public listing metadata only. It does not read cookies, local storage, session storage,
          credentials, private account data, page HTML, or additional pages. Captures are limited to {MARKETPLACE_CAPTURE_MAX_PAYLOAD_BYTES.toLocaleString()} bytes before intake.
        </p>
      </section>
    </div>
  );
}
