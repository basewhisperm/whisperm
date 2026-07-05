#!/usr/bin/env node
// ST1-011: deterministic, idempotent seed for the E2E acquisition regression suite. Reuses the
// same upsert conventions as prisma/founding-workspaces-seed.mjs (tenant/user/feature/subscription)
// and prisma/pipeline-seed.mjs (marketplace_acquisition pipeline + stages) rather than inventing a
// parallel seeding mechanism. The tenant/user/feature/subscription/pipeline are upserted so reruns
// are safe; the campaign is created fresh each run (unique name) so parallel/repeated CI runs never
// collide on the [tenantId, campaignId, marketplaceCaptureId] membership constraint.
import { seedMarketplaceAcquisitionPipeline } from "../../../../prisma/pipeline-seed.mjs";

export const DEFAULT_E2E_TENANT_SLUG = "e2e-acquisition";

const ensureTenant = (prisma, slug) => prisma.tenant.upsert({
  where: { slug },
  create: { slug, name: "E2E Acquisition Regression" },
  update: {},
});

const ensureTenantUser = (prisma, tenant, email) => prisma.tenantUser.upsert({
  where: { tenantId_email: { tenantId: tenant.id, email: email.toLowerCase() } },
  create: { tenantId: tenant.id, email: email.toLowerCase(), displayName: "E2E Acquisition User", role: "OWNER", isActive: true },
  update: { isActive: true },
});

const ensureFeature = (prisma, tenant) => prisma.tenantFeature.upsert({
  where: { tenantId_featureKey: { tenantId: tenant.id, featureKey: "SELLER_ACQUISITION" } },
  create: { tenantId: tenant.id, featureKey: "SELLER_ACQUISITION", enabled: true },
  update: { enabled: true },
});

const ensureActiveSubscription = async (prisma, tenant) => {
  const existing = await prisma.subscription.findFirst({ where: { tenantId: tenant.id }, orderBy: { createdAt: "asc" } });
  const data = { plan: "GROWTH", status: "ACTIVE", currency: "USD" };
  if (existing !== null) {
    return prisma.subscription.update({ where: { tenantId_id: { tenantId: tenant.id, id: existing.id } }, data });
  }
  return prisma.subscription.create({ data: { tenantId: tenant.id, ...data } });
};

const createCampaign = (prisma, tenant, runId) => prisma.sellerAcquisitionCampaign.create({
  data: {
    tenantId: tenant.id,
    name: `E2E Acquisition Regression ${runId}`,
    description: "Created by ST1-011 end-to-end acquisition regression suite. Safe to delete.",
    status: "ACTIVE",
    metadata: { seededBy: "e2e-acquisition-suite", runId },
  },
});

export async function seedAcquisitionE2E(prisma, options) {
  const email = options.email;
  if (!email) throw new Error("seedAcquisitionE2E requires options.email");
  const tenantSlug = options.tenantSlug ?? DEFAULT_E2E_TENANT_SLUG;
  const runId = options.runId ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const tenant = await ensureTenant(prisma, tenantSlug);
  await ensureTenantUser(prisma, tenant, email);
  await ensureFeature(prisma, tenant);
  await ensureActiveSubscription(prisma, tenant);
  await seedMarketplaceAcquisitionPipeline(prisma, { workspaces: [tenant] });
  const campaign = await createCampaign(prisma, tenant, runId);

  return {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    campaignId: campaign.id,
    campaignName: campaign.name,
    runId,
  };
}

const isDirectRun = import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  const email = process.env.E2E_USER_EMAIL;
  if (!email) throw new Error("E2E_USER_EMAIL is required to seed the acquisition E2E fixtures.");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required to seed the acquisition E2E fixtures (point it at a disposable/test Postgres database).");

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const result = await seedAcquisitionE2E(prisma, { email, tenantSlug: process.env.E2E_TENANT_SLUG });
    console.log(JSON.stringify(result));
  } finally {
    await prisma.$disconnect();
  }
}
