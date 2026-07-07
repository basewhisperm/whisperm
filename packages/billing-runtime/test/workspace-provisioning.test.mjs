import assert from "node:assert/strict";
import test from "node:test";

import { createWorkspace, generateWorkspaceSlug, currencyForCountry, DEFAULT_PIPELINE_STAGES } from "../dist/index.js";

const makePort = (overrides = {}) => {
  const tenants = new Map();
  const memberships = new Map();
  const pipelines = new Map();
  return {
    tenants, memberships, pipelines,
    port: {
      async findTenantBySlug(slug) { return tenants.get(slug) ?? null; },
      async createTenant(input) {
        const t = { id: `tenant-${input.slug}`, slug: input.slug, name: input.name };
        tenants.set(input.slug, t);
        return t;
      },
      async createOwnerMembership(input) {
        const record = { id: `u-${input.userId}`, tenantId: input.tenantId, role: "OWNER", email: input.email };
        memberships.set(`${input.tenantId}:${input.userId}`, record);
        return record;
      },
      async createDefaultPipeline(input) {
        const p = { id: `p-${input.tenantId}`, tenantId: input.tenantId, name: input.name, isDefault: true, stageCount: DEFAULT_PIPELINE_STAGES.length };
        pipelines.set(input.tenantId, p);
        return p;
      },
      ...overrides,
    },
  };
};

const base = { userId: "user-1", userEmail: "owner@acme.com", firmName: "Acme Corp", country: "US" };

test("creates a tenant, OWNER membership, and default pipeline", async () => {
  const { port, tenants, memberships, pipelines } = makePort();
  const result = await createWorkspace(port, base);

  assert.equal(tenants.size, 1);
  assert.ok(tenants.has("acme-corp"));
  assert.equal(memberships.size, 1);
  assert.equal([...memberships.values()][0].role, "OWNER");
  assert.equal(pipelines.size, 1);
  assert.equal(result.pipeline.stageCount, DEFAULT_PIPELINE_STAGES.length);
});

test("country=GH without an explicit currency resolves to GHS", async () => {
  const { port } = makePort();
  const result = await createWorkspace(port, { ...base, country: "GH" });
  assert.equal(result.currency, "GHS");
});

test("country=US without an explicit currency resolves to USD", async () => {
  const { port } = makePort();
  const result = await createWorkspace(port, { ...base, country: "US" });
  assert.equal(result.currency, "USD");
});

test("SECURITY: a second signup whose firm name normalizes to the same slug never joins the first caller's tenant", async () => {
  const { port, tenants } = makePort();
  const first = await createWorkspace(port, base);
  // A different person, unrelated firm-name text that happens to normalize to the same slug.
  const second = await createWorkspace(port, { ...base, userId: "user-2", userEmail: "attacker@evil.com", firmName: "ACME CORP!!" });

  assert.notEqual(first.workspaceId, second.workspaceId, "must never be the same tenant");
  assert.equal(tenants.size, 2, "must create a genuinely separate tenant, not merge into the existing one");
  assert.notEqual(second.slug, first.slug, "the colliding slug must be disambiguated, not reused");
});

test("SECURITY: the second caller is never granted membership on the first caller's tenant", async () => {
  const { port, memberships } = makePort();
  const first = await createWorkspace(port, base);
  await createWorkspace(port, { ...base, userId: "user-2", userEmail: "attacker@evil.com", firmName: "ACME CORP!!" });

  assert.equal(memberships.has(`${first.workspaceId}:user-2`), false);
});

test("throws rather than silently reusing a tenant when no unique slug can be found", async () => {
  const { port } = makePort({ async findTenantBySlug() { return { id: "someone-elses-tenant", slug: "acme-corp", name: "Someone Else" }; } });
  await assert.rejects(() => createWorkspace(port, base));
});

test("generateWorkspaceSlug produces a URL-safe slug", () => {
  assert.equal(generateWorkspaceSlug("TrustLayer Accounting"), "trustlayer-accounting");
  assert.equal(generateWorkspaceSlug("Render & Co."), "render-co");
});

test("currencyForCountry auto-detects correctly", () => {
  assert.equal(currencyForCountry("GH"), "GHS");
  assert.equal(currencyForCountry("US"), "USD");
  assert.equal(currencyForCountry("ZZ"), "USD");
});
