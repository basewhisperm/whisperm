# End-to-end tests

Playwright specs covering the marketplace acquisition funnel end to end, plus the pre-existing
auth/pipeline/contacts/reports smoke checks.

## Running locally

```
pnpm --filter @whisperm/web test:e2e
```

Requires, in `apps/web/.env.local` (or exported in the shell):

- `DATABASE_URL` — pointed at a disposable/test Postgres database.
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` — a Clerk **test** instance.
- `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` — credentials for a real Clerk user in that test
  instance. This matches the existing `auth.spec.ts` / `pipeline.spec.ts` / `contacts.spec.ts` /
  `reports.spec.ts` convention: every spec (including the acquisition funnel specs) calls
  `test.skip()` when these are unset, so the suite is a no-op without them (e.g. in CI today).

`global-setup.ts` seeds a dedicated `e2e-acquisition` tenant (idempotent), a `TenantUser` row
matching `E2E_USER_EMAIL` (idempotent), the `SELLER_ACQUISITION` feature flag, an `ACTIVE`
subscription, the `marketplace_acquisition` pipeline, and a fresh `ACTIVE` campaign for this run
(unique name, so repeated/parallel runs never collide on campaign membership uniqueness
constraints). It does not create the Clerk user itself — that has to already exist and match
`E2E_USER_EMAIL`/`E2E_USER_PASSWORD`.

Invitations never touch a real WhatsApp/SMS/email provider: `playwright.config.ts` points the
dev server's SMS provider env vars at `e2e/mocks/sms-server.mjs`, a sandbox HTTP server started
as a second Playwright `webServer`. Tests read the claim link from the message the mock server
actually captured (`GET /__control/messages?to=<phone>`), the same way a real seller would get it
from an SMS.

## Files

- `acquisition-funnel.spec.ts` — the golden path: campaign → capture → qualification → campaign
  membership → invitation (sandbox SMS) → claim → CRM conversion → revenue attribution → usage
  metering → Command Center.
- `acquisition-funnel-negative.spec.ts` — capture without phone, requalification after adding a
  phone, invitation provider failure, and repeat-capture idempotency.
- `helpers/` — shared sign-in, seed-context reader, and capture-payload builder.
- `mocks/sms-server.mjs` — sandbox SMS provider (also used as a control channel for the
  invitation-failure test via `POST /__control/fail-next`).
- `seed/seed-acquisition.mjs` — the fixture seed, runnable standalone via
  `E2E_USER_EMAIL=... node e2e/seed/seed-acquisition.mjs` for local debugging.
