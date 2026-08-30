import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(`src/${path}`, "utf8");

const policy = read("lib/billing/plan-policy.ts");
const pricing = read("components/billing/pricing-cards.tsx");
const checkout = read("lib/billing/checkout.ts");
const upgradeRoute = read("app/api/billing/upgrade/route.ts");
const bulkInvite = read("app/api/marketplace-acquisition/captures/bulk-invite/route.ts");
const planUsage = read("lib/billing/plan-usage.ts");

test("one commercial policy owns displayed prices and enforced acquisition allowances", () => {
  assert.match(policy, /PLAN_POLICIES/u);
  assert.match(policy, /includedBillableActions/u);
  assert.match(policy, /priceUsd/u);
  assert.match(pricing, /PLAN_POLICY_LIST/u);
  assert.doesNotMatch(pricing, /includedBillableActions:\s*\d/u);
  assert.match(planUsage, /getPlanPolicy\(plan\)/u);
});

test("monthly and annual checkout use explicit billing intervals", () => {
  assert.match(pricing, /MONTHLY/u);
  assert.match(pricing, /ANNUAL/u);
  assert.match(checkout, /STRIPE_PRICE_STARTER_ANNUAL/u);
  assert.match(checkout, /billingInterval/u);
  assert.match(upgradeRoute, /INVALID_BILLING_INTERVAL/u);
});

test("bulk invitations fail before execution when the included allowance would be exceeded", () => {
  const usageIndex = bulkInvite.indexOf("getCurrentPlanUsage(tenant.id)");
  const executionIndex = bulkInvite.indexOf("runtime.executeInvitation");
  assert.ok(usageIndex > -1 && executionIndex > usageIndex);
  assert.match(bulkInvite, /PLAN_LIMIT_REACHED/u);
  assert.match(bulkInvite, /upgradeUrl: "\/billing"/u);
  assert.match(bulkInvite, /requestedIds\.length > usage\.remainingBillableActions/u);
});

test("usage enforcement is tenant scoped and reads only billable events in the current UTC month", () => {
  assert.match(planUsage, /tenantId,/u);
  assert.match(planUsage, /billable: true/u);
  assert.match(planUsage, /occurredAt: \{ gte: period\.start, lt: period\.end \}/u);
  assert.match(planUsage, /_sum: \{ quantity: true \}/u);
});

test("the individual invitation route remains outside the commercial bulk limit", () => {
  const individualInvite = read("app/api/marketplace-acquisition/captures/[id]/invite/route.ts");
  assert.doesNotMatch(individualInvite, /PLAN_LIMIT_REACHED|getCurrentPlanUsage/u);
});
