import { NextResponse, type NextRequest } from "next/server";

import { createPaystackSubscriptionChangedEvent, paystackEventToSnapshot, verifyPaystackSignature, type PaystackWebhookEvent } from "@whisperm/billing-runtime";

import { publishSubscriptionChangedOutboxEvent, reserveBillingEvent, upsertSubscriptionSnapshot } from "@/lib/billing/subscription-store";

export const runtime = "nodejs";

const errorResponse = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

const HANDLED_EVENTS = new Set(["subscription.create", "subscription.disable", "charge.success", "charge.failed"]);

/**
 * Paystack webhook ingestion -- mirrors the Stripe route's shape. Same
 * gap this closes: this logic previously only existed in apps/api, which
 * nothing starts, so it never reached the live product's Subscription
 * table.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    return errorResponse(503, "PAYSTACK_NOT_CONFIGURED");
  }

  const signature = request.headers.get("x-paystack-signature");
  if (!signature) {
    return errorResponse(400, "PAYSTACK_SIGNATURE_MISSING");
  }

  const rawBody = await request.text();

  const signatureValid = await verifyPaystackSignature(rawBody, signature, secretKey);
  if (!signatureValid) {
    return errorResponse(400, "PAYSTACK_SIGNATURE_INVALID");
  }

  let event: PaystackWebhookEvent;
  try {
    event = JSON.parse(rawBody) as PaystackWebhookEvent;
  } catch {
    return errorResponse(400, "PAYSTACK_PAYLOAD_INVALID");
  }

  if (!HANDLED_EVENTS.has(event.event)) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  let snapshot;
  try {
    snapshot = paystackEventToSnapshot(event);
  } catch {
    // Handled event type, but this delivery lacked metadata.tenantId (or
    // another required field) to act on -- accept it as received so
    // Paystack doesn't retry, but there is nothing to apply.
    return NextResponse.json({ ok: true, received: true, unmapped: true });
  }

  const eventData = event.data as Record<string, unknown>;
  const providerEventId = `${event.event}:${eventData.id ?? eventData.reference ?? Date.now()}`;

  const reservation = await reserveBillingEvent({
    tenantId: snapshot.tenantId,
    source: "paystack",
    messageId: providerEventId,
    eventType: event.event,
    payload: event,
    correlationId: providerEventId,
  });

  if (reservation === "duplicate") {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  await upsertSubscriptionSnapshot(snapshot);
  await publishSubscriptionChangedOutboxEvent(createPaystackSubscriptionChangedEvent(snapshot, new Date()));

  return NextResponse.json({ ok: true, received: true });
}
