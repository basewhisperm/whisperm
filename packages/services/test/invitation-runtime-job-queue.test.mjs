import assert from "node:assert/strict";
import test from "node:test";

import { createInvitationRuntimeJobQueue, createManualRetryInvitationRuntimeJobQueue } from "@whisperm/services";

const tenant = { tenantId: "tenant-1" };

const createFakeQueueJobs = () => {
  const enqueued = [];
  return {
    enqueued,
    async enqueue(context, input) {
      const row = { id: `job-${enqueued.length + 1}`, ...input };
      enqueued.push(row);
      return row;
    },
  };
};

test("createInvitationRuntimeJobQueue: initial dispatch and a scheduled retry get distinct jobKeys", async () => {
  // Regression: reusing the same jobKey for the initial dispatch and its own retry made
  // PrismaQueueJobRepository.enqueue() return the still-ACTIVE original row instead of creating
  // a new one, so the retry was silently dropped.
  const queueJobs = createFakeQueueJobs();
  const queue = createInvitationRuntimeJobQueue(queueJobs);

  await queue.enqueueInvitation({ tenantId: "tenant-1", campaignId: "campaign-1", opportunityId: "capture-1", executionId: "execution-1", replaySafe: true });
  await queue.enqueueInvitation({ tenantId: "tenant-1", campaignId: "campaign-1", opportunityId: "capture-1", executionId: "execution-1", attempt: 1, replaySafe: true });

  assert.equal(queueJobs.enqueued.length, 2);
  assert.notEqual(queueJobs.enqueued[0].jobKey, queueJobs.enqueued[1].jobKey);
  assert.equal(queueJobs.enqueued[0].jobKey, "campaign-runtime:tenant-1:execution-1");
  assert.equal(queueJobs.enqueued[1].jobKey, "campaign-runtime:tenant-1:execution-1:retry:1");
});

test("createInvitationRuntimeJobQueue: two different retry attempts also get distinct jobKeys", async () => {
  const queueJobs = createFakeQueueJobs();
  const queue = createInvitationRuntimeJobQueue(queueJobs);

  await queue.enqueueInvitation({ tenantId: "tenant-1", campaignId: "campaign-1", opportunityId: "capture-1", executionId: "execution-1", attempt: 1, replaySafe: true });
  await queue.enqueueInvitation({ tenantId: "tenant-1", campaignId: "campaign-1", opportunityId: "capture-1", executionId: "execution-1", attempt: 2, replaySafe: true });

  assert.notEqual(queueJobs.enqueued[0].jobKey, queueJobs.enqueued[1].jobKey);
});

test("createInvitationRuntimeJobQueue: delayMs is translated into a future availableAt, not just embedded in the payload", async () => {
  // Regression: the backoff delay computed by recordInvitationResult (5m/30m/2h) must actually
  // delay when the job becomes claimable -- previously it was only carried in the JSON payload
  // and QueueJob.availableAt (which claimNext actually consults) was left at the default now().
  const queueJobs = createFakeQueueJobs();
  const queue = createInvitationRuntimeJobQueue(queueJobs);
  const before = Date.now();

  await queue.enqueueInvitation({ tenantId: "tenant-1", campaignId: "campaign-1", opportunityId: "capture-1", executionId: "execution-1", attempt: 1, delayMs: 5 * 60_000, replaySafe: true });

  const row = queueJobs.enqueued[0];
  assert.ok(row.availableAt !== undefined);
  const availableAtMs = new Date(row.availableAt).getTime();
  assert.ok(availableAtMs >= before + 5 * 60_000 - 1000, "availableAt must reflect the backoff delay, not be immediately claimable");
});

test("createInvitationRuntimeJobQueue: no delayMs means immediately available", async () => {
  const queueJobs = createFakeQueueJobs();
  const queue = createInvitationRuntimeJobQueue(queueJobs);
  const before = Date.now();

  await queue.enqueueInvitation({ tenantId: "tenant-1", campaignId: "campaign-1", opportunityId: "capture-1", executionId: "execution-1", replaySafe: true });

  const availableAtMs = new Date(queueJobs.enqueued[0].availableAt).getTime();
  assert.ok(availableAtMs <= Date.now() && availableAtMs >= before - 1000);
});

test("createManualRetryInvitationRuntimeJobQueue: every call gets a fresh jobKey", async () => {
  const queueJobs = createFakeQueueJobs();
  const queue = createManualRetryInvitationRuntimeJobQueue(queueJobs);

  await queue.enqueueInvitation({ tenantId: "tenant-1", campaignId: "campaign-1", opportunityId: "capture-1", executionId: "execution-1", replaySafe: true });
  await new Promise((resolve) => { setTimeout(resolve, 2); }); // ensure Date.now() advances between calls
  await queue.enqueueInvitation({ tenantId: "tenant-1", campaignId: "campaign-1", opportunityId: "capture-1", executionId: "execution-1", replaySafe: true });

  assert.notEqual(queueJobs.enqueued[0].jobKey, queueJobs.enqueued[1].jobKey);
});
