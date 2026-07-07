# WhispeRM Production Deployment Runbook

**Issue:** [S4.8] Production deployment
**Target:** https://whisperm.io
**Stack:** Vercel (web), Railway (worker), Supabase (PostgreSQL), Redis (Railway)

There is no standalone API service. `apps/api` (a second, disconnected CRM/billing
implementation that never actually ran in production) was archived — all CRM, billing
(Stripe/Paystack), and self-serve signup logic lives in `apps/web`'s own Next.js API routes,
backed by `@whisperm/billing-runtime` and `@whisperm/repositories`.

---

## Pre-flight checklist

- [ ] Vercel account
- [ ] Supabase project (Pro plan)
- [ ] Railway account (worker only)
- [ ] Clerk application (production instance)
- [ ] Stripe dashboard
- [ ] Paystack dashboard
- [ ] Domain registrar for whisperm.io
- [ ] GitHub repo access

---

## 1. Database — Supabase PostgreSQL

### Provision
1. Create project at https://supabase.com/dashboard
2. Region: closest to primary users
3. Plan: Pro (required for backups and PITR)

### Connection strings (Project Settings → Database)
- Direct URL (migrations only): postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres
- Pooled URL (runtime):         postgresql://postgres.[REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true

Set DATABASE_URL = pooled URL in all runtime services.
Use direct URL for prisma migrate deploy only.

---

## 2. Database migration

MIGRATION SAFETY — VERIFIED SAFE
All migrations use CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
and DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$ guards.
Zero DROP TABLE, DROP COLUMN, or TRUNCATE statements found.

Run:
  export DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres"
  pnpm --filter @whisperm/repositories exec prisma migrate deploy --schema=../../prisma/schema.prisma

Verify:
  pnpm --filter @whisperm/repositories exec prisma db pull --print --schema=../../prisma/schema.prisma | head -30

Confirm tables: Tenant, TenantUser, Contact, Deal, Activity, Pipeline,
PipelineStage, Subscription, BillingWebhookEvent, OutboxEvent, InboxEvent, QueueJob, ScheduledJob

---

## 3. Environment variables

See `.env.example` in each app directory. Set all in platform secret storage — never in
committed files.

apps/web (Vercel):
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY,
  DATABASE_URL, NEXT_PUBLIC_APP_URL,
  STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  STRIPE_PRICE_STARTER, STRIPE_PRICE_GROWTH, STRIPE_PRICE_PRO,
  PAYSTACK_SECRET_KEY, NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY

apps/worker (Railway):
  DATABASE_URL, REDIS_URL, NODE_ENV

---

## 4. Deploy apps/web → Vercel

1. https://vercel.com/new → Import basewhisperm/whisperm
2. Root directory: apps/web
3. Framework: Next.js (auto-detected)
4. Add environment variables (section 3)
5. Deploy → verify https://whisperm.io returns 200

Every CRM, billing, and Seller Acquisition endpoint lives under `apps/web/src/app/api/*` and
deploys as part of this same Vercel deployment — no separate API service to configure.

---

## 5. Deploy apps/worker → Railway (long-running, NOT serverless)

**Status check (verify before relying on this section):** as of this writing, apps/worker's
production bootstrap (`apps/worker/src/index.ts`, `isMainModule()` block) wires `InMemoryQueueRuntime`
-- it registers job handlers and logs "worker started", but does not poll or consume any durable
queue. No BullMQ/Redis/SQS adapter is implemented anywhere in this repo despite REDIS_URL being
listed above; nothing in the codebase reads that variable. A "worker started" log line or a HEALTHY
readiness check from this process is true about its own bootstrap but is **not** proof that any
queued job (event ingestion, score recomputation, trial reminders, publish, scheduler) will ever
execute. Do not treat step 5's checklist below as verified until a real queue backend is wired in.
This does not block deploying apps/web: the seller-acquisition golden path (capture, campaign
assignment, invitation send, claim, CRM/deal update) executes synchronously inside apps/web request
handlers and does not depend on this worker process. Trial-reminder emails are similarly recorded
as durable `QueueJob` rows (`apps/web/src/lib/billing/notification-schedule-adapter.ts`) but are
not yet actually sent, for the same reason.

Intended design (once a real queue backend is implemented): worker runs BullMQ consumers with
persistent Redis connections.

Queues — intended to all be processing (unverified, see status check above):
  event.ingestion        | event.ingestion           | SDK event processing
  score-recomputation    | score.recompute           | Client health scores
  notification           | notification.trial_reminder | Trial reminder emails (D-3, D-1, D+0)
  publish                | publish.dispatch          | Outbound event publishing
  scheduler              | scheduler.tick            | Scheduled job dispatch

