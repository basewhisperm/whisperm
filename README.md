# WhispeRM

## What WhispeRM is

WhispeRM is a multi-tenant CRM with a "Seller Acquisition" engine on top: it finds marketplace
listings (Jiji/Tonaton-style), captures the seller as a Contact/Deal, invites them to claim their
listing, and converts a claimed seller into a CRM contact/deal with revenue attribution.

This document exists so a new engineer, reviewer, or demo operator can go from a fresh clone to a
running, populated app without tribal knowledge. If a command below doesn't work as documented,
that's a bug in this README (or the tooling it describes) -- please fix it rather than working
around it silently.

## Architecture overview

This is a pnpm workspace monorepo:

- **`apps/web`** is the actual product -- a Next.js app. All CRM and Seller Acquisition UI and
  API routes live here. This is what you run.
- **`apps/worker`** is a BullMQ-*shaped* durable-queue worker: its `QueueJob` table is
  Postgres-backed, not in-memory, but nothing in this repo's deployment keeps this process running
  continuously. `apps/web`'s `GET /api/internal/queue-drain` (Vercel Cron) reuses its exact
  production wiring to drain the same queue instead -- see "Known gaps" below. The golden path
  (capture -> invite -> claim -> convert) runs synchronously inside `apps/web` request handlers
  and does not depend on either process being up; only the *retry* and *scheduled* paths (claim
  reminders/expiry, growth-loop evaluation) go through this queue.
- **`apps/api`** is a standalone Fastify-style HTTP API (billing, a second CRM implementation).
  Nothing in this repo currently starts it (no `.listen()` call is wired up) or calls it from
  `apps/web` -- treat it as a library of routes/services, not a running service, until a bootstrap
  entrypoint is added.
- **`packages/*`** hold shared domain logic, Prisma repositories, and runtimes consumed by the
  apps above (`@whisperm/types`, `@whisperm/repositories`, `@whisperm/services`,
  `@whisperm/provider-adapters`, `@whisperm/campaign-runtime`, and others).
- **`prisma/`** holds the single Postgres schema (shared by all three apps), migrations, and seed
  scripts.
- **`scripts/`** holds workspace-level tooling: `doctor.mjs` (environment validation),
  `bootstrap.mjs` (first-run orchestration), `seed-demo.mjs` (canonical demo-seed entry point).

