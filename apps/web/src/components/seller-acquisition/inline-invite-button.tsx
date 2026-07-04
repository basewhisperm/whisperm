"use client";

import { useState } from "react";

import type { SellerAcquisitionInviteChannel } from "./channel-selector";
import { invitationResponseFromFetch } from "@/lib/seller-acquisition/invitation-response";

interface InlineInviteButtonProps {
  readonly captureId: string;
  readonly onRefresh?: () => void | Promise<void>;
}

type InviteState = "idle" | "sending" | "sent" | "error";

const defaultPreferredChannel: SellerAcquisitionInviteChannel = "WHATSAPP";

export function InlineInviteButton({ captureId, onRefresh }: InlineInviteButtonProps) {
  const [state, setState] = useState<InviteState>("idle");
  const [message, setMessage] = useState("");

  async function sendInvite() {
    setState("sending");
    setMessage("Sending Seller Acquisition invitation…");

    try {
      const response = await fetch(`/api/marketplace-acquisition/captures/${encodeURIComponent(captureId)}/invite`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preferredChannel: defaultPreferredChannel }),
      });
      const result = await invitationResponseFromFetch(response);

      if (!result.ok) {
        setState("error");
        setMessage(result.errorMessage ?? "Seller invitation failed");
        return;
      }

      setState("sent");
      setMessage(`Invitation sent via ${defaultPreferredChannel}.`);
    } catch {
      setState("error");
      setMessage("Seller invitation failed");
    } finally {
      await onRefresh?.();
    }
  }

  return (
    <div className="space-y-2">
      <button
        className="rounded-full bg-whisper px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        disabled={state === "sending"}
        onClick={sendInvite}
        type="button"
      >
        {state === "sending" ? "Sending invite…" : "Send invite"}
      </button>
      {message !== "" && (
        <p className={state === "error" ? "text-sm text-red-700" : "text-sm text-muted-foreground"} role="status">
          {message}
        </p>
      )}
    </div>
  );
}
