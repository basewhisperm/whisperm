# WhispeRM

A multi-tenant CRM with a "Seller Acquisition" engine on top: it finds marketplace listings
(Jiji/Tonaton-style), captures the seller as a Contact/Deal, invites them to claim their listing,
and converts a claimed seller into a CRM contact/deal with revenue attribution.

This is a pnpm workspace monorepo:

| Path | What it is | Status |
| --- | --- | --- |
| `apps/web` | Next.js app — the actual product. All CRM and Seller Acquisition UI + API routes live here. | Live, this is what you run. |
| `apps/worker` | BullMQ-shaped worker scaffold. | Not wired to a durable queue yet (in-memory only) — the golden path (capture → invite → claim → convert) runs synchronously inside `apps/web` and does not depend on this process. |
| `apps/api` | Standalone Fastify-style HTTP API (billing, a second CRM implementation). | Not currently started by anything and not called by `apps/web` — see the note below before building on it. |
| `packages/*` | Shared domain logic, Prisma repositories, and runtimes consumed by the apps above. | |
| `prisma/` | The Postgres schema, migrations, and seed scripts. | |

## Prerequisites

- Node `20.11.0` (see `.nvmrc`)
- pnpm `9.15.4` (`corepack enable` will pick this up from `packageManager` in `package.json`)
- A Postgres database (local Postgres, [Neon](https://neon.tech), or [Supabase](https://supabase.com) all work — the schema uses plain `postgresql`, nothing vendor-specific)
- A [Clerk](https://clerk.com) application (free tier is fine) for auth — `apps/web` cannot be used without it

## Local setup

```bash
corepack enable
pnpm install

cp apps/web/.env.example apps/web/.env.local
# then fill in apps/web/.env.local:
#   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY  -- from your Clerk app (use TEST keys, not pk_live_/sk_live_)
#   DATABASE_URL                                          -- your Postgres connection string

pnpm --filter @whisperm/repositories exec prisma migrate deploy --schema=../../prisma/schema.prisma
```

### Seed a demo workspace

```bash
DEMO_USER_EMAIL="you@example.com" pnpm seed:demo
```

Use the **same email address you'll sign in with via Clerk**. `apps/web` resolves your workspace
by matching your signed-in Clerk email against a `TenantUser` row
(`apps/web/src/lib/get-tenant.ts`) — there is no self-service "create your workspace" flow yet
(see Known gaps below), so this seed is currently the only way to attach a login to a populated
workspace. Re-running it is safe (idempotent).

This creates one tenant with:
- 5 CRM contacts/deals spread across the default pipeline's stages (Prospect → Renewal), for the Dashboard/Contacts/Deals/Reports pages
- 3 marketplace sellers captured at the "Captured" stage of the Seller Acquisition pipeline, each with a phone number and draft inventory already attached

It deliberately does **not** pre-seed "Invited"/"Claimed"/"Converted" sellers — those transitions
require real evidence (an actual invitation, an actual claim-portal attestation) to be trustworthy
state, so drive a couple of the seeded sellers through Invite → Claim → Convert live from the
Marketplace Acquisition board. That's also the strongest part of a demo: it proves the pipeline
actually works end to end rather than showing static data.

### Run it

```bash
pnpm --filter @whisperm/web dev
```

Visit `http://localhost:3000`, sign in with the Clerk account matching `DEMO_USER_EMAIL`, and you
should land on a populated dashboard.

## Tests / CI

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## Known gaps (see full review for detail)

- **No self-service signup.** Nothing creates a `TenantUser` row for a new sign-up — every workspace
  today is provisioned by a seed script (`prisma/demo-seed.mjs`, `prisma/founding-workspaces-seed.mjs`).
- **Billing (Stripe/Paystack) is not reachable from the live app.** That logic lives in `apps/api`,
  which nothing calls.
- **`apps/api` does not currently start.** Nothing in it calls `.listen()`; treat it as a library of
  routes/services that would need a bootstrap entrypoint before it could run as a service.
- **`apps/worker`'s queue is in-memory, not durable.** Anything meant to run asynchronously
  (trial reminders, scheduled campaign ticks, claim expiry) needs a real BullMQ/Redis wiring before
  it can be relied on unattended.
