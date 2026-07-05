import { writeFileSync } from "node:fs";
import path from "node:path";
import type { FullConfig } from "@playwright/test";

import { assertAuthenticatedRunIsConfigured } from "./helpers/env";

// ST1-011: seeds the tenant/user/feature/subscription/pipeline/campaign the acquisition E2E
// suite drives against. Mirrors the existing per-test convention (skip when E2E_USER_EMAIL is
// unset, e.g. in CI today) so this never requires DATABASE_URL when the suite will skip anyway.
//
// Anchored on `config.rootDir` (the directory of playwright.config.ts, per Playwright's
// documented FullConfig contract) rather than `process.cwd()`: cwd is wherever the `playwright
// test` command happened to be invoked from -- repo root, apps/web, a CI runner, an IDE test
// runner -- and is NOT guaranteed to be apps/web. A prior version of this file assumed
// `process.cwd() === apps/web` and silently wrote the seed file to the wrong path (or failed
// outright) whenever that assumption didn't hold, which is why acquisition specs were skipping
// with seed === null even though E2E_USER_EMAIL was set. Reproduced directly: running this
// function's logic with cwd=<repo root> instead of apps/web threw
// `ENOENT: no such file or directory, open '<repo root>/e2e/.e2e-seed.json'`.
export const seedContextPath = (rootDir: string): string => path.join(rootDir, "e2e", ".e2e-seed.json");

export default async function globalSetup(config: FullConfig): Promise<void> {
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
    writeFileSync(seedContextPath(config.rootDir), JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}
