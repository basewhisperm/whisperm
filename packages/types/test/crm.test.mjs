import assert from "node:assert/strict";
import test from "node:test";

import {
  buildScoreRecomputationIdempotencyKey,
  contactStageSchema,
  createContactRequestSchema,
  scoreRecomputationJobPayloadSchema,
  scoreRecomputationQueueContract,
  trustBandSchema,
} from "../dist/index.js";

const now = "2026-05-29T00:00:00.000Z";
const correlation = { correlationId: "corr-1" };

test("contact create contract requires tenant and a stable identifier", () => {
  const contact = createContactRequestSchema.parse({ tenantId: "tenant-a", email: "lead@example.com" });
  assert.equal(contact.email, "lead@example.com");
  assert.equal(contact.stage, "PROSPECT");
  assert.equal(contactStageSchema.parse("QUALIFIED"), "QUALIFIED");
  assert.throws(() => createContactRequestSchema.parse({ tenantId: "tenant-a", firstName: "Lead" }));
});

test("score recomputation job contract is worker-compatible and tenant-scoped", () => {
  const payload = scoreRecomputationJobPayloadSchema.parse({ tenantId: "tenant-a", contactId: "contact-1", requestedAt: now, correlation });

  assert.equal(payload.reason, "manual");
  assert.equal(scoreRecomputationQueueContract.queueName, "crm.scoring");
  assert.equal(scoreRecomputationQueueContract.jobType, "crm.score.recompute");
  assert.equal(buildScoreRecomputationIdempotencyKey(payload), "crm.score.recompute:tenant-a:contact-1");
});

test("trust band contract accepts only supported bands", () => {
  assert.equal(trustBandSchema.parse("HIGH"), "HIGH");
  assert.throws(() => trustBandSchema.parse("UNKNOWN"));
});
