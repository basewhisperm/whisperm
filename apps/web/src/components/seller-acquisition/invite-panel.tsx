"use client";

import { useState } from "react";
import { ChannelSelector, type SellerAcquisitionInviteChannel } from "./channel-selector";

export function SellerAcquisitionInvitePanel({ captureId }: { readonly captureId: string }) {
  const [channel, setChannel] = useState<SellerAcquisitionInviteChannel>("WHATSAPP");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function sendInvite() {
    setBusy(true);
    setStatus("Sending Seller Acquisition invitation…");

    try {
      const response = await fetch(`/api/marketplace-acquisition/captures/${encodeURIComponent(captureId)}/invite`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preferredChannel: channel }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok || result.status !== "SENT") {
        const message =
          typeof result.error === "string"
            ? result.error
            : typeof result.error?.message === "string"
              ? result.error.message
              : "Seller invitation failed. Check phone/email and provider configuration.";
        setStatus(message);
        return;
      }

      setStatus(`Invitation ${result.status} by ${result.channel}. Claim link expires in 7 days.`);
    } catch {
      setStatus("Seller invitation failed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Next action</p>
          <h2 className="mt-2 text-lg font-semibold text-foreground">Send seller invitation</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            WhatsApp is the preferred cellphone-first channel. This is the handoff from capture to claim. SMS remains the fallback for phone delivery, and email is available for non-cellphone-first markets.
          </p>
        </div>
        <span className="rounded-full bg-mist px-3 py-1 text-xs font-semibold text-whisper">
          Claim expires in 7 days
        </span>
      </div>

      <div className="mt-5 rounded-2xl bg-secondary p-4">
        <p className="text-sm font-semibold text-foreground">1. Choose invite channel</p>
        <ChannelSelector onChange={setChannel} value={channel} />

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            className="inline-flex h-10 items-center justify-center rounded-xl bg-whisper px-4 text-sm font-semibold text-white disabled:opacity-60"
            disabled={busy}
            onClick={sendInvite}
            type="button"
          >
            {busy ? "Sending invite…" : "Send Seller Acquisition invite"}
          </button>
          <p className="text-xs text-muted-foreground">
            After sending, the seller can claim the listing and draft inventory.
          </p>
        </div>

        {status !== "" && (
          <p className={status.includes("failed") || status.includes("Check") ? "mt-4 text-sm font-medium text-red-700" : "mt-4 text-sm font-medium text-foreground"} role="status">
            {status}
          </p>
        )}
      </div>
    </section>
  );
}
