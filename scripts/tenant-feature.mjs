#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";

export const SUPPORTED_FEATURES = new Set(["SELLER_ACQUISITION"]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

class TenantFeatureCommandError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "TenantFeatureCommandError";
    this.exitCode = exitCode;
  }
}

export function parseTenantFeatureArgs(argv) {
  const [command, ...rest] = argv;
  if (!["enable", "disable", "list"].includes(command ?? "")) {
    throw new TenantFeatureCommandError("Usage: pnpm tenant-feature <enable|disable|list> --tenant <tenant-id-or-slug-or-name> [--feature SELLER_ACQUISITION]");
  }

  const options = { command, tenant: undefined, feature: command === "list" ? undefined : "SELLER_ACQUISITION" };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    const value = rest[index + 1];
    if (token === "--tenant") {
      if (!value || value.startsWith("--")) throw new TenantFeatureCommandError("Missing value for --tenant.");
      options.tenant = value;
      index += 1;
      continue;
    }
    if (token === "--feature") {
      if (!value || value.startsWith("--")) throw new TenantFeatureCommandError("Missing value for --feature.");
      options.feature = value;
      index += 1;
      continue;
    }
    throw new TenantFeatureCommandError(`Unknown argument: ${token}`);
  }

  if (!options.tenant) throw new TenantFeatureCommandError("Missing required --tenant <tenant-id-or-slug-or-name>.");
  if (options.command !== "list" && !SUPPORTED_FEATURES.has(options.feature)) {
    throw new TenantFeatureCommandError(`Unsupported feature: ${options.feature}. Supported features: ${Array.from(SUPPORTED_FEATURES).join(", ")}.`);
  }
  return options;
}

export async function resolveTenant(prisma, tenantSelector) {
  const selectors = [
    ...(UUID_PATTERN.test(tenantSelector) ? [{ id: tenantSelector }] : []),
    { slug: tenantSelector },
    { name: tenantSelector },
    { externalId: tenantSelector },
  ];

  const tenants = await prisma.tenant.findMany({
    where: { OR: selectors },
    orderBy: { createdAt: "asc" },
    select: { id: true, slug: true, name: true, externalId: true },
  });

  if (tenants.length === 0) throw new TenantFeatureCommandError(`No tenant matched '${tenantSelector}'.`);
  if (tenants.length > 1) {
    const matches = tenants.map((tenant) => `${tenant.name} (${tenant.slug}, ${tenant.id})`).join("; ");
    throw new TenantFeatureCommandError(`Multiple tenants matched '${tenantSelector}'. Refine --tenant to an exact id or slug. Matches: ${matches}`);
  }
  return tenants[0];
}

export async function listTenantFeatures(prisma, tenantSelector) {
  const tenant = await resolveTenant(prisma, tenantSelector);
  const features = await prisma.tenantFeature.findMany({
    where: { tenantId: tenant.id },
    orderBy: { featureKey: "asc" },
    select: { featureKey: true, enabled: true, updatedAt: true },
  });
  const hasSellerAcquisition = features.some((feature) => feature.featureKey === "SELLER_ACQUISITION");
  const rows = hasSellerAcquisition ? features : [...features, { featureKey: "SELLER_ACQUISITION", enabled: false, updatedAt: null }];
  return { tenant, features: rows };
}

export async function setTenantFeature(prisma, tenantSelector, featureKey, enabled) {
  if (!SUPPORTED_FEATURES.has(featureKey)) {
    throw new TenantFeatureCommandError(`Unsupported feature: ${featureKey}. Supported features: ${Array.from(SUPPORTED_FEATURES).join(", ")}.`);
  }
  const tenant = await resolveTenant(prisma, tenantSelector);
  const feature = await prisma.tenantFeature.upsert({
    where: { tenantId_featureKey: { tenantId: tenant.id, featureKey } },
    create: { tenantId: tenant.id, featureKey, enabled },
    update: { enabled },
    select: { featureKey: true, enabled: true, updatedAt: true },
  });
  return { tenant, feature };
}

export function formatFeatureList(result) {
  const lines = [
    `Tenant: ${result.tenant.name} (${result.tenant.slug}, ${result.tenant.id})`,
    "Features:",
  ];
  for (const feature of result.features) {
    lines.push(`- ${feature.featureKey}: ${feature.enabled ? "enabled" : "disabled"}`);
  }
  return lines.join("\n");
}

export function formatFeatureWrite(result) {
  return `Tenant: ${result.tenant.name} (${result.tenant.slug}, ${result.tenant.id})\n${result.feature.featureKey}: ${result.feature.enabled ? "enabled" : "disabled"}`;
}

async function main() {
  const options = parseTenantFeatureArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    if (options.command === "list") {
      console.log(formatFeatureList(await listTenantFeatures(prisma, options.tenant)));
      return;
    }
    const enabled = options.command === "enable";
    console.log(formatFeatureWrite(await setTenantFeature(prisma, options.tenant, options.feature, enabled)));
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(error.exitCode ?? 1);
  });
}
