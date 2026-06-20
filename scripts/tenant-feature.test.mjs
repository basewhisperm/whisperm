import assert from "node:assert/strict";
import test from "node:test";

import { formatFeatureList, listTenantFeatures, parseTenantFeatureArgs, setTenantFeature } from "./tenant-feature.mjs";

const tenant = { id: "11111111-1111-4111-8111-111111111111", slug: "acme", name: "Acme Realty", externalId: "ext-acme" };

function createPrisma(seedFeatures = []) {
  const features = seedFeatures.map((feature) => ({ ...feature }));
  const calls = { upsert: 0 };
  return {
    calls,
    features,
    tenant: {
      async findMany(query) {
        const values = query.where.OR.map((clause) => Object.values(clause)[0]);
        const selector = values[0];
        if (values.includes(tenant.id) || values.includes(tenant.slug) || values.includes(tenant.name) || values.includes(tenant.externalId)) return [tenant];
        if (selector === "ambiguous") return [tenant, { id: "22222222-2222-2222-2222-222222222222", slug: "ambiguous", name: "Ambiguous" }];
        return [];
      },
    },
    tenantFeature: {
      async findMany(query) {
        return features.filter((feature) => feature.tenantId === query.where.tenantId).sort((a, b) => a.featureKey.localeCompare(b.featureKey));
      },
      async upsert(query) {
        calls.upsert += 1;
        const { tenantId, featureKey } = query.where.tenantId_featureKey;
        const existing = features.find((feature) => feature.tenantId === tenantId && feature.featureKey === featureKey);
        if (existing) {
          existing.enabled = query.update.enabled;
          return { featureKey: existing.featureKey, enabled: existing.enabled, updatedAt: existing.updatedAt ?? null };
        }
        const created = { id: `feature-${features.length + 1}`, ...query.create, updatedAt: null };
        features.push(created);
        return { featureKey: created.featureKey, enabled: created.enabled, updatedAt: null };
      },
    },
  };
}

test("parseTenantFeatureArgs validates supported commands and feature keys", () => {
  assert.deepEqual(parseTenantFeatureArgs(["enable", "--tenant", "acme", "--feature", "SELLER_ACQUISITION"]), {
    command: "enable",
    tenant: "acme",
    feature: "SELLER_ACQUISITION",
  });
  assert.throws(() => parseTenantFeatureArgs(["enable", "--tenant", "acme", "--feature", "UNKNOWN"]), /Unsupported feature/u);
  assert.throws(() => parseTenantFeatureArgs(["list"]), /Missing required --tenant/u);
});

test("enable creates SELLER_ACQUISITION and repeated enable does not duplicate records", async () => {
  const prisma = createPrisma();
  const first = await setTenantFeature(prisma, "acme", "SELLER_ACQUISITION", true);
  const second = await setTenantFeature(prisma, "acme", "SELLER_ACQUISITION", true);

  assert.equal(first.feature.enabled, true);
  assert.equal(second.feature.enabled, true);
  assert.equal(prisma.features.filter((feature) => feature.featureKey === "SELLER_ACQUISITION").length, 1);
  assert.equal(prisma.calls.upsert, 2);
});

test("disable sets SELLER_ACQUISITION disabled and repeated disable is safe", async () => {
  const prisma = createPrisma([{ id: "feature-1", tenantId: tenant.id, featureKey: "SELLER_ACQUISITION", enabled: true }]);
  const first = await setTenantFeature(prisma, tenant.id, "SELLER_ACQUISITION", false);
  const second = await setTenantFeature(prisma, tenant.id, "SELLER_ACQUISITION", false);

  assert.equal(first.feature.enabled, false);
  assert.equal(second.feature.enabled, false);
  assert.equal(prisma.features.filter((feature) => feature.featureKey === "SELLER_ACQUISITION").length, 1);
});

test("list prints tenant identity and explicit SELLER_ACQUISITION state", async () => {
  const prisma = createPrisma([{ id: "feature-1", tenantId: tenant.id, featureKey: "OTHER_FEATURE", enabled: true }]);
  const output = formatFeatureList(await listTenantFeatures(prisma, "Acme Realty"));

  assert.match(output, /Tenant: Acme Realty \(acme, 11111111-1111-4111-8111-111111111111\)/u);
  assert.match(output, /- OTHER_FEATURE: enabled/u);
  assert.match(output, /- SELLER_ACQUISITION: disabled/u);
});

test("tenant lookup fails clearly for no match or multiple matches", async () => {
  const prisma = createPrisma();
  await assert.rejects(() => listTenantFeatures(prisma, "missing"), /No tenant matched/u);
  await assert.rejects(() => listTenantFeatures(prisma, "ambiguous"), /Multiple tenants matched/u);
});
