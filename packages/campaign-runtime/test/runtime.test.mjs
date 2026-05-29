import assert from "node:assert/strict";
import test from "node:test";
import {
  CampaignRuntimeError,
  assertCampaignTenantIsolation,
  buildCampaignIdempotencyKey,
  calculateCampaignRetryDelayMs,
  campaignApprovalIntegrationContractSchema,
  campaignAudienceContractSchema,
  campaignBudgetContractSchema,
  campaignContentContractSchema,
  campaignExecutionContractSchema,
  campaignJourneyContractSchema,
  campaignQuotaContractSchema,
  campaignRetryPolicySchema,
  campaignSegmentContractSchema,
  campaignSequenceContractSchema,
  campaignTargetingContractSchema,
  canTransitionCampaignLifecycleState,
  createCampaignExecutionContract,
  dispatchCampaignExecution,
  isTerminalCampaignLifecycleState,
  parseCampaignContract,
  transitionCampaignLifecycleState
} from "../dist/index.js";

const now = new Date("2026-01-01T00:00:00.000Z");
const correlation = { correlationId: "corr-1", requestId: "req-1" };

const lifecycle = {
  tenantId: "tenant-1",
  campaignId: "campaign-1",
  state: "APPROVED",
  version: 1,
  updatedAt: now.toISOString(),
  updatedBy: "user-1",
  correlation
};

const targeting = {
  tenantId: "tenant-1",
  audienceIds: ["audience-1"],
  segmentIds: [],
  exclusions: { audienceIds: [], segmentIds: [], recipientIds: [] }
};

const sequence = {
  tenantId: "tenant-1",
  sequenceId: "sequence-1",
  entryStepId: "step-1",
  steps: [
    {
      tenantId: "tenant-1",
      stepId: "step-1",
      name: "Send welcome",
      kind: "SEND",
      channelId: "channel-1",
      contentId: "content-1",
      nextStepIds: ["step-2"]
    },
    {
      tenantId: "tenant-1",
      stepId: "step-2",
      name: "Wait one day",
      kind: "WAIT",
      waitDuration: "P1D",
      nextStepIds: []
    }
  ]
};

test("campaign audience, segment, targeting, content, and journey contracts validate tenant-safe primitives", () => {
  const audience = campaignAudienceContractSchema.parse({
    tenantId: "tenant-1",
    id: "audience-1",
    audienceId: "audience-1",
    source: "SEGMENT",
    estimatedSize: 25,
    consentRequired: true
  });
  assert.equal(audience.tenantId, "tenant-1");

  const segment = campaignSegmentContractSchema.parse({
    tenantId: "tenant-1",
    id: "segment-1",
    segmentId: "segment-1",
    rules: [{ field: "profile.country", operator: "EQ", value: "US" }],
    version: 1
  });
  assert.equal(segment.combinator, "ALL");

  assert.throws(() => campaignTargetingContractSchema.parse({ tenantId: "tenant-1" }), /targeting requires/u);

  const content = campaignContentContractSchema.parse({
    tenantId: "tenant-1",
    contentId: "content-1",
    version: 1,
    blocks: [{ blockId: "subject", kind: "SUBJECT", content: "Hello {{first_name}}" }],
    personalization: {
      tenantId: "tenant-1",
      mode: "TEMPLATE_VARIABLES",
      variables: { first_name: { source: "PROFILE", required: false } }
    }
  });
  assert.equal(content.personalization.deterministic, true);

  assert.throws(() => campaignContentContractSchema.parse({
    ...content,
    personalization: { ...content.personalization, tenantId: "tenant-2" }
  }), /personalization tenantId/u);

  const journey = campaignJourneyContractSchema.parse({
    tenantId: "tenant-1",
    journeyId: "journey-1",
    sequences: [sequence],
    triggers: [{ tenantId: "tenant-1", triggerId: "trigger-1", kind: "SCHEDULED", scheduleId: "schedule-1" }],
    version: 1
  });
  assert.equal(journey.sequences[0].steps.length, 2);
});

test("campaign lifecycle state machine enforces deterministic transitions", () => {
  assert.equal(canTransitionCampaignLifecycleState("DRAFT", "VALIDATING"), true);
  assert.equal(canTransitionCampaignLifecycleState("ARCHIVED", "RUNNING"), false);
  assert.equal(isTerminalCampaignLifecycleState("ARCHIVED"), true);

  const snapshot = {
    tenantId: "tenant-1",
    campaignId: "campaign-1",
    state: "DRAFT",
    version: 0,
    updatedAt: now.toISOString(),
    correlation
  };

  const validating = transitionCampaignLifecycleState({ snapshot, to: "VALIDATING", now, actorId: "user-1", reason: "preflight" });
  assert.equal(validating.state, "VALIDATING");
  assert.equal(validating.version, 1);

  assert.throws(() => transitionCampaignLifecycleState({ snapshot: validating, to: "RUNNING", now }), CampaignRuntimeError);
});

