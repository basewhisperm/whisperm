import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workbench = readFileSync("src/components/marketplace-acquisition/acquisition-workbench.tsx", "utf8");
const sellerCard = readFileSync("src/components/marketplace-acquisition/seller-card.tsx", "utf8");
const sellerNextAction = readFileSync("src/components/marketplace-acquisition/seller-next-action.tsx", "utf8");
const domain = readFileSync("src/lib/marketplace-acquisition/workbench-domain.ts", "utf8");

test("ST1-013J workbench fetches provider health and gates invite actions on it", () => {
  assert.match(workbench, /provider-health\?channel=/u);
  assert.match(workbench, /isInvitationProviderReady/u);
  assert.match(workbench, /Invitation provider is not configured\./u);
});

test("ST1-013J bulk-eligible count excludes provider-unavailable sellers", () => {
  assert.match(workbench, /filteredRecords\.filter\(\(record\) => isEligibleForInvitation\(record\) && isInvitationProviderReady\(record, providerAvailability\)\)/u);
});

test("ST1-013J seller card can surface a provider-unavailable blocked reason distinct from disabled-with-no-explanation", () => {
  assert.match(sellerCard, /blockedReason/u);
  assert.match(sellerNextAction, /blockedReason/u);
  assert.match(sellerNextAction, /seller-primary-action-blocked-reason/u);
});

test("ST1-013J workbench-domain exposes provider-readiness as its own predicate, not folded into seller eligibility", () => {
  assert.match(domain, /export function isInvitationProviderReady/u);
  assert.match(domain, /export function hasEmail/u);
  assert.doesNotMatch(domain, /export function isActionEnabled\([^)]*\): boolean \{\s*return[^}]*Availability/u);
});
