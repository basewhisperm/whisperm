import { NextRequest, NextResponse } from "next/server";
import { processStripeWebhook } from "@whisperm/billing-runtime";

import { webhookStoreAdapter } from "@/lib/billing/webhook-store-adapter";

export async function POST(request: NextRequest) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (stripeSecretKey === undefined || stripeWebhookSecret === undefined) {
    return NextResponse.json({ ok: false, error: "STRIPE_NOT_CONFIGURED" }, { status: 503 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  try {
    const result = await processStripeWebhook({ rawBody, signature }, webhookStoreAdapter, { stripeSecretKey, stripeWebhookSecret });
    return NextResponse.json(result.body, { status: result.status });
  } catch {
    return NextResponse.json({ ok: false, error: "STRIPE_WEBHOOK_PROCESSING_FAILED" }, { status: 500 });
  }
}
