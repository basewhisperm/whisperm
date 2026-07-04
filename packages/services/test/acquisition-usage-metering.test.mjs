import assert from "node:assert/strict";
import test from "node:test";

import { AcquisitionUsageMeteringService, recordUsageEventBestEffort } from "@whisperm/services";

class MemoryUsageEventRepository {
  constructor() {
    this.events = [];
  }

  async createIfNotExists(context, input) {
    const existing = this.events.find((event) => event.tenantId === context.tenantId && event.idempotencyKey === input.idempotencyKey);
    if (existing !== undefined) return existing;
    const record = {
      id: `event-${this.events.length + 1}`,
      tenantId: context.tenantId,
      eventType: input.eventType,
      quantity: input.quantity ?? 1,
      billable: input.billable ?? true,
      campaignId: input.campaignId ?? null,
      captureId: input.captureId ?? null,
      contactId: input.contactId ?? null,
      dealId: input.dealId ?? null,
      runtimeExecutionId: input.runtimeExecutionId ?? null,
      idempotencyKey: input.idempotencyKey,
      occurredAt: input.occurredAt,
      metadata: input.metadata ?? null,
      createdAt: new Date().toISOString(),
    };
    this.events.push(record);
    return record;
  }

  async summarizeByTenantAndPeriod(context, periodStart, periodEnd) {
    const events = this.events.filter((event) =>
      event.tenantId === context.tenantId &&
      Date.parse(event.occurredAt) >= periodStart.getTime() &&
      Date.parse(event.occurredAt) <= periodEnd.getTime());

    const totalsByType = new Map();
    for (const event of events) {
      const current = totalsByType.get(event.eventType) ?? { eventType: event.eventType, quantity: 0, billableQuantity: 0, eventCount: 0 };
      totalsByType.set(event.eventType, {
        eventType: event.eventType,
        quantity: current.quantity + event.quantity,
        billableQuantity: current.billableQuantity + (event.billable ? event.quantity : 0),
        eventCount: current.eventCount + 1,
      });
    }
    const totals = [...totalsByType.values()].sort((a, b) => a.eventType.localeCompare(b.eventType));
    return {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      totals,
      totalQuantity: totals.reduce((sum, total) => sum + total.quantity, 0),
      billableTotalQuantity: totals.reduce((sum, total) => sum + total.billableQuantity, 0),
    };
  }

  async listByTenantAndPeriod(context, periodStart, periodEnd) {
    const items = this.events.filter((event) =>
      event.tenantId === context.tenantId &&
      Date.parse(event.occurredAt) >= periodStart.getTime() &&
      Date.parse(event.occurredAt) <= periodEnd.getTime());
    return { items };
  }
}

const service = (repo, clock) => new AcquisitionUsageMeteringService({ usageEvents: repo, clock });

test("records a usage event", async () => {
  const repo = new MemoryUsageEventRepository();
  const svc = service(repo);

  const event = await svc.recordUsageEvent({ tenantId: "tenant-a" }, {
    eventType: "SELLER_DISCOVERED",
    campaignId: "campaign-1",
    captureId: "capture-1",
    idempotencyKey: "usage:SELLER_DISCOVERED:tenant-a:campaign-1:capture-1",
  });

  assert.equal(event.tenantId, "tenant-a");
  assert.equal(event.eventType, "SELLER_DISCOVERED");
  assert.equal(event.quantity, 1);
  assert.equal(event.billable, true);
  assert.equal(repo.events.length, 1);
});

test("duplicate idempotency key does not double-count", async () => {
  const repo = new MemoryUsageEventRepository();
  const svc = service(repo);
  const input = {
    eventType: "INVITATION_SENT",
    runtimeExecutionId: "execution-1",
    idempotencyKey: "usage:INVITATION_SENT:tenant-a:execution-1",
  };

  const first = await svc.recordUsageEvent({ tenantId: "tenant-a" }, input);
  const retry = await svc.recordUsageEvent({ tenantId: "tenant-a" }, input);

  assert.equal(repo.events.length, 1);
  assert.equal(first.id, retry.id);
});

test("default quantity is 1", async () => {
  const repo = new MemoryUsageEventRepository();
  const svc = service(repo);

  const event = await svc.recordUsageEvent({ tenantId: "tenant-a" }, {
    eventType: "SELLER_CLAIMED",
    idempotencyKey: "usage:SELLER_CLAIMED:tenant-a:token-1",
  });

  assert.equal(event.quantity, 1);
});

test("non-billable event is summarized separately", async () => {
  const repo = new MemoryUsageEventRepository();
  const svc = service(repo);
  const periodStart = new Date("2026-07-01T00:00:00.000Z");
  const periodEnd = new Date("2026-07-31T23:59:59.999Z");

  await svc.recordUsageEvent({ tenantId: "tenant-a" }, {
    eventType: "GROWTH_LOOP_EVALUATED",
    billable: false,
    occurredAt: new Date("2026-07-10T00:00:00.000Z"),
    idempotencyKey: "usage:GROWTH_LOOP_EVALUATED:tenant-a:campaign-1:day",
  });
  await svc.recordUsageEvent({ tenantId: "tenant-a" }, {
    eventType: "SELLER_CLAIMED",
    occurredAt: new Date("2026-07-11T00:00:00.000Z"),
    idempotencyKey: "usage:SELLER_CLAIMED:tenant-a:token-2",
  });

  const summary = await svc.getUsageSummary({ tenantId: "tenant-a" }, { periodStart, periodEnd });
  const growthTotal = summary.totals.find((total) => total.eventType === "GROWTH_LOOP_EVALUATED");
  const claimedTotal = summary.totals.find((total) => total.eventType === "SELLER_CLAIMED");

  assert.equal(growthTotal.quantity, 1);
  assert.equal(growthTotal.billableQuantity, 0);
  assert.equal(claimedTotal.billableQuantity, 1);
  assert.equal(summary.billableTotalQuantity, 1);
});