test("sequence, trigger, retry, quota, budget, approval, and validation helpers fail closed", () => {
  assert.equal(campaignSequenceContractSchema.parse(sequence).entryStepId, "step-1");
  assert.throws(() => campaignSequenceContractSchema.parse({ ...sequence, entryStepId: "missing" }), /entryStepId/u);

  const retry = campaignRetryPolicySchema.parse({
    retryPolicyId: "retry-1",
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
    retryableErrorCodes: ["TRANSIENT"]
  });
  assert.equal(calculateCampaignRetryDelayMs(retry, 3), 4000);

  assert.throws(() => campaignQuotaContractSchema.parse({ tenantId: "tenant-1", quotaId: "quota-1", scope: "CAMPAIGN", limit: 1, used: 2 }), /used quota/u);
  assert.throws(() => campaignBudgetContractSchema.parse({ tenantId: "tenant-1", budgetId: "budget-1", currency: "USD", limitMinor: 100, reservedMinor: 75, spentMinor: 50 }), /reserved plus spent/u);
  assert.throws(() => campaignApprovalIntegrationContractSchema.parse({ tenantId: "tenant-1", campaignId: "campaign-1", required: true, state: "NOT_REQUIRED", correlation }), /required approvals/u);

  assert.doesNotThrow(() => assertCampaignTenantIsolation({ expectedTenantId: "tenant-1", contracts: [{ tenantId: "tenant-1", correlation }] }));
  assert.throws(() => assertCampaignTenantIsolation({ expectedTenantId: "tenant-1", contracts: [{ tenantId: "tenant-2", correlation }] }), CampaignRuntimeError);

  assert.throws(() => parseCampaignContract(campaignTargetingContractSchema, { tenantId: "tenant-1" }, correlation), CampaignRuntimeError);
});

test("campaign execution contracts compose replay-safe execution and tenant isolation", () => {
  const execution = createCampaignExecutionContract({
    tenantId: "tenant-1",
    campaignId: "campaign-1",
    executionId: "execution-1",
    lifecycle,
    targeting: campaignTargetingContractSchema.parse(targeting),
    sequence: campaignSequenceContractSchema.parse(sequence),
    channels: [{ tenantId: "tenant-1", channelId: "channel-1", kind: "EMAIL", capabilities: ["SEND"] }],
    content: [{ tenantId: "tenant-1", contentId: "content-1", version: 1, blocks: [{ blockId: "body", kind: "BODY", content: "Welcome" }] }],
    approval: { tenantId: "tenant-1", campaignId: "campaign-1", approvalId: "approval-1", required: true, state: "APPROVED", correlation },
    billing: { tenantId: "tenant-1", campaignId: "campaign-1", accountId: "account-1", estimatedCostMinor: 10, currency: "USD", correlation },
    schedule: { tenantId: "tenant-1", campaignId: "campaign-1", scheduleId: "schedule-1", scheduleKind: "ONE_TIME", runAt: now.toISOString(), correlation },
    quota: { tenantId: "tenant-1", quotaId: "quota-1", scope: "CAMPAIGN", limit: 100, used: 1 },
    budget: { tenantId: "tenant-1", budgetId: "budget-1", currency: "USD", limitMinor: 1000, reservedMinor: 100, spentMinor: 200 },
    correlation,
    now
  });

  assert.equal(execution.replay.idempotencyKey, buildCampaignIdempotencyKey({ tenantId: "tenant-1", campaignId: "campaign-1", executionId: "execution-1" }));
  assert.equal(execution.replay.deterministic, true);
  assert.throws(() => campaignExecutionContractSchema.parse({ ...execution, lifecycle: { ...execution.lifecycle, tenantId: "tenant-2" } }), /nested execution contracts/u);
});

test("campaign dispatch integrates idempotency, scheduling, approval, billing, telemetry, observability, and enqueue ports", async () => {
  const execution = createCampaignExecutionContract({
    tenantId: "tenant-1",
    campaignId: "campaign-1",
    executionId: "execution-1",
    lifecycle,
    targeting: campaignTargetingContractSchema.parse(targeting),
    schedule: { tenantId: "tenant-1", campaignId: "campaign-1", scheduleId: "schedule-1", scheduleKind: "ONE_TIME", runAt: now.toISOString(), correlation },
    approval: { tenantId: "tenant-1", campaignId: "campaign-1", approvalId: "approval-1", required: true, state: "APPROVED", correlation },
    billing: { tenantId: "tenant-1", campaignId: "campaign-1", accountId: "account-1", estimatedCostMinor: 10, currency: "USD", correlation },
    correlation,
    now
  });
  const calls = [];

  const result = await dispatchCampaignExecution(execution, {
    idempotency: {
      claim: (contract) => {
        calls.push(`claim:${contract.idempotencyKey}`);
        return "CLAIMED";
      },
      complete: (contract) => calls.push(`complete:${contract.executionId}`)
    },
    scheduler: { scheduleCampaign: (contract) => calls.push(`schedule:${contract.scheduleId}`) },
    approval: { requestApproval: (contract) => calls.push(`approval:${contract.approvalId}`) },
    billing: { reserveCampaignBudget: (contract) => calls.push(`billing:${contract.accountId}`) },
    telemetry: { emit: (contract) => calls.push(`telemetry:${contract.eventName}`) },
    observability: { audit: (contract) => calls.push(`audit:${contract.auditId}`) },
    enqueue: { enqueueExecution: (contract) => calls.push(`enqueue:${contract.executionId}`) }
  });

  assert.equal(result, "DISPATCHED");
  assert.deepEqual(calls, [
    "claim:tenant-1:campaign-1:execution-1",
    "schedule:schedule-1",
    "approval:approval-1",
    "billing:account-1",
    "telemetry:campaign.execution.dispatched",
    "audit:tenant-1:campaign-1:execution-1:audit",
    "enqueue:execution-1",
    "complete:execution-1"
  ]);

  assert.equal(await dispatchCampaignExecution({ ...execution, approval: { ...execution.approval, state: "REQUESTED" } }, {}), "BLOCKED_APPROVAL");
});
