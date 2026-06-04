import { defaultPipelineName, defaultPipelineStages } from "./pipeline-seed.mjs";

export class SeedConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "SeedConfigurationError";
  }
}

export const countryCurrencyByCountry = Object.freeze({
  GH: "GHS",
  US: "USD",
});

export const foundingWorkspaces = Object.freeze([
  Object.freeze({ name: "Render", slug: "render", country: "GH", plan: "GROWTH", ownerEmailEnv: "FOUNDING_RENDER_OWNER_EMAIL" }),
  Object.freeze({ name: "Skillpost", slug: "skillpost", country: "GH", plan: "STARTER", ownerEmailEnv: "FOUNDING_SKILLPOST_OWNER_EMAIL" }),
  Object.freeze({ name: "TrustLayer", slug: "trustlayer", country: "GH", plan: "GROWTH", ownerEmailEnv: "FOUNDING_TRUSTLAYER_OWNER_EMAIL" }),
  Object.freeze({ name: "US Firm", slug: "us-firm", country: "US", plan: "PRO", status: "TRIALING", ownerEmailEnv: "FOUNDING_US_FIRM_OWNER_EMAIL" }),
]);

const defaultOwnerEmail = (workspace) => `owner+${workspace.slug}@whisperm.example`;

export const currencyForCountry = (country) => {
  const currency = countryCurrencyByCountry[country];
  if (currency === undefined) {
    throw new SeedConfigurationError(`Unsupported founding workspace country: ${country}`);
  }
  return currency;
};

const subscriptionStatusForWorkspace = (workspace) => workspace.status ?? "ACTIVE";

const trialEndsAtForWorkspace = (workspace, now) => (
  subscriptionStatusForWorkspace(workspace) === "TRIALING"
    ? new Date(now().getTime() + 14 * 24 * 60 * 60 * 1000)
    : null
);

const ownerEmailForWorkspace = (workspace, env) => {
  const value = env[workspace.ownerEmailEnv];
  return value === undefined || value.trim().length === 0 ? defaultOwnerEmail(workspace) : value.trim().toLowerCase();
};

const createLogger = (logger) => {
  if (logger === false) return { log() {} };
  return logger ?? console;
};

export const ensureTenant = async (prisma, workspace) => prisma.tenant.upsert({
  where: { slug: workspace.slug },
  create: {
    slug: workspace.slug,
    name: workspace.name,
    externalId: `founding:${workspace.slug}`,
  },
  update: {
    name: workspace.name,
  },
});

export const ensureOwnerUser = async (prisma, tenant, workspace, options = {}) => prisma.tenantUser.upsert({
  where: {
    tenantId_email: {
      tenantId: tenant.id,
      email: ownerEmailForWorkspace(workspace, options.env ?? process.env),
    },
  },
  create: {
    tenantId: tenant.id,
    email: ownerEmailForWorkspace(workspace, options.env ?? process.env),
    displayName: `${workspace.name} Owner`,
    role: "OWNER",
    isActive: true,
  },
  update: {
    displayName: `${workspace.name} Owner`,
    role: "OWNER",
    isActive: true,
  },
});

export const ensurePipeline = async (prisma, tenant, options = {}) => prisma.pipeline.upsert({
  where: { tenantId_defaultKey: { tenantId: tenant.id, defaultKey: "default" } },
  create: {
    tenantId: tenant.id,
    name: options.pipelineName ?? defaultPipelineName,
    isDefault: true,
    defaultKey: "default",
  },
  update: {
    name: options.pipelineName ?? defaultPipelineName,
    isDefault: true,
    defaultKey: "default",
  },
});

export const ensurePipelineStages = async (prisma, tenant, pipeline) => {
  const stages = [];
  for (const stage of defaultPipelineStages) {
    const ensured = await prisma.pipelineStage.upsert({
      where: {
        tenantId_pipelineId_name: {
          tenantId: tenant.id,
          pipelineId: pipeline.id,
          name: stage.name,
        },
      },
      create: {
        tenantId: tenant.id,
        pipelineId: pipeline.id,
        name: stage.name,
        position: stage.position,
        color: stage.color,
      },
      update: {
        position: stage.position,
        color: stage.color,
      },
    });
    stages.push(ensured);
  }
  return stages;
};

export const ensureSubscription = async (prisma, tenant, workspace, options = {}) => {
  const now = options.now ?? (() => new Date());
  const currency = currencyForCountry(workspace.country);
  const status = subscriptionStatusForWorkspace(workspace);
  const trialEndsAt = trialEndsAtForWorkspace(workspace, now);
  const metadata = {
    country: workspace.country,
    seededBy: "founding-workspaces",
    workspaceSlug: workspace.slug,
  };
  const existing = await prisma.subscription.findFirst({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: "asc" },
  });

  const data = {
    plan: workspace.plan,
    status,
    currency,
    trialEndsAt,
    metadata,
  };

  if (existing !== null) {
    return prisma.subscription.update({
      where: { tenantId_id: { tenantId: tenant.id, id: existing.id } },
      data,
    });
  }

  return prisma.subscription.create({
    data: {
      tenantId: tenant.id,
      ...data,
    },
  });
};

const seedWorkspace = async (prisma, workspace, options) => {
  const logger = createLogger(options.logger);
  const tenant = await ensureTenant(prisma, workspace);
  logger.log(`[seed] Tenant ensured: ${workspace.name}`);

  const owner = await ensureOwnerUser(prisma, tenant, workspace, options);
  logger.log(`[seed] Owner ensured: ${workspace.name}`);

  const pipeline = await ensurePipeline(prisma, tenant, options);
  await ensurePipelineStages(prisma, tenant, pipeline);
  logger.log(`[seed] Pipeline ensured: ${workspace.name}`);

  const subscription = await ensureSubscription(prisma, tenant, workspace, options);
  logger.log(`[seed] Subscription ensured: ${workspace.name}`);

  return { tenant, owner, pipeline, subscription };
};

export const seedFoundingWorkspaces = async (prisma, options = {}) => {
  const workspaces = options.workspaces ?? foundingWorkspaces;
  const results = [];

  for (const workspace of workspaces) {
    const work = async (client) => seedWorkspace(client, workspace, options);
    const result = prisma.$transaction === undefined
      ? await work(prisma)
      : await prisma.$transaction(work, { maxWait: 5_000, timeout: 30_000 });
    results.push(result);
  }

  return {
    workspaces: results.length,
    tenants: results.length,
    owners: results.length,
    pipelines: results.length,
    stages: results.length * defaultPipelineStages.length,
    subscriptions: results.length,
  };
};

const isDirectRun = import.meta.url === `file://${process.argv[1]}`;

if (isDirectRun) {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const result = await seedFoundingWorkspaces(prisma);
    console.log(JSON.stringify(result));
  } finally {
    await prisma.$disconnect();
  }
}
