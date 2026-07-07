# WhispeRM

A multi-tenant CRM with a "Seller Acquisition" engine on top: it finds marketplace listings
(Jiji/Tonaton-style), captures the seller as a Contact/Deal, invites them to claim their listing,
and converts a claimed seller into a CRM contact/deal with revenue attribution.

This is a pnpm workspace monorepo:

| Path | What it is | Status |
| --- | --- | --- |
| `apps/web` | Next.js app — the actual product. All CRM, billing, and Seller Acquisition UI + API routes live here. | Live, this is what you run. |
| `apps/worker` | BullMQ-shaped worker scaffold. | Not wired to a durable queue yet (in-memory only) — the golden path (capture → invite → claim → convert) runs synchronously inside `apps/web` and does not depend on this process. |
| `packages/*` | Shared domain logic (`@whisperm/services`, `@whisperm/billing-runtime`), Prisma repositories, and runtimes consumed by the apps above. | |
| `prisma/` | The Postgres schema, migrations, and seed scripts. | |

There used to be a separate `apps/api` (a second, disconnected CRM/billing implementation that
never actually ran in production — it had no bootstrap entrypoint and nothing called it). It's
been archived; its sound logic (workspace provisioning, trial/billing gating, Stripe/Paystack
webhook handling) was ported into `packages/billing-runtime` and wired directly into `apps/web`.

## Prerequisites

- Node `20.11.0` (see `.nvmrc`)
- pnpm `9.15.4` (`corepack enable` will pick this up from `packageManager` in `package.json`)
- A Postgres database (local Postgres, [Neon](https://neon.tech), or [Supabase](https://supabase.com) all work — the schema uses plain `postgresql`, nothing vendor-specific)
- A [Clerk](https://clerk.com) application (free tier is fine) for auth — `apps/web` cannot be used without it
- Stripe and/or Paystack test-mode API keys, only if you want to exercise the billing/upgrade flow locally (everything else works without them)

## Local setup

```bash
corepack enable
pnpm install

cp apps/web/.env.example apps/web/.env.local
# then fill in apps/web/.env.local:
#   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY  -- from your Clerk app (use TEST keys, not pk_live_/sk_live_)
#   DATABASE_URL                                          -- your Postgres connection string
#   STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / STRIPE_PRICE_*  -- optional, only needed to test upgrades
#   PAYSTACK_SECRET_KEY                                   -- optional, only needed to test upgrades

pnpm --filter @whisperm/repositories exec prisma migrate deploy --schema=../../prisma/schema.prisma
```

### Sign up

```bash
pnpm --filter @whisperm/web dev
```

Visit `http://localhost:3000/sign-up` and create an account. The first time you sign in, a trial
workspace (tenant + OWNER membership + default pipeline + 14-day trial subscription) is
provisioned for you automatically (`apps/web/src/lib/get-tenant.ts` →
`apps/web/src/lib/billing/provision-workspace-for-user.ts`) — there's no separate "create your
workspace" form yet, so the workspace name defaults from your Clerk profile and can't be renamed
in the UI today.

### Optionally seed demo data

A fresh sign-up starts with an empty workspace. To populate one for a demo/walkthrough:

```bash
DEMO_USER_EMAIL="you@example.com" pnpm seed:demo
```

Use the same email you'll sign in with via Clerk. This creates:
- 5 CRM contacts/deals spread across the default pipeline's stages (Prospect → Renewal), for the Dashboard/Contacts/Deals/Reports pages
- 3 marketplace sellers captured at the "Captured" stage of the Seller Acquisition pipeline, each with a phone number and draft inventory already attached

It deliberately does **not** pre-seed "Invited"/"Claimed"/"Converted" sellers — those transitions
require real evidence (an actual invitation, an actual claim-portal attestation) to be trustworthy
state, so drive a couple of the seeded sellers through Invite → Claim → Convert live from the
Marketplace Acquisition board. That's also the strongest part of a demo: it proves the pipeline
actually works end to end rather than showing static data. Re-running the seed is safe (idempotent).

## Billing

Settings → Billing shows the workspace's current plan/trial status and lets you upgrade to Growth
or Pro. Upgrading redirects to a real Stripe Checkout Session (or Paystack transaction for Ghana
workspaces once per-workspace country selection exists — today every workspace defaults to
Stripe). Stripe/Paystack webhooks (`/api/webhooks/stripe`, `/api/webhooks/paystack`) update the
subscription atomically once payment completes. Automated acquisition (campaign creation,
discovery runs, bulk-invite) requires an ACTIVE (paid) subscription; manual single-listing capture
stays available throughout the trial, capped at 10 captures.

## Tests / CI

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## Known gaps

- **No per-workspace country/plan selection at signup.** New workspaces default to `country: "US"`,
  so upgrades always route to Stripe today (Paystack routing logic exists and is tested, but has
  no live trigger yet).
- **`apps/worker`'s queue is in-memory, not durable.** Trial-reminder jobs are recorded as durable
  `QueueJob` rows but nothing consumes them yet; anything meant to run asynchronously (reminders,
  scheduled campaign ticks, claim expiry) needs a real BullMQ/Redis wiring before it can be relied
  on unattended.
- **No workspace rename / team invite UI wired to a backend.** The Settings page's workspace
  preferences, pipeline stage editor, and team invite panel are UI-only previews.
