import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTrialReminderJobs,
  executeTrialReminderJob,
  scheduleTrialReminderJobs
} from "../dist/index.js";

test("buildTrialReminderJobs creates D-3, D-1, and D+0 jobs", () => {
  const jobs = buildTrialReminderJobs({
    tenantId: "tenant-1",
    workspaceName: "Acme",
    ownerEmail: "owner@example.com",
    trialEndsAt: "2026-06-30T00:00:00.000Z"
  });

  assert.equal(jobs.length, 3);
  assert.deepEqual(jobs.map((job) => job.payload.marker), ["D-3", "D-1", "D+0"]);
  assert.equal(jobs[0].runAt, "2026-06-27T00:00:00.000Z");
  assert.equal(jobs[1].runAt, "2026-06-29T00:00:00.000Z");
  assert.equal(jobs[2].runAt, "2026-06-30T00:00:00.000Z");
});

test("scheduleTrialReminderJobs skips tenants without owner email or trial end", async () => {
  const calls = [];
  const count = await scheduleTrialReminderJobs({
    scheduleTrialReminder: (input) => calls.push(input)
  }, {
    tenantId: "tenant-1",
    workspaceName: "Acme"
  });

  assert.equal(count, 0);
  assert.equal(calls.length, 0);
});

test("executeTrialReminderJob calls NotificationService", async () => {
  const calls = [];
  await executeTrialReminderJob({
    sendTrialExpiryEmail: async (input) => calls.push(input)
  }, {
    tenantId: "tenant-1",
    workspaceId: "tenant-1",
    workspaceName: "Acme",
    recipientEmail: "owner@example.com",
    recipientName: "Owner",
    trialEndsAt: "2026-06-30T00:00:00.000Z",
    marker: "D-1"
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].workspace.workspaceName, "Acme");
  assert.equal(calls[0].recipient.email, "owner@example.com");
  assert.equal(calls[0].marker, "D-1");
});
