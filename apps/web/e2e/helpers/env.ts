// ST1-011: single source of truth for which environment variables the E2E suite reads.
// Every value here comes from process.env only -- nothing is hardcoded, and no secret value
// is ever included in an error message or logged (only variable names are).
export type E2EPersona = "admin" | "user" | "demo";

export interface E2ECredentials {
  readonly email: string;
  readonly password: string;
}

const personaEnvNames: Record<E2EPersona, { readonly email: string; readonly password: string }> = {
  admin: { email: "E2E_ADMIN_EMAIL", password: "E2E_ADMIN_PASSWORD" },
  user: { email: "E2E_USER_EMAIL", password: "E2E_USER_PASSWORD" },
  demo: { email: "E2E_DEMO_EMAIL", password: "E2E_DEMO_PASSWORD" },
};

/**
 * Reads a persona's Clerk credentials from process.env. Returns null (never throws) when
 * unset, so specs can `test.skip()` -- the existing, intentional convention for this suite:
 * it must be a graceful no-op when secrets aren't configured (e.g. CI today), not a hard failure.
 */
export function readPersonaCredentials(persona: E2EPersona): E2ECredentials | null {
  const names = personaEnvNames[persona];
  const email = process.env[names.email];
  const password = process.env[names.password];
  if (!email || !password) return null;
  return { email, password };
}

/**
 * Fail fast with an actionable message when the app-level config an authenticated run
 * depends on is missing, instead of letting the failure surface later as a confusing
 * Prisma connection error or a broken Clerk sign-in page. Only called once a persona's
 * credentials are present (i.e. an authenticated run was actually requested) -- never runs,
 * and never requires these vars, when no E2E_* credentials are configured at all.
 *
 * Deliberately never interpolates env var values into the thrown message, only names.
 */
export function assertAuthenticatedRunIsConfigured(): void {
  const missing: string[] = [];
  if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) missing.push("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
  if (!process.env.CLERK_SECRET_KEY) missing.push("CLERK_SECRET_KEY");

  if (missing.length > 0) {
    throw new Error(
      `Acquisition E2E: an E2E_*_EMAIL/PASSWORD pair is set, so an authenticated run was requested, ` +
      `but the following required environment variable(s) are missing: ${missing.join(", ")}. ` +
      `Set them locally (apps/web/.env.local, gitignored) or as CI/Vercel/GitHub environment ` +
      `secrets -- see apps/web/e2e/README.md. Never paste secret values into chat or commit them.`,
    );
  }
}

// ST1-013N: minimum set of env vars a real (non-skipped) golden-path E2E run needs. Kept in
// one place so both the required-mode gate below and docs/CI wiring agree on the list.
export const REQUIRED_E2E_ENV_VARS = ["E2E_USER_EMAIL", "E2E_USER_PASSWORD", "DATABASE_URL"] as const;

/**
 * Required-mode is CI by default, or an explicit local opt-in via WHISPERM_REQUIRE_E2E=true.
 * In required mode, missing env must fail the run loudly -- it must never silently degrade into
 * the pre-existing test.skip() no-op (see assertE2eRequiredModeIsConfigured below).
 */
export function isE2eRequiredMode(): boolean {
  return process.env.WHISPERM_REQUIRE_E2E === "true" || process.env.CI === "true";
}

/**
 * Returns only the *names* of missing required-mode env vars, never a value. Callers must not
 * interpolate anything else from process.env into an error message built from this list.
 *
 * NEXT_PUBLIC_APP_URL / PLAYWRIGHT_BASE_URL: the suite needs at least one base URL to run
 * against; either satisfies the requirement (mirrors playwright.config.ts's own fallback order).
 * VERCEL_AUTOMATION_BYPASS_SECRET is only required when that base URL is a remote (non-localhost)
 * deployment -- Vercel Deployment Protection (see playwright.config.ts) only applies there; a
 * local `pnpm dev` target never needs it.
 */
export function missingRequiredE2eEnv(): readonly string[] {
  const missing: string[] = [];
  for (const name of REQUIRED_E2E_ENV_VARS) {
    if (!process.env[name] || process.env[name]?.trim().length === 0) missing.push(name);
  }

  const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (!baseUrl || baseUrl.trim().length === 0) {
    missing.push("NEXT_PUBLIC_APP_URL or PLAYWRIGHT_BASE_URL");
  } else if (!/localhost|127\.0\.0\.1/u.test(baseUrl) && !process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    missing.push("VERCEL_AUTOMATION_BYPASS_SECRET");
  }

  return missing;
}

/**
 * ST1-013N hard gate: throws with the exact missing variable names (never values) when required
 * mode (CI, or WHISPERM_REQUIRE_E2E=true) is enabled and any required env var is absent.
 * Local/optional runs (required mode off) are unaffected -- specs keep their existing
 * test.skip()-when-unconfigured convention for that case.
 */
export function assertE2eRequiredModeIsConfigured(): void {
  if (!isE2eRequiredMode()) return;
  const missing = missingRequiredE2eEnv();
  if (missing.length > 0) {
    throw new Error(
      `E2E required mode is enabled but required environment variables are missing: ${missing.join(", ")}`,
    );
  }
}
