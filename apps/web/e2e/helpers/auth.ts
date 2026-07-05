import type { Page } from "@playwright/test";

import { readPersonaCredentials, type E2ECredentials } from "./env";

export type { E2ECredentials } from "./env";

// ST1-011: mirrors the existing pattern in e2e/pipeline.spec.ts, e2e/contacts.spec.ts, and
// e2e/reports.spec.ts (test.skip() when unset) rather than inventing an auth bypass -- Clerk
// has no test-mode shortcut in this app, so a real seeded Clerk user is required either way.
// All credentials are read from process.env only -- see helpers/env.ts.
export function e2eCredentials(): E2ECredentials | null {
  return readPersonaCredentials("user");
}

// Reserved for future admin/demo-persona coverage; read from process.env only, never required
// by the current specs (which only need the "user" persona), so their absence never breaks the
// suite. Exposed here so any future spec sources them the same validated way.
export const e2eAdminCredentials = (): E2ECredentials | null => readPersonaCredentials("admin");
export const e2eDemoCredentials = (): E2ECredentials | null => readPersonaCredentials("demo");

export async function signIn(page: Page, credentials: E2ECredentials): Promise<void> {
  await page.goto("/sign-in");
  await page.fill('input[name="identifier"]', credentials.email);
  await page.click('button[type="submit"]');
  await page.fill('input[name="password"]', credentials.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard|marketplace-acquisition/);
}
