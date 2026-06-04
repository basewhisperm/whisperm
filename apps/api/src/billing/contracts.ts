import type {
  BillingSubscriptionSnapshot,
  SubscriptionChangedEvent,
} from "@whisperm/billing-runtime";

export interface BillingEventIngestionReservation {
  provider: "STRIPE" | "PAYSTACK";
  providerEventId: string;
  eventType: string;
  correlationId: string;
}

export interface BillingEventIngestionStore {
  reserve(input: BillingEventIngestionReservation): Promise<"reserved" | "duplicate">;
}

export interface SubscriptionStore {
  upsertSubscription(snapshot: BillingSubscriptionSnapshot): Promise<void>;
}

export interface BillingOutbox {
  publishSubscriptionChanged(event: SubscriptionChangedEvent): Promise<void>;
}

export interface StripeWebhookDependencies {
  billingEventIngestion: BillingEventIngestionStore;
  subscriptions: SubscriptionStore;
  outbox: BillingOutbox;
  now?: () => Date;
}

export interface PaystackWebhookDependencies {
  billingEventIngestion: BillingEventIngestionStore;
  subscriptions: SubscriptionStore;
  outbox: BillingOutbox;
  now?: () => Date;
}
