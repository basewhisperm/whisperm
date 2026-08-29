import Link from "next/link";

import { resolveTenantForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { PricingCards } from "@/components/billing/pricing-cards";
import { getPlanPolicy } from "@/lib/billing/plan-policy";
import type { SubscriptionPlan } from "@prisma/client";

function daysRemaining(trialEndsAt: Date, now: Date): number {
  const ms = trialEndsAt.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

export default async function BillingPage() {
  const resolution = await resolveTenantForCurrentUser();

  if (!resolution.ok) {
    return (
      <div className="rounded-2xl border-hairline bg-background p-6">
        <p className="text-sm font-medium text-foreground">
          {resolution.code === "AUTH_REQUIRED" ? "Sign in to manage billing." : "Workspace access could not be resolved."}
        </p>
        {resolution.code === "AUTH_REQUIRED" ? (
          <Link className="mt-3 inline-block text-xs font-medium text-[var(--color-whisper)]" href="/sign-in">
            Sign in
          </Link>
        ) : null}
      </div>
    );
  }

  const subscription = await prisma.subscription.findFirst({
    where: { tenantId: resolution.tenant.id },
    orderBy: { createdAt: "asc" },
  });

  const now = new Date();
  const trialDaysLeft =
    subscription?.status === "TRIALING" && subscription.trialEndsAt ? daysRemaining(subscription.trialEndsAt, now) : null;
  const currentPolicy = subscription ? getPlanPolicy(subscription.plan) : null;
  const annualConfiguredPlans = (["STARTER", "GROWTH", "PRO"] as const).filter(
    (plan) => Boolean(process.env[`STRIPE_PRICE_${plan}_ANNUAL`]),
  ) satisfies readonly SubscriptionPlan[];

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border-hairline bg-background p-5">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Current plan</p>
        <h1 className="mt-2 text-xl font-semibold text-foreground">
          {subscription ? `${subscription.plan} · ${subscription.status}` : "No subscription yet"}
        </h1>
        {trialDaysLeft !== null ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {trialDaysLeft > 0 ? `${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left in your trial.` : "Your trial has ended."}
          </p>
        ) : null}
        {currentPolicy ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {currentPolicy.includedBillableActions.toLocaleString()} acquisition actions included each month.
          </p>
        ) : null}
      </section>
      <PricingCards
        annualConfiguredPlans={annualConfiguredPlans}
        currentPlan={subscription?.plan ?? null}
        subscriptionStatus={subscription?.status ?? null}
      />
    </div>
  );
}
