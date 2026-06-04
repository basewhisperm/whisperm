import assert from "node:assert/strict";
import test from "node:test";

import {
  BillingRuntimeError,
  aggregateUsageEvents,
  aiProviderCostSchema,
  assertBillingTenantIsolation,
  billingAuditTrailSchema,
  billingCycleSchema,
  buildBillingAuditTrail,
  buildUsageEventIdempotencyKey,
  calculateUsageCharge,
  canTransitionBillingCycleState,
  costAttributionSchema,
  createBillingTelemetryEvent,
  createMeteringRecordFromUsageEvent,
  creditLedgerEntrySchema,
  evaluateQuota,
  evaluateRateLimit,
  invoiceGenerationContractSchema,
  pricingModelSchema,
  quotaPolicySchema,
  rateLimitPolicySchema,
  reconcileCosts,
  subscriptionPlanSchema,
  tokenAccountingSchema,
  transitionBillingCycleState,
  usageEventSchema,
  usageLedgerEntrySchema,
  usageSnapshotSchema
} from "../dist/index.js";

const now = new Date("2026-01-01T00:00:00.000Z");
const correlation = { correlationId: "corr-billing-1", requestId: "req-1", traceId: "trace-1" };

const usageEvent = (overrides = {}) => usageEventSchema.parse({
  eventId: "usage-1",
  tenantId: "tenant-1",
  metric: "AI_INPUT_TOKENS",
  quantity: 100,
  occurredAt: now.toISOString(),
  source: "WORKFLOW",
  resourceId: "run-1",
  idempotencyKey: "tenant-1:AI_INPUT_TOKENS:WORKFLOW:run-1:2026-01-01T00:00:00.000Z",
  replaySafe: true,
  correlation,
  metadata: {},
  ...overrides
});

test("provider-neutral plan, pricing, usage, ledger, token, and AI cost contracts validate without payment SDKs", () => {
  const plan = subscriptionPlanSchema.parse({
    planId: "growth",
    version: 1,
    name: "Growth",
    providerMappings: [
      { provider: "STRIPE", externalPlanId: "price_future_stripe" },
      { provider: "AWS_MARKETPLACE", externalPlanId: "aws-future" }
    ],
    includedQuotas: [{ metric: "AI_INPUT_TOKENS", limit: 1_000_000, period: "BILLING_CYCLE" }],
    active: true
  });
  assert.equal(plan.providerMappings.length, 2);

  const pricing = pricingModelSchema.parse({
    pricingModelId: "price-ai-input-v1",
    planId: "growth",
    version: 1,
    metric: "AI_INPUT_TOKENS",
    currency: "usd",
    model: "PER_UNIT",
    unitAmountMinor: 2,
    effectiveAt: now.toISOString()
  });
  assert.deepEqual(calculateUsageCharge({ pricing, quantity: 150 }), { currency: "USD", amountMinor: 300 });

  const event = usageEvent();
  const meter = createMeteringRecordFromUsageEvent({ meterId: "meter-1", event, measuredAt: now });
  assert.equal(meter.tenantId, "tenant-1");
  assert.equal(meter.idempotencyKey, event.idempotencyKey);

  const usageLedger = usageLedgerEntrySchema.parse({
    ledgerEntryId: "usage-ledger-1",
    tenantId: "tenant-1",
    cycleId: "cycle-1",
    metric: "AI_INPUT_TOKENS",
    quantity: 100,
    direction: "DEBIT",
    sourceEventId: event.eventId,
    idempotencyKey: event.idempotencyKey,
    postedAt: now.toISOString(),
    replaySafe: true,
    correlation
  });
  assert.equal(usageLedger.replaySafe, true);

  const creditLedger = creditLedgerEntrySchema.parse({
    creditEntryId: "credit-1",
    tenantId: "tenant-1",
    accountId: "acct-1",
    currency: "usd",
    amountMinor: 1000,
    direction: "CREDIT",
    reason: "PROMOTION",
    sourceId: "promo-1",
    idempotencyKey: "credit-key-1",
    postedAt: now.toISOString(),
    replaySafe: true,
    correlation
  });
  assert.equal(creditLedger.currency, "USD");

  const tokens = tokenAccountingSchema.parse({
    tenantId: "tenant-1",
    provider: "OPENAI",
    model: "future-model",
    inputTokens: 100,
    outputTokens: 20,
    requestCount: 1,
    measuredAt: now.toISOString(),
    correlation
  });
  assert.equal(tokens.cachedInputTokens, 0);

  const providerCost = aiProviderCostSchema.parse({
    tenantId: "tenant-1",
    provider: "ANTHROPIC",
    model: "future-claude",
    inputCost: { currency: "USD", amountMinor: 10 },
    outputCost: { currency: "USD", amountMinor: 25 },
    totalCost: { currency: "USD", amountMinor: 35 },
    usageWindow: { startsAt: now.toISOString(), endsAt: new Date(now.getTime() + 3600000).toISOString(), grain: "HOUR" },
    correlation
  });
  assert.equal(providerCost.totalCost.amountMinor, 35);
});

