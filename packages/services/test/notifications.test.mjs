import assert from "node:assert/strict";
import test from "node:test";

import {
  NotificationService,
  monthlyPipelineDigestEmail,
  teamInviteEmail,
  trialExpiryEmail,
  weeklyIdleContactDigestEmail,
  welcomeEmail,
} from "../dist/index.js";

const workspace = {
  tenantId: "tenant-1",
  workspaceId: "workspace-1",
  workspaceName: "Acme Workspace",
};

const recipient = {
  email: "owner@example.com",
  name: "Owner",
};

test("notification templates render expected subjects", () => {
  assert.equal(welcomeEmail({ workspaceName: "Acme" }).subject, "Welcome to Acme");

  assert.equal(
    trialExpiryEmail({
      workspaceName: "Acme",
      trialEndsAt: "2026-06-30T00:00:00.000Z",
      marker: "D-3",
    }).subject,
    "Your Acme trial ends soon",
  );

  assert.equal(
    trialExpiryEmail({
      workspaceName: "Acme",
      trialEndsAt: "2026-06-30T00:00:00.000Z",
      marker: "D+0",
    }).subject,
    "Your Acme trial expires today",
  );

  assert.equal(
    teamInviteEmail({
      workspaceName: "Acme",
      inviterName: "William",
      inviteUrl: "https://example.com/invite",
      expiresAt: "2026-06-05T00:00:00.000Z",
    }).subject,
    "William invited you to Acme",
  );

  assert.equal(
    monthlyPipelineDigestEmail({
      workspaceName: "Acme",
      pipelineCount: 2,
      activeCampaignCount: 1,
    }).subject,
    "Acme monthly pipeline digest",
  );

  assert.equal(
    weeklyIdleContactDigestEmail({
      workspaceName: "Acme",
      idleContactCount: 7,
      idleDays: 7,
    }).subject,
    "Acme weekly follow-up digest",
  );
});

test("notification service sends welcome, trial, and invite emails", async () => {
  const sent = [];
  const service = new NotificationService({
    async send(message) {
      sent.push(message);
    },
  });

  await service.sendWelcomeEmail({ workspace, recipient });
  await service.sendTrialExpiryEmail({
    workspace,
    recipient,
    trialEndsAt: "2026-06-30T00:00:00.000Z",
    marker: "D-3",
  });
  await service.sendTrialExpiryEmail({
    workspace,
    recipient,
    trialEndsAt: "2026-06-30T00:00:00.000Z",
    marker: "D-1",
  });
  await service.sendTrialExpiryEmail({
    workspace,
    recipient,
    trialEndsAt: "2026-06-30T00:00:00.000Z",
    marker: "D+0",
  });
  await service.sendTeamInviteEmail({
    workspace,
    recipient,
    inviterName: "William",
    inviteUrl: "https://example.com/invite",
    expiresAt: "2026-06-05T00:00:00.000Z",
  });

  assert.equal(sent.length, 5);
  assert.equal(sent[0].to, "owner@example.com");
  assert.equal(sent[1].subject, "Your Acme Workspace trial ends soon");
  assert.equal(sent[2].subject, "Your Acme Workspace trial ends soon");
  assert.equal(sent[3].subject, "Your Acme Workspace trial expires today");
  assert.equal(sent[4].subject, "William invited you to Acme Workspace");
});

test("workspace alert digest toggle suppresses digest emails when off", async () => {
  const sent = [];
  const service = new NotificationService({
    async send(message) {
      sent.push(message);
    },
  });

  const monthly = await service.sendMonthlyPipelineDigest({
    workspace: { ...workspace, alertDigestEnabled: false },
    recipient,
    pipelineCount: 3,
    activeCampaignCount: 2,
  });

  const weekly = await service.sendWeeklyIdleContactDigest({
    workspace: { ...workspace, alertDigestEnabled: false },
    recipient,
    idleContactCount: 5,
    idleDays: 7,
  });

  assert.equal(monthly, "suppressed");
  assert.equal(weekly, "suppressed");
  assert.equal(sent.length, 0);
});

test("digest emails send when workspace toggle is enabled or unset", async () => {
  const sent = [];
  const service = new NotificationService({
    async send(message) {
      sent.push(message);
    },
  });

  assert.equal(
    await service.sendMonthlyPipelineDigest({
      workspace,
      recipient,
      pipelineCount: 3,
      activeCampaignCount: 2,
    }),
    "sent",
  );

  assert.equal(
    await service.sendWeeklyIdleContactDigest({
      workspace: { ...workspace, alertDigestEnabled: true },
      recipient,
      idleContactCount: 5,
      idleDays: 7,
    }),
    "sent",
  );

  assert.equal(sent.length, 2);
});
