import Stripe from "stripe";
import type { StripeUpgradePort } from "@whisperm/billing-runtime";

// Stripe Price IDs are account-specific configuration (created in the Stripe dashboard), not
// shared business logic, so they're read from env vars rather than hardcoded here.
const STRIPE_PRICE_ENV_VAR: Record<string, string> = {
  STARTER: "STRIPE_PRICE_STARTER",
  GROWTH: "STRIPE_PRICE_GROWTH",
  PRO: "STRIPE_PRICE_PRO",
};

const priceIdForPlan = (plan: string): string => {
  const envVar = STRIPE_PRICE_ENV_VAR[plan.toUpperCase()];
  const priceId = envVar === undefined ? undefined : process.env[envVar];
  if (priceId === undefined || priceId.trim().length === 0) {
    throw new Error(`No Stripe price configured for plan "${plan}" (expected env var ${envVar ?? "STRIPE_PRICE_<PLAN>"})`);
  }
  return priceId;
};

export const createStripeUpgradePort = (options: { readonly secretKey: string; readonly appUrl: string }): StripeUpgradePort => {
  const stripe = new Stripe(options.secretKey, { apiVersion: "2026-05-27.dahlia" });

  return {
    async createCustomerAndCheckout(input) {
      const customer = await stripe.customers.create({
        email: input.email,
        name: input.workspaceName,
        metadata: { tenantId: input.tenantId },
      });

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customer.id,
        line_items: [{ price: priceIdForPlan(input.plan), quantity: 1 }],
        subscription_data: { metadata: { tenantId: input.tenantId, plan: input.plan } },
        success_url: `${options.appUrl}/settings?upgrade=success`,
        cancel_url: `${options.appUrl}/settings?upgrade=canceled`,
      });

      if (session.url === null) {
        throw new Error("Stripe did not return a checkout URL");
      }

      return { customerId: customer.id, checkoutUrl: session.url };
    },
  };
};
