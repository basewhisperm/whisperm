/**
 * paystack.ts
 *
 * Paystack billing provider for WhispeRM — Ghana market.
 * Maps Paystack webhook events to the shared BillingSubscriptionSnapshot shape
 * so internal consumers are provider-agnostic.
 */

import type { StripeSubscriptionStatus, BillingSubscriptionSnapshot, SubscriptionChangedEvent } from "./stripe.js";

export interface PaystackSubscriptionData {
  subscription_code: string;
  email_token: string;
  status: string;
  customer: {
    id: number;
    customer_code: string;
    email: string;
    metadata?: Record<string, unknown> | null;
  };
  plan: {
    plan_code: string;
    name: string;
    interval: string;
  };
  next_payment_date?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface PaystackChargeData {
  id: number;
  reference: string;
  status: string;
  amount: number;
  currency: string;
  customer: {
    id: number;
    customer_code: string;
    email: string;
    metadata?: Record<string, unknown> | null;
  };
  subscription_code?: string | null;
  metadata?: Record<string, unknown> | null;
  paid_at?: string | null;
  created_at?: string | null;
}

export type PaystackEventType =
  | "subscription.create"
  | "subscription.disable"
  | "charge.success"
  | "charge.failed";

export interface PaystackWebhookEvent {
  event: PaystackEventType | string;
  data: PaystackSubscriptionData | PaystackChargeData | Record<string, unknown>;
}

const extractTenantId = (metadata: Record<string, unknown> | null | undefined): string => {
  const tenantId = metadata?.["tenantId"];
  if (typeof tenantId !== "string" || tenantId.trim().length === 0) {
    throw new Error("Paystack event missing metadata.tenantId");
  }
  return tenantId;
};

export const mapPaystackSubscriptionEventToStatus = (
  eventType: PaystackEventType | string,
): StripeSubscriptionStatus => {
  switch (eventType) {
    case "subscription.create": return "ACTIVE";
    case "subscription.disable": return "CANCELED";
    case "charge.success": return "ACTIVE";
    case "charge.failed": return "PAST_DUE";
    default: return "PAST_DUE";
  }
};

export const paystackSubscriptionEventToSnapshot = (
  event: PaystackWebhookEvent,
): BillingSubscriptionSnapshot => {
  const data = event.data as PaystackSubscriptionData;
  const tenantId = extractTenantId(data.customer?.metadata as Record<string, unknown> | null);
  return {
    tenantId,
    provider: "PAYSTACK",
    providerCustomerId: data.customer.customer_code,
    providerSubscriptionId: data.subscription_code,
    status: mapPaystackSubscriptionEventToStatus(event.event),
    cancelAtPeriodEnd: event.event === "subscription.disable",
    ...(data.next_payment_date == null ? {} : { currentPeriodEnd: data.next_payment_date }),
    metadata: {
      paystackProvider: "PAYSTACK",
      planCode: data.plan?.plan_code,
      planName: data.plan?.name,
    },
  };
};

export const paystackChargeEventToSnapshot = (
  event: PaystackWebhookEvent,
): BillingSubscriptionSnapshot => {
  const data = event.data as PaystackChargeData;
  const metadata = (data.metadata ?? {}) as Record<string, unknown>;
  const tenantId = extractTenantId(metadata);
  return {
    tenantId,
    provider: "PAYSTACK",
    providerCustomerId: data.customer.customer_code,
    providerSubscriptionId: data.subscription_code ?? data.reference,
    status: mapPaystackSubscriptionEventToStatus(event.event),
    cancelAtPeriodEnd: false,
    metadata: {
      paystackProvider: "PAYSTACK",
      chargeReference: data.reference,
    },
  };
};

export const paystackEventToSnapshot = (event: PaystackWebhookEvent): BillingSubscriptionSnapshot => {
  if (event.event === "charge.success" || event.event === "charge.failed") {
    return paystackChargeEventToSnapshot(event);
  }
  return paystackSubscriptionEventToSnapshot(event);
};

export const createPaystackSubscriptionChangedEvent = (
  subscription: BillingSubscriptionSnapshot,
  occurredAt = new Date(),
): SubscriptionChangedEvent => ({
  type: "subscription.changed",
  source: "paystack",
  tenantId: subscription.tenantId,
  provider: "PAYSTACK",
  providerSubscriptionId: subscription.providerSubscriptionId,
  status: subscription.status,
  occurredAt: occurredAt.toISOString(),
  subscription,
});

export const verifyPaystackSignature = async (
  rawBody: string,
  signature: string,
  secretKey: string,
): Promise<boolean> => {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secretKey),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const hex = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex === signature;
};

export const PAYSTACK_PRICING_GHS = {
  STARTER: { amountPesewas: 490000, planCode: "PLN_starter_gh", interval: "monthly" },
  GROWTH:  { amountPesewas: 990000, planCode: "PLN_growth_gh",  interval: "monthly" },
  PRO:     { amountPesewas: 1990000, planCode: "PLN_pro_gh",    interval: "monthly" },
} as const;

export type BillingProviderName = "STRIPE" | "PAYSTACK";

export const resolveBillingProvider = (workspace: { country?: string | null }): BillingProviderName =>
  workspace.country === "GH" ? "PAYSTACK" : "STRIPE";
