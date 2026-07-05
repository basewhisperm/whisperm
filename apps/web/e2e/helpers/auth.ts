import type { Page } from "@playwright/test";

export interface E2ECredentials {
  readonly email: string;
  readonly password: string;
}

// ST1-011: mirrors the existing pattern in e2e/pipeline.spec.ts, e2e/contacts.spec.ts, and
// e2e/reports.spec.ts (test.skip() when unset) rather than inventing an auth bypass -- Clerk
// has no test-mode shortcut in this app, so a real seeded Clerk user is required either way.
export function e2eCredentials(): E2ECredentials | null {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;
  if (!email || !password) return null;
  return { email, password };
}

export async function signIn(page: Page, credentials: E2ECredentials): Promise<void> {
  await page.goto("/sign-in");
  await page.fill('input[name="identifier"]', credentials.email);
  await page.click('button[type="submit"]');
  await page.fill('input[name="password"]', credentials.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard|marketplace-acquisition/);
}
