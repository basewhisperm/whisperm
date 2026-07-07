// Idempotent demo-data seed: a populated workspace to walk a stakeholder through without
// hitting empty dashboards. Reuses the same upsert conventions as founding-workspaces-seed.mjs
// and pipeline-seed.mjs rather than inventing a parallel seeding mechanism.
//
// The tenant owner is tied to a real login email (DEMO_USER_EMAIL) because
// apps/web/src/lib/get-tenant.ts resolves the signed-in Clerk user's workspace purely by
// matching their verified email against TenantUser.email -- there is no other path from
// "signed in" to "has a workspace" in the live app. Sign in with this same email (or a Clerk
// account you configure to use it) to see the seeded data.
//
// Deliberately stops at "Captured" for every marketplace-acquisition seller: fabricating
// "Invited"/"Claim Started"/"Claimed" state directly in a seed script is exactly the
// evidence-free status bypass that apps/web/src/app/api/marketplace-acquisition/deals/[dealId]/stage/route.ts
// was hardened against (a capture marked CLAIMED with no real SellerInvitation/attestation on
// record permanently blocks the real seller from ever attesting). Drive Invite -> Claim ->
// Convert live during the demo using the seeded captures below -- it's the strongest part of
// the product and doing it live proves it actually works.
import { seedPipelines, marketplaceAcquisitionPipelineDefaultKey } from "./pipeline-seed.mjs";

const DEFAULT_TENANT_SLUG = "demo";

const demoContacts = [
  { externalId: "demo-contact-1", firstName: "Ama", lastName: "Boateng", company: "Boateng Textiles", email: "ama@boatengtextiles.example", phone: "+233201234501", stage: "PROSPECT" },
  { externalId: "demo-contact-2", firstName: "Kwame", lastName: "Owusu", company: "Owusu Logistics", email: "kwame@owusulogistics.example", phone: "+233201234502", stage: "QUALIFIED" },
  { externalId: "demo-contact-3", firstName: "Efua", lastName: "Mensah", company: "Mensah & Co", email: "efua@mensahco.example", phone: "+233201234503", stage: "PROPOSAL" },
  { externalId: "demo-contact-4", firstName: "Kojo", lastName: "Asante", company: "Asante Retail Group", email: "kojo@asanteretail.example", phone: "+233201234504", stage: "ENGAGEMENT" },
  { externalId: "demo-contact-5", firstName: "Adjoa", lastName: "Darko", company: "Darko Consulting", email: "adjoa@darkoconsulting.example", phone: "+233201234505", stage: "RENEWAL" },
];

const demoDeals = [
  { externalId: "demo-deal-1", contactExternalId: "demo-contact-1", stageName: "Prospect", title: "Boateng Textiles — starter plan", value: "1200.00" },
  { externalId: "demo-deal-2", contactExternalId: "demo-contact-2", stageName: "Qualified", title: "Owusu Logistics — growth plan", value: "3600.00" },
  { externalId: "demo-deal-3", contactExternalId: "demo-contact-3", stageName: "Proposal", title: "Mensah & Co — pro plan", value: "7800.00" },
  { externalId: "demo-deal-4", contactExternalId: "demo-contact-4", stageName: "Engagement", title: "Asante Retail Group — pro plan", value: "9600.00", probability: 70 },
  { externalId: "demo-deal-5", contactExternalId: "demo-contact-5", stageName: "Renewal", title: "Darko Consulting — renewal", value: "4800.00", probability: 90 },
];

const demoSellers = [
  { externalId: "demo-seller-1", sellerName: "Yaw Antwi", sellerPhone: "+233209876501", title: "Solar lantern set, bulk lot of 12", price: "450.00", currency: "GHS", listingUrl: "https://www.jiji.com.gh/listing/demo-seller-1", category: "Home & Garden", location: "Kumasi" },
  { externalId: "demo-seller-2", sellerName: "Abena Frimpong", sellerPhone: "+233209876502", title: "Handmade leather sandals, assorted sizes", price: "180.00", currency: "GHS", listingUrl: "https://www.jiji.com.gh/listing/demo-seller-2", category: "Fashion", location: "Accra" },
  { externalId: "demo-seller-3", sellerName: "Nana Yeboah", sellerPhone: "+233209876503", title: "Refurbished laptops, mixed lot of 6", price: "3200.00", currency: "GHS", listingUrl: "https://www.jiji.com.gh/listing/demo-seller-3", category: "Electronics", location: "Tema" },
];

const ensureTenant = (prisma, slug, name) => prisma.tenant.upsert({
  where: { slug },
  create: { slug, name, externalId: `demo:${slug}` },
  update: { name },
});

