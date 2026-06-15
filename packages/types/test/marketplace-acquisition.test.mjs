import assert from "node:assert/strict";
import test from "node:test";

import {
  sellerInvitationChannelValues,
  sellerInvitationCreateRequestSchema,
  sellerInvitationResponseSchema,
} from "../dist/index.js";

test("seller invitation contracts preserve WhatsApp-first channel support with optional email", () => {
  assert.deepEqual(sellerInvitationChannelValues, ["WHATSAPP", "SMS", "EMAIL"]);

  assert.deepEqual(
    sellerInvitationCreateRequestSchema.parse({ preferredChannel: "WHATSAPP" }),
    { preferredChannel: "WHATSAPP" },
  );

  assert.deepEqual(
    sellerInvitationCreateRequestSchema.parse({ preferredChannel: "EMAIL" }),
    { preferredChannel: "EMAIL" },
  );

  assert.throws(() => sellerInvitationCreateRequestSchema.parse({ preferredChannel: "FAX" }));

  const response = sellerInvitationResponseSchema.parse({
    captureId: "capture-1",
    invitationId: "invite-1",
    channel: "WHATSAPP",
    status: "SENT",
    inviteUrl: "https://app.example/claim/raw-token",
    expiresAt: "2026-06-22T00:00:00.000Z",
  });

  assert.equal(response.channel, "WHATSAPP");
});

import {
  sellerAcquisitionWorkQueueItemSchema,
  sellerAcquisitionWorkQueueReasonValues,
} from "../dist/index.js";

test("seller acquisition work queue contract preserves operator follow-up reasons", () => {
  assert.deepEqual(sellerAcquisitionWorkQueueReasonValues, [
    "NEEDS_FOLLOW_UP",
    "FAILED_DELIVERY",
    "CLAIM_STARTED",
    "CLAIM_ABANDONED",
    "EXPIRING_SOON",
  ]);

  const item = sellerAcquisitionWorkQueueItemSchema.parse({
    tenantId: "tenant-1",
    captureId: "capture-1",
    reason: "EXPIRING_SOON",
    createdAt: "2026-06-15T00:00:00.000Z",
    dueAt: "2026-06-16T00:00:00.000Z",
  });

  assert.equal(item.priority, "NORMAL");
  assert.deepEqual(item.metadata, {});
});
