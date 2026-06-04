import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspace, generateWorkspaceSlug, currencyForCountry, computeOnboardingChecklist, DEFAULT_PIPELINE_STAGES } from "../dist/index.js";

const now = new Date("2026-01-01T00:00:00.000Z");

const makePort = (overrides = {}) => {
  const tenants = new Map(); const memberships = new Map(); const pipelines = new Map(); const subscriptions = new Map();
  return { tenants, memberships, pipelines, subscriptions, port: {
    async findTenantBySlug(slug) { return tenants.get(slug) ?? null; },
    async createTenant(input) { const t = { id: `tenant-${input.slug}`, slug: input.slug, name: input.name }; tenants.set(input.slug, t); return t; },
    async createOwnerMembership(input) { const k = `${input.tenantId}:${input.userId}`; if (!memberships.has(k)) memberships.set(k, { id: `u-${input.userId}`, tenantId: input.tenantId, role: "OWNER", email: input.email }); return memberships.get(k); },
    async findDefaultPipeline(tenantId) { return pipelines.get(tenantId) ?? null; },
    async createDefaultPipeline(input) { const p = { id: `p-${input.tenantId}`, tenantId: input.tenantId, name: input.name, isDefault: true, stageCount: DEFAULT_PIPELINE_STAGES.length }; pipelines.set(input.tenantId, p); return p; },
    async findTrialSubscription(tenantId) { return subscriptions.get(tenantId) ?? null; },
    ...overrides,
  }};
};

const makeTrialStore = () => { const created = []; return { created, store: { async createTrialSubscription(i) { created.push(i); return i; } } }; };
const makeScheduler = () => ({ scheduler: { async scheduleTrialReminder() {} } });
const base = { userId: "user-1", userEmail: "owner@acme.com", firmName: "Acme Corp", country: "US" };

test("1. Creates Tenant on workspace creation", async () => {
  const { port, tenants } = makePort(); const { store } = makeTrialStore(); const { scheduler } = makeScheduler();
  await createWorkspace(port, store, scheduler, base, () => now);
  assert.equal(tenants.size, 1); assert.ok(tenants.has("acme-corp"));
});

test("2. Creates OWNER membership", async () => {
  const { port, memberships } = makePort(); const { store } = makeTrialStore(); const { scheduler } = makeScheduler();
  await createWorkspace(port, store, scheduler, base, () => now);
  assert.equal(memberships.size, 1);
  assert.equal([...memberships.values()][0].role, "OWNER");
});

test("3. Creates default Pipeline", async () => {
  const { port, pipelines } = makePort(); const { store } = makeTrialStore(); const { scheduler } = makeScheduler();
  const result = await createWorkspace(port, store, scheduler, base, () => now);
  assert.equal(pipelines.size, 1); assert.equal(result.pipeline.stageCount, DEFAULT_PIPELINE_STAGES.length);
});

test("4. Creates trial Subscription with status=TRIALING", async () => {
  const { port } = makePort(); const { store, created } = makeTrialStore(); const { scheduler } = makeScheduler();
  await createWorkspace(port, store, scheduler, base, () => now);
  assert.equal(created.length, 1); assert.equal(created[0].status, "TRIALING");
});

test("5. country=GH without currency → GHS", async () => {
  const { port } = makePort(); const { store } = makeTrialStore(); const { scheduler } = makeScheduler();
  const result = await createWorkspace(port, store, scheduler, { ...base, country: "GH" }, () => now);
  assert.equal(result.currency, "GHS");
});

test("6. country=US without currency → USD", async () => {
  const { port } = makePort(); const { store } = makeTrialStore(); const { scheduler } = makeScheduler();
  const result = await createWorkspace(port, store, scheduler, { ...base, country: "US" }, () => now);
  assert.equal(result.currency, "USD");
});

test("7. Same slug returns existing workspace (isNew=false)", async () => {
  const { port } = makePort(); const { store } = makeTrialStore(); const { scheduler } = makeScheduler();
  const first = await createWorkspace(port, store, scheduler, base, () => now);
  const second = await createWorkspace(port, store, scheduler, base, () => now);
  assert.equal(first.workspaceId, second.workspaceId); assert.equal(second.isNew, false);
});