Deploy:
1. New Railway service → same repo
2. Root directory: apps/worker
3. Start command: node dist/index.js
4. Restart policy: Always
5. Add DATABASE_URL and REDIS_URL

Verify in Railway logs (presence of these lines confirms the process booted, not that jobs are
being consumed -- see status check above):
  [worker] event.ingestion-worker started
  [worker] score-recomputation-worker started
  [worker] notification-worker started
  [worker] publish-worker started
  [worker] scheduler-worker started

---

## 6. DNS — whisperm.io

  whisperm.io       A      76.76.21.21 (Vercel)
  www.whisperm.io   CNAME  cname.vercel-dns.com

Add whisperm.io and www.whisperm.io in Vercel Project Settings → Domains. TLS automatic.

Verify:
  curl -vI https://whisperm.io 2>&1 | grep -E "SSL|issuer|subject"

---

## 7. Webhooks

Stripe:
1. Stripe Dashboard → Webhooks → Add endpoint: https://whisperm.io/api/webhooks/stripe
2. Events: customer.subscription.created, customer.subscription.updated,
   customer.subscription.deleted, invoice.payment_succeeded, invoice.payment_failed
3. Copy signing secret → set as STRIPE_WEBHOOK_SECRET

Paystack:
1. Paystack Dashboard → Settings → Developer → Webhook URL: https://whisperm.io/api/webhooks/paystack
2. Signed via x-paystack-signature using PAYSTACK_SECRET_KEY — no separate webhook secret needed

---

## 8. Backups

Supabase Pro includes daily backups and 30-day PITR automatically.
1. Supabase Dashboard → Project → Database → Backups
2. Confirm at least one backup is visible
3. Restore: Dashboard → Database → Backups → Restore to point in time

---

## 9. Smoke test

1. Sign up with a fresh email at https://whisperm.io/sign-up
2. Confirm you land on a populated (if empty) dashboard, not an error — this exercises the
   self-serve auto-provisioning path (`apps/web/src/lib/get-tenant.ts`), which creates a
   trial `Tenant`/`TenantUser`/`Pipeline`/`Subscription` on first login.
3. Verify in Supabase: `SELECT status, "trialEndsAt" FROM "Subscription" WHERE "tenantId" = '[tenantId]'`
4. Create a contact and a deal from the UI; confirm they appear on the Dashboard/Pipeline
5. Capture a marketplace listing (Marketplace Acquisition → Capture)
6. From Settings → Billing, click "Upgrade to Growth" and confirm redirect to a live Stripe/Paystack checkout page (use a test card/test mode first)
7. Complete the test payment and confirm the workspace's plan updates within a few seconds (Stripe/Paystack webhook → `/api/webhooks/stripe` or `/api/webhooks/paystack`)
8. Cleanup: delete the smoke-test tenant from Supabase

---

## 10. Deployment checklist

  1.  Database connectivity        | prisma db pull succeeds                     | [ ]
  2.  Migrations applied           | All tables present in Supabase              | [ ]
  3.  Frontend health              | https://whisperm.io -> 200                  | [ ]
  4.  Worker health                | All 5 workers started in Railway logs       | [ ]
  5.  Self-serve signup            | Fresh sign-up lands on a populated dashboard | [ ]
  6.  Manual capture               | Capture a listing -> 201                    | [ ]
  7.  Dashboard load               | Dashboard renders contacts/pipeline value   | [ ]
  8.  TLS validity                 | Valid cert, not expired                     | [ ]
  9.  Backup status                | Supabase shows >= 1 backup                  | [ ]
  10. Stripe upgrade + webhook     | Test checkout completes, plan updates       | [ ]
  11. Paystack upgrade + webhook   | Test checkout completes, plan updates       | [ ]
  12. HSTS header                  | strict-transport-security present           | [ ]
  13. CSP header                   | content-security-policy present             | [ ]
  14. No secrets in logs           | Search Railway/Vercel logs                  | [ ]

---

## 11. Rollback plan

  Web        | Vercel -> Deployments -> Instant Rollback
  Worker     | Railway -> Deployments -> Redeploy previous
  Database   | No rollback needed — all migrations are expand-only
  DNS        | Revert A/CNAME (set TTL=60s before deploy)

---

## 12. Post-deployment

1. Swap test Stripe/Paystack keys for live keys
2. Delete smoke test workspace from Supabase
3. Monitor Railway worker logs for first 24h
4. Set up Railway restart alerts
5. Confirm first automated backup in Supabase dashboard within 24h
