import { NextRequest, NextResponse } from "next/server";
import { processPaystackWebhook } from "@whisperm/billing-runtime";

import { webhookStoreAdapter } from "@/lib/billing/webhook-store-adapter";

export async function POST(request: NextRequest) {
  const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
  if (paystackSecretKey === undefined) {
    return NextResponse.json({ ok: false, error: "PAYSTACK_NOT_CONFIGURED" }, { status: 503 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-paystack-signature");

  try {
    const result = await processPaystackWebhook({ rawBody, signature }, webhookStoreAdapter, { paystackSecretKey });
    return NextResponse.json(result.body, { status: result.status });
  } catch {
    return NextResponse.json({ ok: false, error: "PAYSTACK_WEBHOOK_PROCESSING_FAILED" }, { status: 500 });
  }
}
