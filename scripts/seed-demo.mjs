#!/usr/bin/env node
// WhispeRM Demo Seed -- ST1-013L canonical entry point (`pnpm seed:demo`).
//
// Thin CLI wrapper around the tested seeding logic in prisma/demo-seed.mjs
// (seedDemoWorkspace) -- this file exists so there is exactly one documented command to seed a
// demo workspace, regardless of where the underlying implementation lives. Idempotent: reruns
// upsert existing rows rather than duplicating them (see prisma/demo-seed.mjs and its test at
// prisma/demo-seed.test.mjs for the upsert-key proof).
import { seedDemoWorkspace } from "../prisma/demo-seed.mjs";

function resolveEmail() {
  return process.env.WHISPERM_DEMO_USER_EMAIL || process.env.DEMO_USER_EMAIL || null;
}

function resolveTenantSlug() {
  return process.env.WHISPERM_DEMO_TENANT_SLUG || process.env.DEMO_TENANT_SLUG || undefined;
}

const isDirectRun = import.meta.url === `file://${process.argv[1]}`;

if (isDirectRun) {
  const email = resolveEmail();
  if (!email) {
    console.error(
      "WHISPERM_DEMO_USER_EMAIL is required: set it to the email you sign in with (Clerk) so " +
      "you can see the seeded workspace, e.g.:\n" +
      "  WHISPERM_DEMO_USER_EMAIL=\"you@example.com\" pnpm seed:demo",
    );
    process.exit(1);
  }

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const result = await seedDemoWorkspace(prisma, { email, tenantSlug: resolveTenantSlug() });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`Demo seed failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}
