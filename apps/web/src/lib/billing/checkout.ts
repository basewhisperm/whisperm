import Stripe from "stripe";

import { PAYSTACK_PRICING_GHS, resolveBillingProvider, type BillingProviderName } from "@whisperm/billing-runtime";

export type CheckoutPlan = "STARTER" | "GROWTH" | "PRO";

export interface CheckoutContext {
  readonly tenantId: string;
  readonly country?: string | null;
  readonly ownerEmail: string;
  readonly workspaceName: string;
  readonly plan: CheckoutPlan;
}

export type CheckoutResult =
  | { readonly ok: true; readonly provider: BillingProviderName; readonly checkoutUrl: string }
  | { readonly ok: false; readonly provider: BillingProviderName; readonly code: "PROVIDER_NOT_CONFIGURED"; readonly message: string };

const STRIPE_PRICE_ENV: Record<CheckoutPlan, string> = {
  STARTER: "STRIPE_PRICE_STARTER",
  GROWTH: "STRIPE_PRICE_GROWTH",
  PRO: "STRIPE_PRICE_PRO",
};

async function createStripeCheckout(context: CheckoutContext): Promise<CheckoutResult> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env[STRIPE_PRICE_ENV[context.plan]];
  const successUrl = process.env.BILLING_CHECKOUT_SUCCESS_URL;
  const cancelUrl = process.env.BILLING_CHECKOUT_CANCEL_URL;

  if (!secretKey || !priceId || !successUrl || !cancelUrl) {
    return {
      ok: false,
      provider: "STRIPE",
      code: "PROVIDER_NOT_CONFIGURED",
      message: "Stripe is not configured for this environment (STRIPE_SECRET_KEY, a per-plan STRIPE_PRICE_*, and the checkout success/cancel URLs are all required).",
    };
  }

  const stripe = new Stripe(secretKey, { apiVersion: "2026-05-27.dahlia" });

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: context.ownerEmail,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    subscription_data: {
      metadata: { tenantId: context.tenantId, plan: context.plan },
    },
    metadata: { tenantId: context.tenantId, plan: context.plan },
  });

  if (!session.url) {
    return {
      ok: false,
      provider: "STRIPE",
      code: "PROVIDER_NOT_CONFIGURED",
      message: "Stripe did not return a checkout URL.",
    };
  }

  return { ok: true, provider: "STRIPE", checkoutUrl: session.url };
}

async function createPaystackCheckout(context: CheckoutContext): Promise<CheckoutResult> {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  const callbackUrl = process.env.BILLING_CHECKOUT_SUCCESS_URL;

  if (!secretKey || !callbackUrl) {
    return {
      ok: false,
      provider: "PAYSTACK",
      code: "PROVIDER_NOT_CONFIGURED",
      message: "Paystack is not configured for this environment (PAYSTACK_SECRET_KEY and the checkout success URL are required).",
    };
  }

  const pricing = PAYSTACK_PRICING_GHS[context.plan];
  const planCode = process.env[`PAYSTACK_PLAN_CODE_${context.plan}`] ?? pricing.planCode;

  const response = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: context.ownerEmail,
      amount: pricing.amountPesewas,
      currency: "GHS",
      plan: planCode,
      callback_url: callbackUrl,
      metadata: { tenantId: context.tenantId, plan: context.plan },
    }),
  });

  const body = (await response.json()) as { status: boolean; data?: { authorization_url?: string }; message?: string };

  if (!response.ok || body.status !== true || !body.data?.authorization_url) {
    return {
      ok: false,
      provider: "PAYSTACK",
      code: "PROVIDER_NOT_CONFIGURED",
      message: body.message ?? "Paystack did not return a checkout URL.",
    };
  }

  return { ok: true, provider: "PAYSTACK", checkoutUrl: body.data.authorization_url };
}

/**
 * Starts a hosted checkout session for a tenant's chosen plan. Never
 * throws for a missing/misconfigured provider -- callers get back an
 * explicit PROVIDER_NOT_CONFIGURED result to show the user, matching this
 * codebase's existing convention for the seller-invitation providers
 * (see provider-health route) rather than failing deep inside a payment
 * SDK call.
 */
export async function initiateCheckout(context: CheckoutContext): Promise<CheckoutResult> {
  const provider = resolveBillingProvider({ country: context.country ?? null });
  return provider === "PAYSTACK" ? createPaystackCheckout(context) : createStripeCheckout(context);
}