test("usage aggregation and snapshots are deterministic and tenant isolated", () => {
  const window = { startsAt: now.toISOString(), endsAt: new Date(now.getTime() + 3600000).toISOString(), grain: "HOUR" };
  const events = [
    usageEvent({ eventId: "b", quantity: 3 }),
    usageEvent({ eventId: "a", quantity: 7 }),
    usageEvent({ eventId: "ignored", metric: "AI_OUTPUT_TOKENS", quantity: 99 })
  ];

  const aggregate = aggregateUsageEvents({ aggregateId: "agg-1", tenantId: "tenant-1", metric: "AI_INPUT_TOKENS", events, window, computedAt: now, correlation });
  assert.equal(aggregate.quantity, 10);
  assert.deepEqual(aggregate.sourceEventIds, ["a", "b"]);

  const snapshot = usageSnapshotSchema.parse({
    snapshotId: "snap-1",
    tenantId: "tenant-1",
    cycleId: "cycle-1",
    aggregates: [aggregate],
    capturedAt: now.toISOString(),
    replaySafe: true,
    correlation
  });
  assert.equal(snapshot.aggregates[0].tenantId, "tenant-1");

  assert.throws(
    () => aggregateUsageEvents({ aggregateId: "bad", tenantId: "tenant-1", metric: "AI_INPUT_TOKENS", events: [usageEvent({ tenantId: "tenant-2" })], window, computedAt: now, correlation }),
    BillingRuntimeError
  );
});

test("quota and rate limit helpers fail closed with replay-safe enforcement decisions", () => {
  const quota = quotaPolicySchema.parse({
    quotaId: "quota-1",
    tenantId: "tenant-1",
    metric: "AI_REQUESTS",
    limit: 5,
    period: "DAY",
    enforcement: "HARD",
    failClosed: true,
    active: true,
    correlation
  });
  const quotaDecision = evaluateQuota({ policy: quota, currentQuantity: 5, requestedQuantity: 1, evaluatedAt: now });
  assert.equal(quotaDecision.allowed, false);
  assert.equal(quotaDecision.reason, "HARD_LIMIT_EXCEEDED");
  assert.equal(quotaDecision.replaySafe, true);

  const rateLimit = rateLimitPolicySchema.parse({
    rateLimitId: "rate-1",
    tenantId: "tenant-1",
    metric: "AI_REQUESTS",
    limit: 10,
    windowSeconds: 60,
    burstLimit: 12,
    failClosed: true,
    active: true,
    correlation
  });
  const rateDecision = evaluateRateLimit({ policy: rateLimit, observedQuantity: 11, requestedQuantity: 2, evaluatedAt: now });
  assert.equal(rateDecision.allowed, false);
  // Effective ceiling should reflect burst capacity rather than the
  // steady-state limit so callers can display the actual quota window.
  assert.equal(rateDecision.limit, 12);

  const sustainedDecision = evaluateRateLimit({
    policy: { ...rateLimit, rateLimitId: "rate-2", burstLimit: undefined },
    observedQuantity: 8,
    requestedQuantity: 2,
    evaluatedAt: now
  });
  assert.equal(sustainedDecision.allowed, true);
  assert.equal(sustainedDecision.limit, 10);
});

