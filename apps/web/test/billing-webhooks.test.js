import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(`${root}src/${path}`, "utf8");

const stripeRoute = read("app/api/webhooks/stripe/route.ts");
const paystackRoute = read("app/api/webhooks/paystack/route.ts");
const subscriptionStore = read("lib/billing/subscription-store.ts");
const checkout = read("lib/billing/checkout.ts");
const subscriptionGate = read("lib/billing/subscription-gate.ts");

test("Stripe webhook fails closed with 503 when the secret key or webhook secret is unconfigured", () => {
  assert.match(stripeRoute, /if \(!secretKey \|\| !webhookSecret\) \{\s*return errorResponse\(503, "STRIPE_NOT_CONFIGURED"\);/u);
});

test("Stripe webhook verifies the signature before doing anything else with the body", () => {
  assert.match(stripeRoute, /event = stripe\.webhooks\.constructEvent\(rawBody, signature, webhookSecret\);/u);
  assert.match(stripeRoute, /catch \{\s*return errorResponse\(400, "STRIPE_SIGNATURE_INVALID"\);/u);
});

test("Stripe webhook reserves the event for exactly-once processing before writing the subscription", () => {
  const reserveIndex = stripeRoute.indexOf("reserveBillingEvent(");
  const upsertIndex = stripeRoute.indexOf("upsertSubscriptionSnapshot(");
  assert.ok(reserveIndex > -1 && upsertIndex > -1 && reserveIndex < upsertIndex);
  assert.match(stripeRoute, /if \(reservation === "duplicate"\)/u);
});

test("Paystack webhook fails closed with 503 when the secret key is unconfigured, and verifies signature before parsing", () => {
  assert.match(paystackRoute, /if \(!secretKey\) \{\s*return errorResponse\(503, "PAYSTACK_NOT_CONFIGURED"\);/u);
  assert.match(paystackRoute, /const signatureValid = await verifyPaystackSignature\(rawBody, signature, secretKey\);/u);
  assert.match(paystackRoute, /if \(!signatureValid\) \{\s*return errorResponse\(400, "PAYSTACK_SIGNATURE_INVALID"\);/u);
});

test("Paystack webhook never throws on a missing tenantId -- it reports unmapped instead of crashing", () => {
  assert.match(paystackRoute, /try \{\s*snapshot = paystackEventToSnapshot\(event\);\s*\} catch \{/u);
});

test("subscription upsert maps Stripe's INCOMPLETE states onto the narrower Prisma enum instead of throwing", () => {
  assert.match(subscriptionStore, /case "INCOMPLETE":\s*return "PAST_DUE";/u);
  assert.match(subscriptionStore, /case "INCOMPLETE_EXPIRED":\s*return "CANCELED";/u);
});

test("subscription upsert only writes fields present on the snapshot, never clobbering with null", () => {
  assert.match(subscriptionStore, /const periodFields: Record<string, Date> = \{\};/u);
  assert.match(subscriptionStore, /if \(snapshot\.currentPeriodEnd !== undefined\) periodFields\.currentPeriodEnd/u);
});

test("checkout never calls a payment provider without its required env vars -- returns PROVIDER_NOT_CONFIGURED instead", () => {
  assert.match(checkout, /if \(!secretKey \|\| !priceId \|\| !successUrl \|\| !cancelUrl\) \{/u);
  assert.match(checkout, /if \(!secretKey \|\| !callbackUrl\) \{/u);
  assert.match(checkout, /code: "PROVIDER_NOT_CONFIGURED",/u);
});

test("subscription gate treats an expired trial as not entitled, and fails closed with no subscription row", () => {
  assert.match(subscriptionGate, /if \(!subscription\) return false;/u);
  assert.match(subscriptionGate, /return !isTrialExpired\(subscription\.trialEndsAt, now\(\)\);/u);
});
