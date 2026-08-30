import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";

import {
  createSubscriptionChangedEvent,
  stripeEventToSubscriptionSnapshot,
  stripeHandledSubscriptionEventTypes,
} from "@whisperm/billing-runtime";

import { publishSubscriptionChangedOutboxEvent, reserveBillingEvent, upsertSubscriptionSnapshot } from "@/lib/billing/subscription-store";

export const runtime = "nodejs";

const errorResponse = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

/**
 * Stripe webhook ingestion -- previously this logic existed only in
 * apps/api (never started by anything), so a real Stripe subscription
 * change never reached the live product's Subscription table. This is
 * the first thing in this repo that actually writes to it from apps/web.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    return errorResponse(503, "STRIPE_NOT_CONFIGURED");
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return errorResponse(400, "STRIPE_SIGNATURE_MISSING");
  }

  const rawBody = await request.text();

  const stripe = new Stripe(secretKey, { apiVersion: "2026-05-27.dahlia" });
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    return errorResponse(400, "STRIPE_SIGNATURE_INVALID");
  }

  if (!stripeHandledSubscriptionEventTypes.has(event.type)) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const snapshot = stripeEventToSubscriptionSnapshot(event);
  if (snapshot === undefined) {
    // Handled event type, but this particular event lacked metadata.tenantId
    // (or another required field) to act on -- accept it as received so
    // Stripe doesn't retry, but there is nothing to apply.
    return NextResponse.json({ ok: true, received: true, unmapped: true });
  }

  const reservation = await reserveBillingEvent({
    tenantId: snapshot.tenantId,
    source: "stripe",
    messageId: event.id,
    eventType: event.type,
    payload: event,
    correlationId: event.id,
  });

  if (reservation === "duplicate") {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  await upsertSubscriptionSnapshot(snapshot);
  await publishSubscriptionChangedOutboxEvent(createSubscriptionChangedEvent(snapshot, new Date(), event.id));

  return NextResponse.json({ ok: true, received: true });
}
