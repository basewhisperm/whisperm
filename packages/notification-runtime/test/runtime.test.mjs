import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTrialReminderJobs,
  executeTrialReminderJob,
  scheduleTrialReminderJobs,
  trialReminderJobPayloadSchema,
} from "../dist/index.js";

const payload = {
  tenantId: "tenant-1",
  workspaceId: "workspace-1",
  workspaceName: "Acme Workspace",
  ownerEmail: "owner@example.com",
  ownerName: "Owner",
  trialEndsAt: "2026-06-30T00:00:00.000Z",
};

test("buildTrialReminderJobs creates D-3, D-1, and D+0 jobs", () => {
  const jobs = buildTrialReminderJobs(payload);

  assert.equal(jobs.length, 3);
  assert.deepEqual(jobs.map((job) => job.payload.marker), ["D-3", "D-1", "D+0"]);
  assert.deepEqual(jobs.map((job) => job.runAt), [
    "2026-06-27T00:00:00.000Z",
    "2026-06-29T00:00:00.000Z",
    "2026-06-30T00:00:00.000Z",
  ]);
});

test("buildTrialReminderJobs returns no jobs without owner email or trial end", () => {
  assert.equal(buildTrialReminderJobs({ tenantId: "tenant-1", trialEndsAt: payload.trialEndsAt }).length, 0);
  assert.equal(buildTrialReminderJobs({ tenantId: "tenant-1", ownerEmail: payload.ownerEmail }).length, 0);
});

test("scheduleTrialReminderJobs schedules all trial reminder jobs", async () => {
  const scheduled = [];

  const count = await scheduleTrialReminderJobs({
    async scheduleTrialReminder(job) {
      scheduled.push(job);
    },
  }, payload);

  assert.equal(count, 3);
  assert.equal(scheduled.length, 3);
  assert.equal(scheduled[0].jobType, "notification.trial_reminder");
  assert.equal(scheduled[2].payload.marker, "D+0");
});

test("executeTrialReminderJob delegates to notification service", async () => {
  const sent = [];

  await executeTrialReminderJob({
    async sendTrialExpiryEmail(input) {
      sent.push(input);
    },
  }, trialReminderJobPayloadSchema.parse({
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    workspaceName: "Acme Workspace",
    recipientEmail: "owner@example.com",
    recipientName: "Owner",
    trialEndsAt: "2026-06-30T00:00:00.000Z",
    marker: "D-1",
  }));

  assert.equal(sent.length, 1);
  assert.equal(sent[0].workspace.tenantId, "tenant-1");
  assert.equal(sent[0].recipient.email, "owner@example.com");
  assert.equal(sent[0].marker, "D-1");
});
