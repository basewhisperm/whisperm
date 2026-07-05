import { writeFileSync } from "node:fs";
import path from "node:path";

import { assertAuthenticatedRunIsConfigured } from "./helpers/env";

// ST1-011: seeds the tenant/user/feature/subscription/pipeline/campaign the acquisition E2E
// suite drives against. Mirrors the existing per-test convention (skip when E2E_USER_EMAIL is
// unset, e.g. in CI today) so this never requires DATABASE_URL when the suite will skip anyway.
// Anchored on process.cwd() rather than __dirname/import.meta.url: apps/web declares
// "type": "module", and Playwright is always invoked with cwd=apps/web here (same assumption
// the existing `webServer: { command: 'pnpm dev' }` already makes).
export const SEED_CONTEXT_PATH = path.join(process.cwd(), "e2e", ".e2e-seed.json");

export default async function globalSetup(): Promise<void> {
  const email = process.env.E2E_USER_EMAIL;
  if (email === undefined || email.trim().length === 0) return;

  // An authenticated run was requested (E2E_USER_EMAIL is set) -- fail fast with an actionable
  // message if the rest of the required config isn't there, rather than a cryptic Prisma
  // connection error or a Clerk sign-in page that mysteriously never authenticates.
  assertAuthenticatedRunIsConfigured();

  const { PrismaClient } = await import("@prisma/client");
  const { seedAcquisitionE2E } = await import("./seed/seed-acquisition.mjs");

  const prisma = new PrismaClient();
  try {
    const result = await seedAcquisitionE2E(prisma, { email, tenantSlug: process.env.E2E_TENANT_SLUG });
    writeFileSync(SEED_CONTEXT_PATH, JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}
