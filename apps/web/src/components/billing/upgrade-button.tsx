"use client";

import { useState } from "react";

import type { CheckoutBillingInterval, CheckoutPlan } from "@/lib/billing/checkout";

interface UpgradeButtonProps {
  readonly plan: CheckoutPlan;
  readonly label: string;
  readonly billingInterval?: CheckoutBillingInterval;
  readonly disabled?: boolean;
}

type UpgradeState = { status: "idle" } | { status: "loading" } | { status: "error"; message: string };

export function UpgradeButton({ plan, label, billingInterval = "MONTHLY", disabled }: UpgradeButtonProps) {
  const [state, setState] = useState<UpgradeState>({ status: "idle" });

  async function handleClick() {
    setState({ status: "loading" });

    try {
      const response = await fetch("/api/billing/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, billingInterval }),
      });

      const body = (await response.json()) as
        | { ok: true; checkoutUrl: string }
        | { ok: false; error: { code: string; message: string } };

      if (!body.ok) {
        setState({ status: "error", message: body.error.message });
        return;
      }

      window.location.href = body.checkoutUrl;
    } catch {
      setState({ status: "error", message: "Could not start checkout. Please try again." });
    }
  }

  return (
    <div>
      <button
        className="w-full rounded-full bg-whisper px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled || state.status === "loading"}
        onClick={handleClick}
        type="button"
      >
        {state.status === "loading" ? "Starting checkout…" : label}
      </button>
      {state.status === "error" ? <p className="mt-2 text-xs text-[var(--color-health-red)]">{state.message}</p> : null}
    </div>
  );
}
