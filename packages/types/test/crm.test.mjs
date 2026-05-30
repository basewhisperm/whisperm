import assert from "node:assert/strict";
import test from "node:test";
import {
  buildScoreRecomputationIdempotencyKey,
  contactSchema,
  createContactRequestSchema,
  leadEventSchema,
  scoreRecomputationJobPayloadSchema,
  scoreRecomputationQueueContract,
} from "../dist/index.js";

const now = "2026-05-30T00:00:00.000Z";
const correlation = { correlationId: "corr-1" };

test("CRM contact contracts require tenant scope and at least one non-null stable identifier", () => {
  const contact = contactSchema.parse({
    id: "contact-1",
    tenantId: "tenant-1",
    email: "person@example.com",
    leadScore: 0,
    trajectoryScore: 0,
    trustBand: "LOW",
    createdAt: now,
    updatedAt: now,
  });

  assert.equal(contact.tenantId, "tenant-1");
  assert.equal(createContactRequestSchema.parse({ tenantId: "tenant-1", externalId: "ext-1" }).externalId, "ext-1");
  assert.throws(() => createContactRequestSchema.parse({ tenantId: "tenant-1", email: null, phone: null, externalId: null }));
});

test("CRM lead events and score recomputation payloads are tenant-scoped", () => {
  assert.equal(leadEventSchema.parse({ id: "event-1", tenantId: "tenant-1", contactId: "contact-1", eventType: "FORM_SUBMIT", occurredAt: now, createdAt: now }).tenantId, "tenant-1");
  assert.equal(scoreRecomputationJobPayloadSchema.parse({ tenantId: "tenant-1", contactId: "contact-1", reason: "lead-event", requestedAt: now, correlation }).correlation.correlationId, "corr-1");
  assert.equal(scoreRecomputationQueueContract.queueName, "crm.scoring");
});

test("score recomputation idempotency is per tenant contact reason and request", () => {
  const first = buildScoreRecomputationIdempotencyKey({ tenantId: "tenant-1", contactId: "contact-1", reason: "lead-event", requestedAt: now, requestId: "req-1" });
  const next = buildScoreRecomputationIdempotencyKey({ tenantId: "tenant-1", contactId: "contact-1", reason: "lead-event", requestedAt: now, requestId: "req-2" });

  assert.equal(first, "crm.score.recompute:tenant-1:contact-1:lead-event:req-1");
  assert.notEqual(first, next);
});
