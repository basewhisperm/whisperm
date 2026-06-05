# WhispeRM Production Deployment Runbook

**Issue:** [S4.8] Production deployment
**Target:** https://whisperm.io
**Stack:** Vercel (web), Railway (api + worker), Supabase (PostgreSQL), Redis (Railway)

---

## Pre-flight checklist

- [ ] Vercel account
- [ ] Supabase project (Pro plan)
- [ ] Railway account
- [ ] Stripe dashboard
- [ ] Paystack dashboard
- [ ] Resend account
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
  pnpm --filter @whisperm/api exec prisma migrate deploy

Verify:
  pnpm --filter @whisperm/api exec prisma db pull --print | head -30

Confirm tables: Tenant, TenantUser, Contact, Deal, Activity, Pipeline,
PipelineStage, Subscription, OutboxEvent, InboxEvent, QueueJob, ScheduledJob

---

## 3. Environment variables

See .env.example in each app directory. Set all in platform secret storage — never in committed files.

apps/api (Railway):
  DATABASE_URL, DIRECT_URL, JWT_SECRET, JWT_ISSUER,
  STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, PAYSTACK_SECRET_KEY,
  RESEND_API_KEY, EMAIL_FROM, REDIS_URL, NODE_ENV

apps/web (Vercel):
  NEXT_PUBLIC_API_URL, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY

apps/worker (Railway):
  DATABASE_URL, REDIS_URL, NODE_ENV

---

## 4. Deploy apps/web → Vercel

1. https://vercel.com/new → Import basewhisperm/whisperm
2. Root directory: apps/web
3. Framework: Next.js (auto-detected)
4. Add environment variables
5. Deploy → verify returns 200

---

## 5. Deploy apps/api → Railway

The API is a persistent Node.js HTTP server — NOT serverless.

1. New Railway project → Deploy from GitHub → basewhisperm/whisperm
2. Root directory: apps/api
3. Start command: node dist/index.js
4. Build command: pnpm --filter @whisperm/api build
5. Add Redis service in same project → copy REDIS_URL
6. Add all environment variables
7. Add custom domain api.whisperm.io → Railway provisions TLS automatically

Verify:
  curl https://api.whisperm.io/healthz
  -> {"ok":true,"data":{"status":"ok"}}

  curl https://api.whisperm.io/readyz
  -> {"ok":true,"data":{"status":"ready"}}

---

## 6. Deploy apps/worker → Railway (long-running, NOT serverless)

Worker runs BullMQ consumers with persistent Redis connections.

Queues — all 5 must be processing:
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

Verify in Railway logs:
  [worker] event.ingestion-worker started
  [worker] score-recomputation-worker started
  [worker] notification-worker started
  [worker] publish-worker started
  [worker] scheduler-worker started

---

## 7. DNS — whisperm.io

  whisperm.io       A      76.76.21.21 (Vercel)
  www.whisperm.io   CNAME  cname.vercel-dns.com
  api.whisperm.io   CNAME  Railway-provided domain

Add whisperm.io and www.whisperm.io in Vercel Project Settings → Domains. TLS automatic.

Verify:
  curl -vI https://whisperm.io 2>&1 | grep -E "SSL|issuer|subject"

---

## 8. Webhooks

Stripe:
1. Stripe Dashboard → Webhooks → Add endpoint: https://api.whisperm.io/webhooks/stripe
2. Events: customer.subscription.created, customer.subscription.updated,
   customer.subscription.deleted, invoice.payment_succeeded, invoice.payment_failed
3. Copy signing secret → set as STRIPE_WEBHOOK_SECRET

Paystack:
1. Paystack Dashboard → Settings → Developer → Webhook URL: https://api.whisperm.io/webhooks/paystack
2. Signed via x-paystack-signature using PAYSTACK_SECRET_KEY — no separate webhook secret needed

---

## 9. Backups

Supabase Pro includes daily backups and 30-day PITR automatically.
1. Supabase Dashboard → Project → Database → Backups
2. Confirm at least one backup is visible
3. Restore: Dashboard → Database → Backups → Restore to point in time

---

## 10. Smoke test

  BASE=https://api.whisperm.io

  # 1. Health
  curl $BASE/healthz

  # 2. Create workspace
  curl -X POST $BASE/workspaces \
    -H "Content-Type: application/json" \
    -d '{"userId":"smoke-u1","userEmail":"smoke@whisperm.io","firmName":"Smoke Test Co","country":"US"}'

  # 3. Verify trial subscription in Supabase:
  # SELECT status, "trialEndsAt" FROM "Subscription" WHERE "tenantId" = '[workspaceId]';

  # 4. Create contact
  curl -X POST $BASE/contacts \
    -H "Content-Type: application/json" \
    -H "x-tenant-id: [workspaceId]" \
    -d '{"email":"client@example.com","stage":"PROSPECT"}'

  # 5. View dashboard
  curl $BASE/dashboard -H "x-tenant-id: [workspaceId]"

  # 6. Verify worker logs show job processing in Railway

  # 7. Cleanup
  # DELETE FROM "Tenant" WHERE name = 'Smoke Test Co';

---

## 11. Deployment checklist

  1.  Database connectivity        | prisma db pull succeeds                  | [ ]
  2.  Migrations applied           | All tables present in Supabase           | [ ]
  3.  API health                   | GET /healthz -> 200                      | [ ]
  4.  Frontend health              | https://whisperm.io -> 200               | [ ]
  5.  Worker health                | All 5 workers started in Railway logs    | [ ]
  6.  Queue processing             | Job visible in logs after workspace create | [ ]
  7.  Signup flow                  | Google OAuth redirect works              | [ ]
  8.  Workspace creation           | POST /workspaces -> 201                  | [ ]
  9.  Contact creation             | POST /contacts -> 201                    | [ ]
  10. Activity creation            | Activity endpoint -> 201                 | [ ]
  11. Dashboard load               | GET /dashboard -> 200                    | [ ]
  12. TLS validity                 | Valid cert, not expired                  | [ ]
  13. Backup status                | Supabase shows >= 1 backup               | [ ]
  14. Stripe webhook               | Test event -> 200                        | [ ]
  15. Paystack webhook             | Test event -> 200                        | [ ]
  16. HSTS header                  | strict-transport-security present        | [ ]
  17. CSP header                   | content-security-policy present          | [ ]
  18. No secrets in logs           | Search Railway/Vercel logs               | [ ]

---

## 12. Rollback plan

  Web        | Vercel -> Deployments -> Instant Rollback
  API/Worker | Railway -> Deployments -> Redeploy previous
  Database   | No rollback needed — all migrations are expand-only
  DNS        | Revert A/CNAME (set TTL=60s before deploy)

---

## 13. Post-deployment

1. Swap test Stripe/Paystack keys for live keys
2. Delete smoke test workspace from Supabase
3. Monitor Railway worker logs for first 24h
4. Set up Railway restart alerts
5. Confirm first automated backup in Supabase dashboard within 24h