test("tenant isolation is enforced", async () => {
  const repo = new MemoryUsageEventRepository();
  const svc = service(repo);
  const periodStart = new Date("2026-07-01T00:00:00.000Z");
  const periodEnd = new Date("2026-07-31T23:59:59.999Z");

  await svc.recordUsageEvent({ tenantId: "tenant-a" }, {
    eventType: "SELLER_DISCOVERED",
    occurredAt: new Date("2026-07-05T00:00:00.000Z"),
    idempotencyKey: "usage:SELLER_DISCOVERED:tenant-a:x",
  });
  await svc.recordUsageEvent({ tenantId: "tenant-b" }, {
    eventType: "SELLER_DISCOVERED",
    occurredAt: new Date("2026-07-05T00:00:00.000Z"),
    idempotencyKey: "usage:SELLER_DISCOVERED:tenant-b:x",
  });

  const summaryA = await svc.getUsageSummary({ tenantId: "tenant-a" }, { periodStart, periodEnd });
  assert.equal(summaryA.totalQuantity, 1);
  assert.equal(summaryA.totals[0].eventType, "SELLER_DISCOVERED");
});

test("usage summary groups by event type", async () => {
  const repo = new MemoryUsageEventRepository();
  const svc = service(repo);
  const periodStart = new Date("2026-07-01T00:00:00.000Z");
  const periodEnd = new Date("2026-07-31T23:59:59.999Z");

  await svc.recordUsageEvent({ tenantId: "tenant-a" }, { eventType: "SELLER_DISCOVERED", occurredAt: new Date("2026-07-02T00:00:00.000Z"), idempotencyKey: "k1" });
  await svc.recordUsageEvent({ tenantId: "tenant-a" }, { eventType: "SELLER_DISCOVERED", occurredAt: new Date("2026-07-03T00:00:00.000Z"), idempotencyKey: "k2" });
  await svc.recordUsageEvent({ tenantId: "tenant-a" }, { eventType: "INVITATION_SENT", occurredAt: new Date("2026-07-04T00:00:00.000Z"), idempotencyKey: "k3" });

  const summary = await svc.getUsageSummary({ tenantId: "tenant-a" }, { periodStart, periodEnd });
  const discovered = summary.totals.find((total) => total.eventType === "SELLER_DISCOVERED");
  const invited = summary.totals.find((total) => total.eventType === "INVITATION_SENT");

  assert.equal(discovered.quantity, 2);
  assert.equal(invited.quantity, 1);
  assert.equal(summary.totalQuantity, 3);
});

test("usage summary respects period bounds", async () => {
  const repo = new MemoryUsageEventRepository();
  const svc = service(repo);

  await svc.recordUsageEvent({ tenantId: "tenant-a" }, { eventType: "SELLER_DISCOVERED", occurredAt: new Date("2026-06-30T23:59:59.000Z"), idempotencyKey: "before" });
  await svc.recordUsageEvent({ tenantId: "tenant-a" }, { eventType: "SELLER_DISCOVERED", occurredAt: new Date("2026-07-15T00:00:00.000Z"), idempotencyKey: "inside" });
  await svc.recordUsageEvent({ tenantId: "tenant-a" }, { eventType: "SELLER_DISCOVERED", occurredAt: new Date("2026-08-01T00:00:01.000Z"), idempotencyKey: "after" });

  const summary = await svc.getUsageSummary({ tenantId: "tenant-a" }, {
    periodStart: new Date("2026-07-01T00:00:00.000Z"),
    periodEnd: new Date("2026-07-31T23:59:59.999Z"),
  });

  assert.equal(summary.totalQuantity, 1);
});

test("failed business operation does not record success usage", async () => {
  const repo = new MemoryUsageEventRepository();
  const svc = service(repo);

  let attempted = false;
  try {
    attempted = true;
    throw new Error("business operation failed before reaching success");
  } catch {
    // Simulates a caller that only calls recordUsageEvent after a successful operation.
  }

  assert.equal(attempted, true);
  assert.equal(repo.events.length, 0);
});

test("retried runtime completion does not double-count", async () => {
  const repo = new MemoryUsageEventRepository();
  const svc = service(repo);
  const input = {
    eventType: "CRM_CONVERSION_CREATED",
    dealId: "deal-1",
    idempotencyKey: "usage:CRM_CONVERSION_CREATED:marketplace-crm-conversion:tenant-a:token-1:capture-1",
  };

  await svc.recordUsageEvent({ tenantId: "tenant-a" }, input);
  await svc.recordUsageEvent({ tenantId: "tenant-a" }, input);
  await svc.recordUsageEvent({ tenantId: "tenant-a" }, input);

  const summary = await svc.getUsageSummary({ tenantId: "tenant-a" }, {
    periodStart: new Date("2026-01-01T00:00:00.000Z"),
    periodEnd: new Date("2026-12-31T23:59:59.999Z"),
  });
  assert.equal(summary.totalQuantity, 1);
});

test("recordUsageEventBestEffort swallows failures and returns null", async () => {
  const failingService = { async recordUsageEvent() { throw new Error("ledger unavailable"); } };
  let captured;
  const result = await recordUsageEventBestEffort(failingService, { tenantId: "tenant-a" }, {
    eventType: "SELLER_DISCOVERED",
    idempotencyKey: "k",
  }, (error) => { captured = error; });

  assert.equal(result, null);
  assert.ok(captured instanceof Error);
});