const ensureOwnerUser = (prisma, tenant, email) => prisma.tenantUser.upsert({
  where: { tenantId_email: { tenantId: tenant.id, email: email.toLowerCase() } },
  create: { tenantId: tenant.id, email: email.toLowerCase(), displayName: "Demo Owner", role: "OWNER", isActive: true },
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
  if (existing !== null) return prisma.subscription.update({ where: { tenantId_id: { tenantId: tenant.id, id: existing.id } }, data });
  return prisma.subscription.create({ data: { tenantId: tenant.id, ...data } });
};

const stageByName = (pipeline, name) => {
  const stage = pipeline.stages.find((candidate) => candidate.name === name);
  if (stage === undefined) throw new Error(`Pipeline "${pipeline.name}" is missing stage "${name}"`);
  return stage;
};

const seedContactsAndDeals = async (prisma, tenant, defaultPipeline) => {
  const contactByExternalId = new Map();

  for (const contact of demoContacts) {
    const record = await prisma.contact.upsert({
      where: { tenantId_externalId: { tenantId: tenant.id, externalId: contact.externalId } },
      create: { tenantId: tenant.id, ...contact },
      update: { ...contact },
    });
    contactByExternalId.set(contact.externalId, record);
  }

  for (const deal of demoDeals) {
    const contact = contactByExternalId.get(deal.contactExternalId);
    const stage = stageByName(defaultPipeline, deal.stageName);
    await prisma.deal.upsert({
      where: { tenantId_externalId: { tenantId: tenant.id, externalId: deal.externalId } },
      create: {
        tenantId: tenant.id,
        externalId: deal.externalId,
        contactId: contact.id,
        pipelineId: defaultPipeline.id,
        pipelineStageId: stage.id,
        title: deal.title,
        value: deal.value,
        probability: deal.probability ?? null,
      },
      update: {
        pipelineStageId: stage.id,
        title: deal.title,
        value: deal.value,
        probability: deal.probability ?? null,
      },
    });
  }

  return contactByExternalId;
};

const seedMarketplaceSellers = async (prisma, tenant, acquisitionPipeline) => {
  const capturedStage = stageByName(acquisitionPipeline, "Captured");

  for (const seller of demoSellers) {
    const contact = await prisma.contact.upsert({
      where: { tenantId_externalId: { tenantId: tenant.id, externalId: seller.externalId } },
      create: {
        tenantId: tenant.id,
        externalId: seller.externalId,
        firstName: seller.sellerName.split(" ")[0],
        lastName: seller.sellerName.split(" ").slice(1).join(" ") || null,
        phone: seller.sellerPhone,
        stage: "PROSPECT",
        source: "MARKETPLACE_ACQUISITION",
      },
      update: { phone: seller.sellerPhone },
    });

    const deal = await prisma.deal.upsert({
      where: { tenantId_externalId: { tenantId: tenant.id, externalId: seller.externalId } },
      create: {
        tenantId: tenant.id,
        externalId: seller.externalId,
        contactId: contact.id,
        pipelineId: acquisitionPipeline.id,
        pipelineStageId: capturedStage.id,
        title: seller.title,
        value: seller.price,
        currency: seller.currency,
      },
      update: { pipelineStageId: capturedStage.id },
    });

    const capture = await prisma.marketplaceCapture.upsert({
      where: { tenantId_listingUrl: { tenantId: tenant.id, listingUrl: seller.listingUrl } },
      create: {
        tenantId: tenant.id,
        externalId: seller.externalId,
        contactId: contact.id,
        dealId: deal.id,
        listingUrl: seller.listingUrl,
        title: seller.title,
        price: seller.price,
        currency: seller.currency,
        sellerName: seller.sellerName,
        status: "CAPTURED",
        metadata: { seededBy: "demo-seed", location: seller.location },
      },
      update: { contactId: contact.id, dealId: deal.id, status: "CAPTURED" },
    });

    await prisma.draftInventory.upsert({
      where: { tenantId_marketplaceCaptureId: { tenantId: tenant.id, marketplaceCaptureId: capture.id } },
      create: {
        tenantId: tenant.id,
        marketplaceCaptureId: capture.id,
        contactId: contact.id,
        dealId: deal.id,
        title: seller.title,
        price: seller.price,
        currency: seller.currency,
        category: seller.category,
        listingUrl: seller.listingUrl,
        marketplaceSource: "jiji",
        status: "DRAFT",
      },
      update: {},
    });
  }
};

export const seedDemoWorkspace = async (prisma, options = {}) => {
  const email = options.email;
  if (!email) throw new Error("seedDemoWorkspace requires options.email (the Clerk login email that should see this workspace)");
  const tenantSlug = options.tenantSlug ?? DEFAULT_TENANT_SLUG;
  const tenantName = options.tenantName ?? "Demo Workspace";

  const tenant = await ensureTenant(prisma, tenantSlug, tenantName);
  await ensureOwnerUser(prisma, tenant, email);
  await ensureFeature(prisma, tenant);
  await ensureActiveSubscription(prisma, tenant);
  await seedPipelines(prisma, { workspaces: [tenant] });

  const [defaultPipeline, acquisitionPipeline] = await Promise.all([
    prisma.pipeline.findFirstOrThrow({ where: { tenantId: tenant.id, defaultKey: "default" }, include: { stages: true } }),
    prisma.pipeline.findFirstOrThrow({ where: { tenantId: tenant.id, defaultKey: marketplaceAcquisitionPipelineDefaultKey }, include: { stages: true } }),
  ]);

  await seedContactsAndDeals(prisma, tenant, defaultPipeline);
  await seedMarketplaceSellers(prisma, tenant, acquisitionPipeline);

  return {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    ownerEmail: email.toLowerCase(),
    contacts: demoContacts.length,
    deals: demoDeals.length,
    marketplaceSellers: demoSellers.length,
  };
};

const isDirectRun = import.meta.url === `file://${process.argv[1]}`;

if (isDirectRun) {
  const email = process.env.DEMO_USER_EMAIL;
  if (!email) {
    console.error("DEMO_USER_EMAIL is required: set it to the email you sign in with (Clerk) so you can see the seeded workspace.");
    process.exit(1);
  }

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const result = await seedDemoWorkspace(prisma, { email, tenantSlug: process.env.DEMO_TENANT_SLUG });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}
