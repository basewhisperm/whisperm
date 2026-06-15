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
