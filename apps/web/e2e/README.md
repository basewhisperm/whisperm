# End-to-end tests

Playwright specs covering the marketplace acquisition funnel end to end, plus the pre-existing
auth/pipeline/contacts/reports smoke checks.

## Configuration: environment variables only

**Never paste real credentials into chat, commit them, or hardcode them in source.** Configure
everything below locally (`apps/web/.env.local`, which is gitignored) or as CI/Vercel/GitHub
Actions **environment secrets**. Nothing in this suite reads credentials from anywhere except
`process.env`.

| Variable | Required when | Notes |
| --- | --- | --- |
| `PLAYWRIGHT_BASE_URL` | Optional | Defaults to `http://localhost:3000`. Set it to target a deployed preview/staging URL instead of the local `pnpm dev` server. |
| `DATABASE_URL` | Once `E2E_USER_EMAIL` is set | Must point at a disposable/test Postgres database. `global-setup.ts` seeds fixtures into it; never point this at production. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Once `E2E_USER_EMAIL` is set | Must be a **Clerk test instance** key, and must match the same Clerk instance the `E2E_*` users below were created in. |
| `CLERK_SECRET_KEY` | Once `E2E_USER_EMAIL` is set | Same Clerk test instance as above. |
| `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` | To run any authenticated spec | Credentials for a real Clerk user, tenant-mapped by `global-setup.ts`. Every spec (including the acquisition funnel ones) calls `test.skip()` when unset -- the suite is a no-op without them, e.g. in CI today. |
| `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` | Not required today | Read via `helpers/env.ts` / `e2eAdminCredentials()`, reserved for future admin-persona coverage. No current spec consumes them. |
| `E2E_DEMO_EMAIL` / `E2E_DEMO_PASSWORD` | Not required today | Same as above, reserved for a future demo-persona spec. |

If `E2E_USER_EMAIL`/`E2E_USER_PASSWORD` are set but `DATABASE_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
or `CLERK_SECRET_KEY` are missing, `global-setup.ts` throws immediately with a message naming the
missing variable(s) -- it never logs or echoes any secret *value*, only variable *names*.

Treat any seeded E2E tenant/campaign/user as disposable. Nothing here should ever touch production
data -- point `DATABASE_URL` only at a throwaway or staging database created for this purpose.

## Running locally

```
pnpm --filter @whisperm/web test:e2e
```

`global-setup.ts` seeds a dedicated `e2e-acquisition` tenant (idempotent), a `TenantUser` row
matching `E2E_USER_EMAIL` (idempotent), the `SELLER_ACQUISITION` feature flag, an `ACTIVE`
subscription, the `marketplace_acquisition` pipeline, and a fresh `ACTIVE` campaign for this run
(unique name, so repeated/parallel runs never collide on campaign membership uniqueness
constraints). It does not create the Clerk user itself -- that has to already exist and match
`E2E_USER_EMAIL`/`E2E_USER_PASSWORD` in the same Clerk instance as your `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`/`CLERK_SECRET_KEY`.

Invitations never touch a real WhatsApp/SMS/email provider: `playwright.config.ts` points the
dev server's SMS provider env vars at `e2e/mocks/sms-server.mjs`, a sandbox HTTP server started
as a second Playwright `webServer`. Tests read the claim link from the message the mock server
actually captured (`GET /__control/messages?to=<phone>`), the same way a real seller would get it
from an SMS.

## Running in CI

Set the same variables as CI/GitHub Actions/Vercel **environment secrets**, not as plaintext in
workflow YAML or repo variables. Without them, every spec skips (as today); with them, the suite
seeds its own tenant/campaign and runs against the `DATABASE_URL`/`PLAYWRIGHT_BASE_URL` you provide.

## Files

- `acquisition-funnel.spec.ts` — the golden path: campaign → capture → qualification → campaign
  membership → invitation (sandbox SMS) → claim → CRM conversion → revenue attribution → usage
  metering → Command Center.
- `acquisition-funnel-negative.spec.ts` — capture without phone, requalification after adding a
  phone, invitation provider failure, and repeat-capture idempotency.
- `helpers/env.ts` — the single place that reads `E2E_*` credentials and validates the
  DB/Clerk config an authenticated run needs; never logs secret values.
- `helpers/auth.ts`, `helpers/seed-context.ts`, `helpers/capture-payload.ts` — shared sign-in,
  seed-context reader, and capture-payload builder.
- `mocks/sms-server.mjs` — sandbox SMS provider (also used as a control channel for the
  invitation-failure test via `POST /__control/fail-next`).
- `seed/seed-acquisition.mjs` — the fixture seed, runnable standalone via
  `E2E_USER_EMAIL=... DATABASE_URL=... node e2e/seed/seed-acquisition.mjs` for local debugging.

`playwright/.auth/` (gitignored) is reserved for a future storage-state cache so authenticated
specs can sign in once instead of per test; not implemented yet -- every spec currently signs in
independently via `helpers/auth.ts`'s `signIn()`.
