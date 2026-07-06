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
