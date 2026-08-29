"use client";

import { useState } from "react";
import type { SubscriptionPlan, SubscriptionStatus } from "@prisma/client";

import { UpgradeButton } from "@/components/billing/upgrade-button";
import {
  PLAN_POLICY_LIST,
  annualSavingsUsd,
  type BillingInterval,
} from "@/lib/billing/plan-policy";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function PricingCards({
  currentPlan,
  subscriptionStatus,
  annualConfiguredPlans,
}: {
  readonly currentPlan: SubscriptionPlan | null;
  readonly subscriptionStatus: SubscriptionStatus | null;
  readonly annualConfiguredPlans: readonly SubscriptionPlan[];
}) {
  const [interval, setInterval] = useState<BillingInterval>("MONTHLY");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center gap-1 rounded-full bg-secondary p-1 sm:ml-auto sm:w-fit">
        {(["MONTHLY", "ANNUAL"] as const).map((value) => (
          <button
            aria-pressed={interval === value}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
              interval === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
            }`}
            key={value}
            onClick={() => setInterval(value)}
            type="button"
          >
            {value === "MONTHLY" ? "Monthly" : "Annual · 2 months free"}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {PLAN_POLICY_LIST.map((policy) => {
          const isCurrentPlan = currentPlan === policy.plan && subscriptionStatus !== "CANCELED";
          const displayedPrice = policy.priceUsd[interval];
          const period = interval === "MONTHLY" ? "month" : "year";
          const annualCheckoutUnavailable = interval === "ANNUAL" && !annualConfiguredPlans.includes(policy.plan);

          return (
            <section
              className={`relative flex flex-col rounded-2xl border bg-background p-5 ${
                policy.recommended ? "border-[var(--color-whisper)] shadow-sm" : "border-[var(--color-border)]"
              }`}
              key={policy.plan}
            >
              {policy.recommended ? (
                <span className="absolute right-4 top-4 rounded-full bg-whisper px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white">
                  Recommended
                </span>
              ) : null}
              <p className="text-sm font-semibold text-foreground">{policy.label}</p>
              <p className="mt-1 min-h-10 text-xs text-muted-foreground">{policy.tagline}</p>
              <div className="mt-4 flex items-end gap-1">
                <span className="text-3xl font-semibold tracking-tight text-foreground">{money.format(displayedPrice)}</span>
                <span className="pb-1 text-xs text-muted-foreground">/{period}</span>
              </div>
              {interval === "ANNUAL" ? (
                <p className="mt-1 text-xs font-medium text-[var(--color-growth)]">
                  Save {money.format(annualSavingsUsd(policy))} per year
                </p>
              ) : null}

              <ul className="mt-5 flex-1 space-y-2 text-xs text-muted-foreground">
                {[...policy.quotas, ...policy.features].map((line) => (
                  <li className="flex gap-2" key={line}>
                    <span aria-hidden="true" className="text-[var(--color-growth)]">✓</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-5">
                {isCurrentPlan ? (
                  <p className="rounded-full bg-secondary px-4 py-2 text-center text-sm font-semibold text-foreground">Current plan</p>
                ) : (
                  <UpgradeButton
                    billingInterval={interval}
                    disabled={annualCheckoutUnavailable}
                    label={annualCheckoutUnavailable
                      ? "Annual checkout unavailable"
                      : `Choose ${policy.label} ${interval === "ANNUAL" ? "annual" : "monthly"}`}
                    plan={policy.plan}
                  />
                )}
                {annualCheckoutUnavailable ? (
                  <p className="mt-2 text-center text-xs text-muted-foreground">Contact sales while annual billing is being configured.</p>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
