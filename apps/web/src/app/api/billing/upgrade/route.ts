import { currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { initiateUpgrade, BillingError } from "@whisperm/billing-runtime";

import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { createStripeUpgradePort } from "@/lib/billing/stripe-checkout-adapter";
import { createPaystackUpgradePort } from "@/lib/billing/paystack-checkout-adapter";

const errorResponse = (message: string, status: number, code?: string) =>
  NextResponse.json({ ok: false, error: { code: code ?? "REQUEST_FAILED", message } }, { status });

const VALID_PLANS = new Set(["STARTER", "GROWTH", "PRO"]);

export async function POST(request: NextRequest) {
  const [tenant, user] = await Promise.all([getTenantForCurrentUser(), currentUser()]);
  if (!tenant || !user) return errorResponse("Unauthorized", 401, "UNAUTHORIZED");

  const email = user.emailAddresses.find((address) => address.id === user.primaryEmailAddressId)?.emailAddress ?? user.emailAddresses[0]?.emailAddress;
  if (email === undefined) return errorResponse("No verified email on this account", 422, "EMAIL_REQUIRED");

  const body = await request.json().catch(() => null) as { plan?: unknown } | null;
  const plan = typeof body?.plan === "string" ? body.plan.toUpperCase() : undefined;
  if (plan === undefined || !VALID_PLANS.has(plan)) {
    return errorResponse("A supported plan (STARTER, GROWTH, or PRO) is required", 400, "PLAN_REQUIRED");
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
  if (stripeSecretKey === undefined || paystackSecretKey === undefined) {
    return errorResponse("Billing is not configured for this environment", 503, "BILLING_NOT_CONFIGURED");
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin;

  try {
    const result = await initiateUpgrade(
      {
        stripe: createStripeUpgradePort({ secretKey: stripeSecretKey, appUrl }),
        paystack: createPaystackUpgradePort({ secretKey: paystackSecretKey, appUrl }),
      },
      // No per-workspace country is captured today (no signup form collects one) -- unknown
      // country resolves to Stripe, which is the correct default until that exists.
      { tenantId: tenant.id, country: null, ownerEmail: email, workspaceName: tenant.name },
      plan,
    );

    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    if (error instanceof BillingError) return errorResponse(error.message, error.statusCode, error.code);
    return errorResponse("Failed to start checkout", 500);
  }
}