test("8. No duplicate Tenant", async () => {
  const { port, tenants } = makePort(); const { store } = makeTrialStore(); const { scheduler } = makeScheduler();
  await createWorkspace(port, store, scheduler, base, () => now);
  await createWorkspace(port, store, scheduler, base, () => now);
  assert.equal(tenants.size, 1);
});

test("9. No duplicate Pipeline", async () => {
  const { port, pipelines } = makePort(); const { store } = makeTrialStore(); const { scheduler } = makeScheduler();
  await createWorkspace(port, store, scheduler, base, () => now);
  await createWorkspace(port, store, scheduler, base, () => now);
  assert.equal(pipelines.size, 1);
});

test("10. No duplicate Subscription", async () => {
  const { port } = makePort(); const { store, created } = makeTrialStore(); const { scheduler } = makeScheduler();
  await createWorkspace(port, store, scheduler, base, () => now);
  await createWorkspace(port, store, scheduler, base, () => now);
  assert.equal(created.length, 1);
});

test("11. No duplicate Membership", async () => {
  const { port, memberships } = makePort(); const { store } = makeTrialStore(); const { scheduler } = makeScheduler();
  await createWorkspace(port, store, scheduler, base, () => now);
  await createWorkspace(port, store, scheduler, base, () => now);
  assert.equal(memberships.size, 1);
});

const makeOPort = ({ contacts = 0, stages = 0, members = 1, isMember = true } = {}) => ({
  async countContacts() { return contacts; },
  async findDefaultPipelineWithStages() { return stages > 0 ? { stageCount: stages } : null; },
  async countTeamMembers() { return members; },
  async isMember() { return isMember; },
});

test("12. Empty workspace shows all steps incomplete", async () => {
  const c = await computeOnboardingChecklist(makeOPort(), "ws-1", "u-1");
  assert.equal(c.steps.import_contacts.complete, false);
  assert.equal(c.steps.setup_pipeline.complete, false);
  assert.equal(c.steps.invite_team_member.complete, false);
  assert.equal(c.percentComplete, 0);
});

test("13. Contact creation completes import_contacts", async () => {
  const c = await computeOnboardingChecklist(makeOPort({ contacts: 1 }), "ws-1", "u-1");
  assert.equal(c.steps.import_contacts.complete, true);
});

test("14. Pipeline with stages completes setup_pipeline", async () => {
  const c = await computeOnboardingChecklist(makeOPort({ stages: 5 }), "ws-1", "u-1");
  assert.equal(c.steps.setup_pipeline.complete, true);
});

test("15. Inviting team member completes invite_team_member", async () => {
  const c = await computeOnboardingChecklist(makeOPort({ members: 2 }), "ws-1", "u-1");
  assert.equal(c.steps.invite_team_member.complete, true);
});

test("16. Percent complete calculated correctly", async () => {
  const two = await computeOnboardingChecklist(makeOPort({ contacts: 1, stages: 5 }), "ws-1", "u-1");
  assert.equal(two.percentComplete, 67);
  const full = await computeOnboardingChecklist(makeOPort({ contacts: 1, stages: 5, members: 2 }), "ws-1", "u-1");
  assert.equal(full.percentComplete, 100);
});

test("17. Non-member cannot access onboarding state", async () => {
  await assert.rejects(
    () => computeOnboardingChecklist(makeOPort({ isMember: false }), "ws-1", "stranger"),
    (err) => err.code === "ONBOARDING_ACCESS_DENIED"
  );
});

test("18. Workspace scoping enforced", async () => {
  const ids = [];
  const port = {
    async countContacts(id) { ids.push(id); return 0; },
    async findDefaultPipelineWithStages(id) { ids.push(id); return null; },
    async countTeamMembers(id) { ids.push(id); return 1; },
    async isMember(id) { ids.push(id); return true; },
  };
  await computeOnboardingChecklist(port, "ws-specific", "u-1");
  assert.ok(ids.every((id) => id === "ws-specific"));
});

test("generateWorkspaceSlug produces URL-safe slug", () => {
  assert.equal(generateWorkspaceSlug("TrustLayer Accounting"), "trustlayer-accounting");
  assert.equal(generateWorkspaceSlug("Render & Co."), "render-co");
});

test("currencyForCountry auto-detects correctly", () => {
  assert.equal(currencyForCountry("GH"), "GHS");
  assert.equal(currencyForCountry("US"), "USD");
  assert.equal(currencyForCountry("XX"), "USD");
});
