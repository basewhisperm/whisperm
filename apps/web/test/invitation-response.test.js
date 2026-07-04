import assert from "node:assert/strict";
import test from "node:test";

import {
  invitationResponseFromFetch,
  invitationResponseFromPayload,
} from "../src/lib/seller-acquisition/invitation-response.js";

test("invitationResponseFromPayload treats { ok: true, data: { invitation } } as success", () => {
  const result = invitationResponseFromPayload({ ok: true, data: { invitation: { id: "invite-1" } } });
  assert.equal(result.ok, true);
  assert.equal(result.errorMessage, undefined);
  assert.deepEqual(result.invitation, { invitation: { id: "invite-1" } });
});

test("invitationResponseFromPayload treats { ok: true, data: { executionId, status } } (real invite route shape) as success", () => {
  const result = invitationResponseFromPayload({ ok: true, data: { executionId: "execution-1", status: "ACCEPTED" } });
  assert.equal(result.ok, true);
  assert.equal(result.errorMessage, undefined);
});

test("invitationResponseFromPayload treats legacy { ok: true, invitation } as success", () => {
  const result = invitationResponseFromPayload({ ok: true, invitation: { id: "invite-legacy" } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.invitation, { id: "invite-legacy" });
});

test("invitationResponseFromPayload surfaces the backend error message on { ok: false, error: { message } }", () => {
  const result = invitationResponseFromPayload({ ok: false, error: { message: "No phone number" } });
  assert.equal(result.ok, false);
  assert.equal(result.errorMessage, "No phone number");
});

test("invitationResponseFromPayload surfaces a string error", () => {
  const result = invitationResponseFromPayload({ ok: false, error: "Capture is not assigned to a campaign." });
  assert.equal(result.ok, false);
  assert.equal(result.errorMessage, "Capture is not assigned to a campaign.");
});

test("invitationResponseFromPayload falls back to a generic message for malformed payload shapes", () => {
  assert.equal(invitationResponseFromPayload(null).ok, false);
  assert.equal(invitationResponseFromPayload("not an object").ok, false);
  assert.equal(invitationResponseFromPayload({}).ok, false);
});

test("invitationResponseFromFetch parses a real 202 Response with the invite route's success envelope", async () => {
  const response = new Response(JSON.stringify({ ok: true, data: { executionId: "execution-1", status: "ACCEPTED" } }), {
    status: 202,
    headers: { "content-type": "application/json" },
  });
  const result = await invitationResponseFromFetch(response);
  assert.equal(result.ok, true);
  assert.equal(result.errorMessage, undefined);
});

test("invitationResponseFromFetch parses a real 409 Response with a backend error message", async () => {
  const response = new Response(JSON.stringify({ ok: false, error: { message: "No phone number" } }), { status: 409 });
  const result = await invitationResponseFromFetch(response);
  assert.equal(result.ok, false);
  assert.equal(result.errorMessage, "No phone number");
});

test("invitationResponseFromFetch renders a safe failure for a 500 response with malformed JSON", async () => {
  const response = new Response("<html>Internal Server Error</html>", { status: 500 });
  const result = await invitationResponseFromFetch(response);
  assert.equal(result.ok, false);
  assert.match(result.errorMessage, /500/u);
});

test("invitationResponseFromFetch renders a safe failure for a non-JSON 200 response", async () => {
  const response = new Response("OK", { status: 200 });
  const result = await invitationResponseFromFetch(response);
  assert.equal(result.ok, false);
});

test("invitationResponseFromFetch does not treat a payload claiming success as success on a non-2xx status", async () => {
  const response = new Response(JSON.stringify({ ok: true, data: {} }), { status: 500 });
  const result = await invitationResponseFromFetch(response);
  assert.equal(result.ok, false);
});