Auth is [Clerk](https://clerk.com) -- there is no NextAuth/custom session layer in this repo today.

## Apps and packages

| Path | What it is | Status |
| --- | --- | --- |
| `apps/web` | Next.js app -- the actual product. All CRM and Seller Acquisition UI + API routes live here. | Live, this is what you run. |
| `apps/worker` | BullMQ-shaped worker with a Postgres-backed durable queue. | Not run as a standing process by this repo's deployment -- `apps/web`'s Vercel-Cron-triggered `/api/internal/queue-drain` drains the same queue instead. See "Known gaps" below. |
| `apps/api` | Standalone Fastify-style HTTP API (billing, a second CRM implementation). | Not currently started by anything and not called by `apps/web` -- see "Known gaps" below. |
| `packages/*` | Shared domain logic, Prisma repositories, and runtimes consumed by the apps above. | |
| `prisma/` | The Postgres schema, migrations, and seed scripts. | |
| `scripts/` | Bootstrap/doctor/demo-seed tooling (this slice, ST1-013L). | |

## Prerequisites

- **Node `20.11.0`** (see `.nvmrc`) -- `>= 20.11.0` per `package.json`'s `engines` field.
- **pnpm `9.x`** (pinned to `9.15.4` via `packageManager` in `package.json`) -- run `corepack
  enable` to pick it up automatically.
- **PostgreSQL** -- required. Local Postgres, [Neon](https://neon.tech), or
  [Supabase](https://supabase.com) all work; the schema uses plain `postgresql`, nothing
  vendor-specific.
- **Redis** -- required *if/when* queue/runtime features are enabled. As of this slice,
  `apps/worker`'s queue runtime is in-memory and nothing in the codebase reads `REDIS_URL` yet
  (see "Known gaps"); `pnpm run doctor` warns rather than fails when it's unset.
- A [Clerk](https://clerk.com) application (free tier is fine) for auth -- `apps/web` cannot be
  used without it.

## Environment variables

Each app has its own `.env.example`; there's also a root `.env.example` for workspace-level
variables (root scripts, Prisma, E2E tests):

- `.env.example` (root)
- `apps/web/.env.example`
- `apps/api/.env.example`
- `apps/worker/.env.example`

Copy the ones you need and fill in real values -- never commit a filled-in `.env*` file (the
`.gitignore` blocks all of them except the `.example` files themselves). `pnpm run doctor` (below)
checks that the required ones are set, by name only -- it never prints a variable's value.

Key variables at a glance:

| Variable | Where | Required for |
| --- | --- | --- |
| `DATABASE_URL` | root, all apps | Anything that touches Postgres (Prisma generate/migrate, seeding, running the app). |
| `DIRECT_URL` | `apps/api` | Documented for the pooled-vs-direct-connection split in `docs/production-deployment.md`; not read by `prisma/schema.prisma`'s datasource block today. |
| `REDIS_URL` | root, `apps/api`, `apps/worker` | Reserved for the future durable queue backend; not read by any code yet. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | `apps/web` | Signing in -- `apps/web` cannot be used without these. |
| `NEXTAUTH_SECRET` / `NEXTAUTH_URL` / `AUTH_SECRET` | root | Not used by any code in this repo (Clerk is the real auth provider) -- reserved placeholders only. |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | root, `apps/web` | Letting automated checks (Playwright, uptime pings) bypass Vercel's preview deployment-protection screen. |
| `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` | root, `apps/web` | Running the authenticated Playwright E2E suite (`apps/web/e2e`). Specs `test.skip()` when unset. |
| `WHISPERM_DEMO_TENANT_SLUG` / `WHISPERM_DEMO_USER_EMAIL` | root | `pnpm seed:demo` (see "Demo seed" below). |
| `SELLER_INVITATION_BASE_URL` | `apps/web` | Generating usable seller claim links -- see "Seller invitation provider configuration" below. |

## First-run setup

```bash
git clone <this repo>
cd whisperm

corepack enable
pnpm run doctor      # sanity-check Node/pnpm/workspace layout before installing anything
pnpm bootstrap   # pnpm install + prisma generate + pnpm run doctor, idempotent
```

`pnpm bootstrap` prints the exact next commands (env files to copy, migration command, demo seed
command, dev server command) instead of running anything that touches a real database for you --
see "Database setup" and "Demo seed" below for those.

## Local development

```bash
# apps/web (the product) -- http://localhost:3000
pnpm --filter @whisperm/web dev

# apps/api (standalone library today -- see "Known gaps"; has no start command wired up)
pnpm --filter @whisperm/api build

# apps/worker (in-memory queue scaffold -- see "Known gaps")
pnpm --filter @whisperm/worker build && pnpm --filter @whisperm/worker start
```

## Database setup

```bash
# 1. Point DATABASE_URL at a Postgres database, then copy env files:
cp apps/web/.env.example apps/web/.env.local
# fill in apps/web/.env.local:
#   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY  -- from your Clerk app (TEST keys, not pk_live_/sk_live_)
#   DATABASE_URL                                          -- your Postgres connection string

# 2. Generate the Prisma client (also runs automatically on `pnpm install` via postinstall):
pnpm exec prisma generate

# 3. Apply the schema:
pnpm --filter @whisperm/repositories exec prisma migrate deploy --schema=../../prisma/schema.prisma
```

For a pooled production database (e.g. Supabase's pgbouncer pooler), run `prisma migrate deploy`
against the *direct* (non-pooled) connection string, not the pooled one -- see
`docs/production-deployment.md`.

`prisma/migrations/20260601000000_baseline_core_schema` (ST1-013L) creates the core tables
(`Tenant`, `TenantUser`, `Contact`, `Deal`, `Pipeline`, `Subscription`, and the rest of the
platform/observability tables) that predate migration tracking -- every statement in it is
`IF NOT EXISTS`/`duplicate_object`-guarded, so it's a no-op against an already-provisioned
database and only actually creates anything against a genuinely empty one. Without it, `prisma
migrate deploy` against a fresh database fails on the very next migration (a foreign key to a
`Tenant` table that was never created by any migration file).

## Demo seed

```bash
WHISPERM_DEMO_USER_EMAIL="you@example.com" pnpm seed:demo
```

`pnpm seed:demo` runs `scripts/seed-demo.mjs`, the canonical entry point, which delegates to the
tested seeding logic in `prisma/demo-seed.mjs` (`seedDemoWorkspace`). It is **idempotent** --
rerunning it upserts existing rows instead of duplicating them.

Use the **same email address you'll sign in with via Clerk**. `apps/web` resolves your workspace
by matching your signed-in Clerk email against a `TenantUser` row
(`apps/web/src/lib/get-tenant.ts`) -- there is no self-service "create your workspace" flow yet
(see "Known gaps"), so this seed is currently the only way to attach a login to a populated
workspace.

This creates one tenant (`WHISPERM_DEMO_TENANT_SLUG`, default `demo`) with:
- 5 CRM contacts/deals spread across the default pipeline's stages (Prospect -> Renewal), for the
  Dashboard/Contacts/Deals/Reports pages.
- 3 marketplace sellers captured at the "Captured" stage of the Seller Acquisition pipeline, each
  with a phone number and draft inventory already attached.

It deliberately does **not** pre-seed "Invited"/"Claimed"/"Converted" sellers -- those transitions
require real evidence (an actual invitation, an actual claim-portal attestation) to be trustworthy
state, so drive a couple of the seeded sellers through Invite -> Claim -> Convert live from the
Marketplace Acquisition board. That's also the strongest part of a demo: it proves the pipeline
actually works end to end rather than showing static data.

Run it: `pnpm --filter @whisperm/web dev`, visit `http://localhost:3000`, sign in with the Clerk
account matching `WHISPERM_DEMO_USER_EMAIL`, and you should land on a populated dashboard.

## Health checks

| Endpoint | App | Notes |
| --- | --- | --- |
| `GET /api/health` | `apps/web` | Public (excluded from Clerk auth in `middleware.ts`). Returns `{ ok, service: "web", database: "ok" \| "error", timestamp }`. `database` reflects a live `SELECT 1`; never leaks connection-string/error detail. |
| `GET /healthz` | `apps/api` | Liveness. `curl https://api.whisperm.io/healthz` -> `{"ok":true,"data":{"status":"ok"}}`. Only meaningful once `apps/api` has a bootstrap entrypoint that starts it (see "Known gaps"). |
| `GET /readyz` | `apps/api` | Readiness (configurable checks via `ReadinessCheck`). |
| `GET /api/marketplace-acquisition/provider-health?channel=WHATSAPP\|SMS\|EMAIL` | `apps/web` | Reports whether an invitation channel is actually usable given current env config. |
| `GET /api/marketplace-acquisition/runtime-health` | `apps/web` | Acquisition runtime health/governance surface. |
| `GET /api/internal/queue-drain` | `apps/web` | Not a health check -- drains the durable `QueueJob` table for every tenant with due work. Requires `Authorization: Bearer $CRON_SECRET`; wired to Vercel Cron in `apps/web/vercel.json`. See "Known gaps". |

`apps/worker` exposes `getHealth()`/`getReadiness()` as in-process methods
(`apps/worker/src/index.ts`) but does not currently serve them over HTTP.

## Running tests

```bash
pnpm lint
pnpm typecheck
pnpm typecheck:strict
pnpm test               # every workspace package's unit/integration test suite
pnpm test:doctor        # scripts/doctor.mjs's own tests
pnpm test:seed:demo     # prisma/demo-seed.mjs's own tests
pnpm check:bootstrap    # pnpm run doctor + a full apps/web typecheck, see below
```

End-to-end (Playwright, `apps/web/e2e`): `pnpm --filter @whisperm/web test:e2e`. See
`apps/web/e2e/README.md` for the full environment-variable reference -- every authenticated spec
`test.skip()`s itself when `E2E_USER_EMAIL`/`E2E_USER_PASSWORD` are unset (a no-op in CI today).

## Troubleshooting

Run `pnpm run doctor` first -- it's designed to catch the causes below before you hit them, and it
never prints secret values, only variable names, so it's safe to paste its output when asking for
help.

- **`DATABASE_URL is missing` / `is not a parseable postgres:// URL`** -- set `DATABASE_URL` in
  your shell or in the app's `.env.local`/`.env` file (see "Database setup"). It must start with
  `postgres://` or `postgresql://`.
- **Prisma client errors ("did you forget to run `prisma generate`?")** -- run `pnpm exec prisma
  generate` (or re-run `pnpm bootstrap`, which does this for you) after pulling schema changes or
  a fresh install.
- **Dashboard/API routes returning `CONFIGURATION_ERROR`** -- this is `apps/web`'s explicit,
  typed response for a Prisma connection/config failure (see
  `apps/web/src/lib/dashboard-data.ts`); it never falls back to fake zeros. Check `DATABASE_URL`.
- **Signed in but see an empty workspace / no dashboard data** -- your Clerk email doesn't match
  any `TenantUser.email` row. Run `pnpm seed:demo` with `WHISPERM_DEMO_USER_EMAIL` set to the
  exact email you sign in with, or use `pnpm tenant-feature` / the founding-workspaces seed to
  attach an existing tenant to your login.
- **`pnpm --filter @whisperm/web typecheck` (or `check:bootstrap`) fails with a "Cannot find
  module '@whisperm/campaign-runtime'" error** -- that package needs to be built first;
  `pnpm check:bootstrap` and the root `pnpm typecheck` both do this for you. If you're invoking a
  single app's `typecheck` script directly, build its workspace dependencies first (`pnpm
  --filter @whisperm/campaign-runtime build`, etc.).
- **Seller invitations silently not sending** -- no invitation provider is configured for that
  channel. `GET /api/marketplace-acquisition/provider-health?channel=...` (or the Acquisition
  Workbench UI) reports this explicitly (`PROVIDER_NOT_CONFIGURED`) rather than failing deep
  inside delivery -- see "Seller invitation provider configuration" below.
- **`pnpm run doctor` warns about `REDIS_URL`** -- expected today; `apps/worker`'s queue is in-memory
  only and nothing reads `REDIS_URL` yet (see "Known gaps"). This is a warning, not a failure.

## Seller invitation provider configuration (ST1-013J)

WhispeRM never assumes an invitation provider is configured -- `GET
/api/marketplace-acquisition/provider-health?channel=WHATSAPP|SMS|EMAIL` reports whether a
channel is actually usable, and the invite/bulk-invite APIs and the Acquisition Workbench UI both
check this before allowing an invite to be sent. A misconfigured or unset provider blocks the
invite action cleanly (`PROVIDER_NOT_CONFIGURED`) instead of failing deep inside delivery.

**Claim link base URL** -- `SELLER_INVITATION_BASE_URL` has no built-in default (an implicit
production default would silently generate unusable claim links in preview/local/demo). It must
be set explicitly and be an absolute `http(s)` URL with no placeholder value:

```bash
# local development
SELLER_INVITATION_BASE_URL=http://localhost:3000/claim

# Vercel preview (set per-preview-deployment, not globally)
SELLER_INVITATION_BASE_URL=https://whisperm-git-my-branch.vercel.app/claim

# production
SELLER_INVITATION_BASE_URL=https://app.whisperm.ai/claim
```

**WhatsApp (Meta Cloud API)**:

| Env var | Required | Notes |
| --- | --- | --- |
| `META_WHATSAPP_ACCESS_TOKEN` | yes | Meta Cloud API access token |
| `META_WHATSAPP_PHONE_NUMBER_ID` | yes | Meta Cloud API phone number ID |
| `WHATSAPP_TEMPLATE_NAME` | no (defaults to `seller_invitation_v1`) | Must match an approved Meta template |
| `WHATSAPP_TEMPLATE_LANGUAGE` | no (defaults to `en`) | Must match the approved template's language |
| `WHATSAPP_TEMPLATE_BODY_PARAM_COUNT` | no (defaults to `1`) | See limitation below |

**Known limitation**: the WhatsApp adapter only supports templates with **0 or 1** body
parameters. A template with more than one body parameter fails provider preflight
(`INVALID_TEMPLATE_CONFIGURATION`) rather than guessing how to map invite data onto the extra
parameters -- add explicit per-parameter mapping support before using such a template.

**SMS (generic HTTP provider)**: `SELLER_INVITATION_SMS_API_URL`, `SELLER_INVITATION_SMS_API_KEY`,
`SELLER_INVITATION_SMS_SENDER_ID` (all required together), `SELLER_INVITATION_SMS_PROVIDER`
(optional label).

**Email (Resend) fallback**: `RESEND_API_KEY` (required), `EMAIL_FROM` (optional). A seller with
an email address but no phone number is invited by email as soon as this is configured -- email
fallback is never blocked by a missing phone.

**Other invitation env vars**: `SELLER_INVITATION_WHATSAPP_ENABLED` (default `true`),
`SELLER_INVITATION_FALLBACK_TO_SMS` (default `true`, WhatsApp send failures fall back to SMS when
the seller has a phone and SMS is configured).

None of the above are committed to the repo with real values -- set them per environment.

## Seller claim lifecycle (ST1-013K)

A claim token moves through `ACTIVE` (`PENDING`/`SENT`/`OPENED`) -> `CLAIMED` | `EXPIRED` |
`ABANDONED`, and is always stored hashed (`MarketplaceClaimToken.tokenHash`) -- the raw token
exists only long enough to build the invite URL at send time and is never persisted or logged.
`packages/services/src/claim-lifecycle.ts` (`MarketplaceClaimLifecycleService`) is the single
place lifecycle transitions happen; route handlers and the worker call into it rather than
mutating token/capture/invitation status directly.

- **Expiration**: a token expires exactly 7 days after it was sent (`expireClaimInvitation`).
  Already-`CLAIMED`/`CONVERTED` captures are left untouched; an already-`EXPIRED` token is a no-op
  success. Expiring a token also moves its `MarketplaceCapture` and `DraftInventory` to `EXPIRED`
  (unless already claimed/converted) and records a `MARKETPLACE_CLAIM_INVITATION_EXPIRED` audit
  event. An expired claim link shows a clear "this link has expired" state in
  `/claim/[token]` and cannot be claimed.
- **Reminders**: Day 3 and Day 6 reminders (`sendClaimReminder`) resend the *same* claim link the
  seller originally received (looked up via the claim token's linked `MarketplaceSellerInvitation`
  row), through the same `MessagingProviderRegistry` the original invitation used -- WhatsApp ->
  SMS -> Email, per the Seller Invitation Engine's channel priority. A reminder is only attempted
  once eligibility holds (token `ACTIVE`, capture not terminal, that reminder not already sent);
  ineligible or already-claimed/expired/revoked tokens are skipped, never reminded.
  If no provider is configured for the channel (routine in preview/local/demo -- see above), or the
  original invitation record can't be found, the reminder cleanly reports "not delivered" and
  records a `MARKETPLACE_CLAIM_REMINDER_SKIPPED` audit event instead of throwing or claiming a
  false success -- it does **not** mark the reminder as sent, so it stays eligible for a later
  retry. This replaced an earlier stopgap where the worker's reminder notification port always
  threw an HTTP 501.
- **No raw-token logging**: token lookups always hash the incoming token before any
  comparison/lookup; audit events and lifecycle logs never carry the raw token or its hash.

## Known gaps (see full review for detail)

- **Self-service signup is real but minimal.** A signed-in Clerk user with no matching
  `TenantUser` row is auto-provisioned a `Tenant`, an `OWNER` `TenantUser`, a default CRM
  pipeline, and a 14-day trial `Subscription` (`apps/web/src/lib/provision-tenant.ts`). There is
  still no onboarding flow (workspace name, team invites, etc.) beyond this bare-minimum
  provisioning.
- **Billing is wired into `apps/web`, not just `apps/api`.** `/api/webhooks/stripe`,
  `/api/webhooks/paystack`, and `/api/billing/upgrade` (`apps/web/src/lib/billing/`) verify
  signatures, upsert the tenant's `Subscription` row, and start a real Stripe/Paystack checkout
  session. `SELLER_ACQUISITION` now also unlocks from an active/trialing subscription, not only
  the manual `tenant-feature` CLI toggle (which still works, as an ops override). Paystack routing
  is effectively unreachable today: `resolveBillingProvider` only picks it for country `"GH"`, and
  nothing in the live sign-up flow collects a country yet.
- **`apps/api` does not currently start.** Nothing in it calls `.listen()`; treat it as a library
  of routes/services that would need a bootstrap entrypoint before it could run as a service. Its
  billing/webhook logic is real and tested, but `apps/web` no longer depends on it -- the reusable
  Stripe event-mapping piece was moved to `packages/billing-runtime` instead (see
  `stripeEventToSubscriptionSnapshot`).
- **`apps/worker`'s queue is durable but not continuously drained.** The `QueueJob` table is
  Postgres-backed (`apps/worker/src/durable-queue-runtime.ts`), not in-memory, and the claim
  lifecycle / campaign-runtime / growth-loop job handlers are correct and tested -- but nothing in
  this repo's deployment keeps `apps/worker` running as a standing process. Instead,
  `GET /api/internal/queue-drain` (`apps/web/src/lib/queue-drain/drain.ts`) reuses that exact
  production wiring to drain every tenant's due jobs in one bounded, time-budgeted HTTP call, and
  is wired to Vercel Cron in `apps/web/vercel.json` (requires `CRON_SECRET`; every-5-minutes cron
  needs a Vercel Pro plan -- Hobby is limited to daily). Trial-expiry reminder emails
  (`buildTrialReminderJobs` in `@whisperm/notification-runtime`) are still never scheduled by
  anything in `apps/web`, so they don't fire even with the drain running.