test("billing cycle state machine rejects invalid transitions and stamps deterministic timestamps", () => {
  const cycle = billingCycleSchema.parse({
    tenantId: "tenant-1",
    cycleId: "cycle-1",
    subscriptionId: "sub-1",
    state: "OPEN",
    startsAt: now.toISOString(),
    endsAt: new Date(now.getTime() + 86400000).toISOString(),
    correlation
  });

  assert.equal(canTransitionBillingCycleState("OPEN", "CLOSED"), true);
  const closed = transitionBillingCycleState({ cycle, to: "CLOSED", now });
  assert.equal(closed.closedAt, now.toISOString());
  const invoiced = transitionBillingCycleState({ cycle: closed, to: "INVOICED", now });
  assert.equal(invoiced.invoicedAt, now.toISOString());
  assert.throws(() => transitionBillingCycleState({ cycle: invoiced, to: "OPEN", now }), BillingRuntimeError);
});

test("cost attribution, invoices, reconciliation, telemetry, and audit contracts preserve tenant boundaries", () => {
  const cost = costAttributionSchema.parse({
    attributionId: "exec-cost-1",
    tenantId: "tenant-1",
    category: "EXECUTION",
    executionId: "exec-1",
    durationMs: 1250,
    cost: { currency: "USD", amountMinor: 42 },
    occurredAt: now.toISOString(),
    idempotencyKey: "exec-cost-key-1",
    replaySafe: true,
    correlation
  });
  assertBillingTenantIsolation({ tenantId: "tenant-1", costs: [cost], correlation });

  const invoice = invoiceGenerationContractSchema.parse({
    invoiceId: "invoice-1",
    tenantId: "tenant-1",
    accountId: "acct-1",
    cycleId: "cycle-1",
    currency: "usd",
    state: "DRAFT",
    generatedAt: now.toISOString(),
    lineItems: [{
      lineItemId: "line-1",
      tenantId: "tenant-1",
      metric: "EXECUTION_SECONDS",
      description: "Execution runtime",
      quantity: 1,
      unitAmountMinor: 42,
      amount: { currency: "USD", amountMinor: 42 },
      sourceAggregateId: "agg-exec-1"
    }],
    subtotal: { currency: "USD", amountMinor: 42 },
    creditsApplied: { currency: "USD", amountMinor: 0 },
    total: { currency: "USD", amountMinor: 42 },
    replaySafe: true,
    correlation
  });
  assert.equal(invoice.currency, "USD");

  assert.throws(() => invoiceGenerationContractSchema.parse({
    ...invoice,
    lineItems: [{ ...invoice.lineItems[0], tenantId: "tenant-2" }]
  }), /line item tenantId/u);

  const reconciliation = reconcileCosts({
    reconciliationId: "recon-1",
    tenantId: "tenant-1",
    provider: "OPENAI",
    internalCost: { currency: "USD", amountMinor: 100 },
    externalCost: { currency: "USD", amountMinor: 103 },
    reconciledAt: now,
    toleranceMinor: 5,
    correlation
  });
  assert.equal(reconciliation.status, "VARIANCE");

  const telemetry = createBillingTelemetryEvent({ eventId: "telemetry-1", tenantId: "tenant-1", name: "billing.quota.evaluated", occurredAt: now, correlation, attributes: { allowed: false, limit: 5 } });
  assert.equal(telemetry.attributes.limit, 5);

  const audit = buildBillingAuditTrail({
    auditId: "audit-1",
    tenantId: "tenant-1",
    actor: { tenantId: "tenant-1", actorId: "user-1", actorType: "USER" },
    action: "BUDGET_CHANGED",
    targetType: "budget",
    targetId: "budget-1",
    occurredAt: now,
    correlation
  });
  assert.equal(billingAuditTrailSchema.parse(audit).actor.actorId, "user-1");
  assert.throws(() => buildBillingAuditTrail({ ...audit, actor: { tenantId: "tenant-2", actorId: "user-2", actorType: "USER" }, occurredAt: now }), /audit actor tenantId/u);
});

test("idempotency keys are stable for deterministic replay-safe accounting", () => {
  const first = buildUsageEventIdempotencyKey({ tenantId: "tenant-1", metric: "AI_INPUT_TOKENS", source: "WORKFLOW", resourceId: "run-1", occurredAt: now.toISOString() });
  const second = buildUsageEventIdempotencyKey({ tenantId: "tenant-1", metric: "AI_INPUT_TOKENS", source: "WORKFLOW", resourceId: "run-1", occurredAt: now.toISOString() });
  assert.equal(first, second);
  assert.equal(usageEvent({ idempotencyKey: first }).replaySafe, true);
});
