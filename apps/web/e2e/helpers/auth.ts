import type { Locator, Page } from "@playwright/test";

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

// ST1-011: Clerk's rendered <SignIn/> DOM (input names/autocomplete attributes) has been
// observed to differ across Clerk SDK versions/configurations -- `input[name="identifier"]`
// timed out in one real deployment even though the form was genuinely present. These are
// listed most-to-least specific; the comma-joined CSS selector matches whichever is actually
// rendered, so this stays correct without knowing which Clerk build produced the DOM.
const EMAIL_INPUT_SELECTORS = [
  'input[name="identifier"]',
  'input[name="emailAddress"]',
  'input[type="email"]',
  'input[autocomplete="username"]',
  'input[autocomplete="email"]',
] as const;

const PASSWORD_INPUT_SELECTORS = [
  'input[name="password"]',
  'input[type="password"]',
  'input[autocomplete="current-password"]',
] as const;

const AUTHENTICATED_URL = /dashboard|marketplace-acquisition/;

async function locateVisible(page: Page, selectors: readonly string[], description: string, timeout = 15_000): Promise<Locator> {
  const locator = page.locator(selectors.join(", ")).first();
  try {
    await locator.waitFor({ state: "visible", timeout });
  } catch {
    throw new Error(
      `signIn(): could not find a ${description} on ${page.url()}. Tried selectors: ${selectors.join(", ")}. ` +
      "The rendered Clerk sign-in form doesn't match any of them -- inspect the actual DOM " +
      "(e.g. npx playwright test --debug, or a trace/screenshot) and add the real selector to " +
      "helpers/auth.ts's EMAIL_INPUT_SELECTORS/PASSWORD_INPUT_SELECTORS.",
    );
  }
  return locator;
}

async function clickContinueOrSubmit(page: Page): Promise<void> {
  const byRole = page.getByRole("button", { name: /continue|sign in|submit/i });
  const byType = page.locator('button[type="submit"]');
  const button = byRole.or(byType).first();
  try {
    await button.waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    throw new Error(
      `signIn(): could not find a Continue/Submit button on ${page.url()}. ` +
      'Tried role=button name=/continue|sign in|submit/i and button[type="submit"].',
    );
  }
  await button.click();
}

/**
 * Waits for whichever comes first after the identifier step: a password field (the standard
 * two-step Clerk email+password flow), or navigation away from /sign-in (some Clerk
 * configurations complete in one step). Returns null in the latter case so the caller skips
 * the password step instead of hanging on a field that will never appear.
 */
async function passwordStepOrAlreadySignedIn(page: Page): Promise<Locator | null> {
  const passwordLocator = page.locator(PASSWORD_INPUT_SELECTORS.join(", ")).first();
  const outcome = await Promise.race([
    passwordLocator.waitFor({ state: "visible", timeout: 15_000 }).then(() => "password" as const),
    page.waitForURL(AUTHENTICATED_URL, { timeout: 15_000 }).then(() => "done" as const),
  ]).catch(() => "timeout" as const);

  if (outcome === "password") return passwordLocator;
  if (outcome === "done") return null;
  throw new Error(
    `signIn(): after submitting the email/identifier step, neither a password field ` +
    `(tried: ${PASSWORD_INPUT_SELECTORS.join(", ")}) nor a redirect to ${AUTHENTICATED_URL} ` +
    `appeared within 15s. Current URL: ${page.url()}.`,
  );
}

export async function signIn(page: Page, credentials: E2ECredentials): Promise<void> {
  await page.goto("/sign-in");

  const emailInput = await locateVisible(page, EMAIL_INPUT_SELECTORS, "email/identifier input");
  await emailInput.fill(credentials.email);
  await clickContinueOrSubmit(page);

  const passwordInput = await passwordStepOrAlreadySignedIn(page);
  if (passwordInput !== null) {
    await passwordInput.fill(credentials.password);
    await clickContinueOrSubmit(page);
  }

  await page.waitForURL(AUTHENTICATED_URL);
}
