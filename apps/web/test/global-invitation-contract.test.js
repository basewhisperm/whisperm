import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

const eligibility = read("src/lib/marketplace-acquisition/invitation-eligibility.ts");
const singleInvite = read("src/app/api/marketplace-acquisition/captures/[id]/invite/route.ts");
const bulkInvite = read("src/app/api/marketplace-acquisition/captures/bulk-invite/route.ts");
const workbench = read("src/components/marketplace-acquisition/acquisition-workbench.tsx");

test("ST1-013I defines one typed invitation eligibility contract", () => {
  assert.match(eligibility, /export type InvitationEligibility/u);
  for (const code of [
    "CAPTURE_NOT_FOUND",
    "CAPTURE_NOT_QUALIFIED",
    "MISSING_CONTACT",
    "MISSING_CONTACT_CHANNEL",
    "MISSING_CAMPAIGN_CONTEXT",
    "ALREADY_INVITED",
    "ALREADY_CLAIMED",
    "PROVIDER_NOT_CONFIGURED",
  ]) {
    assert.match(eligibility, new RegExp(code, "u"));
  }
  assert.match(eligibility, /tenantId: input\.tenantId, id: input\.captureId/u);
  assert.match(eligibility, /Assign this seller to a campaign before sending an invitation\./u);
});

test("ST1-013I single invite uses shared eligibility and consistent envelopes", () => {
  assert.match(singleInvite, /resolveInvitationEligibility/u);
  assert.match(singleInvite, /invitationEligibilityHttpStatus/u);
  assert.match(singleInvite, /ok: false, error: \{ code: eligibility\.code, message: eligibility\.message \}/u);
  assert.match(singleInvite, /ok: true/u);
  assert.match(singleInvite, /status: execution\.status === "COMPLETED" \? "SENT" : "QUEUED"/u);
  assert.doesNotMatch(singleInvite, /Capture is not assigned to a campaign/u);
});

test("ST1-013I bulk invite represents every requested id and reports partial results", () => {
  assert.match(bulkInvite, /const requestedIds = parsed\.data\.captureIds/u);
  assert.match(bulkInvite, /for \(const captureId of requestedIds\)/u);
  assert.match(bulkInvite, /resolveInvitationEligibility/u);
  assert.match(bulkInvite, /results\.push\(\{ captureId, ok: false, code: eligibility\.code/u);
  assert.match(bulkInvite, /summary: summarize\(requestedIds\.length, results\), results/u);
  assert.doesNotMatch(bulkInvite, /No captures assigned to a campaign/u);
});

test("ST1-013I global workbench disables invite actions until campaign assignment", () => {
  assert.match(workbench, /const invitationActionsSupported = mode === "campaign"/u);
  assert.match(workbench, /Assign this seller to a campaign before sending an invitation\./u);
  assert.match(workbench, /bulkResultMessage/u);
  assert.match(workbench, /failedResults/u);
});
