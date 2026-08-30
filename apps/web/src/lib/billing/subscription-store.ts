import { Prisma, type SubscriptionPlan, type SubscriptionStatus } from "@prisma/client";
import type { BillingSubscriptionSnapshot, StripeSubscriptionStatus, SubscriptionChangedEvent } from "@whisperm/billing-runtime";

import { prisma } from "@/lib/prisma";

const PLAN_VALUES: readonly SubscriptionPlan[] = ["STARTER", "GROWTH", "PRO"];

function planFromMetadata(metadata: Record<string, unknown>): SubscriptionPlan | undefined {
  const raw = metadata.plan;
  if (typeof raw !== "string") return undefined;
  const upper = raw.toUpperCase();
  return (PLAN_VALUES as readonly string[]).includes(upper) ? (upper as SubscriptionPlan) : undefined;
}

/**
 * Stripe/Paystack subscription statuses this snapshot type can carry
 * (including INCOMPLETE/INCOMPLETE_EXPIRED, which Stripe uses but our
 * Subscription.status enum doesn't) mapped onto the narrower Prisma enum.
 * Both incomplete states fail closed -- they mean "no confirmed payment
 * yet", which must not read as entitled.
 */
function toPrismaStatus(status: StripeSubscriptionStatus): SubscriptionStatus {
  switch (status) {
    case "ACTIVE":
    case "TRIALING":
    case "PAST_DUE":
    case "CANCELED":
    case "UNPAID":
      return status;
    case "INCOMPLETE":
      return "PAST_DUE";
    case "INCOMPLETE_EXPIRED":
      return "CANCELED";
    default:
      return "PAST_DUE";
  }
}

/**
 * Upserts the tenant's single canonical Subscription row from a webhook
 * snapshot. Only fields present on the snapshot are written -- an absent
 * optional field (e.g. an invoice event with no currentPeriodEnd) leaves
 * whatever was already stored untouched rather than clobbering it with
 * null.
 */
export async function upsertSubscriptionSnapshot(snapshot: BillingSubscriptionSnapshot): Promise<void> {
  const status = toPrismaStatus(snapshot.status);
  const plan = planFromMetadata(snapshot.metadata);

  const providerIds =
    snapshot.provider === "STRIPE"
      ? { stripeCustomerId: snapshot.providerCustomerId, stripeSubscriptionId: snapshot.providerSubscriptionId }
      : { paystackCustomerId: snapshot.providerCustomerId, paystackSubscriptionId: snapshot.providerSubscriptionId };

  const periodFields: Record<string, Date> = {};
  if (snapshot.currentPeriodStart !== undefined) periodFields.currentPeriodStart = new Date(snapshot.currentPeriodStart);
  if (snapshot.currentPeriodEnd !== undefined) periodFields.currentPeriodEnd = new Date(snapshot.currentPeriodEnd);
  if (snapshot.trialEndsAt !== undefined) periodFields.trialEndsAt = new Date(snapshot.trialEndsAt);

  const existing = await prisma.subscription.findFirst({
    where: { tenantId: snapshot.tenantId },
    orderBy: { createdAt: "asc" },
  });

  if (existing) {
    await prisma.subscription.update({
      where: { id: existing.id },
      data: {
        status,
        ...(plan !== undefined ? { plan } : {}),
        ...providerIds,
        ...periodFields,
        canceledAt: status === "CANCELED" ? (existing.canceledAt ?? new Date()) : null,
      },
    });
    return;
  }

  await prisma.subscription.create({
    data: {
      tenantId: snapshot.tenantId,
      plan: plan ?? "STARTER",
      status,
      currency: "USD",
      ...providerIds,
      ...periodFields,
    },
  });
}

export interface ReserveBillingEventInput {
  readonly tenantId: string;
  readonly source: "stripe" | "paystack";
  readonly messageId: string;
  readonly eventType: string;
  readonly payload: unknown;
  readonly correlationId: string;
}

/**
 * Reserves a webhook delivery for exactly-once processing using the
 * existing tenant-scoped InboxEvent table (unique on tenantId+source+
 * messageId) -- Stripe/Paystack both deliver at-least-once, so a retried
 * delivery must be a no-op rather than re-applying the subscription
 * update.
 */
export async function reserveBillingEvent(input: ReserveBillingEventInput): Promise<"reserved" | "duplicate"> {
  try {
    await prisma.inboxEvent.create({
      data: {
        tenantId: input.tenantId,
        source: input.source,
        messageId: input.messageId,
        eventType: input.eventType,
        payload: input.payload as Prisma.InputJsonValue,
        correlationId: input.correlationId,
        state: "CONSUMED",
        processedAt: new Date(),
      },
    });
    return "reserved";
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return "duplicate";
    }
    throw error;
  }
}

/**
 * Best-effort audit trail of subscription changes via the existing Outbox
 * table. Deliberately non-fatal: nothing currently drains OutboxEvent (see
 * the worker-durability gap noted in the codebase audit), so a failure
 * here must never take down webhook ingestion that has already durably
 * updated the Subscription row.
 */
export async function publishSubscriptionChangedOutboxEvent(event: SubscriptionChangedEvent): Promise<void> {
  try {
    await prisma.outboxEvent.create({
      data: {
        tenantId: event.tenantId,
        aggregateType: "Subscription",
        aggregateId: event.providerSubscriptionId,
        eventType: event.type,
        idempotencyKey: `${event.source}:${event.providerSubscriptionId}:${event.occurredAt}`,
        payload: event as unknown as Prisma.InputJsonValue,
        correlationId: event.stripeEventId ?? `${event.source}:${event.providerSubscriptionId}:${event.occurredAt}`,
      },
    });
  } catch (error) {
    console.error("subscription_changed_outbox_write_failed", {
      tenantId: event.tenantId,
      error: error instanceof Error ? error.message : "Unknown outbox write error",
    });
  }
}
