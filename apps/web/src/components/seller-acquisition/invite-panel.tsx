"use client";

import { useState } from "react";

type Channel = "WHATSAPP" | "SMS" | "EMAIL";

export function SellerAcquisitionInvitePanel({ captureId }: { readonly captureId: string }) {
  const [channel, setChannel] = useState<Channel>("WHATSAPP");
  const [status, setStatus] = useState("");

  async function sendInvite() {
    setStatus("Sending Seller Acquisition invitation…");
    const response = await fetch(`/api/marketplace-acquisition/captures/${encodeURIComponent(captureId)}/invite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preferredChannel: channel }),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setStatus(typeof result.error === "string" ? result.error : "Seller invitation failed");
      return;
    }

    setStatus(`Invitation ${result.status} by ${result.channel}. Claim link expires in 7 days.`);
  }

  return (
    <section className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }}>
      <h2 className="text-sm font-semibold text-foreground">Seller Acquisition invitation</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        WhatsApp is the preferred cellphone-first channel. SMS remains the fallback for phone delivery, and email is available for non-cellphone-first markets.
      </p>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {(["WHATSAPP", "SMS", "EMAIL"] as const).map((option) => (
          <button key={option} type="button" onClick={() => setChannel(option)}>
            {option === "WHATSAPP" ? "WhatsApp first" : option === "SMS" ? "SMS fallback" : "Email optional"}
          </button>
        ))}
      </div>

      <button type="button" onClick={sendInvite}>
        Send Seller Acquisition invite
      </button>

      {status !== "" && <p role="status">{status}</p>}
    </section>
  );
}
