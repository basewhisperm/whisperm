import { NextResponse, type NextRequest } from "next/server";

import { getTenantContextForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { initiateCheckout, type CheckoutPlan } from "@/lib/billing/checkout";
import { readJsonBody, RequestBodyError } from "@/lib/api/request-body";

const errorResponse = (status: number, code: string, message: string) =>
  NextResponse.json({ ok: false, error: { code, message } }, { status });

const VALID_PLANS: readonly CheckoutPlan[] = ["STARTER", "GROWTH", "PRO"];

/**
 * Starts a hosted checkout session for the signed-in user's tenant. This
 * is currently the only user-facing way in the live app to begin paying --
 * see the pricing page at /billing, which posts here.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const context = await getTenantContextForCurrentUser();
  if (!context) return errorResponse(401, "AUTH_REQUIRED", "Sign in to upgrade your workspace.");

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    if (error instanceof RequestBodyError) return errorResponse(error.status, error.code, error.message);
    throw error;
  }

  const plan = (body as { plan?: unknown }).plan;
  if (typeof plan !== "string" || !VALID_PLANS.includes(plan as CheckoutPlan)) {
    return errorResponse(400, "INVALID_PLAN", `plan must be one of ${VALID_PLANS.join(", ")}.`);
  }

  const tenantUser = await prisma.tenantUser.findUnique({
    where: { id: context.tenantUserId },
    select: { email: true },
  });
  if (!tenantUser) return errorResponse(401, "AUTH_REQUIRED", "Sign in to upgrade your workspace.");

  const result = await initiateCheckout({
    tenantId: context.tenant.id,
    // Country isn't collected anywhere in the live sign-up flow yet, so
    // billing always routes to Stripe today; Paystack stays available in
    // initiateCheckout for when GH-specific onboarding adds it.
    country: null,
    ownerEmail: tenantUser.email,
    workspaceName: context.tenant.name,
    plan: plan as CheckoutPlan,
  });

  if (!result.ok) {
    return errorResponse(503, result.code, result.message);
  }

  return NextResponse.json({ ok: true, provider: result.provider, checkoutUrl: result.checkoutUrl });
}
